const test = require('node:test');
const assert = require('node:assert');
const QR = require('../public/js/qr');
const { rsDivisor, rsRemainder, formatBits, versionBits, BLOCKS, ALIGN } = QR._internal;

test('Reed-Solomon: ejemplo publicado "HELLO WORLD" 1-Q (13 de datos + 13 de corrección)', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236];
  assert.deepStrictEqual(rsRemainder(data, rsDivisor(13)), [168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16]);
});

test('bits de formato del nivel M (tabla de la norma) y de versión 7', () => {
  const table = ['101010000010010', '101000100100101', '101111001111100', '101101101001011',
                 '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
  table.forEach((bits, mask) => assert.strictEqual(formatBits(mask).toString(2).padStart(15, '0'), bits, `máscara ${mask}`));
  assert.strictEqual(versionBits(7), 0x07C94);
});

// ── Lector independiente para el test de ida y vuelta ──
function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; }

function reservedMap(version) {
  const size = version * 4 + 17;
  const r = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) r[y][x] = true; };
  mark(0, 0, 9, 9); mark(size - 8, 0, 8, 9); mark(0, size - 8, 9, 8);   // posición + formato
  mark(6, 0, 1, size); mark(0, 6, size, 1);                             // sincronismo
  const p = ALIGN[version];
  p.forEach((ay, i) => p.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === p.length - 1) || (i === p.length - 1 && j === 0)) return;
    mark(ax - 2, ay - 2, 5, 5);
  }));
  if (version >= 7) { mark(size - 11, 0, 3, 6); mark(0, size - 11, 6, 3); }
  return r;
}

function decode(m) {
  const size = m.length;
  const version = (size - 17) / 4;
  // Máscara desde la primera copia del formato
  let fb = 0;
  const coords = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  coords.forEach(([x, y], i) => { if (m[y][x]) fb |= 1 << i; });
  const mask = [0, 1, 2, 3, 4, 5, 6, 7].find(k => formatBits(k) === fb);
  assert.notStrictEqual(mask, undefined, 'formato ilegible');
  const maskFn = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
  ][mask];
  const reserved = reservedMap(version);
  const bits = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    for (let k = 0; k < size; k++) {
      const y = upward ? size - 1 - k : k;
      for (const x of [right, right - 1]) if (!reserved[y][x]) bits.push(m[y][x] !== maskFn(x, y) ? 1 : 0);
    }
    upward = !upward;
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  // Desintercalar bloques y verificar los síndromes de Reed-Solomon (todos 0 = sin errores)
  const { ec, groups } = BLOCKS[version];
  const lens = groups.flatMap(([n, d]) => new Array(n).fill(d));
  const blocks = lens.map(() => []);
  let k = 0;
  for (let i = 0; i < Math.max(...lens); i++) lens.forEach((len, b) => { if (i < len) blocks[b].push(bytes[k++]); });
  for (let i = 0; i < ec; i++) blocks.forEach(b => b.push(bytes[k++]));
  for (const block of blocks) {
    let alpha = 1;
    for (let i = 0; i < ec; i++) {
      let s = 0;
      for (const c of block) s = gfMul(s, alpha) ^ c;
      assert.strictEqual(s, 0, 'síndrome distinto de 0');
      alpha = gfMul(alpha, 2);
    }
  }
  const data = blocks.flatMap((b, i) => b.slice(0, lens[i]));
  const dbits = data.flatMap(b => [7, 6, 5, 4, 3, 2, 1, 0].map(i => (b >>> i) & 1));
  const read = (from, n) => dbits.slice(from, from + n).reduce((a, b) => (a << 1) | b, 0);
  assert.strictEqual(read(0, 4), 0b0100, 'modo byte');
  const len = read(4, 8);
  return Buffer.from(Array.from({ length: len }, (_, i) => read(12 + i * 8, 8))).toString('utf8');
}

test('ida y vuelta: patrones fijos en su lugar y los datos se leen igual', () => {
  const samples = [
    'https://agendaste.com.ar/barberia-demo',
    'https://agendaste.com.ar/' + 'peluqueria-de-nombre-muy-largo-'.repeat(2),
    'https://agendaste.com.ar/' + 'x'.repeat(150),   // versión 7+ (con información de versión)
    'Ñandú barbería ✂️'
  ];
  for (const text of samples) {
    const m = QR.encode(text);
    const size = m.length;
    // Patrón de posición: anillo oscuro exterior y centro 3x3 oscuro en las tres esquinas
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      assert.ok(m[cy][cx] && m[cy - 3][cx - 3] && !m[cy - 2][cx - 2] && m[cy - 1][cx - 1]);
    }
    for (let i = 8; i < size - 8; i++) assert.strictEqual(m[6][i], i % 2 === 0, 'sincronismo');
    assert.ok(m[size - 8][8], 'módulo oscuro');
    assert.strictEqual(decode(m), text);
  }
});

test('texto demasiado largo para versión 9', () => {
  assert.throws(() => QR.encode('x'.repeat(181)), /demasiado largo/);
  assert.doesNotThrow(() => QR.encode('x'.repeat(180)));
});
