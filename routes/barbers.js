// ==============================
// Rutas de barberos — Supabase DB
// ==============================
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/barbers → barberos activos
router.get('/', async (req, res) => {
  const bizId = parseInt(req.query.business_id) || req.session?.business_id || 1;
  try {
    const result = await db.query(
      'SELECT * FROM barbers WHERE active = true AND business_id = $1 ORDER BY id',
      [bizId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo barberos' });
  }
});

// GET /api/barbers/all → todos incluyendo inactivos
router.get('/all', async (req, res) => {
  const bizId = req.session?.business_id || 1;
  try {
    const result = await db.query(
      'SELECT * FROM barbers WHERE business_id = $1 ORDER BY id',
      [bizId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo barberos' });
  }
});

// POST /api/barbers → agregar barbero
router.post('/', requireAuth, async (req, res) => {
  const { name, role } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const result = await db.query(
      'INSERT INTO barbers (business_id, name, role, active) VALUES ($1, $2, $3, true) RETURNING *',
      [req.businessId, name, role || 'Barbero']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error creando barbero' });
  }
});

// GET /api/barbers/:id/schedule → horarios del barbero
router.get('/:id/schedule', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM barber_schedules WHERE barber_id = $1 ORDER BY day_of_week',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo horarios' });
  }
});

// PATCH /api/barbers/:id/schedule → guardar horarios del barbero
router.patch('/:id/schedule', requireAuth, async (req, res) => {
  const { schedule } = req.body;
  const barberId = req.params.id;
  if (!Array.isArray(schedule)) return res.status(400).json({ error: 'Formato inválido' });
  try {
    const ownerCheck = await db.query(
      'SELECT id FROM barbers WHERE id = $1 AND business_id = $2',
      [barberId, req.businessId]
    );
    if (ownerCheck.rows.length === 0) return res.status(403).json({ error: 'No autorizado' });
    for (const day of schedule) {
      await db.query(
        `INSERT INTO barber_schedules (barber_id, day_of_week, is_open, open_time, close_time, has_split, open_time_2, close_time_2)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (barber_id, day_of_week)
         DO UPDATE SET is_open = $3, open_time = $4, close_time = $5, has_split = $6, open_time_2 = $7, close_time_2 = $8`,
        [barberId, day.day_of_week, day.is_open, day.open_time, day.close_time, day.has_split || false, day.open_time_2 || null, day.close_time_2 || null]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error guardando horarios' });
  }
});

// POST /api/barbers/apply-schedule → aplica un horario base a todos los barberos del negocio
router.post('/apply-schedule', requireAuth, async (req, res) => {
  const { schedule } = req.body;
  const bizId = req.businessId;
  if (!Array.isArray(schedule)) return res.status(400).json({ error: 'Formato inválido' });
  try {
    const barbersResult = await db.query('SELECT id FROM barbers WHERE business_id = $1', [bizId]);
    for (const barber of barbersResult.rows) {
      for (const day of schedule) {
        await db.query(
          `INSERT INTO barber_schedules (barber_id, day_of_week, is_open, open_time, close_time, has_split, open_time_2, close_time_2)
           VALUES ($1, $2, $3, $4, $5, false, NULL, NULL)
           ON CONFLICT (barber_id, day_of_week)
           DO UPDATE SET is_open = $3, open_time = $4, close_time = $5, has_split = false, open_time_2 = NULL, close_time_2 = NULL`,
          [barber.id, day.day_of_week, day.is_open, day.open_time, day.close_time]
        );
      }
    }
    res.json({ success: true, barbersUpdated: barbersResult.rows.length });
  } catch (err) {
    console.error('Error POST /api/barbers/apply-schedule:', err.message);
    res.status(500).json({ error: 'Error aplicando horario a los barberos' });
  }
});

// PATCH /api/barbers/:id → actualizar barbero
router.patch('/:id', requireAuth, async (req, res) => {
  const { name, role, active } = req.body;
  try {
    const result = await db.query(
      `UPDATE barbers SET
        name = COALESCE($1, name),
        role = COALESCE($2, role),
        active = COALESCE($3, active)
       WHERE id = $4 AND business_id = $5 RETURNING *`,
      [name, role, active, req.params.id, req.businessId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Barbero no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando barbero' });
  }
});

// DELETE /api/barbers/:id → eliminar barbero
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const check = await db.query(
      'SELECT id FROM barbers WHERE id = $1 AND business_id = $2',
      [req.params.id, req.businessId]
    );
    if (check.rows.length === 0) return res.status(403).json({ error: 'Barbero no encontrado o no autorizado' });
    await db.query('DELETE FROM barbers WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error borrando barbero' });
  }
});

module.exports = router;