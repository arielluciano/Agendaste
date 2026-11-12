// ==============================
// Rutas de configuración del negocio
// ==============================
const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { validateWeekSchedule } = require('../services/validation');
const multer  = require('multer');
const sharp   = require('sharp');
const storage = require('../services/storage');
const { publicPrefix } = storage;

// GET /api/business → datos del negocio
// Acepta ?slug=xxx (público) o usa session.business_id (admin)
// Campos que puede ver cualquiera (página de reservas). Nunca owner_email ni datos internos.
const PUBLIC_BUSINESS_COLS = `id, name, slug, address, phone, description,
  brand_primary, brand_bg, brand_text, brand_font, logo_url`;

router.get('/', async (req, res) => {
  try {
    let result;
    if (req.query.slug) {
      result = await db.query(`SELECT ${PUBLIC_BUSINESS_COLS} FROM businesses WHERE slug = $1`, [req.query.slug]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Negocio no encontrado' });
    } else if (req.session?.business_id) {
      // Dueño logueado (panel / configuración): su propio negocio completo
      result = await db.query('SELECT * FROM businesses WHERE id = $1', [req.session.business_id]);
      if (result.rows.length === 0) return res.json({ id: req.session.business_id, name: '', address: '', phone: '', description: '', schedule: null });
    } else {
      const bizId = parseInt(req.query.business_id) || 1;
      result = await db.query(`SELECT ${PUBLIC_BUSINESS_COLS} FROM businesses WHERE id = $1`, [bizId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Negocio no encontrado' });
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

  // Anticipación mínima para cancelar/reprogramar (horas, 0 = sin límite). Si no viene, no se toca.
  let cancelMinHours = null;
  if (req.body.cancel_min_hours !== undefined && req.body.cancel_min_hours !== null && req.body.cancel_min_hours !== '') {
    cancelMinHours = Number(req.body.cancel_min_hours);
    if (!Number.isInteger(cancelMinHours) || cancelMinHours < 0 || cancelMinHours > 720) {
      return res.status(400).json({ error: 'Las horas para cancelar tienen que ser un número entero entre 0 y 720' });
    }
  }
  // Horario base del negocio: mismas reglas que los horarios de los barberos
  if (schedule) {
    const schedError = validateWeekSchedule(schedule);
    if (schedError) return res.status(400).json({ error: schedError });
  }

  try {
    const result = await db.query(
      `UPDATE businesses
         SET name = $1, address = $2, phone = $3, description = $4, schedule = $5,
             cancel_min_hours = COALESCE($7, cancel_min_hours)
       WHERE id = $6
       RETURNING *`,
      [name ?? null, address ?? null, phone ?? null, description ?? null, schedule ? JSON.stringify(schedule) : null, bizId, cancelMinHours]
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
function validateBrand(body, businessId) {
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

  if (values.logo_url !== null && !isOwnLogoUrl(values.logo_url, businessId)) {
    return { error: 'El logo tiene que subirse desde Personalización' };
  }

  return { values };
}

// Solo URLs públicas de nuestro bucket, en la carpeta de ESTE negocio:
// {SUPABASE_URL}/storage/v1/object/public/logos/{business_id}/logo-{timestamp}.webp
function isOwnLogoUrl(value, businessId) {
  if (typeof value !== 'string' || value.length > 1000) return false;
  let u;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== 'https:' || u.search || u.hash) return false;
  const prefix = publicPrefix(businessId);
  return u.href.startsWith(prefix) && /^logo-\d+\.webp$/.test(u.href.slice(prefix.length));
}

// PATCH /api/business/brand → actualizar solo la marca (no pisa el resto de los datos).
// logo_url solo se toca si viene en el body; lo normal es manejarlo con /logo.
router.patch('/brand', requireAuth, async (req, res) => {
  const body = req.body || {};
  const { values, error } = validateBrand(body, req.businessId);
  if (error) return res.status(400).json({ error });

  const params = [values.brand_primary, values.brand_bg, values.brand_text, values.brand_font, req.businessId];
  let setLogo = '';
  if (Object.prototype.hasOwnProperty.call(body, 'logo_url')) {
    params.push(values.logo_url);
    setLogo = `, logo_url = $${params.length}`;
  }

  try {
    const result = await db.query(
      `UPDATE businesses
         SET brand_primary = $1, brand_bg = $2, brand_text = $3, brand_font = $4${setLogo}
       WHERE id = $5
       RETURNING brand_primary, brand_bg, brand_text, brand_font, logo_url`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error PATCH /api/business/brand:', err.message);
    res.status(500).json({ error: 'Error guardando la personalización' });
  }
});

// ── Logo del negocio (Supabase Storage) ───────
const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_MAX_SIDE  = 512;
const LOGO_TYPE_ERROR = 'Formato no permitido. Subí un PNG, JPG o WebP.';

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_MAX_BYTES, files: 1 }
}).single('logo');

// Tipo real según los primeros bytes del archivo (no el mimetype que manda el navegador)
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG' &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'png';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null; // SVG, GIF, HEIC, PDF, etc.
}

function storageNotConfigured(res) {
  return res.status(503).json({ error: 'La subida de logos no está configurada en el servidor' });
}

// POST /api/business/logo → sube, procesa y reemplaza el logo (campo de form "logo")
router.post('/logo', requireAuth, (req, res) => {
  if (!storage.isConfigured()) return storageNotConfigured(res);

  logoUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'El archivo pesa más de 5 MB. Probá con una imagen más liviana.' });
      return res.status(400).json({ error: 'No se pudo leer el archivo' });
    }
    if (!req.file) return res.status(400).json({ error: 'No llegó ningún archivo' });

    const type = sniffImageType(req.file.buffer);
    if (!type) return res.status(415).json({ error: LOGO_TYPE_ERROR });

    let webp;
    try {
      const img = sharp(req.file.buffer, { limitInputPixels: 40_000_000, failOn: 'error' });
      const meta = await img.metadata();
      if (meta.format !== type) return res.status(415).json({ error: LOGO_TYPE_ERROR });
      webp = await img
        .rotate() // respeta la orientación EXIF de las fotos del celular
        .resize({ width: LOGO_MAX_SIDE, height: LOGO_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90, alphaQuality: 100 }) // WebP conserva el canal alfa
        .toBuffer();
    } catch (err) {
      console.error('Error procesando logo:', err.message);
      return res.status(422).json({ error: 'No pudimos procesar la imagen. Probá con otro archivo.' });
    }

    try {
      const { path, publicUrl } = await storage.uploadBusinessLogo(req.businessId, webp);
      const result = await db.query(
        'UPDATE businesses SET logo_url = $1 WHERE id = $2 RETURNING logo_url',
        [publicUrl, req.businessId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Negocio no encontrado' });

      // Borrar el logo anterior (y cualquier resto) de este negocio. Si falla, el nuevo ya quedó guardado.
      storage.removeBusinessLogos(req.businessId, path)
        .catch(err => console.error(`⚠️ No se pudo borrar el logo anterior del negocio ${req.businessId}:`, err.message));

      res.json({ logo_url: result.rows[0].logo_url });
    } catch (err) {
      console.error('Error POST /api/business/logo:', err.message);
      res.status(500).json({ error: 'Error guardando el logo' });
    }
  });
});

// DELETE /api/business/logo → borra el archivo y deja logo_url en null
router.delete('/logo', requireAuth, async (req, res) => {
  if (!storage.isConfigured()) return storageNotConfigured(res);
  try {
    await storage.removeBusinessLogos(req.businessId);
    await db.query('UPDATE businesses SET logo_url = NULL WHERE id = $1', [req.businessId]);
    res.json({ logo_url: null });
  } catch (err) {
    console.error('Error DELETE /api/business/logo:', err.message);
    res.status(500).json({ error: 'Error quitando el logo' });
  }
});

module.exports = router;
