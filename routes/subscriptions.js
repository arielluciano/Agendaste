// ==============================
// Rutas de suscripción — Mercado Pago
// ==============================
const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { requireAuthNoTrialGate } = require('../middleware/auth');
const { getAccess, loadPlanContext, getPlanFeatures, isFounderActive, planPrice, PLAN_FLAGS } = require('../services/access');
const { getUsage } = require('../services/usage');
const { changePlan, latestSubscription } = require('../services/billing');
const {
  MercadoPagoConfig,
  PreApproval,
  Payment,
  WebhookSignatureValidator
} = require('mercadopago');

// El monto sale del plan elegido (tabla plans, ver migrations/010_plans.sql), con 50% si es fundador.

const mpConfig    = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const preApproval = new PreApproval(mpConfig);
const mpPayment   = new Payment(mpConfig);

// Aplica el estado "cancelada" tanto si llega por el endpoint manual como por el webhook de MP.
// access_until = next_payment_date que tenía agendado MP → el dueño conserva acceso hasta esa fecha.
async function applyCancellation(businessId, preapprovalId, nextPaymentDate) {
  const accessUntil = nextPaymentDate || new Date().toISOString();

  await db.query(
    `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE mp_preapproval_id = $1`,
    [preapprovalId]
  );
  await db.query(
    `UPDATE owners SET plan = 'cancelled', access_until = $1 WHERE business_id = $2`,
    [accessUntil, businessId]
  );

  return accessUntil;
}

// Consulta el preapproval en MP y sincroniza subscriptions/owners con su estado actual.
// Punto único de procesamiento: lo usan tanto las notificaciones de subscription_preapproval
// como las de subscription_authorized_payment (una vez resuelto el preapproval asociado al pago).
async function processPreapprovalUpdate(preapprovalId) {
  const preapprovalData = await preApproval.get({ id: preapprovalId });
  const status     = preapprovalData.status;
  const businessId = parseInt(preapprovalData.external_reference, 10);

  if (status === 'cancelled') {
    if (businessId) {
      await applyCancellation(businessId, preapprovalId, preapprovalData.next_payment_date);
    }
    return;
  }

  await db.query(
    `UPDATE subscriptions SET status = $1, updated_at = NOW() WHERE mp_preapproval_id = $2`,
    [status, preapprovalId]
  );

  if (businessId) {
    // Autorizada: el plan de esa suscripción pasa a ser el plan del negocio
    if (status === 'authorized') {
      await db.query(
        `UPDATE businesses b SET plan_id = s.plan_id
           FROM subscriptions s
          WHERE s.mp_preapproval_id = $1 AND s.plan_id IS NOT NULL AND b.id = s.business_id AND b.id = $2`,
        [preapprovalId, businessId]
      );
    }
    const newPlan = status === 'authorized' ? 'active' : 'trial';
    // Un preapproval que no se autoriza no baja una cuenta de cortesía a 'trial'
    await db.query(
      `UPDATE owners SET plan = $1 WHERE business_id = $2 AND NOT (plan = 'courtesy' AND $1 = 'trial')`,
      [newPlan, businessId]
    );
  }
}

