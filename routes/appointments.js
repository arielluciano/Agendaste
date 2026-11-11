// ==============================
// Rutas de turnos — Supabase DB
// ==============================
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const { sendConfirmationEmail } = require('../services/email');

const TZ_AR = 'America/Argentina/Buenos_Aires';

// Fecha de hoy (YYYY-MM-DD) en horario de Argentina, no UTC —
// el server corre en UTC y eso corría el corte de "hoy" varias horas.
function todayAR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_AR }).format(new Date());
}

// Hora actual en Argentina, en minutos desde las 00:00 (mismo criterio que todayAR)
function nowMinutesAR() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ_AR, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date());
  const get = type => parseInt(parts.find(p => p.type === type).value, 10);
  return get('hour') * 60 + get('minute');
}

function toMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

function toTimeStr(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// ── Anti-spam de reservas ─────────────────────
const MAX_FUTURE_PER_PHONE = 2;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// 5 reservas por IP cada 15 min. Solo cuentan las exitosas (un error de tipeo no penaliza)
// y no aplica a las altas manuales del dueño desde el panel.
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipFailedRequests: true,
  skip: req => !!req.session?.business_id,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Hiciste muchas reservas seguidas. Probá de nuevo en unos minutos.' }
});

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
      const fromDate = from === 'today' ? todayAR() : from;
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

// GET /api/appointments/mine → turnos del cliente logueado (Google)
router.get('/mine', async (req, res) => {
  const clientEmail = req.session?.client?.email;
  if (!clientEmail) {
    return res.status(401).json({ error: 'No hay sesión de cliente' });
  }

  try {
    const result = await db.query(
      `SELECT a.*, s.name as service_name, b.name as barber_name,
              biz.name as business_name, biz.slug as business_slug, biz.address as business_address
       FROM appointments a
       LEFT JOIN services s ON a.service_id = s.id
       LEFT JOIN barbers b ON a.barber_id = b.id
       LEFT JOIN businesses biz ON a.business_id = biz.id
       WHERE a.client_email = $1
       ORDER BY a.date, a.time`,
      [clientEmail]
    );

    const today = new Date().toISOString().split('T')[0];
    const upcoming = [];
    const past = [];

    for (const appt of result.rows) {
      const apptDate = appt.date instanceof Date ? appt.date.toISOString().split('T')[0] : String(appt.date).split('T')[0];
      const normalized = { ...appt, date: apptDate };
      if (apptDate >= today) {
        upcoming.push(normalized);
      } else {
        past.push(normalized);
      }
    }

    res.json({ upcoming, past });
  } catch (err) {
    console.error('Error GET /api/appointments/mine:', err.message);
    res.status(500).json({ error: 'Error obteniendo tus turnos' });
  }
});

