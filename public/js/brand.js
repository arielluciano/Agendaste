// ==============================
// Agendaste — Marca por negocio
// Compartido entre la página de reservas (client.html) y la preview de settings.
// ==============================
(function () {
  // Lista blanca de fuentes → parámetro "family" de Google Fonts.
  // Mantener sincronizada con BRAND_FONTS en routes/business.js.
  const FONTS = {
    'Inter':            'Inter:wght@400;500;600',
    'Oswald':           'Oswald:wght@400;600',
    'Anton':            'Anton',
    'Playfair Display': 'Playfair+Display:wght@400;700',
    'Montserrat':       'Montserrat:wght@400;600',
    'Cinzel':           'Cinzel:wght@400;700'
  };

  const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  // Variables que applyBrand puede setear (para poder limpiarlas en la preview)
  const VARS = ['--brand', '--brand-contrast', '--brand-hover', '--primary', '--primary-dark', '--primary-light',
                '--brand-bg', '--bg-secondary', '--bg', '--border', '--text', '--text-muted', '--font',
                '--surface', '--muted', '--accent-text'];

  function isHex(v) { return typeof v === 'string' && HEX_RE.test(v); }

  function hexToRgb(hex) {
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Luminancia relativa (WCAG 2.x)
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(c => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Negro o blanco, el que tenga más contraste contra el color dado
  function contrastText(hex) {
    const L = luminance(hex);
    const vsWhite = 1.05 / (L + 0.05);
    const vsBlack = (L + 0.05) / 0.05;
    return vsBlack >= vsWhite ? '#000000' : '#FFFFFF';
  }

  function isDark(hex) { return contrastText(hex) === '#FFFFFF'; }

  // Relación de contraste WCAG entre dos colores (1 a 21)
  function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // Mezcla en sRGB, igual que color-mix(in srgb, a p%, b): p = peso de `a` (0 a 1)
  function mix(a, b, p) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return '#' + A.map((c, i) => Math.round(c * p + B[i] * (1 - p)).toString(16).padStart(2, '0')).join('');
  }

  // El color de acento, oscurecido/aclarado lo justo para leerse (4.5:1) sobre `surface`
  function readableOn(color, surface) {
    const target = isDark(surface) ? '#FFFFFF' : '#000000';
    for (let p = 1; p > 0; p -= 0.05) {
      const c = mix(color, target, p);
      if (contrastRatio(c, surface) >= 4.5) return c;
    }
    return target;
  }

  // Carga la fuente de Google Fonts solo si está en la lista blanca
  function loadFont(name) {
    const family = FONTS[name];
    if (!family) return;
    const id = 'brand-font-' + family.split(':')[0];
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
    document.head.appendChild(link);
  }

  // Aplica la marca como variables CSS sobre `el` (document.documentElement o un contenedor).
  // Solo pisa lo que el negocio configuró: con todo NULL queda el diseño de Agendaste intacto.
  function applyBrand(el, biz) {
    VARS.forEach(v => el.style.removeProperty(v));
    biz = biz || {};
    const set = (k, v) => el.style.setProperty(k, v);

    const primary = isHex(biz.brand_primary) ? biz.brand_primary : null;
    const bg      = isHex(biz.brand_bg)      ? biz.brand_bg      : null;
    let   text    = isHex(biz.brand_text)    ? biz.brand_text    : null;

    // Si eligieron un fondo oscuro sin color de texto, el texto por defecto no se leería
    if (!text && bg && isDark(bg)) text = '#FFFFFF';

    if (primary) {
      set('--brand', primary);
      set('--brand-contrast', contrastText(primary));
      set('--brand-hover', `color-mix(in srgb, ${primary} 85%, #000)`);
      set('--primary', primary);
      set('--primary-dark', `color-mix(in srgb, ${primary} 80%, #000)`);
      set('--primary-light', `color-mix(in srgb, ${primary} 12%, ${bg || '#FFFFFF'})`);
    }

    // Fondo y superficie de referencia (sin marca: crema y blanco de Agendaste)
    const pageBg  = bg || '#F8F7F4';
    const surface = bg ? (isDark(bg) ? mix(bg, '#FFFFFF', 0.95) : mix(bg, '#000000', 0.95)) : '#FFFFFF';

    if (bg) {
      const ink = text || '#1A1A17';
      set('--brand-bg', bg);
      set('--bg-secondary', `color-mix(in srgb, ${bg} 94%, ${ink})`);
      // Superficie de tarjetas: un poco más clara que el fondo
      set('--bg', isDark(bg) ? `color-mix(in srgb, ${bg} 88%, #FFFFFF)` : `color-mix(in srgb, ${bg} 35%, #FFFFFF)`);
      set('--border', `color-mix(in srgb, ${ink} 16%, ${bg})`);
      // Superficie de la tarjeta de reserva: 5% más clara (fondo oscuro) o más oscura (fondo claro)
      set('--surface', surface);
    }

    if (primary) set('--border', mix(primary, pageBg, 0.35));
    // Texto de acento sobre --surface: siempre 4.5:1 (con el naranja de Agendaste si no hay primario)
    if (primary || bg) set('--accent-text', readableOn(primary || '#9A3412', surface));

    if (text) {
      set('--text', text);
      set('--text-muted', `color-mix(in srgb, ${text} 62%, ${bg || '#FFFFFF'})`);
      set('--muted', mix(text, pageBg, 0.65));
    }

    if (biz.brand_font && FONTS[biz.brand_font]) {
      loadFont(biz.brand_font);
      set('--font', `'${biz.brand_font}', var(--font-sans)`);
    }
  }

  window.AgendasteBrand = { FONTS: Object.keys(FONTS), isHex, contrastText, contrastRatio, loadFont, applyBrand };
})();