// POST /api/subscriptions/create { plan: 'inicial' | 'pro' | 'plus' } → crea la suscripción en MP y devuelve el link de pago
router.post('/create', requireAuthNoTrialGate, async (req, res) => {
  const bizId = req.businessId;
  const planCode = String(req.body?.plan || '');

  try {
    // Cortesía vigente: no se cobra
    const access = await getAccess(bizId);
    if (access?.courtesyActive) {
      return res.status(400).json({ error: 'Tu cuenta es de cortesía: no hace falta suscribirse.' });
    }

    const bizResult = await db.query('SELECT * FROM businesses WHERE id = $1', [bizId]);
    const business = bizResult.rows[0];
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    const planResult = await db.query('SELECT * FROM plans WHERE code = $1', [planCode]);
    const plan = planResult.rows[0];
    if (!plan) return res.status(400).json({ error: 'Elegí un plan.' });

    // Con una suscripción activa no se crea otra: se cambia de plan (POST /change-plan)
    const current = await latestSubscription(db, bizId);
    if (access?.subscriptionActive && current?.status === 'authorized') {
      return res.status(409).json({ error: 'Ya tenés una suscripción activa. Cambiá de plan desde Suscripción.' });
    }

    const ownerResult = await db.query('SELECT * FROM owners WHERE business_id = $1 LIMIT 1', [bizId]);
    const owner = ownerResult.rows[0];

    const amount = planPrice(plan, business.founder_until);

    const subscription = await preApproval.create({
      body: {
        reason: `Agendaste — Plan ${plan.name} · ${business.name}`,
        external_reference: String(bizId),
        payer_email: owner?.email,
        // MP exige una URL pública con HTTPS — en local hay que setear BASE_URL (ej. túnel ngrok)
        back_url: `${process.env.BASE_URL || `${req.protocol}://${req.get('host')}`}/panel`,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: amount,
          currency_id: 'ARS'
        },
        status: 'pending'
      }
    });

    await db.query(
      `INSERT INTO subscriptions (business_id, mp_preapproval_id, status, amount, plan_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [bizId, subscription.id, subscription.status || 'pending', amount, plan.id]
    );

    res.json({ init_point: subscription.init_point, amount, plan: plan.code });
  } catch (err) {
    console.error('Error creando suscripción MP:', err.message);
    res.status(500).json({ error: 'Error creando la suscripción' });
  }
});

// POST /api/subscriptions/change-plan { plan } → actualiza el monto del PreApproval (desde el próximo cobro).
// Si Mercado Pago rechaza el cambio, el plan del negocio no se toca.
router.post('/change-plan', requireAuthNoTrialGate, async (req, res) => {
  try {
    const r = await changePlan(req.businessId, req.body?.plan, { preApproval });
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json({ success: true, plan: r.plan.code, plan_name: r.plan.name, amount: r.amount });
  } catch (err) {
    console.error('Error POST /api/subscriptions/change-plan:', err.message);
    res.status(500).json({ error: 'Error cambiando de plan' });
  }
});

// POST /api/subscriptions/webhook → notificaciones de Mercado Pago (formato Webhooks moderno)
// Eventos manejados: subscription_preapproval (cambios de estado de la suscripción)
// y subscription_authorized_payment (cobro de la cuota mensual).
router.post('/webhook', async (req, res) => {
  // 1) Validar la firma antes de tocar nada. Sin esto, cualquiera podría pegarle
  // a este endpoint con notificaciones falsas para activar/cancelar suscripciones ajenas.
  try {
    WebhookSignatureValidator.validate({
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
      dataId: req.query['data.id'],
      secret: process.env.MP_WEBHOOK_SECRET
    });
  } catch (err) {
    console.error('Webhook MP: firma inválida —', err.message);
    return res.sendStatus(401);
  }

  // 2) Firma válida: procesar el evento. Errores acá se loguean pero igual
  // respondemos 200 para que MP no reintente indefinidamente una notificación
  // que de todos modos no vamos a poder procesar.
  try {
    const type   = req.body?.type;
    const dataId = req.body?.data?.id;

    if (type === 'subscription_preapproval' && dataId) {
      await processPreapprovalUpdate(dataId);
    } else if (type === 'subscription_authorized_payment' && dataId) {
      const paymentData   = await mpPayment.get({ id: dataId });
      const preapprovalId = paymentData?.point_of_interaction?.transaction_data?.subscription_id;
      if (preapprovalId) {
        await processPreapprovalUpdate(preapprovalId);
      }
    }
    // Otros tipos de notificación (ej. "payment" sueltos) no son relevantes para
    // suscripciones y se ignoran sin error.

    res.sendStatus(200);
  } catch (err) {
    console.error('Error procesando webhook de Mercado Pago:', err.message);
    res.sendStatus(200);
  }
});

// GET /api/subscriptions/status → estado de suscripción del negocio actual
router.get('/status', requireAuthNoTrialGate, async (req, res) => {
  try {
    const owner = (await getAccess(req.businessId)) || {};

    const subResult = await db.query(
      'SELECT status, amount FROM subscriptions WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.businessId]
    );
    const subscription = subResult.rows[0] || null;

    const trialEndsAt = owner.trial_ends_at || null;
    const msLeft      = trialEndsAt ? new Date(trialEndsAt).getTime() - Date.now() : 0;
    const trialActive = msLeft > 0;
    const daysLeft    = trialActive ? Math.ceil(msLeft / (1000 * 60 * 60 * 24)) : 0;

    // Plan, funciones, precios (con precio fundador si corresponde) y uso del mes
    const ctx      = await loadPlanContext(req.businessId);
    const features = getPlanFeatures(ctx);
    const founderActive = isFounderActive(ctx?.founder_until);
    const plans = (ctx?.plans || []).map((p) => {
      const plan = {
        code: p.code, name: p.name,
        monthly_price: Number(p.monthly_price),
        price: planPrice(p, ctx.founder_until),
        monthly_appointment_limit: Number(p.monthly_appointment_limit)
      };
      for (const k of PLAN_FLAGS) plan[k] = !!p[k];
      return plan;
    });
    const current = plans.find((p) => (ctx?.plans || []).some((x) => Number(x.id) === Number(ctx.plan_id) && x.code === p.code)) || null;
    const usage = await getUsage(req.businessId, features);

    res.json({
      plan: owner.plan || 'trial',
      trial_ends_at: trialEndsAt,
      trial_active: trialActive,
      days_left: daysLeft,
      subscription_status: subscription?.status || null,
      subscription_amount: subscription?.amount || null,
      access_until: owner.access_until || null,
      // Cortesía vigente: acceso completo, sin cobro ni banner de prueba. courtesy_until null = sin vencimiento
      courtesy_active: !!owner.courtesyActive,
      courtesy_until: owner.courtesyActive ? owner.courtesy_until : null,
      plan_code: current?.code || null,
      plan_name: current?.name || null,
      features,
      plans,
      founder_active: founderActive,
      founder_until: founderActive ? ctx.founder_until : null,
      usage
    });
  } catch (err) {
    console.error('Error GET /api/subscriptions/status:', err.message);
    res.status(500).json({ error: 'Error obteniendo estado de suscripción' });
  }
});

// POST /api/subscriptions/cancel → el dueño cancela su propia suscripción
router.post('/cancel', requireAuthNoTrialGate, async (req, res) => {
  const bizId = req.businessId;

  try {
    const subResult = await db.query(
      'SELECT * FROM subscriptions WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1',
      [bizId]
    );
    const subscription = subResult.rows[0];

    if (!subscription || !subscription.mp_preapproval_id) {
      return res.status(404).json({ error: 'No se encontró una suscripción para cancelar' });
    }
    if (subscription.status === 'cancelled') {
      return res.status(409).json({ error: 'La suscripción ya está cancelada' });
    }

    const updated = await preApproval.update({
      id: subscription.mp_preapproval_id,
      body: { status: 'cancelled' }
    });

    const accessUntil = await applyCancellation(bizId, subscription.mp_preapproval_id, updated.next_payment_date);

    res.json({ success: true, access_until: accessUntil });
  } catch (err) {
    console.error('Error cancelando suscripción MP:', err.message);
    res.status(500).json({ error: 'Error cancelando la suscripción' });
  }
});

module.exports = router;
