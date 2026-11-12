// ==============================
// Rutas de barberos — Supabase DB
// ==============================
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { validateWeekSchedule, validateBarber, toInt } = require('../services/validation');
const { todayAR } = require('../services/availability');

// :id tiene que ser un entero positivo (si no, Postgres tira error y salía un 500)
router.param('id', (req, res, next, id) => {
  if (!(toInt(id) > 0)) return res.status(400).json({ error: 'Barbero inválido' });
  next();
});

// GET /api/barbers → barberos activos
// ?with_schedule=1 (página de reservas): solo los que tienen al menos un día de atención cargado
router.get('/', async (req, res) => {
  const bizId = parseInt(req.query.business_id) || req.session?.business_id || 1;
  const onlyWithSchedule = req.query.with_schedule === '1';
  try {
    const result = await db.query(
      `SELECT b.id, b.name, b.role, b.active FROM barbers b WHERE b.active = true AND b.business_id = $1
       ${onlyWithSchedule ? 'AND EXISTS (SELECT 1 FROM barber_schedules s WHERE s.barber_id = b.id AND s.is_open)' : ''}
       ORDER BY b.id`,
      [bizId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo barberos' });
  }
});

// GET /api/barbers/all → todos incluyendo inactivos
// (antes no pedía sesión: sin sesión devolvía los del negocio 1)
router.get('/all', requireAuth, async (req, res) => {
  const bizId = req.businessId;
  try {
    const result = await db.query(
      'SELECT id, name, role, active FROM barbers WHERE business_id = $1 ORDER BY id',
      [bizId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo barberos' });
  }
});

// POST /api/barbers → agregar barbero
router.post('/', requireAuth, async (req, res) => {
  const v = validateBarber(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const { name, role } = v.values;
  try {
    const result = await db.query(
      'INSERT INTO barbers (business_id, name, role, active) VALUES ($1, $2, $3, true) RETURNING *',
      [req.businessId, name, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error creando barbero' });
  }
});

// GET /api/barbers/:id/schedule?business_id= → horarios del barbero
// Exige el negocio (query, o la sesión del dueño en el panel) y que el barbero sea de ese negocio.
router.get('/:id/schedule', async (req, res) => {
  const bizId    = parseInt(req.query.business_id) || req.session?.business_id;
  const barberId = parseInt(req.params.id);
  if (!bizId)    return res.status(400).json({ error: 'Falta business_id' });
  if (!barberId) return res.status(400).json({ error: 'Barbero inválido' });
  try {
    const own = await db.query('SELECT 1 FROM barbers WHERE id = $1 AND business_id = $2', [barberId, bizId]);
    if (own.rows.length === 0) return res.status(404).json({ error: 'Barbero no encontrado' });
    const result = await db.query(
      `SELECT barber_id, day_of_week, is_open, open_time, close_time, has_split, open_time_2, close_time_2
         FROM barber_schedules WHERE barber_id = $1 ORDER BY day_of_week`,
      [barberId]
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
  const schedError = validateWeekSchedule(schedule);
  if (schedError) return res.status(400).json({ error: schedError });
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
  const schedError = validateWeekSchedule(schedule);
  if (schedError) return res.status(400).json({ error: schedError });
  try {
    const barbersResult = await db.query('SELECT id FROM barbers WHERE business_id = $1', [bizId]);
    for (const barber of barbersResult.rows) {
      for (const day of schedule) {
        // Copia también el turno partido (solo si vienen las dos horas del segundo tramo)
        const hasSplit = !!(day.has_split && day.open_time_2 && day.close_time_2);
        await db.query(
          `INSERT INTO barber_schedules (barber_id, day_of_week, is_open, open_time, close_time, has_split, open_time_2, close_time_2)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (barber_id, day_of_week)
           DO UPDATE SET is_open = $3, open_time = $4, close_time = $5, has_split = $6, open_time_2 = $7, close_time_2 = $8`,
          [barber.id, day.day_of_week, day.is_open, day.open_time, day.close_time,
           hasSplit, hasSplit ? day.open_time_2 : null, hasSplit ? day.close_time_2 : null]
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
  const v = validateBarber(req.body, { partial: true });
  if (v.error) return res.status(400).json({ error: v.error });
  const { name = null, role = null, active = null } = v.values;
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
// Con turnos futuros (no cancelados) no se borra: hay que desactivarlo. Los horarios se borran en cascada.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const check = await db.query(
      'SELECT id FROM barbers WHERE id = $1 AND business_id = $2',
      [req.params.id, req.businessId]
    );
    if (check.rows.length === 0) return res.status(403).json({ error: 'Barbero no encontrado o no autorizado' });

    const future = await db.query(
      `SELECT COUNT(*)::int AS n FROM appointments
        WHERE barber_id = $1 AND status <> 'cancelled' AND date >= $2`,
      [req.params.id, todayAR()]
    );
    if (future.rows[0].n > 0) {
      const n = future.rows[0].n;
      return res.status(409).json({
        error: `Tiene ${n} turno${n === 1 ? '' : 's'} por delante, así que no se puede borrar. Desactivalo para que no reciba reservas nuevas.`
      });
    }

    await db.query('DELETE FROM barbers WHERE id = $1 AND business_id = $2', [req.params.id, req.businessId]);
    res.json({ success: true });
  } catch (err) {
    // Turnos pasados o cancelados que apuntan al barbero (FK): se conservan, así que tampoco se borra
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Tiene turnos registrados, así que no se puede borrar. Desactivalo para que no reciba reservas nuevas.' });
    }
    res.status(500).json({ error: 'Error borrando barbero' });
  }
});

module.exports = router;