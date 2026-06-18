// ==============================
// Rutas de turnos — Supabase DB
// ==============================
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/appointments → todos los turnos
router.get('/', requireAuth, async (req, res) => {
  try {
    const { date, from } = req.query;
    const bizId = req.businessId;
    let query = `
      SELECT a.*, s.name as service_name
      FROM appointments a
      LEFT JOIN services s ON a.service_id = s.id
      WHERE 1=1`;
    const params = [];

    params.push(bizId);
    query += ` AND a.business_id = $${params.length}`;

    if (from) {
      const fromDate = from === 'today' ? new Date().toISOString().split('T')[0] : from;
      params.push(fromDate);
      query += ` AND date >= $${params.length}`;
    }
    if (date) {
      params.push(date);
      query += ` AND date = $${params.length}`;
    }

    query += ' ORDER BY date, time';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo turnos' });
  }
});

// POST /api/appointments → crear nuevo turno
router.post('/', async (req, res) => {
  const { clientName, clientPhone, clientEmail, service, barberId, date, time, price, businessId } = req.body;

  if (!clientName || !service || !date || !time) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  try {
    // Verificar que el horario no esté ocupado
    const conflict = await db.query(
      'SELECT id FROM appointments WHERE date = $1 AND time = $2 AND barber_id = $3 AND status != $4',
      [date, time, barberId || 1, 'cancelled']
    );

    if (conflict.rows.length > 0) {
      return res.status(409).json({ error: 'Ese horario ya está ocupado' });
    }

    const result = await db.query(
      `INSERT INTO appointments (business_id, barber_id, client_name, client_phone, client_email, service_id, date, time, price, status)
 VALUES ($1, $2, $3, $4, $5, (SELECT id FROM services WHERE name = $6 AND business_id = $7 LIMIT 1), $8, $9, $10, $11)
 RETURNING *`,
[businessId || 1, barberId || 1, clientName, clientPhone, clientEmail, service, businessId || 1, date, time, price, 'confirmed']
    );

    const newAppointment = result.rows[0];
    console.log(`📋 Nuevo turno: ${clientName} — ${service} el ${date} a las ${time}`);

    // Intentar agregar al Google Calendar del dueño
    try {
      const { google } = require('googleapis');
      if (req.session && req.session.tokens) {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.REDIRECT_URI
        );
        oauth2Client.setCredentials(req.session.tokens);
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const cleanDate = typeof date === 'string' ? date.split('T')[0] : date.toISOString().split('T')[0];
        const cleanTime = typeof time === 'string' ? time.substring(0,5) : '09:00';
        const start = new Date(`${cleanDate}T${cleanTime}:00-03:00`);
        const end = new Date(start.getTime() + 30 * 60 * 1000);

        await calendar.events.insert({
          calendarId: 'primary',
          resource: {
            summary: `✂️ ${service} — ${clientName}`,
            description: `Cliente: ${clientName}\nTeléfono: ${clientPhone || 'Sin teléfono'}\nServicio: ${service}\nPrecio: $${price}\n\nReservado via Agendaste`,
            start: { dateTime: start.toISOString(), timeZone: 'America/Argentina/Buenos_Aires' },
            end: { dateTime: end.toISOString(), timeZone: 'America/Argentina/Buenos_Aires' },
            reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }
          }
        });
        console.log(`📅 Turno agregado al Google Calendar`);
      }
    } catch (calErr) {
      console.log(`⚠️ No se pudo agregar al calendar: ${calErr.message}`);
    }

    res.status(201).json({
      id: newAppointment.id,
      clientName: newAppointment.client_name,
      clientPhone: newAppointment.client_phone,
      service,
      date: newAppointment.date,
      time: newAppointment.time,
      price: newAppointment.price,
      status: newAppointment.status
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando el turno' });
  }
});

// PATCH /api/appointments/:id/status → confirmar o cancelar
router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  try {
    const result = await db.query(
      'UPDATE appointments SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Turno no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando turno' });
  }
});

// DELETE /api/appointments/:id → borrar turno
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM appointments WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error borrando turno' });
  }
});

// GET /api/appointments/slots/:date → horarios disponibles
router.get('/slots/:date', async (req, res) => {
  const allSlots = ['9:00','9:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30'];
  const { barber_id } = req.query;

  function toMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  try {
    let allowedSlots = allSlots;

    if (barber_id) {
      const dayOfWeek = new Date(req.params.date + 'T12:00:00').getDay();
      const schedResult = await db.query(
        'SELECT * FROM barber_schedules WHERE barber_id = $1 AND day_of_week = $2',
        [barber_id, dayOfWeek]
      );

      if (schedResult.rows.length === 0 || !schedResult.rows[0].is_open) {
        return res.json(allSlots.map(s => ({ time: s, available: false })));
      }

      const { open_time, close_time, has_split, open_time_2, close_time_2 } = schedResult.rows[0];
      const openMins  = toMinutes(open_time.substring(0, 5));
      const closeMins = toMinutes(close_time.substring(0, 5));

      let open2Mins  = null;
      let close2Mins = null;
      if (has_split && open_time_2 && close_time_2) {
        open2Mins  = toMinutes(open_time_2.substring(0, 5));
        close2Mins = toMinutes(close_time_2.substring(0, 5));
      }

      allowedSlots = allSlots.filter(s => {
        const m = toMinutes(s);
        const inFranja1 = m >= openMins && m < closeMins;
        const inFranja2 = open2Mins !== null && m >= open2Mins && m < close2Mins;
        return inFranja1 || inFranja2;
      });
    }

    const bizId2 = parseInt(req.query.business_id) || 1;
    const barberId2 = parseInt(barber_id) || 1;
    const result = await db.query(
      "SELECT time FROM appointments WHERE date = $1 AND status != 'cancelled' AND business_id = $2 AND barber_id = $3",
      [req.params.date, bizId2, barberId2]
    );
    const taken = result.rows.map(r => r.time.substring(0, 5));
    const slots = allSlots.map(s => ({
      time: s,
      available: allowedSlots.includes(s) && !taken.includes(s)
    }));
    res.json(slots);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo slots' });
  }
});

module.exports = router;