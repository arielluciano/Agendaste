// ==============================
// Cobro por plan: cambio de plan y fin del precio fundador (Mercado Pago PreApproval)
// ==============================
// El monto de la suscripción = monthly_price del plan (50% si founder_until está vigente).
// Cambiar de plan o terminar el precio fundador actualiza el monto del PreApproval existente
// (preApproval.update con auto_recurring.transaction_amount): aplica desde el próximo cobro, sin prorrateo.
const { founderPrice, planPrice } = require('./access');

const getDb = () => require('../config/database');
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const FOUNDER_NOTICE_DAYS = 7;

// 'AAAA-MM-DD' en hora argentina
function dayAR(d) {
  return new Date(new Date(d).getTime() - AR_OFFSET_MS).toISOString().slice(0, 10);
}

function updateAmount(preApproval, preapprovalId, amount) {
  return preApproval.update({
    id: preapprovalId,
    body: { auto_recurring: { transaction_amount: amount, currency_id: 'ARS' } }
  });
}

// Última suscripción del negocio
async function latestSubscription(q, businessId) {
  const r = await q.query(
    'SELECT * FROM subscriptions WHERE business_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
    [businessId]
  );
  return r.rows[0] || null;
}

// Cambia el plan de una suscripción activa. Si Mercado Pago rechaza el cambio no se toca nada en la base.
// Devuelve { plan, amount } o { status, error }.
async function changePlan(businessId, planCode, deps = {}) {
  const q = deps.db || getDb();
  const now = deps.now || Date.now();

  const planRes = await q.query('SELECT * FROM plans WHERE code = $1', [String(planCode || '')]);
  const plan = planRes.rows[0];
  if (!plan) return { status: 400, error: 'Ese plan no existe.' };

  const bizRes = await q.query(
    `SELECT b.plan_id, b.founder_until, o.plan AS owner_plan
       FROM businesses b LEFT JOIN owners o ON o.business_id = b.id
      WHERE b.id = $1 LIMIT 1`,
    [businessId]
  );
  const biz = bizRes.rows[0];
  if (!biz) return { status: 404, error: 'Negocio no encontrado' };

  const sub = await latestSubscription(q, businessId);
  if (biz.owner_plan !== 'active' || !sub || sub.status !== 'authorized' || !sub.mp_preapproval_id) {
    return { status: 409, error: 'Para cambiar de plan necesitás una suscripción activa.' };
  }
  if (Number(biz.plan_id) === Number(plan.id)) {
    return { status: 409, error: `Ya estás en el plan ${plan.name}.` };
  }

  const amount = planPrice(plan, biz.founder_until, now);
  try {
    await updateAmount(deps.preApproval, sub.mp_preapproval_id, amount);
  } catch (err) {
    console.error(`Error cambiando de plan en MP (negocio ${businessId}):`, err.message);
    return { status: 502, error: 'Mercado Pago no aceptó el cambio de plan. No se cambió nada: probá de nuevo en unos minutos.' };
  }

  await q.query(
    'UPDATE subscriptions SET amount = $1, plan_id = $2, updated_at = NOW() WHERE id = $3',
    [amount, plan.id, sub.id]
  );
  await q.query('UPDATE businesses SET plan_id = $1 WHERE id = $2', [plan.id, businessId]);
  return { plan, amount };
}

// Suscripciones activas de negocios fundadores (con su plan y la última suscripción)
const FOUNDER_SUBS_SQL = `
  SELECT b.id, b.name, b.founder_until, o.email,
         p.name AS plan_name, p.monthly_price,
         s.id AS subscription_id, s.mp_preapproval_id, s.amount
    FROM businesses b
    JOIN owners o ON o.business_id = b.id
    JOIN plans  p ON p.id = b.plan_id
    JOIN LATERAL (
      SELECT * FROM subscriptions WHERE business_id = b.id ORDER BY created_at DESC, id DESC LIMIT 1
    ) s ON true
   WHERE b.founder_until IS NOT NULL
     AND o.plan = 'active'
     AND s.status = 'authorized'
     AND s.mp_preapproval_id IS NOT NULL`;

// Reclama un aviso/intento (true si es la primera vez para ese período)
async function claimNotice(q, businessId, period, kind) {
  const r = await q.query(
    `INSERT INTO plan_usage_notices (business_id, period, kind) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING kind`,
    [businessId, period, kind]
  );
  return r.rows.length > 0;
}

// Corre en cada pasada del cron (es idempotente):
//  1. Faltando 7 días o menos para founder_until: mail al dueño, una sola vez.
//  2. Vencido founder_until y todavía cobrando el precio fundador: se actualiza el PreApproval al precio
//     completo. Un intento por día (si falla, se reintenta al día siguiente); si ya está actualizado, nada.
// deps: { db, preApproval, sendEmail, now }
async function runFounderJobs(deps = {}) {
  const q   = deps.db || getDb();
  const now = deps.now || Date.now();
  const sendEmail = deps.sendEmail || require('./email').sendFounderEndingEmail;
  const out = { notified: [], updated: [], failed: [] };

  const rows = (await q.query(FOUNDER_SUBS_SQL)).rows;
  for (const r of rows) {
    const ends = new Date(r.founder_until).getTime();
    const full = Number(r.monthly_price);

    // 1. Aviso 7 días antes
    if (ends > now && ends - now <= FOUNDER_NOTICE_DAYS * 864e5) {
      if (await claimNotice(q, r.id, dayAR(ends), 'founder_ending')) {
        try {
          await sendEmail({
            to: r.email, businessName: r.name, planName: r.plan_name,
            endsAt: r.founder_until, amount: full, currentAmount: Number(r.amount)
          });
          out.notified.push(r.id);
        } catch (err) {
          console.error(`⚠️ Aviso de fin de precio fundador (negocio ${r.id}): ${err.message}`);
          await q.query(
            `DELETE FROM plan_usage_notices WHERE business_id = $1 AND period = $2 AND kind = 'founder_ending'`,
            [r.id, dayAR(ends)]
          ).catch(() => {});
        }
      }
    }

    // 2. Al vencer: precio completo. Solo si sigue cobrando exactamente el precio fundador de su plan
    // (así un cambio de precio del catálogo nunca se aplica solo).
    if (ends <= now && Number(r.amount) === founderPrice(full) && Number(r.amount) !== full) {
      if (!(await claimNotice(q, r.id, dayAR(now), 'founder_price_update'))) continue; // ya se intentó hoy
      try {
        await updateAmount(deps.preApproval, r.mp_preapproval_id, full);
        await q.query('UPDATE subscriptions SET amount = $1, updated_at = NOW() WHERE id = $2', [full, r.subscription_id]);
        out.updated.push(r.id);
      } catch (err) {
        console.error(`Error actualizando precio fundador → completo (negocio ${r.id}, preapproval ${r.mp_preapproval_id}):`, err.message);
        out.failed.push(r.id);
      }
    }
  }
  return out;
}

module.exports = { changePlan, runFounderJobs, latestSubscription, dayAR, FOUNDER_NOTICE_DAYS };
