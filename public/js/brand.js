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
                '--brand-bg', '--bg-secondary', '--bg', '--border', '--text', '--text-muted', '--font'];

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

    if (bg) {
      const ink = text || '#1A1A17';
      set('--brand-bg', bg);
      set('--bg-secondary', `color-mix(in srgb, ${bg} 94%, ${ink})`);
      // Superficie de tarjetas: un poco más clara que el fondo
      set('--bg', isDark(bg) ? `color-mix(in srgb, ${bg} 88%, #FFFFFF)` : `color-mix(in srgb, ${bg} 35%, #FFFFFF)`);
      set('--border', `color-mix(in srgb, ${ink} 16%, ${bg})`);
    }

    if (text) {
      set('--text', text);
      set('--text-muted', `color-mix(in srgb, ${text} 62%, ${bg || '#FFFFFF'})`);
    }

    if (biz.brand_font && FONTS[biz.brand_font]) {
      loadFont(biz.brand_font);
      set('--font', `'${biz.brand_font}', var(--font-sans)`);
    }
  }

  window.AgendasteBrand = { FONTS: Object.keys(FONTS), isHex, contrastText, loadFont, applyBrand };
})();
