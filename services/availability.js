// ==============================
// Motor de disponibilidad — única fuente de verdad para la grilla y la validación de reservas
// ==============================
const db = require('../config/database');

// Cada cuántos minutos se ofrece un horario de inicio
const SLOT_STEP_MINUTES = 15;
// Hoy: no se ofrecen horarios que empiecen dentro de este margen
const SAME_DAY_MARGIN_MINUTES = 15;
// Duración si el servicio no la tiene cargada
const DEFAULT_DURATION_MINUTES = 30;

const TZ_AR = 'America/Argentina/Buenos_Aires';

// Fecha de hoy (YYYY-MM-DD) en horario de Argentina, no UTC —
// el server corre en UTC y eso corría el corte de "hoy" varias horas.
function todayAR(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_AR }).format(now);
}

// Hora actual en Argentina, en minutos desde las 00:00 (mismo criterio que todayAR)
function nowMinutesAR(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ_AR, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now);
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

// Día de la semana (0 = domingo) de una fecha 'YYYY-MM-DD', sin depender de la zona del server
function dayOfWeek(date) {
  return new Date(date + 'T12:00:00Z').getUTCDay();
}

// 'YYYY-MM-DD' + n días
function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Tramos de atención [inicio, fin) en minutos de una fila de barber_schedules (incluye el turno partido)
function rangesFromSchedule(sched) {
  if (!sched || !sched.is_open || !sched.open_time || !sched.close_time) return [];
  const ranges = [[toMinutes(sched.open_time), toMinutes(sched.close_time)]];
  if (sched.has_split && sched.open_time_2 && sched.close_time_2) {
    ranges.push([toMinutes(sched.open_time_2), toMinutes(sched.close_time_2)]);
  }
  return ranges.filter(([a, b]) => b > a);
}

// Núcleo puro (sin base): arma la grilla de un día.
// - ranges: tramos [inicio, fin) del día
// - duration: duración del servicio a reservar
// - booked: turnos no cancelados del barbero ese día [{ start, duration }] en minutos
// - date / today / nowMins: para descartar lo que ya pasó hoy (hora de Argentina)
// Devuelve [{ time: 'HH:MM', available }]. Un horario existe si inicio + duración <= fin de SU tramo;
// está disponible si no se superpone con ningún turno.
function buildSlots({ ranges, duration, booked, date, today, nowMins }) {
  if (date < today) return [];
  const minStart = date === today ? nowMins + SAME_DAY_MARGIN_MINUTES : -1;
  const slots = [];
  for (const [open, close] of ranges) {
    for (let start = open; start + duration <= close; start += SLOT_STEP_MINUTES) {
      if (start < minStart) continue;
      const end = start + duration;
      const overlaps = booked.some(b => start < b.start + b.duration && b.start < end);
      slots.push({ time: toTimeStr(start), available: !overlaps });
    }
  }
  return slots.sort((a, b) => a.time.localeCompare(b.time));
}

// ── Carga de datos ───────────────────────────
// Cuatro consultas independientes que se mandan en paralelo (un solo viaje de ida y vuelta a la base):
// barbero, servicio, horario semanal completo y turnos no cancelados de un rango de fechas.
// Con un cliente de transacción, pg las encola en orden; con el pool van por conexiones distintas.
async function loadContext(q, { barberId, businessId, serviceId, from, to }) {
  const [barberRes, serviceRes, schedRes, bookedRes] = await Promise.all([
    q.query('SELECT id FROM barbers WHERE id = $1 AND business_id = $2', [barberId, businessId]),
    serviceId != null
      ? q.query('SELECT id, name, price, duration FROM services WHERE id = $1 AND business_id = $2 AND active = true', [serviceId, businessId])
      : Promise.resolve({ rows: [] }),
    q.query(
      `SELECT day_of_week, is_open, open_time, close_time, has_split, open_time_2, close_time_2
         FROM barber_schedules WHERE barber_id = $1`,
      [barberId]
    ),
    q.query(
      `SELECT to_char(a.date, 'YYYY-MM-DD') AS date, a.time, COALESCE(NULLIF(s.duration, 0), $4) AS duration
         FROM appointments a LEFT JOIN services s ON s.id = a.service_id
        WHERE a.barber_id = $1 AND a.date BETWEEN $2 AND $3 AND a.status != 'cancelled'`,
      [barberId, from, to, DEFAULT_DURATION_MINUTES]
    )
  ]);

  if (!barberRes.rows[0]) return { status: 400, error: 'Profesional inválido' };
  const service = serviceRes.rows[0] || null;
  if (serviceId != null && !service) return { status: 400, error: 'Servicio inválido' };

  const scheduleByDow = new Map(schedRes.rows.map(r => [Number(r.day_of_week), r]));
  const bookedByDate = new Map();
  for (const r of bookedRes.rows) {
    if (!bookedByDate.has(r.date)) bookedByDate.set(r.date, []);
    bookedByDate.get(r.date).push({ start: toMinutes(r.time), duration: parseInt(r.duration, 10) || DEFAULT_DURATION_MINUTES });
  }

  return {
    service,
    duration: parseInt(service?.duration, 10) || DEFAULT_DURATION_MINUTES,
    scheduleByDow,
    bookedByDate
  };
}

// Grilla de un día a partir del contexto ya cargado (en memoria, sin base)
function slotsForDate(ctx, date, now) {
  return buildSlots({
    ranges:   rangesFromSchedule(ctx.scheduleByDow.get(dayOfWeek(date))),
    duration: ctx.duration,
    booked:   ctx.bookedByDate.get(date) || [],
    date, today: todayAR(now), nowMins: nowMinutesAR(now)
  });
}

// Disponibilidad de un barbero para un servicio en una fecha.
// `q` = pool o cliente de una transacción (la validación del POST la llama dentro de su transacción, con el lock tomado).
// serviceId null → duración por defecto (compatibilidad con /slots sin servicio).
// Devuelve { slots, service } o { status, error }.
async function getAvailableSlots(barberId, businessId, serviceId, date, q = db, now = new Date()) {
  const ctx = await loadContext(q, { barberId, businessId, serviceId, from: date, to: date });
  if (ctx.error) return ctx;
  return { slots: slotsForDate(ctx, date, now), service: ctx.service };
}

// Próximos `days` días (desde `from`) en que el barbero atiende, cada uno con su grilla.
// Mismo cálculo que getAvailableSlots, con los turnos de todo el rango traídos en una sola consulta.
// Si atiende al menos un día por semana, `days` días hábiles entran en 7 × days días corridos.
async function getAvailability(barberId, businessId, serviceId, from, days, q = db, now = new Date()) {
  const span = Math.min(days * 7, 60);
  const to   = addDays(from, span - 1);
  const ctx  = await loadContext(q, { barberId, businessId, serviceId, from, to });
  if (ctx.error) return ctx;

  const dates = [];
  for (let i = 0; i < span && dates.length < days; i++) {
    const d = addDays(from, i);
    if (ctx.scheduleByDow.get(dayOfWeek(d))?.is_open) dates.push(d);
  }
  return { today: todayAR(now), days: dates.map(date => ({ date, slots: slotsForDate(ctx, date, now) })) };
}

module.exports = {
  SLOT_STEP_MINUTES, SAME_DAY_MARGIN_MINUTES, DEFAULT_DURATION_MINUTES,
  todayAR, nowMinutesAR, toMinutes, toTimeStr, addDays,
  rangesFromSchedule, buildSlots, getAvailableSlots, getAvailability
};
