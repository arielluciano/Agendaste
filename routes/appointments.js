// ==============================
// Rutas de turnos — Supabase DB
// ==============================
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const { sendConfirmationEmail, sendOwnerNoticeEmail } = require('../services/email');

const { todayAR, nowMinutesAR, toMinutes, toTimeStr, getAvailableSlots } = require('../services/availability');

// ── Anti-spam de reservas ─────────────────────
const MAX_FUTURE_PER_PHONE = 2;
const MAX_GUEST_EMAILS_PER_HOUR = 3;
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
      `SELECT a.*, s.name as service_name, s.duration as service_duration, b.name as barber_name,
              biz.name as business_name, biz.slug as business_slug, biz.address as business_address,
              biz.phone as business_phone, biz.logo_url as business_logo_url,
              COALESCE(biz.cancel_min_hours, 2) as cancel_min_hours
       FROM appointments a
       LEFT JOIN services s ON a.service_id = s.id
       LEFT JOIN barbers b ON a.barber_id = b.id
       LEFT JOIN businesses biz ON a.business_id = biz.id
       WHERE a.client_email = $1
       ORDER BY a.date, a.time`,
      [clientEmail]
    );

    // Próximo = fecha y hora todavía no pasaron (hora de Argentina)
    const today = todayAR();
    const nowMins = nowMinutesAR();
    const upcoming = [];
    const past = [];

    for (const appt of result.rows) {
      const apptDate = appt.date instanceof Date ? appt.date.toISOString().split('T')[0] : String(appt.date).split('T')[0];
      const normalized = { ...appt, date: apptDate };
      if (apptDate > today || (apptDate === today && toMinutes(appt.time) > nowMins)) {
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

// ── Alta de turnos (compartido por la reserva y la reprogramación) ──

// Valida los datos del formulario. Devuelve { error } o los valores normalizados.
function validateBookingInput({ clientName, clientPhone, clientEmail, service_id, barberId, date, time }) {
  if (!clientName || !date || !time) return { error: 'Faltan campos obligatorios' };

  const serviceId = parseInt(service_id, 10);
  if (!Number.isInteger(serviceId) || serviceId <= 0) return { error: 'Elegí un servicio' };
  const barber = parseInt(barberId, 10);
  if (!Number.isInteger(barber) || barber <= 0) return { error: 'Elegí un profesional' };

  const name = String(clientName).trim();
  if (name.length < 2 || name.length > 60) return { error: 'El nombre tiene que tener entre 2 y 60 caracteres' };

  // Solo para comparar/validar; se guarda tal cual lo mandó el cliente
  const phoneDigits = String(clientPhone || '').replace(/\D/g, '');
  if (phoneDigits.length < 8 || phoneDigits.length > 15) return { error: 'El teléfono tiene que tener entre 8 y 15 dígitos' };

  if (clientEmail && (typeof clientEmail !== 'string' || clientEmail.length > 254 || !EMAIL_RE.test(clientEmail.trim()))) {
    return { error: 'El email no es válido' };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T12:00:00').getTime())) return { error: 'Fecha inválida' };
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return { error: 'Hora inválida' };
  const startMins = toMinutes(time);

  // Tiene que ser en el futuro (hora de Argentina)
  const today = todayAR();
  if (date < today || (date === today && startMins <= nowMinutesAR())) return { error: 'Ese horario ya pasó' };

  return { name, phoneDigits, startMins, today, serviceId, barberId: barber };
}

// Chequea disponibilidad e inserta el turno. `q` TIENE que ser el cliente de una transacción abierta:
// el advisory lock dura hasta el COMMIT/ROLLBACK.
// Devuelve { status, error } si no se puede, o { appointment, service }.
async function insertAppointment(q, { name, clientPhone, phoneDigits, email, serviceId, barberId, businessId, date, time, isOwner, today }) {
  // El barbero tiene que ser del negocio del turno
  const barberCheck = await q.query('SELECT id FROM barbers WHERE id = $1 AND business_id = $2', [barberId, businessId]);
  if (barberCheck.rows.length === 0) {
    return isOwner
      ? { status: 403, error: 'El barbero no pertenece a tu negocio' }
      : { status: 400, error: 'Profesional inválido' };
  }

  // Límite por teléfono: máximo 2 turnos futuros no cancelados en este negocio (el dueño queda exento)
  if (!isOwner) {
    const phoneCount = await q.query(
      `SELECT COUNT(*)::int AS n FROM appointments
        WHERE business_id = $1
          AND status != 'cancelled'
          AND regexp_replace(COALESCE(client_phone, ''), '[^0-9]', '', 'g') = $2
          AND (date > $3 OR (date = $3 AND time > $4))`,
      [businessId, phoneDigits, today, toTimeStr(nowMinutesAR())]
    );
    if (phoneCount.rows[0].n >= MAX_FUTURE_PER_PHONE) {
      return { status: 409, error: 'Ya tenés turnos reservados. Si necesitás otro, comunicate con el negocio.' };
    }
  }

  // Reservas simultáneas: los pedidos para el mismo barbero y día se procesan de a uno
  // (el lock se libera solo al terminar la transacción)
  await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${barberId}:${date}`]);

  // Misma función que arma la grilla: horario de atención, que el servicio entre en el tramo,
  // superposición con la duración real de cada turno y horarios ya pasados (hora de Argentina).
  // El servicio se valida ahí (del negocio y activo); precio y duración salen de la base, nunca del cliente.
  const avail = await getAvailableSlots(barberId, businessId, serviceId, date, q);
  if (avail.error) return { status: avail.status, error: avail.error };
  const hhmm = String(time).substring(0, 5);
  if (!avail.slots.some(s => s.time === hhmm && s.available)) {
    return { status: 409, error: 'Ese horario ya no está disponible. Elegí otro.' };
  }
  const svc = avail.service;

  const result = await q.query(
    `INSERT INTO appointments (business_id, barber_id, client_name, client_phone, client_email, service_id, date, time, price, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [businessId, barberId, name, clientPhone, email, svc.id, date, hhmm, svc.price, 'confirmed']
  );
  return { appointment: result.rows[0], service: svc };
}

// Mail de confirmación al cliente (no bloquea ni hace fallar la reserva)
async function sendBookingEmail(appt, { name, service, time, isVerified, rescheduled = false }) {
  if (!appt.client_email) return;
  try {
    // Invitados: máximo N confirmaciones por email destino por hora (en todos los negocios),
    // para que el formulario no sirva para mandarle mails a terceros. Cada confirmación sale de
    // un turno insertado, así que se cuentan los turnos de la última hora (incluye el recién creado).
    // Con login de Google el email está verificado y no se limita.
    if (!isVerified) {
      const sent = await db.query(
        `SELECT COUNT(*)::int AS n FROM appointments
          WHERE lower(client_email) = lower($1) AND created_at > now() - interval '1 hour'`,
        [appt.client_email]
      );
      if (sent.rows[0].n > MAX_GUEST_EMAILS_PER_HOUR) {
        throw new Error(`límite de ${MAX_GUEST_EMAILS_PER_HOUR} confirmaciones por hora alcanzado para ese email`);
      }
    }

    const [businessResult, barberResult] = await Promise.all([
      db.query('SELECT name, address FROM businesses WHERE id = $1', [appt.business_id]),
      db.query('SELECT name FROM barbers WHERE id = $1', [appt.barber_id])
    ]);

    await sendConfirmationEmail({
      to: appt.client_email,
      clientName: name,
      businessName: businessResult.rows[0]?.name,
      service,
      barber: barberResult.rows[0]?.name,
      date: appt.date,
      time,
      address: businessResult.rows[0]?.address,
      rescheduled
    });
  } catch (emailErr) {
    console.log(`⚠️ No se pudo enviar el email de confirmación: ${emailErr.message}`);
  }
}

// POST /api/appointments → crear nuevo turno
// Body: clientName, clientPhone, clientEmail?, service_id, barberId, date, time, businessId (el precio lo pone el server)
router.post('/', bookingLimiter, async (req, res) => {
  const { clientName, clientPhone, clientEmail, service_id, date, time, businessId, website } = req.body;
  const isOwner = !!req.session?.business_id;

  // Honeypot: un humano nunca ve ni completa "website". Éxito falso, sin crear el turno.
  if (typeof website === 'string' && website.trim() !== '') {
    console.log('🍯 Honeypot: reserva descartada');
    return res.status(200).json({
      id: 0, clientName, clientPhone, service_id, date, time, status: 'confirmed'
    });
  }

  const v = validateBookingInput(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  // El email del cliente logueado con Google es la fuente más confiable
  const resolvedClientEmail = req.session?.client?.email || (clientEmail ? clientEmail.trim() : null);
  // Si hay sesión de dueño (alta manual desde el admin), el negocio es el de su sesión, no el del body
  const resolvedBusinessId = req.session?.business_id || parseInt(businessId) || 1;

  const client = await db.connect();
  let r;
  try {
    await client.query('BEGIN');
    r = await insertAppointment(client, {
      ...v, clientPhone, email: resolvedClientEmail, businessId: resolvedBusinessId, date, time, isOwner
    });
    await client.query(r.error ? 'ROLLBACK' : 'COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    return res.status(500).json({ error: 'Error creando el turno' });
  } finally {
    client.release();
  }
  if (r.error) return res.status(r.status).json({ error: r.error });

  const newAppointment = r.appointment;
  const service = r.service.name;
  console.log(`📋 Nuevo turno: ${v.name} — ${service} el ${date} a las ${time}`);

  await sendBookingEmail(newAppointment, { name: v.name, service, time, isVerified: !!req.session?.client?.email });

  res.status(201).json({
    id: newAppointment.id,
    clientName: newAppointment.client_name,
    clientPhone: newAppointment.client_phone,
    service,
    service_id: newAppointment.service_id,
    date: newAppointment.date,
    time: newAppointment.time,
    price: newAppointment.price,
    status: newAppointment.status
  });
});

// ── Cambios del cliente (cancelar / reprogramar) ──

// Fecha 'YYYY-MM-DD' de una columna date de pg (el server corre en UTC)
function dateStr(d) {
  return d instanceof Date ? d.toISOString().split('T')[0] : String(d).split('T')[0];
}

// Turno del cliente, bloqueado para la transacción, con la regla de anticipación del negocio.
// Devuelve { status, error } si no se puede tocar, o { appt }.
async function lockOwnAppointment(q, id, clientEmail) {
  const r = await q.query(
    `SELECT a.*, COALESCE(biz.cancel_min_hours, 2) AS cancel_min_hours
       FROM appointments a JOIN businesses biz ON biz.id = a.business_id
      WHERE a.id = $1 AND a.client_email = $2
      FOR UPDATE OF a`,
    [id, clientEmail]
  );
  const appt = r.rows[0];
  if (!appt) return { status: 404, error: 'Turno no encontrado' };
  if (appt.status === 'cancelled') return { status: 409, error: 'Ese turno ya está cancelado' };

  // Argentina es UTC-3 todo el año
  const start = new Date(`${dateStr(appt.date)}T${String(appt.time).substring(0, 5)}:00-03:00`);
  const hoursLeft = (start.getTime() - Date.now()) / 3600000;
  if (hoursLeft <= 0) return { status: 403, error: 'Ese turno ya pasó' };

  const minHours = parseInt(appt.cancel_min_hours, 10) || 0;
  if (minHours > 0 && hoursLeft < minHours) {
    return {
      status: 403,
      error: `Los cambios se pueden hacer hasta ${minHours} ${minHours === 1 ? 'hora' : 'horas'} antes del turno. Para cambiarlo, escribile al negocio.`
    };
  }
  return { appt };
}

// Datos para el aviso al dueño
async function ownerNoticeContext(appt) {
  const r = await db.query(
    `SELECT biz.name AS business_name, COALESCE(biz.owner_email, o.email) AS owner_email,
            s.name AS service_name, b.name AS barber_name
       FROM businesses biz
       LEFT JOIN owners o ON o.business_id = biz.id
       LEFT JOIN services s ON s.id = $2
       LEFT JOIN barbers b ON b.id = $3
      WHERE biz.id = $1
      ORDER BY o.id
      LIMIT 1`,
    [appt.business_id, appt.service_id, appt.barber_id]
  );
  return r.rows[0] || {};
}

// PATCH /api/appointments/:id/reschedule → el cliente cambia su turno por otro, en una sola transacción
router.patch('/:id/reschedule', bookingLimiter, async (req, res) => {
  const clientEmail = req.session?.client?.email;
  if (!clientEmail) return res.status(401).json({ error: 'Iniciá sesión para cambiar tu turno' });

  const { clientName, clientPhone, service_id, barberId, date, time } = req.body;
  const v = validateBookingInput({ clientName, clientPhone, service_id, barberId, date, time });
  if (v.error) return res.status(400).json({ error: v.error });

  const client = await db.connect();
  let original, created, newService;
  try {
    await client.query('BEGIN');

    const own = await lockOwnAppointment(client, parseInt(req.params.id, 10), clientEmail);
    if (own.error) { await client.query('ROLLBACK'); return res.status(own.status).json({ error: own.error }); }
    original = own.appt;

    // Se cancela primero (dentro de la transacción) para que el turno viejo no cuente
    // como superposición ni para el límite por teléfono. Si algo falla, ROLLBACK lo deja como estaba.
    await client.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [original.id]);

    // El turno nuevo es siempre del mismo negocio que el original
    const r = await insertAppointment(client, {
      ...v, clientPhone, email: clientEmail, businessId: original.business_id, date, time, isOwner: false
    });
    if (r.error) { await client.query('ROLLBACK'); return res.status(r.status).json({ error: r.error }); }
    created = r.appointment;
    newService = r.service.name;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error PATCH /api/appointments/:id/reschedule:', err.message);
    return res.status(500).json({ error: 'Error cambiando el turno' });
  } finally {
    client.release();
  }

  console.log(`🔁 Turno ${original.id} reprogramado → ${created.id} (${date} ${time})`);
  await sendBookingEmail(created, { name: v.name, service: newService, time, isVerified: true, rescheduled: true });

  try {
    const ctx = await ownerNoticeContext(original);
    const newBarber = (await db.query('SELECT name FROM barbers WHERE id = $1', [created.barber_id])).rows[0]?.name;
    await sendOwnerNoticeEmail({
      to: ctx.owner_email, kind: 'rescheduled', businessName: ctx.business_name,
      clientName: original.client_name, clientPhone: original.client_phone,
      service: ctx.service_name, barber: ctx.barber_name, date: dateStr(original.date), time: String(original.time).substring(0, 5),
      newService, newBarber, newDate: date, newTime: time
    });
  } catch (err) {
    console.log(`⚠️ No se pudo avisar al negocio: ${err.message}`);
  }

  res.json({ id: created.id, date: created.date, time: created.time, status: created.status, replaced: original.id });
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

// PATCH /api/appointments/:id/attendance → el dueño marca si el cliente vino
// attendance: 'attended' | 'no_show' | null (desmarcar). Solo turnos de hoy o anteriores, no cancelados.
const ATTENDANCE = new Set(['attended', 'no_show']);
router.patch('/:id/attendance', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { attendance } = req.body || {};
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Turno inválido' });
  if (attendance !== null && !ATTENDANCE.has(attendance)) {
    return res.status(400).json({ error: 'La asistencia tiene que ser "attended", "no_show" o null' });
  }
  try {
    const result = await db.query(
      `UPDATE appointments SET attendance = $1
        WHERE id = $2 AND business_id = $3 AND status <> 'cancelled' AND date <= $4
        RETURNING id, attendance`,
      [attendance, id, req.businessId, todayAR()]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Solo se puede marcar la asistencia de turnos de hoy o anteriores que no estén cancelados' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error PATCH /api/appointments/:id/attendance:', err.message);
    res.status(500).json({ error: 'Error guardando la asistencia' });
  }
});

// PATCH /api/appointments/:id/cancel-mine → el cliente cancela su propio turno
router.patch('/:id/cancel-mine', async (req, res) => {
  const clientEmail = req.session?.client?.email;
  if (!clientEmail) {
    return res.status(401).json({ error: 'No hay sesión de cliente' });
  }

  const client = await db.connect();
  let appt;
  try {
    await client.query('BEGIN');
    // lockOwnAppointment asegura que sea un turno propio, vigente y dentro de la anticipación mínima
    const own = await lockOwnAppointment(client, parseInt(req.params.id, 10), clientEmail);
    if (own.error) { await client.query('ROLLBACK'); return res.status(own.status).json({ error: own.error }); }
    const result = await client.query(
      "UPDATE appointments SET status = 'cancelled' WHERE id = $1 RETURNING *",
      [own.appt.id]
    );
    await client.query('COMMIT');
    appt = result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error PATCH /api/appointments/:id/cancel-mine:', err.message);
    return res.status(500).json({ error: 'Error cancelando el turno' });
  } finally {
    client.release();
  }

  try {
    const ctx = await ownerNoticeContext(appt);
    await sendOwnerNoticeEmail({
      to: ctx.owner_email, kind: 'cancelled', businessName: ctx.business_name,
      clientName: appt.client_name, clientPhone: appt.client_phone,
      service: ctx.service_name, barber: ctx.barber_name, date: dateStr(appt.date), time: String(appt.time).substring(0, 5)
    });
  } catch (err) {
    console.log(`⚠️ No se pudo avisar al negocio: ${err.message}`);
  }

  res.json(appt);
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

// GET /api/appointments/slots/:date?barber_id=&business_id=&service_id= → horarios del día
// (compatibilidad: la página de reservas usa /api/availability; mismo motor)
router.get('/slots/:date', async (req, res) => {
  const bizId    = parseInt(req.query.business_id) || req.session?.business_id;
  const barberId = parseInt(req.query.barber_id);
  const serviceId = req.query.service_id ? parseInt(req.query.service_id) : null;
  if (!Number.isInteger(barberId) || barberId <= 0) return res.status(400).json({ error: 'Falta barber_id' });
  if (!bizId) return res.status(400).json({ error: 'Falta business_id' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return res.status(400).json({ error: 'Fecha inválida' });
  if (req.query.service_id && !serviceId) return res.status(400).json({ error: 'service_id inválido' });

  try {
    const r = await getAvailableSlots(barberId, bizId, serviceId, req.params.date);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json(r.slots);
  } catch (err) {
    console.error('Error GET /api/appointments/slots/:date:', err.message);
    res.status(500).json({ error: 'Error obteniendo slots' });
  }
});

module.exports = router;