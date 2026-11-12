// ==============================
// Uso mensual de turnos y avisos de límite (límite blando: nunca corta una reserva)
// ==============================
// Se cuentan los turnos NO cancelados creados en el mes calendario de Argentina.
// Al 80% y al 100% del límite del plan: aviso en el panel y un mail al dueño, una sola vez
// por umbral por mes (plan_usage_notices, clave negocio + período + tipo).
const { loadPlanContext, getPlanFeatures, planPrice } = require('./access');

const getDb = () => require('../config/database');
const AR_OFFSET_MS = 3 * 60 * 60 * 1000; // Argentina: UTC-3 todo el año (sin horario de verano)
const USAGE_THRESHOLDS = [80, 100];

// Mes calendario de Argentina que contiene `now`: { period: 'AAAA-MM', start, end } (start/end en UTC)
function monthRangeAR(now = new Date()) {
  const ar = new Date(new Date(now).getTime() - AR_OFFSET_MS);
  const y = ar.getUTCFullYear();
  const m = ar.getUTCMonth();
  return {
    period: `${y}-${String(m + 1).padStart(2, '0')}`,
    start:  new Date(Date.UTC(y, m, 1) + AR_OFFSET_MS),
    end:    new Date(Date.UTC(y, m + 1, 1) + AR_OFFSET_MS)
  };
}

// 0 = sin aviso, 80 o 100 = umbral alcanzado
function usageLevel(count, limit) {
  if (!limit || limit <= 0) return 0;
  if (count >= limit) return 100;
  if (count * 100 >= limit * 80) return 80;
  return 0;
}

function usageMessage(count, limit) {
  return `Usaste ${count} de ${limit} turnos este mes`;
}

// created_at es timestamp sin zona guardado en UTC (TimeZone de la base): se compara como UTC
async function countMonthlyAppointments(businessId, now = new Date(), q = getDb()) {
  const { start, end } = monthRangeAR(now);
  const r = await q.query(
    `SELECT COUNT(*)::int AS n FROM appointments
      WHERE business_id = $1
        AND status IS DISTINCT FROM 'cancelled'
        AND created_at AT TIME ZONE 'UTC' >= $2::timestamptz
        AND created_at AT TIME ZONE 'UTC' <  $3::timestamptz`,
    [businessId, start.toISOString(), end.toISOString()]
  );
  return r.rows[0].n;
}

// Uso del mes para el panel. features = getPlanFeatures(...)
async function getUsage(businessId, features, now = new Date(), q = getDb()) {
  const limit = features && features.monthly_appointment_limit;
  const count = await countMonthlyAppointments(businessId, now, q);
  const level = usageLevel(count, limit);
  return {
    period: monthRangeAR(now).period,
    count,
    limit: limit || null,
    level,
    message: limit && level ? usageMessage(count, limit) : null
  };
}

// Después de cada reserva: si se cruzó un umbral, se reclama el aviso y se manda el mail.
// Reclamar con INSERT ... ON CONFLICT DO NOTHING hace que dos reservas simultáneas no manden dos mails.
// Si el mail falla, se libera el aviso para que lo intente la próxima reserva.
// deps (para tests): { db, sendEmail, now }
async function notifyUsageIfNeeded(businessId, deps = {}) {
  const q   = deps.db || getDb();
  const now = deps.now || new Date();
  const sendEmail = deps.sendEmail || require('./email').sendPlanUsageEmail;

  const ctx = await loadPlanContext(businessId, q);
  if (!ctx) return null;
  const features = getPlanFeatures(ctx, new Date(now).getTime());
  const limit = features.monthly_appointment_limit;
  if (!limit) return null;

  const count = await countMonthlyAppointments(businessId, now, q);
  const level = usageLevel(count, limit);
  if (!level) return null;

  const { period } = monthRangeAR(now);
  const kinds = USAGE_THRESHOLDS.filter((t) => t <= level).map((t) => `usage_${t}`);
  const claimed = await q.query(
    `INSERT INTO plan_usage_notices (business_id, period, kind)
     SELECT $1, $2, k FROM unnest($3::text[]) AS k
     ON CONFLICT DO NOTHING
     RETURNING kind`,
    [businessId, period, kinds]
  );
  if (!claimed.rows.length) return null;

  // Si se cruzaron los dos umbrales de golpe, un solo mail (el más alto)
  const threshold = Math.max(...claimed.rows.map((r) => Number(String(r.kind).replace('usage_', ''))));
  const plans = Array.isArray(ctx.plans) ? ctx.plans : [];
  const idx = plans.findIndex((p) => p.code === features.code);
  const next = idx >= 0 ? plans[idx + 1] : null;

  try {
    const info = await q.query(
      `SELECT b.name, o.email FROM businesses b LEFT JOIN owners o ON o.business_id = b.id WHERE b.id = $1 LIMIT 1`,
      [businessId]
    );
    const row = info.rows[0] || {};
    await sendEmail({
      to: row.email,
      businessName: row.name,
      planName: features.name,
      count,
      limit,
      threshold,
      nextPlan: next ? { name: next.name, limit: next.monthly_appointment_limit, price: planPrice(next, ctx.founder_until, new Date(now).getTime()) } : null
    });
  } catch (err) {
    console.error(`⚠️ Aviso de uso negocio ${businessId}: ${err.message}`);
    await q.query(
      'DELETE FROM plan_usage_notices WHERE business_id = $1 AND period = $2 AND kind = ANY($3::text[])',
      [businessId, period, claimed.rows.map((r) => r.kind)]
    ).catch((e) => console.error(`⚠️ No se pudo liberar el aviso de uso ${businessId}: ${e.message}`));
    return null;
  }
  return { period, count, limit, threshold };
}

module.exports = { USAGE_THRESHOLDS, monthRangeAR, usageLevel, usageMessage, countMonthlyAppointments, getUsage, notifyUsageIfNeeded };
