// ==============================
// Agendaste — Generador de códigos QR (en el navegador, sin servicios externos)
// ==============================
// Modo byte (UTF-8), corrección de errores nivel M, versiones 1 a 9 (hasta 180 bytes:
// alcanza de sobra para el link de reservas). Sigue la norma ISO/IEC 18004.
// Uso: AgendasteQR.encode(texto) → matriz booleana [fila][columna] (true = módulo oscuro)
//      AgendasteQR.toCanvas(texto, { scale, margin }) → <canvas> listo para mostrar o bajar como PNG
(function (root) {
  // Por versión (nivel M): bloques [cantidad, bytes de datos] y bytes de corrección por bloque
  const BLOCKS = {
    1: { ec: 10, groups: [[1, 16]] },
    2: { ec: 16, groups: [[1, 28]] },
    3: { ec: 26, groups: [[1, 44]] },
    4: { ec: 18, groups: [[2, 32]] },
    5: { ec: 24, groups: [[2, 43]] },
    6: { ec: 16, groups: [[4, 27]] },
    7: { ec: 18, groups: [[4, 31]] },
    8: { ec: 22, groups: [[2, 38], [2, 39]] },
    9: { ec: 22, groups: [[3, 36], [2, 37]] }
  };
  const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46] };
  const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0 };
  const EC_LEVEL_M = 0; // bits de formato: L=1, M=0, Q=3, H=2

  const dataCapacity = v => BLOCKS[v].groups.reduce((s, [n, d]) => s + n * d, 0);

  // ── Reed-Solomon sobre GF(256), polinomio 0x11D ──
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let rootVal = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], rootVal);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      rootVal = gfMul(rootVal, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
    }
    return result;
  }

  // ── Datos: modo byte + largo + bytes + terminador + relleno ──
  function utf8(text) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
    return Array.from(Buffer.from(text, 'utf8'));
  }

  function dataCodewords(bytes, version) {
    const capacityBits = dataCapacity(version) * 8;
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0b0100, 4);              // modo byte
    push(bytes.length, 8);        // largo (8 bits en versiones 1 a 9)
    bytes.forEach(b => push(b, 8));
    push(0, Math.min(4, capacityBits - bits.length)); // terminador
    while (bits.length % 8) bits.push(0);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    for (let pad = 0xEC; out.length < capacityBits / 8; pad ^= 0xEC ^ 0x11) out.push(pad);
    return out;
  }

  // Divide en bloques, agrega la corrección de cada uno e intercala
  function withEcc(data, version) {
    const { ec, groups } = BLOCKS[version];
    const divisor = rsDivisor(ec);
    const blocks = [];
    let k = 0;
    for (const [count, len] of groups) {
      for (let i = 0; i < count; i++) {
        const dat = data.slice(k, k + len);
        k += len;
        blocks.push({ dat, ecc: rsRemainder(dat, divisor) });
      }
    }
    const out = [];
    const maxLen = Math.max(...blocks.map(b => b.dat.length));
    for (let i = 0; i < maxLen; i++) blocks.forEach(b => { if (i < b.dat.length) out.push(b.dat[i]); });
    for (let i = 0; i < ec; i++) blocks.forEach(b => out.push(b.ecc[i]));
    return out;
  }

  // ── Matriz ──
  function formatBits(mask) {
    const data = (EC_LEVEL_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function versionBits(version) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    return (version << 12) | rem;
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
  ];

  function build(codewords, version, mask) {
    const size = version * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

    // Patrones de sincronismo, de posición y de alineación
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
    const pos = ALIGN[version];
    pos.forEach((ay, i) => pos.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));

    // Información de formato (dos copias) y módulo oscuro fijo
    const fb = formatBits(mask);
    const bit = (v, i) => ((v >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(fb, i));
    set(8, 7, bit(fb, 6)); set(8, 8, bit(fb, 7)); set(7, 8, bit(fb, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(fb, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(fb, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(fb, i));
    set(8, size - 8, true);

    // Información de versión (7 en adelante)
    if (version >= 7) {
      const vb = versionBits(version);
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, bit(vb, i)); set(b, a, bit(vb, i));
      }
    }

    // Datos en zigzag: columnas de a pares, de derecha a izquierda, saltando la de sincronismo
    let i = 0;
    const totalBits = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (fn[y][x]) continue;
          if (i < totalBits) { m[y][x] = bit(codewords[i >>> 3], 7 - (i & 7)); i++; }
        }
      }
    }

    // Máscara (solo sobre los módulos de datos)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
    }
    return m;
  }

  // Penalización de la norma: la máscara con menos puntaje es la más fácil de leer
  function penalty(m) {
    const size = m.length;
    let score = 0;
    const lines = [];
    for (let y = 0; y < size; y++) lines.push(m[y]);
    for (let x = 0; x < size; x++) lines.push(m.map(row => row[x]));
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) { run++; continue; }
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
      const s = line.map(v => (v ? 1 : 0)).join('');
      for (const p of ['10111010000', '00001011101']) {
        for (let k = s.indexOf(p); k !== -1; k = s.indexOf(p, k + 1)) score += 40;
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
    const dark = m.reduce((s, row) => s + row.filter(Boolean).length, 0);
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  function encode(text) {
    const bytes = utf8(String(text));
    let version = 1;
    while (version <= 9 && dataCapacity(version) * 8 < 12 + bytes.length * 8) version++;
    if (version > 9) throw new Error('El texto es demasiado largo para el QR');
    const codewords = withEcc(dataCodewords(bytes, version), version);
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = build(codewords, version, mask);
      const p = penalty(m);
      if (p < bestScore) { best = m; bestScore = p; }
    }
    return best;
  }

  // Dibuja el QR en un canvas (blanco y negro, con el margen de 4 módulos que pide la norma)
  function toCanvas(text, { scale = 8, margin = 4 } = {}) {
    const m = encode(text);
    const px = (m.length + margin * 2) * scale;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000000';
    m.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
    }));
    return canvas;
  }

  const api = { encode, toCanvas, _internal: { rsDivisor, rsRemainder, formatBits, versionBits, dataCodewords, withEcc, BLOCKS, ALIGN } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgendasteQR = api;
})(typeof window !== 'undefined' ? window : globalThis);
