// ==============================
// Rutas de servicios — Supabase DB
// ==============================
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/services → servicios activos (para el cliente)
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM services WHERE active = true AND business_id = $1 ORDER BY id',
      [1]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo servicios' });
  }
});

// GET /api/services/all → todos incluyendo inactivos (para el admin)
router.get('/all', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM services WHERE business_id = $1 ORDER BY id',
      [1]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo servicios' });
  }
});

// POST /api/services → agregar servicio nuevo
router.post('/', async (req, res) => {
  const { name, price, dur } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
  try {
    const result = await db.query(
      'INSERT INTO services (business_id, name, price, duration, active) VALUES ($1, $2, $3, $4, true) RETURNING *',
      [1, name, parseInt(price), dur || '30 min']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error creando servicio' });
  }
});

// PATCH /api/services/:id → actualizar servicio
router.patch('/:id', async (req, res) => {
  const { name, price, dur, active } = req.body;
  try {
    const result = await db.query(
      `UPDATE services SET
        name = COALESCE($1, name),
        price = COALESCE($2, price),
        duration = COALESCE($3, duration),
        active = COALESCE($4, active)
       WHERE id = $5 RETURNING *`,
      [name, price ? parseInt(price) : null, dur, active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando servicio' });
  }
});

// DELETE /api/services/:id → eliminar servicio
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM services WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error borrando servicio' });
  }
});

module.exports = router;