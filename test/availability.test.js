// Tests del motor de disponibilidad con datos simulados (no se conecta a ninguna base).
// Correr con: npm test
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// config/database abre un Pool al cargarse: lo reemplazamos antes de requerir el motor
const dbPath = path.join(__dirname, '..', 'config', 'database.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [] }) } };

const { buildSlots, getAvailableSlots, getAvailability, SLOT_STEP_MINUTES } = require('../services/availability');

const FUTURE = '2030-06-10'; // lunes
const NOW    = new Date('2030-06-01T15:00:00Z'); // otra fecha: nada se descarta por "ya pasó"

// Base falsa: responde según la consulta, igual que las tablas reales.
// - schedule: una fila que vale para todos los días, o un objeto { day_of_week: fila }
// - appointments: [{ date?, time, service_id }] (date por defecto = FUTURE)
// Cuenta las consultas en `calls`.
function fakeDb({ schedule, appointments = [], services = { 1: 30, 2: 60 } }) {
  const byDow = schedule && !('is_open' in schedule)
    ? schedule
    : Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, schedule]));
  const db = {
    calls: [],
    async query(sql, params) {
      db.calls.push(sql);
      if (sql.includes('FROM barbers')) return { rows: [{ id: params[0] }] };
      if (sql.includes('FROM services')) {
        const d = services[params[0]];
        return { rows: d ? [{ id: params[0], name: 'Servicio', price: 1000, duration: d }] : [] };
      }
      if (sql.includes('FROM barber_schedules')) {
        return { rows: Object.entries(byDow).filter(([, r]) => r).map(([d, r]) => ({ day_of_week: Number(d), ...r })) };
      }
      if (sql.includes('FROM appointments')) {
        const [, from, to] = params;
        return { rows: appointments
          .map(a => ({ date: a.date || FUTURE, time: a.time + ':00', duration: services[a.service_id] ?? 30 }))
          .filter(a => a.date >= from && a.date <= to) };
      }
      throw new Error('consulta no esperada: ' + sql);
    }
  };
  return db;
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

test('availability: varios días con una sola tanda de consultas (4) y saltea los días cerrados', async () => {
  const open = { is_open: true, open_time: '09:00:00', close_time: '12:00:00', has_split: false };
  // Atiende lunes (1), miércoles (3) y viernes (5)
  const q = fakeDb({
    schedule: { 1: open, 3: open, 5: open, 0: { ...open, is_open: false } },
    appointments: [
      { date: '2030-06-12', time: '10:00', service_id: 2 },  // miércoles, 60 min
      { date: '2030-06-20', time: '09:00', service_id: 1 }   // jueves: no atiende, no importa
    ]
  });
  const r = await getAvailability(1, 1, 1, FUTURE, 4, q, NOW);
  assert.equal(q.calls.length, 4);
  assert.deepEqual(r.days.map(d => d.date), ['2030-06-10', '2030-06-12', '2030-06-14', '2030-06-17']);
  const wed = r.days[1].slots;
  assert.equal(slotAt(wed, '09:30').available, true);
  assert.equal(slotAt(wed, '09:45').available, false);
  assert.equal(slotAt(wed, '10:45').available, false);
  assert.equal(slotAt(wed, '11:00').available, true);
});

test('availability da lo mismo que getAvailableSlots día por día', async () => {
  const split = { is_open: true, open_time: '09:00:00', close_time: '13:00:00',
                  has_split: true, open_time_2: '16:00:00', close_time_2: '20:00:00' };
  const appointments = [
    { date: '2030-06-10', time: '11:00', service_id: 1 },
    { date: '2030-06-11', time: '16:30', service_id: 2 },
    { date: '2030-06-13', time: '12:15', service_id: 1 }
  ];
  const now = new Date('2030-06-10T13:07:00Z'); // hoy = 10/06, 10:07 en Argentina
  const multi = await getAvailability(1, 1, 2, '2030-06-10', 6, fakeDb({ schedule: split, appointments }), now);
  for (const day of multi.days) {
    const single = await getAvailableSlots(1, 1, 2, day.date, fakeDb({ schedule: split, appointments }), now);
    assert.deepEqual(day.slots, single.slots, `difiere el ${day.date}`);
  }
  assert.equal(multi.today, '2030-06-10');
});

test('availability: barbero que no atiende ningún día → sin días', async () => {
  const r = await getAvailability(1, 1, 1, FUTURE, 6, fakeDb({ schedule: null }), NOW);
  assert.deepEqual(r.days, []);
});

test('servicio inexistente o inactivo → error', async () => {
  const r = await getAvailableSlots(1, 1, 99, FUTURE, fakeDb({ schedule: NINE_TO_EIGHT }), NOW);
  assert.equal(r.status, 400);
  assert.equal(r.error, 'Servicio inválido');
});
