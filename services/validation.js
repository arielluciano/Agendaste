// ==============================
// Validación de los datos numéricos y horarios que carga el dueño
// ==============================
// Todas devuelven { error } con un mensaje para mostrar, o los valores ya normalizados.

const PRICE_MIN = 1;
const PRICE_MAX = 10000000;
const DURATION_MIN = 5;
const DURATION_MAX = 480;
const NAME_MAX = 80;

// Entero exacto: número o texto de solo dígitos (rechaza "12.5", "1e3", "", true, null)
function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return Number(v);
  return null;
}

function intInRange(v, min, max) {
  const n = toInt(v);
  return n !== null && n >= min && n <= max ? n : null;
}

const fmt = n => n.toLocaleString('es-AR');
const PRICE_ERROR    = `El precio tiene que ser un número entero entre $${fmt(PRICE_MIN)} y $${fmt(PRICE_MAX)}`;
const DURATION_ERROR = `La duración tiene que ser un número entero de minutos entre ${DURATION_MIN} y ${DURATION_MAX}`;

// Servicio. partial = true (editar): solo valida lo que viene.
// Devuelve { error } o { values: { name?, price?, duration?, active? } }
function validateService(body, { partial = false } = {}) {
  body = body || {};
  const values = {};
  const has = k => body[k] !== undefined && body[k] !== null;

  if (has('name') || !partial) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { error: 'El nombre del servicio es obligatorio' };
    if (name.length > NAME_MAX) return { error: `El nombre del servicio puede tener hasta ${NAME_MAX} caracteres` };
    values.name = name;
  }

  if (has('price') || !partial) {
    const price = intInRange(body.price, PRICE_MIN, PRICE_MAX);
    if (price === null) return { error: PRICE_ERROR };
    values.price = price;
  }

  // "dur" es el nombre viejo que usaba el PATCH
  const durRaw = has('duration') ? body.duration : body.dur;
  if ((durRaw !== undefined && durRaw !== null) || !partial) {
    const duration = intInRange(durRaw, DURATION_MIN, DURATION_MAX);
    if (duration === null) return { error: DURATION_ERROR };
    values.duration = duration;
  }

  if (has('active')) {
    if (typeof body.active !== 'boolean') return { error: 'El estado del servicio no es válido' };
    values.active = body.active;
  }

  if (partial && Object.keys(values).length === 0) return { error: 'No hay datos para actualizar' };
  return { values };
}

// ── Horarios semanales (barberos y horario base del negocio) ──
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const minutes = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const isTime = t => typeof t === 'string' && TIME_RE.test(t);
const empty = t => t === undefined || t === null || t === '';

// Devuelve un mensaje de error o null. Los días cerrados pueden venir sin horas;
// las horas que vengan tienen que tener formato HH:MM igual.
function validateWeekSchedule(schedule) {
  if (!Array.isArray(schedule) || schedule.length > 7) return 'Formato de horarios inválido';
  const seen = new Set();
  for (const day of schedule) {
    if (!day || typeof day !== 'object') return 'Formato de horarios inválido';
    const dow = toInt(day.day_of_week);
    if (dow === null || dow < 0 || dow > 6) return 'Día de la semana inválido';
    if (seen.has(dow)) return `El ${DAY_NAMES[dow]} está repetido`;
    seen.add(dow);
    if (typeof day.is_open !== 'boolean') return `Falta indicar si el ${DAY_NAMES[dow]} está abierto`;
    if (day.has_split !== undefined && day.has_split !== null && typeof day.has_split !== 'boolean') {
      return `Turno partido inválido el ${DAY_NAMES[dow]}`;
    }

    for (const k of ['open_time', 'close_time', 'open_time_2', 'close_time_2']) {
      if (!empty(day[k]) && !isTime(day[k])) return `Hora inválida el ${DAY_NAMES[dow]} (usá HH:MM)`;
    }
    if (!day.is_open) continue;

    if (!isTime(day.open_time) || !isTime(day.close_time)) return `Faltan las horas de apertura y cierre del ${DAY_NAMES[dow]}`;
    if (minutes(day.open_time) >= minutes(day.close_time)) return `El ${DAY_NAMES[dow]} la hora de cierre tiene que ser posterior a la de apertura`;

    if (day.has_split) {
      if (!isTime(day.open_time_2) || !isTime(day.close_time_2)) return `Faltan las horas del segundo tramo del ${DAY_NAMES[dow]}`;
      if (minutes(day.open_time_2) < minutes(day.close_time)) return `El ${DAY_NAMES[dow]} el segundo tramo tiene que empezar después del primero`;
      if (minutes(day.open_time_2) >= minutes(day.close_time_2)) return `El ${DAY_NAMES[dow]} el segundo tramo tiene que cerrar después de abrir`;
    }
  }
  return null;
}

module.exports = {
  PRICE_MIN, PRICE_MAX, DURATION_MIN, DURATION_MAX,
  toInt, intInRange, validateService, validateWeekSchedule
};
