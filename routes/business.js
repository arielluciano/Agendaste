// ==============================
// Rutas de configuración del negocio
// ==============================
const express = require('express');
const router  = express.Router();
const db      = require('../config/database');

// GET /api/business → datos del negocio (id=1)
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM businesses WHERE id = $1', [1]);
    if (result.rows.length === 0) {
      return res.json({ id: 1, name: '', address: '', phone: '', description: '' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error GET /api/business:', err.message);
    res.status(500).json({ error: 'Error obteniendo datos del negocio' });
  }
});

// PATCH /api/business → actualizar datos del negocio
router.patch('/', async (req, res) => {
  const { name, address, phone, description } = req.body;
  try {
    const result = await db.query(
      `UPDATE businesses
         SET name = $1, address = $2, phone = $3, description = $4
       WHERE id = $5
       RETURNING *`,
      [name ?? null, address ?? null, phone ?? null, description ?? null, 1]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error PATCH /api/business:', err.message);
    res.status(500).json({ error: 'Error actualizando negocio' });
  }
});

module.exports = router;
