// ==============================
// Rutas de registro de negocios
// ==============================
const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const path    = require('path');

// GET /registro → página de registro
router.get('/registro', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'register.html'));
});

// POST /api/register → crear negocio + dueño
router.post('/api/register', async (req, res) => {
  const { ownerName, email, businessName, address, phone } = req.body;
  if (!ownerName || !email || !businessName) {
    return res.status(400).json({ error: 'Nombre, email y nombre del negocio son obligatorios' });
  }

  const baseSlug = businessName
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');

  try {
    const existingOwner = await db.query('SELECT id FROM owners WHERE email = $1', [email]);
    if (existingOwner.rows.length > 0) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
    }

    const slugCheck = await db.query('SELECT id FROM businesses WHERE slug = $1', [baseSlug]);
    const slug = slugCheck.rows.length > 0 ? `${baseSlug}-${Date.now()}` : baseSlug;

    const bizResult = await db.query(
      'INSERT INTO businesses (name, address, phone, slug, owner_email) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [businessName, address || null, phone || null, slug, email]
    );
    const business = bizResult.rows[0];

    await db.query(
      `INSERT INTO owners (business_id, name, email, plan, trial_ends_at, terms_accepted_at)
       VALUES ($1, $2, $3, 'trial', NOW() + INTERVAL '14 days', NOW())`,
      [business.id, ownerName, email]
    );

    // Activar sesión si el dueño llegó desde el flujo de Google OAuth
    if (req.session.pendingUser) {
      req.session.user        = req.session.pendingUser;
      req.session.business_id = business.id;
      delete req.session.pendingUser;
    }

    console.log(`✅ Nuevo negocio: ${businessName} — /${slug}`);
    res.status(201).json({ success: true, slug });
  } catch (err) {
    console.error('Error en registro:', err.message);
    res.status(500).json({ error: 'Error creando el negocio' });
  }
});

module.exports = router;
