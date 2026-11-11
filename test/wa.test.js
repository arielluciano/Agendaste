// Tests del helper de WhatsApp del frontend (public/js/wa.js)
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'wa.js'), 'utf8'), { window });
const { normalizeArPhone, waLink } = window;

test('normaliza teléfonos argentinos a 549 + área + número', () => {
  const casos = {
    '11 2345-6789':          '5491123456789',
    '011 2345 6789':         '5491123456789',
    '011 15 2345-6789':      '5491123456789',
    '11 15 2345 6789':       '5491123456789',
    '+54 9 11 2345-6789':    '5491123456789',
    '+54 11 2345-6789':      '5491123456789',
    '0054 9 11 2345 6789':   '5491123456789',
    '0351 15 123-4567':      '5493511234567',
    '+54 9 351 123 4567':    '5493511234567',
    '(0221) 15-412-3456':    '5492214123456'
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

test('waLink arma el link con el mensaje codificado (emojis incluidos)', () => {
  const url = waLink('11 2345-6789', 'Hola! ✂️ 📅 jue 13/11 · 10:30');
  assert.ok(url.startsWith('https://wa.me/5491123456789?text='));
  assert.equal(decodeURIComponent(url.split('?text=')[1]), 'Hola! ✂️ 📅 jue 13/11 · 10:30');
  assert.equal(waLink('11 2345-6789'), 'https://wa.me/5491123456789');
  assert.equal(waLink(''), null);
});
