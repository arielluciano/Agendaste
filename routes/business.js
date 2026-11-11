// ==============================
// Rutas de configuración del negocio
// ==============================
const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/business → datos del negocio
// Acepta ?slug=xxx (público) o usa session.business_id (admin)
router.get('/', async (req, res) => {
  try {
    let result;
    if (req.query.slug) {
      result = await db.query('SELECT * FROM businesses WHERE slug = $1', [req.query.slug]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Negocio no encontrado' });
    } else {
      const bizId = req.session?.business_id || parseInt(req.query.business_id) || 1;
      result = await db.query('SELECT * FROM businesses WHERE id = $1', [bizId]);
      if (result.rows.length === 0) return res.json({ id: bizId, name: '', address: '', phone: '', description: '', schedule: null });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error GET /api/business:', err.message);
    res.status(500).json({ error: 'Error obteniendo datos del negocio' });
  }
});

// PATCH /api/business → actualizar datos del negocio
router.patch('/', requireAuth, async (req, res) => {
  const { name, address, phone, description, schedule } = req.body;
  const bizId = req.businessId;
  try {
    const result = await db.query(
      `UPDATE businesses
         SET name = $1, address = $2, phone = $3, description = $4, schedule = $5
       WHERE id = $6
       RETURNING *`,
      [name ?? null, address ?? null, phone ?? null, description ?? null, schedule ? JSON.stringify(schedule) : null, bizId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error PATCH /api/business:', err.message);
    res.status(500).json({ error: 'Error actualizando negocio' });
  }
});

// ── Marca del negocio ─────────────────────────
const BRAND_FONTS = ['Inter', 'Oswald', 'Anton', 'Playfair Display', 'Montserrat', 'Cinzel'];
const HEX_RE      = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Normaliza un valor de marca: '' / null / undefined → null.
function emptyToNull(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return v;
  const t = v.trim();
  return t === '' ? null : t;
}

// Devuelve { values } o { error }.
function validateBrand(body) {
  const values = {
    brand_primary: emptyToNull(body.brand_primary),
    brand_bg:      emptyToNull(body.brand_bg),
    brand_text:    emptyToNull(body.brand_text),
    brand_font:    emptyToNull(body.brand_font),
    logo_url:      emptyToNull(body.logo_url)
  };

  for (const key of ['brand_primary', 'brand_bg', 'brand_text']) {
    const v = values[key];
    if (v !== null && (typeof v !== 'string' || !HEX_RE.test(v))) {
      return { error: `${key} tiene que ser un color hex (#RGB o #RRGGBB)` };
    }
  }

  if (values.brand_font !== null && !BRAND_FONTS.includes(values.brand_font)) {
    return { error: `brand_font tiene que ser una de: ${BRAND_FONTS.join(', ')}` };
  }

  if (values.logo_url !== null) {
    if (typeof values.logo_url !== 'string' || values.logo_url.length > 1000) {
      return { error: 'logo_url inválida' };
    }
    let u;
    try { u = new URL(values.logo_url); } catch { return { error: 'logo_url inválida' }; }
    if (u.protocol !== 'https:') return { error: 'logo_url tiene que empezar con https://' };
    values.logo_url = u.href;
  }

  return { values };
}

// PATCH /api/business/brand → actualizar solo la marca (no pisa el resto de los datos)
router.patch('/brand', requireAuth, async (req, res) => {
  const { values, error } = validateBrand(req.body || {});
  if (error) return res.status(400).json({ error });

  try {
    const result = await db.query(
      `UPDATE businesses
         SET brand_primary = $1, brand_bg = $2, brand_text = $3, brand_font = $4, logo_url = $5
       WHERE id = $6
       RETURNING brand_primary, brand_bg, brand_text, brand_font, logo_url`,
      [values.brand_primary, values.brand_bg, values.brand_text, values.brand_font, values.logo_url, req.businessId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error PATCH /api/business/brand:', err.message);
    res.status(500).json({ error: 'Error guardando la personalización' });
  }
});

module.exports = router;
