// Tests del helper de WhatsApp del frontend (public/js/whatsapp.js)
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'whatsapp.js'), 'utf8'), { window });
const { normalizeArPhone, waLink, bookingConfirmedText } = window;

test('reglas: 10 dígitos → 549; 54 + 10 → agrega el 9; 549 → se deja', () => {
  assert.equal(normalizeArPhone('1123456789'),     '5491123456789');
  assert.equal(normalizeArPhone('541123456789'),   '5491123456789');
  assert.equal(normalizeArPhone('5491123456789'),  '5491123456789');
  assert.equal(normalizeArPhone('+54 9 351 123 4567'), '5493511234567');
});

test('formatos locales argentinos', () => {
  const casos = {
    '11 2345-6789':        '5491123456789',
    '011 2345 6789':       '5491123456789',
    '011 15 2345-6789':    '5491123456789',
    '11 15 2345 6789':     '5491123456789',
    '+54 11 2345-6789':    '5491123456789',
    '0054 9 11 2345 6789': '5491123456789',
    '0351 15 123-4567':    '5493511234567',
    '(0221) 15-412-3456':  '5492214123456'
  };
  for (const [entrada, esperado] of Object.entries(casos)) {
    assert.equal(normalizeArPhone(entrada), esperado, entrada);
  }
});

test('otros países quedan como vienen; basura → null', () => {
  assert.equal(normalizeArPhone('+598 99 123 456'), '59899123456');
  assert.equal(normalizeArPhone(''), null);
  assert.equal(normalizeArPhone(null), null);
  assert.equal(normalizeArPhone('1234'), null);
  assert.equal(normalizeArPhone('sin teléfono'), null);
});

test('mensaje de turno confirmado: una línea por dato', () => {
  const text = bookingConfirmedText({
    business: 'Santi Barber', day: 'Jue 12 de noviembre', time: '09:30',
    service: 'Corte', barber: 'Hanna', address: 'Av. Corrientes 1234'
  });
  assert.equal(text, [
    '✅ ¡Turno confirmado en Santi Barber!',
    '📅 Jue 12 de noviembre',
    '🕐 09:30',
    '✂️ Corte',
    '💈 Hanna',
    '📍 Av. Corrientes 1234',
    'Reservado vía Agendaste'
  ].join('\n'));
  // Sin dirección no queda la línea vacía
  assert.ok(!bookingConfirmedText({ business: 'X', day: 'd', time: 't', service: 's', barber: 'b' }).includes('📍'));
});

test('decodeURIComponent del link devuelve el texto intacto (emojis y saltos)', () => {
  const text = bookingConfirmedText({
    business: 'Peluquería Ñandú & Co', day: 'Jue 12 de noviembre', time: '09:30',
    service: 'Corte + barba', barber: 'José', address: 'Calle 7 #123, 1°B'
  });
  const url = waLink('011 15 2345-6789', text);
  assert.ok(url.startsWith('https://wa.me/5491123456789?text='));
  const encoded = url.split('?text=')[1];
  assert.equal(decodeURIComponent(encoded), text);
  assert.ok(encoded.includes('%0A'), 'los saltos de línea van como %0A');
  assert.ok(encoded.includes('%E2%9C%85'), '✅ va en UTF-8');
  assert.ok(encoded.includes('%F0%9F%93%85'), '📅 va en UTF-8 (4 bytes)');
  assert.ok(!/[^\x21-\x7E]/.test(url), 'el link es ASCII puro: nada sin codificar');
  assert.equal(new URL(url).searchParams.get('text'), text);
});

test('waLink sin texto o sin teléfono', () => {
  assert.equal(waLink('11 2345-6789'), 'https://wa.me/5491123456789');
  assert.equal(waLink('', 'hola'), null);
});
