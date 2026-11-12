const test = require('node:test');
const assert = require('node:assert');
const { validateService, validateWeekSchedule } = require('../services/validation');

test('servicio nuevo: precio y duración en rango', () => {
  assert.deepStrictEqual(validateService({ name: ' Corte ', price: 8000, duration: 30 }).values, { name: 'Corte', price: 8000, duration: 30 });
  assert.deepStrictEqual(validateService({ name: 'Corte', price: '1', duration: '480' }).values, { name: 'Corte', price: 1, duration: 480 });
  assert.ok(validateService({ name: 'Corte', price: 10000000, duration: 5 }).values);
});

test('servicio nuevo: rechaza precios y duraciones fuera de rango o no enteros', () => {
  for (const price of [0, -1, 10000001, 12.5, '12.5', '1e3', '', null, true, 'abc']) {
    assert.match(validateService({ name: 'Corte', price, duration: 30 }).error, /precio/, `price ${price}`);
  }
  for (const duration of [0, 4, 481, 7.5, '', null, 'x']) {
    assert.match(validateService({ name: 'Corte', price: 100, duration }).error, /duración/, `duration ${duration}`);
  }
  assert.match(validateService({ name: '  ', price: 100, duration: 30 }).error, /nombre/);
});

test('editar servicio: solo valida lo que viene', () => {
  assert.deepStrictEqual(validateService({ price: 9000 }, { partial: true }).values, { price: 9000 });
  assert.deepStrictEqual(validateService({ active: false }, { partial: true }).values, { active: false });
  assert.deepStrictEqual(validateService({ dur: 45 }, { partial: true }).values, { duration: 45 });
  assert.match(validateService({ price: 0 }, { partial: true }).error, /precio/);
  assert.match(validateService({ duration: 600 }, { partial: true }).error, /duración/);
  assert.match(validateService({ active: 'si' }, { partial: true }).error, /estado/);
  assert.match(validateService({}, { partial: true }).error, /No hay datos/);
});

test('horarios: acepta días válidos, cerrados sin horas y turno partido', () => {
  assert.strictEqual(validateWeekSchedule([
    { day_of_week: 1, is_open: true, open_time: '09:00', close_time: '18:00', has_split: false, open_time_2: '', close_time_2: '' },
    { day_of_week: 2, is_open: true, open_time: '09:00', close_time: '13:00', has_split: true, open_time_2: '16:00', close_time_2: '20:00:00' },
    { day_of_week: 0, is_open: false, open_time: null, close_time: null }
  ]), null);
});

test('horarios: rechaza datos inválidos', () => {
  const day = (o) => [{ day_of_week: 1, is_open: true, open_time: '09:00', close_time: '18:00', ...o }];
  assert.ok(validateWeekSchedule('x'));
  assert.ok(validateWeekSchedule(day({ day_of_week: 7 })));
  assert.ok(validateWeekSchedule(day({ is_open: 'true' })));
  assert.ok(validateWeekSchedule(day({ open_time: '25:00' })));
  assert.ok(validateWeekSchedule(day({ close_time: '08:00' })));
  assert.ok(validateWeekSchedule(day({ has_split: true, open_time_2: '17:00', close_time_2: '20:00' })));
  assert.ok(validateWeekSchedule(day({ has_split: true, open_time_2: '19:00', close_time_2: '19:00' })));
  assert.ok(validateWeekSchedule([...day({}), ...day({})]));
  assert.ok(validateWeekSchedule([{ day_of_week: 3, is_open: false, open_time: 'abc' }]));
});
