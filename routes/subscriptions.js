// ==============================
// Rutas de suscripción — Mercado Pago
// ==============================
const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { requireAuthNoTrialGate } = require('../middleware/auth');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');

const PRICE_PER_BARBER = 5000; // ARS por barbero por mes

const mpConfig    = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const preApproval = new PreApproval(mpConfig);

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

// GET /api/subscriptions/webhook → notificaciones de Mercado Pago (alta, pago, cancelación)
router.get('/webhook', async (req, res) => {
  try {
    const type   = req.query.type || req.query.topic;
    const dataId = req.query['data.id'] || req.query.id;

    if (type === 'subscription_preapproval' && dataId) {
      const preapprovalData = await preApproval.get({ id: dataId });
      const status     = preapprovalData.status;
      const businessId = parseInt(preapprovalData.external_reference, 10);

      await db.query(
        `UPDATE subscriptions SET status = $1, updated_at = NOW() WHERE mp_preapproval_id = $2`,
        [status, dataId]
      );

      if (businessId) {
        const newPlan = status === 'authorized' ? 'active' : 'trial';
        await db.query('UPDATE owners SET plan = $1 WHERE business_id = $2', [newPlan, businessId]);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Error en webhook de Mercado Pago:', err.message);
    res.sendStatus(200);
  }
});

// GET /api/subscriptions/status → estado de suscripción del negocio actual
router.get('/status', requireAuthNoTrialGate, async (req, res) => {
  try {
    const ownerResult = await db.query(
      'SELECT plan, trial_ends_at FROM owners WHERE business_id = $1 LIMIT 1',
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
      subscription_amount: subscription?.amount || null
    });
  } catch (err) {
    console.error('Error GET /api/subscriptions/status:', err.message);
    res.status(500).json({ error: 'Error obteniendo estado de suscripción' });
  }
});

module.exports = router;
