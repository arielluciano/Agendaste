// Tests del motor de disponibilidad con datos simulados (no se conecta a ninguna base).
// Correr con: npm test
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// config/database abre un Pool al cargarse: lo reemplazamos antes de requerir el motor
const dbPath = path.join(__dirname, '..', 'config', 'database.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [] }) } };

const { buildSlots, getAvailableSlots, SLOT_STEP_MINUTES } = require('../services/availability');

const FUTURE = '2030-06-10'; // lunes
const NOW    = new Date('2030-06-01T15:00:00Z'); // otra fecha: nada se descarta por "ya pasó"

// Base falsa: responde según la consulta, igual que las tablas reales
function fakeDb({ schedule, appointments = [], services = { 1: 30, 2: 60 } }) {
  return {
    async query(sql, params) {
      if (sql.includes('FROM barbers')) return { rows: [{ id: params[0] }] };
      if (sql.includes('FROM services')) {
        const d = services[params[0]];
        return { rows: d ? [{ id: params[0], name: 'Servicio', price: 1000, duration: d }] : [] };
      }
      if (sql.includes('FROM barber_schedules')) return { rows: schedule ? [schedule] : [] };
      if (sql.includes('FROM appointments')) {
        return { rows: appointments.map(a => ({ time: a.time + ':00', duration: services[a.service_id] ?? 30 })) };
      }
      throw new Error('consulta no esperada: ' + sql);
    }
  };
}

const NINE_TO_EIGHT = { is_open: true, open_time: '09:00:00', close_time: '20:00:00', has_split: false };
const times = slots => slots.map(s => s.time);
const slotAt = (slots, t) => slots.find(s => s.time === t);

test('la grilla va cada SLOT_STEP_MINUTES', async () => {
  const r = await getAvailableSlots(1, 1, 1, FUTURE, fakeDb({ schedule: NINE_TO_EIGHT }), NOW);
  assert.equal(SLOT_STEP_MINUTES, 15);
  assert.deepEqual(times(r.slots).slice(0, 4), ['09:00', '09:15', '09:30', '09:45']);
});

test('servicio de 60 min con un turno a las 11:00 no ofrece las 10:30', async () => {
  const q = fakeDb({ schedule: NINE_TO_EIGHT, appointments: [{ time: '11:00', service_id: 1 }] });
  const { slots } = await getAvailableSlots(1, 1, 2, FUTURE, q, NOW);
  assert.equal(slotAt(slots, '10:00').available, true);   // 10:00–11:00 termina justo cuando empieza el otro
  assert.equal(slotAt(slots, '10:15').available, false);
  assert.equal(slotAt(slots, '10:30').available, false);
  assert.equal(slotAt(slots, '11:00').available, false);
  assert.equal(slotAt(slots, '11:15').available, false);  // el turno de las 11 dura 30 min
  assert.equal(slotAt(slots, '11:30').available, true);
});

test('la superposición usa la duración real del turno ya reservado', async () => {
  // Turno de 60 min a las 10:00 → un servicio de 30 min no entra a las 10:45
  const q = fakeDb({ schedule: NINE_TO_EIGHT, appointments: [{ time: '10:00', service_id: 2 }] });
  const { slots } = await getAvailableSlots(1, 1, 1, FUTURE, q, NOW);
  assert.equal(slotAt(slots, '09:30').available, true);
  assert.equal(slotAt(slots, '09:45').available, false);
  assert.equal(slotAt(slots, '10:45').available, false);
  assert.equal(slotAt(slots, '11:00').available, true);
});

test('un servicio que terminaría después del cierre no aparece', async () => {
  const { slots } = await getAvailableSlots(1, 1, 2, FUTURE, fakeDb({ schedule: NINE_TO_EIGHT }), NOW);
  assert.equal(times(slots).at(-1), '19:00');        // 19:00 + 60 = 20:00 = cierre
  assert.equal(slotAt(slots, '19:15'), undefined);
  assert.equal(slotAt(slots, '19:45'), undefined);
});

test('el turno partido respeta el descanso', async () => {
  const split = { is_open: true, open_time: '09:00:00', close_time: '13:00:00',
                  has_split: true, open_time_2: '16:00:00', close_time_2: '20:00:00' };
  const { slots } = await getAvailableSlots(1, 1, 2, FUTURE, fakeDb({ schedule: split }), NOW);
  const t = times(slots);
  assert.ok(t.includes('12:00'));                     // 12:00–13:00 entra justo en el primer tramo
  assert.ok(!t.includes('12:15'));                    // se pasaría al descanso
  assert.ok(!t.some(x => x > '12:00' && x < '16:00')); // nada durante el descanso
  assert.ok(t.includes('16:00'));
  assert.equal(t.at(-1), '19:00');
});

test('día cerrado o sin horario cargado → sin horarios', async () => {
  const closed = await getAvailableSlots(1, 1, 1, FUTURE, fakeDb({ schedule: { ...NINE_TO_EIGHT, is_open: false } }), NOW);
  assert.deepEqual(closed.slots, []);
  const none = await getAvailableSlots(1, 1, 1, FUTURE, fakeDb({ schedule: null }), NOW);
  assert.deepEqual(none.slots, []);
});

test('hoy oculta lo que ya pasó, con 15 min de margen y en hora de Argentina', async () => {
  // 13:07 UTC = 10:07 en Argentina → primer horario posible 10:22 → se ofrece desde las 10:30
  const now = new Date('2030-06-10T13:07:00Z');
  const { slots } = await getAvailableSlots(1, 1, 1, '2030-06-10', fakeDb({ schedule: NINE_TO_EIGHT }), now);
  assert.equal(times(slots)[0], '10:30');
  assert.ok(!times(slots).includes('10:15'));
});

test('hoy cerca de medianoche UTC usa la fecha de Argentina, no la del server', async () => {
  // 02:00 UTC del 11/06 = 23:00 del 10/06 en Argentina: el 10/06 sigue siendo "hoy" y ya no queda nada
  const now = new Date('2030-06-11T02:00:00Z');
  const today = await getAvailableSlots(1, 1, 1, '2030-06-10', fakeDb({ schedule: NINE_TO_EIGHT }), now);
  assert.deepEqual(today.slots, []);
  const tomorrow = await getAvailableSlots(1, 1, 1, '2030-06-11', fakeDb({ schedule: NINE_TO_EIGHT }), now);
  assert.equal(times(tomorrow.slots)[0], '09:00');
});

test('fecha pasada → sin horarios', () => {
  const slots = buildSlots({ ranges: [[540, 1200]], duration: 30, booked: [], date: '2030-06-09', today: '2030-06-10', nowMins: 0 });
  assert.deepEqual(slots, []);
});

test('servicio inexistente o inactivo → error', async () => {
  const r = await getAvailableSlots(1, 1, 99, FUTURE, fakeDb({ schedule: NINE_TO_EIGHT }), NOW);
  assert.equal(r.status, 400);
  assert.equal(r.error, 'Servicio inválido');
});