// POST /api/appointments → crear nuevo turno
router.post('/', bookingLimiter, async (req, res) => {
  const { clientName, clientPhone, clientEmail, service, barberId, date, time, price, businessId, website } = req.body;
  const isOwner = !!req.session?.business_id;

  // Honeypot: un humano nunca ve ni completa "website". Éxito falso, sin crear el turno.
  if (typeof website === 'string' && website.trim() !== '') {
    console.log('🍯 Honeypot: reserva descartada');
    return res.status(200).json({
      id: 0, clientName, clientPhone, service, date, time, price, status: 'confirmed'
    });
  }

  if (!clientName || !service || !date || !time) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  // ── Validaciones de datos ──
  const name = String(clientName).trim();
  if (name.length < 2 || name.length > 60) {
    return res.status(400).json({ error: 'El nombre tiene que tener entre 2 y 60 caracteres' });
  }

  // Solo para comparar/validar; se guarda tal cual lo mandó el cliente
  const phoneDigits = String(clientPhone || '').replace(/\D/g, '');
  if (phoneDigits.length < 8 || phoneDigits.length > 15) {
    return res.status(400).json({ error: 'El teléfono tiene que tener entre 8 y 15 dígitos' });
  }

  if (clientEmail && (typeof clientEmail !== 'string' || clientEmail.length > 254 || !EMAIL_RE.test(clientEmail.trim()))) {
    return res.status(400).json({ error: 'El email no es válido' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T12:00:00').getTime())) {
    return res.status(400).json({ error: 'Fecha inválida' });
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) {
    return res.status(400).json({ error: 'Hora inválida' });
  }
  const startMins = toMinutes(time);

  // Tiene que ser en el futuro (hora de Argentina)
  const today = todayAR();
  if (date < today || (date === today && startMins <= nowMinutesAR())) {
    return res.status(400).json({ error: 'Ese horario ya pasó' });
  }

  // El email del cliente logueado con Google es la fuente más confiable
  const resolvedClientEmail = req.session?.client?.email || (clientEmail ? clientEmail.trim() : null);
  // Si hay sesión de dueño (alta manual desde el admin), el negocio es el de su sesión, no el del body
  const resolvedBusinessId = req.session?.business_id || parseInt(businessId) || 1;
  const resolvedBarberId = parseInt(barberId) || 1;

  try {
    // El barbero tiene que ser del negocio del turno
    const barberCheck = await db.query(
      'SELECT id FROM barbers WHERE id = $1 AND business_id = $2',
      [resolvedBarberId, resolvedBusinessId]
    );
    if (barberCheck.rows.length === 0) {
      return isOwner
        ? res.status(403).json({ error: 'El barbero no pertenece a tu negocio' })
        : res.status(400).json({ error: 'Profesional inválido' });
    }

    // Dentro del horario de atención (el mismo que usa /slots para ofrecer turnos)
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const sched = (await db.query(
      'SELECT * FROM barber_schedules WHERE barber_id = $1 AND day_of_week = $2',
      [resolvedBarberId, dayOfWeek]
    )).rows[0];
    const ranges = [];
    if (sched && sched.is_open) {
      ranges.push([toMinutes(sched.open_time), toMinutes(sched.close_time)]);
      if (sched.has_split && sched.open_time_2 && sched.close_time_2) {
        ranges.push([toMinutes(sched.open_time_2), toMinutes(sched.close_time_2)]);
      }
    }
    if (!ranges.some(([open, close]) => startMins >= open && startMins < close)) {
      return res.status(400).json({ error: 'Ese horario está fuera del horario de atención' });
    }

    // Límite por teléfono: máximo 2 turnos futuros no cancelados en este negocio (el dueño queda exento)
    if (!isOwner) {
      const phoneCount = await db.query(
        `SELECT COUNT(*)::int AS n FROM appointments
          WHERE business_id = $1
            AND status != 'cancelled'
            AND regexp_replace(COALESCE(client_phone, ''), '[^0-9]', '', 'g') = $2
            AND (date > $3 OR (date = $3 AND time > $4))`,
        [resolvedBusinessId, phoneDigits, today, toTimeStr(nowMinutesAR())]
      );
      if (phoneCount.rows[0].n >= MAX_FUTURE_PER_PHONE) {
        return res.status(409).json({ error: 'Ya tenés turnos reservados. Si necesitás otro, comunicate con el negocio.' });
      }
    }

    // No superponerse con otro turno del mismo profesional (según la duración de cada servicio; 30 min si no se conoce)
    const svc = await db.query(
      'SELECT duration FROM services WHERE name = $1 AND business_id = $2 LIMIT 1',
      [service, resolvedBusinessId]
    );
    const duration = parseInt(svc.rows[0]?.duration) || 30;
    const conflict = await db.query(
      `SELECT a.id FROM appointments a
         LEFT JOIN services s ON a.service_id = s.id
        WHERE a.date = $1 AND a.barber_id = $2 AND a.status != 'cancelled'
          AND a.time < ($3::time + make_interval(mins => $4))
          AND $3::time < (a.time + make_interval(mins => COALESCE(NULLIF(s.duration, 0), 30)))`,
      [date, resolvedBarberId, toTimeStr(startMins), duration]
    );

    if (conflict.rows.length > 0) {
      return res.status(409).json({ error: 'Ese horario ya está ocupado' });
    }

    const result = await db.query(
      `INSERT INTO appointments (business_id, barber_id, client_name, client_phone, client_email, service_id, date, time, price, status)
 VALUES ($1, $2, $3, $4, $5, (SELECT id FROM services WHERE name = $6 AND business_id = $7 LIMIT 1), $8, $9, $10, $11)
 RETURNING *`,
[resolvedBusinessId, resolvedBarberId, name, clientPhone, resolvedClientEmail, service, resolvedBusinessId, date, time, price, 'confirmed']
    );

    const newAppointment = result.rows[0];
    console.log(`📋 Nuevo turno: ${name} — ${service} el ${date} a las ${time}`);

    // Enviar email de confirmación al cliente (no debe bloquear la creación del turno)
    if (newAppointment.client_email) {
      try {
        const [businessResult, barberResult] = await Promise.all([
          db.query('SELECT name, address FROM businesses WHERE id = $1', [newAppointment.business_id]),
          db.query('SELECT name FROM barbers WHERE id = $1', [newAppointment.barber_id])
        ]);

        await sendConfirmationEmail({
          to: newAppointment.client_email,
          clientName: name,
          businessName: businessResult.rows[0]?.name,
          service,
          barber: barberResult.rows[0]?.name,
          date: newAppointment.date,
          time,
          address: businessResult.rows[0]?.address
        });
      } catch (emailErr) {
        console.log(`⚠️ No se pudo enviar el email de confirmación: ${emailErr.message}`);
      }
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
      'UPDATE appointments SET status = $1 WHERE id = $2 AND business_id = $3 RETURNING *',
      [status, req.params.id, req.businessId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Turno no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando turno' });
  }
});

// PATCH /api/appointments/:id/cancel-mine → el cliente cancela su propio turno
router.patch('/:id/cancel-mine', async (req, res) => {
  const clientEmail = req.session?.client?.email;
  if (!clientEmail) {
    return res.status(401).json({ error: 'No hay sesión de cliente' });
  }

  try {
    // El WHERE con client_email asegura que solo se cancele un turno propio
    const result = await db.query(
      `UPDATE appointments SET status = 'cancelled'
       WHERE id = $1 AND client_email = $2
       RETURNING *`,
      [req.params.id, clientEmail]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Turno no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error PATCH /api/appointments/:id/cancel-mine:', err.message);
    res.status(500).json({ error: 'Error cancelando el turno' });
  }
});

// DELETE /api/appointments/:id → borrar turno
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM appointments WHERE id = $1 AND business_id = $2 RETURNING id',
      [req.params.id, req.businessId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Turno no encontrado' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error borrando turno' });
  }
});

// GET /api/appointments/slots/:date → horarios disponibles
router.get('/slots/:date', async (req, res) => {
  const bizId2 = parseInt(req.query.business_id) || req.session?.business_id || 1;
  const barberId2 = parseInt(req.query.barber_id) || 1;

  function toMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  function toTimeStr(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Genera horarios cada 30 minutos entre openMins y closeMins (sin incluir el cierre)
  function generateSlots(openMins, closeMins) {
    const slots = [];
    for (let m = openMins; m < closeMins; m += 30) {
      slots.push(toTimeStr(m));
    }
    return slots;
  }

  try {
    const dayOfWeek = new Date(req.params.date + 'T12:00:00').getDay();
    const schedResult = await db.query(
      'SELECT * FROM barber_schedules WHERE barber_id = $1 AND day_of_week = $2',
      [barberId2, dayOfWeek]
    );

    if (schedResult.rows.length === 0 || !schedResult.rows[0].is_open) {
      return res.json([]);
    }

    const { open_time, close_time, has_split, open_time_2, close_time_2 } = schedResult.rows[0];
    const openMins  = toMinutes(open_time.substring(0, 5));
    const closeMins = toMinutes(close_time.substring(0, 5));

    let allSlots = generateSlots(openMins, closeMins);

    if (has_split && open_time_2 && close_time_2) {
      const open2Mins  = toMinutes(open_time_2.substring(0, 5));
      const close2Mins = toMinutes(close_time_2.substring(0, 5));
      allSlots = allSlots.concat(generateSlots(open2Mins, close2Mins));
    }

    const result = await db.query(
      "SELECT time FROM appointments WHERE date = $1 AND status != 'cancelled' AND business_id = $2 AND barber_id = $3",
      [req.params.date, bizId2, barberId2]
    );
    const taken = result.rows.map(r => r.time.substring(0, 5));

    const slots = allSlots.map(s => ({
      time: s,
      available: !taken.includes(s)
    }));
    res.json(slots);
  } catch (err) {
    console.error('Error GET /api/appointments/slots/:date:', err.message);
    res.status(500).json({ error: 'Error obteniendo slots' });
  }
});

module.exports = router;