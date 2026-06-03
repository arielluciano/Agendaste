// ==============================
// Rutas de barberos — Supabase DB
// ==============================
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/barbers → barberos activos
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM barbers WHERE active = true AND business_id = $1 ORDER BY id',
      [1]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo barberos' });
  }
});

// GET /api/barbers/all → todos incluyendo inactivos
router.get('/all', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM barbers WHERE business_id = $1 ORDER BY id',
      [1]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo barberos' });
  }
});

// POST /api/barbers → agregar barbero
router.post('/', async (req, res) => {
  const { name, role } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const result = await db.query(
      'INSERT INTO barbers (business_id, name, role, active) VALUES ($1, $2, $3, true) RETURNING *',
      [1, name, role || 'Barbero']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error creando barbero' });
  }
});

// PATCH /api/barbers/:id → actualizar barbero
router.patch('/:id', async (req, res) => {
  const { name, role, active } = req.body;
  try {
    const result = await db.query(
      `UPDATE barbers SET
        name = COALESCE($1, name),
        role = COALESCE($2, role),
        active = COALESCE($3, active)
       WHERE id = $4 RETURNING *`,
      [name, role, active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Barbero no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando barbero' });
  }
});

// DELETE /api/barbers/:id → eliminar barbero
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM barbers WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error borrando barbero' });
  }
});

module.exports = router;