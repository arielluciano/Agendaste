// ==============================
// Tareas programadas (las dispara GitHub Actions, ver .github/workflows/keep-alive.yml)
// ==============================
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../config/database');
const { sendReminderEmail } = require('../services/email');
const { runFounderJobs } = require('../services/billing');
const { loadPlanContext, getPlanFeatures, brandForPlan } = require('../services/access');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');

const preApproval = new PreApproval(new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN }));

// Misma zona que todayAR()/nowMinutesAR() en routes/appointments.js (Argentina, -03:00 sin horario de verano)
const TZ_AR = 'America/Argentina/Buenos_Aires';

// Cuánto antes del turno sale el recordatorio
const REMIND_LONG  = '24 hours'; // turnos reservados con 24 h o más de anticipación
const REMIND_SHORT = '2 hours';  // turnos reservados con menos de 24 h
// El cron corre cada 10 min pero GitHub Actions a veces se atrasa: margen para no perder
// el recordatorio de 2 h. Pasado este margen (o sea, faltando menos de 1 h 30) no se manda nada.
const SHORT_GRACE  = '30 minutes';
const BATCH_SIZE   = 20;
const SEND_GAP_MS  = 600; // Resend limita a ~2 envíos por segundo

// ── Auth: header x-cron-secret contra CRON_SECRET ──
function requireCronSecret(req, res, next) {
  const expected = process.env.CRON_SECRET;
  const given    = req.get('x-cron-secret');
  if (!expected || !given) return res.status(401).json({ error: 'No autorizado' });
  // Comparación en tiempo constante (se hashea para igualar longitudes)
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'No autorizado' });
  next();
}

// Turnos que necesitan recordatorio ahora mismo.
//   start   = fecha+hora del turno interpretada en hora argentina
//   created = created_at (timestamp sin zona, guardado en UTC: es el TimeZone de la base)
//   - Reservado con >= 24 h:  se manda cuando faltan entre 24 h y 2 h.
//   - Reservado con <  24 h:  se manda cuando faltan 2 h (con el margen SHORT_GRACE),
//                             y solo si al reservar faltaban más de 2 h.
//   - Faltando menos de 2 h sin haberlo mandado: nada (salvo el margen del caso corto).
const DUE_SQL = `
  SELECT a.id
    FROM appointments a,
         LATERAL (SELECT (a.date + a.time) AT TIME ZONE $1 AS start,
                         COALESCE(a.created_at AT TIME ZONE 'UTC', '-infinity'::timestamptz) AS created) t
   WHERE a.client_email IS NOT NULL
     AND a.reminder_sent_at IS NULL
     AND a.status IS DISTINCT FROM 'cancelled'
     AND a.date BETWEEN (now() AT TIME ZONE $1)::date AND (now() AT TIME ZONE $1)::date + 2
     AND (
           (t.start - t.created >= interval '${REMIND_LONG}'
             AND t.start <= now() + interval '${REMIND_LONG}'
             AND t.start >= now() + interval '${REMIND_SHORT}')
        OR (t.start - t.created <  interval '${REMIND_LONG}'
             AND t.start - t.created > interval '${REMIND_SHORT}'
             AND t.start <= now() + interval '${REMIND_SHORT}'
             AND t.start >  now() + interval '${REMIND_SHORT}' - interval '${SHORT_GRACE}')
         )
   ORDER BY a.date, a.time`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Precio fundador (ver services/billing.js): aviso 7 días antes y, al vencer, PreApproval al precio completo.
// Es idempotente y va en el mismo cron que los recordatorios; si falla no frena los recordatorios.
async function founderJobs() {
  try {
    const r = await runFounderJobs({ preApproval });
    if (r.notified.length || r.updated.length || r.failed.length) {
      console.log(`💸 Precio fundador: ${r.notified.length} avisos, ${r.updated.length} actualizados, ${r.failed.length} fallidos`);
    }
    return r;
  } catch (err) {
    console.error('Error en tareas de precio fundador:', err.message);
    return { error: true };
  }
}

// POST /api/cron/reminders → manda los recordatorios pendientes (y corre las tareas de precio fundador)
// ?dry=1 → solo lista qué turnos se mandarían, sin marcar ni enviar nada
router.post('/reminders', requireCronSecret, async (req, res) => {
  try {
    if (req.query.dry === '1') {
      const due = await db.query(DUE_SQL, [TZ_AR]);
      return res.json({ dry: true, due: due.rows.map(r => r.id) });
    }

    // Reclamar los turnos (marcar reminder_sent_at) ANTES de mandar, en una sola sentencia.
    // Si dos corridas del cron se superponen, la segunda espera el lock de la fila y Postgres
    // vuelve a evaluar "reminder_sent_at IS NULL" sobre la versión ya marcada → la saltea.
    // Así cada turno lo reclama una sola corrida y el mail nunca sale dos veces.
    const claimed = await db.query(
      `WITH claimed AS (
         UPDATE appointments
            SET reminder_sent_at = now()
          WHERE id IN (SELECT id FROM (${DUE_SQL}) due LIMIT ${BATCH_SIZE})
            AND reminder_sent_at IS NULL
         RETURNING *
       )
       SELECT c.id, c.client_name, c.client_email,
              c.date::text AS date, to_char(c.time, 'HH24:MI') AS time,
              s.name AS service, b.name AS barber, to_jsonb(biz) AS business
         FROM claimed c
         LEFT JOIN services   s   ON s.id   = c.service_id
         LEFT JOIN barbers    b   ON b.id   = c.barber_id
         LEFT JOIN businesses biz ON biz.id = c.business_id
        ORDER BY c.date, c.time`,
      [TZ_AR]
    );

    // Marca del mail según el plan (mismo criterio que la página pública), una consulta por negocio
    const featuresByBiz = new Map();
    const businessForMail = async (biz) => {
      if (!biz) return biz;
      if (!featuresByBiz.has(biz.id)) {
        featuresByBiz.set(biz.id, await loadPlanContext(biz.id).then(getPlanFeatures).catch((err) => {
          console.error(`⚠️ Plan del negocio ${biz.id} (recordatorio):`, err.message);
          return null; // sin plan legible: el mail sale como siempre
        }));
      }
      const features = featuresByBiz.get(biz.id);
      return features ? brandForPlan(biz, features) : biz;
    };

    let sent = 0;
    const failed = [];
    for (const [i, appt] of claimed.rows.entries()) {
      if (i > 0) await sleep(SEND_GAP_MS);
      try {
        await sendReminderEmail({
          to:         appt.client_email,
          clientName: appt.client_name,
          business:   await businessForMail(appt.business),
          service:    appt.service,
          barber:     appt.barber,
          date:       appt.date,
          time:       appt.time
        });
        sent++;
      } catch (err) {
        // Liberar el turno para reintentar en la próxima corrida (si todavía está dentro de la ventana)
        console.error(`⚠️ Recordatorio turno ${appt.id}: ${err.message}`);
        failed.push(appt.id);
        await db.query('UPDATE appointments SET reminder_sent_at = NULL WHERE id = $1', [appt.id])
          .catch(e => console.error(`⚠️ No se pudo liberar el turno ${appt.id}: ${e.message}`));
      }
    }

    if (claimed.rows.length) console.log(`⏰ Recordatorios: ${sent} enviados, ${failed.length} fallidos`);
    const founder = await founderJobs();
    res.json({ claimed: claimed.rows.length, sent, failed, founder });
  } catch (err) {
    console.error('Error POST /api/cron/reminders:', err.message);
    res.status(500).json({ error: 'Error procesando recordatorios' });
  }
});

module.exports = router;
