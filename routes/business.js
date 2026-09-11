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

module.exports = router;
