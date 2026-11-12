// ==============================
// Rutas de servicios — Supabase DB
// ==============================
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { validateService, toInt } = require('../services/validation');

// :id tiene que ser un entero positivo (si no, Postgres tira error y salía un 500)
router.param('id', (req, res, next, id) => {
  if (!(toInt(id) > 0)) return res.status(400).json({ error: 'Servicio inválido' });
  next();
});

// GET /api/services → servicios activos (para el cliente)
router.get('/', async (req, res) => {
  const bizId = parseInt(req.query.business_id) || req.session?.business_id || 1;
  try {
    const result = await db.query(
      'SELECT id, name, price, duration, active FROM services WHERE active = true AND business_id = $1 ORDER BY id',
      [bizId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo servicios' });
  }
});

// GET /api/services/all → todos incluyendo inactivos (para el admin)
// (antes no pedía sesión: sin sesión devolvía los del negocio 1)
router.get('/all', requireAuth, async (req, res) => {
  const bizId = req.businessId;
  try {
    const result = await db.query(
      'SELECT id, name, price, duration, active FROM services WHERE business_id = $1 ORDER BY id',
      [bizId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo servicios' });
  }
});

// POST /api/services → agregar servicio nuevo
router.post('/', async (req, res) => {
  const bizId = req.session?.business_id;
  if (!bizId) return res.status(401).json({ error: 'No autenticado' });
  // Sin duración se usa 30 min, como antes; si viene, tiene que ser válida
  const body = { ...req.body };
  if (body.duration === undefined || body.duration === null || body.duration === '') body.duration = 30;
  const v = validateService(body);
  if (v.error) return res.status(400).json({ error: v.error });
  const { name, price, duration } = v.values;
  try {
    const result = await db.query(
      'INSERT INTO services (business_id, name, price, duration, active) VALUES ($1, $2, $3, $4, true) RETURNING *',
      [bizId, name, price, duration]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error POST /api/services:', err.message, '| body:', req.body, '| bizId:', bizId);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/services/:id → actualizar servicio
router.patch('/:id', requireAuth, async (req, res) => {
  const v = validateService(req.body, { partial: true });
  if (v.error) return res.status(400).json({ error: v.error });
  const { name = null, price = null, duration = null, active = null } = v.values;
  try {
    const result = await db.query(
      `UPDATE services SET
        name = COALESCE($1, name),
        price = COALESCE($2, price),
        duration = COALESCE($3, duration),
        active = COALESCE($4, active)
       WHERE id = $5 AND business_id = $6 RETURNING *`,
      [name, price, duration, active, req.params.id, req.businessId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando servicio' });
  }
});

// DELETE /api/services/:id → eliminar servicio
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM services WHERE id = $1 AND business_id = $2 RETURNING id',
      [req.params.id, req.businessId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
    res.json({ success: true });
  } catch (err) {
    // Turnos que apuntan a este servicio (FK): no se borra, así esos turnos no se tocan
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Este servicio tiene turnos registrados y no se puede borrar. Desactivalo para que no aparezca en las reservas.' });
    }
    res.status(500).json({ error: 'Error borrando servicio' });
  }
});

module.exports = router;