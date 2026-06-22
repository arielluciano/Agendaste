// ==============================
// Rutas de suscripción — Mercado Pago
// ==============================
const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { requireAuthNoTrialGate } = require('../middleware/auth');
const {
  MercadoPagoConfig,
  PreApproval,
  Payment,
  WebhookSignatureValidator
} = require('mercadopago');

const PRICE_PER_BARBER = 5000; // ARS por barbero por mes

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
    const newPlan = status === 'authorized' ? 'active' : 'trial';
    await db.query('UPDATE owners SET plan = $1 WHERE business_id = $2', [newPlan, businessId]);
  }
}

// POST /api/subscriptions/create → crea la suscripción en MP y devuelve el link de pago
router.post('/create', requireAuthNoTrialGate, async (req, res) => {
  const bizId = req.businessId;

  try {
    const bizResult = await db.query('SELECT * FROM businesses WHERE id = $1', [bizId]);
    const business = bizResult.rows[0];
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    const ownerResult = await db.query('SELECT * FROM owners WHERE business_id = $1 LIMIT 1', [bizId]);
    const owner = ownerResult.rows[0];

    const barbersResult = await db.query(
      'SELECT COUNT(*) FROM barbers WHERE business_id = $1 AND active = true',
      [bizId]
    );
    const barberCount = Math.max(1, parseInt(barbersResult.rows[0].count, 10));
    const amount = PRICE_PER_BARBER * barberCount;

    const subscription = await preApproval.create({
      body: {
        reason: `Agendaste — Suscripción ${business.name} (${barberCount} barbero${barberCount > 1 ? 's' : ''})`,
        external_reference: String(bizId),
        payer_email: owner?.email,
        // MP exige una URL pública con HTTPS — en local hay que setear BASE_URL (ej. túnel ngrok)
        back_url: `${process.env.BASE_URL || `${req.protocol}://${req.get('host')}`}/admin`,
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
      `INSERT INTO subscriptions (business_id, mp_preapproval_id, status, amount)
       VALUES ($1, $2, $3, $4)`,
      [bizId, subscription.id, subscription.status || 'pending', amount]
    );

    res.json({ init_point: subscription.init_point, amount, barber_count: barberCount });
  } catch (err) {
    console.error('Error creando suscripción MP:', err.message);
    res.status(500).json({ error: 'Error creando la suscripción' });
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
    const ownerResult = await db.query(
      'SELECT plan, trial_ends_at, access_until FROM owners WHERE business_id = $1 LIMIT 1',
      [req.businessId]
    );
    const owner = ownerResult.rows[0] || {};

    const subResult = await db.query(
      'SELECT status, amount FROM subscriptions WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.businessId]
    );
    const subscription = subResult.rows[0] || null;

    const trialEndsAt = owner.trial_ends_at || null;
    const msLeft      = trialEndsAt ? new Date(trialEndsAt).getTime() - Date.now() : 0;
    const trialActive = msLeft > 0;
    const daysLeft    = trialActive ? Math.ceil(msLeft / (1000 * 60 * 60 * 24)) : 0;

    res.json({
      plan: owner.plan || 'trial',
      trial_ends_at: trialEndsAt,
      trial_active: trialActive,
      days_left: daysLeft,
      subscription_status: subscription?.status || null,
      subscription_amount: subscription?.amount || null,
      access_until: owner.access_until || null
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
