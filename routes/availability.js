// ==============================
// Disponibilidad pública para la página de reservas
// ==============================
const express = require('express');
const router  = express.Router();
const { getAvailability, todayAR } = require('../services/availability');

const MAX_DAYS = 14;

// GET /api/availability?business_id=&barber_id=&service_id=&from=YYYY-MM-DD&days=6
// → { today, days: [{ date, slots: [{ time, available }] }] }: los próximos N días en que el barbero atiende.
router.get('/', async (req, res) => {
  const businessId = parseInt(req.query.business_id);
  const barberId   = parseInt(req.query.barber_id);
  const serviceId  = parseInt(req.query.service_id);
  if (!businessId) return res.status(400).json({ error: 'Falta business_id' });
  if (!barberId)   return res.status(400).json({ error: 'Falta barber_id' });
  if (!serviceId)  return res.status(400).json({ error: 'Falta service_id' });

  const today = todayAR();
  let from = req.query.from || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || isNaN(new Date(from + 'T12:00:00Z').getTime())) {
    return res.status(400).json({ error: 'from tiene que ser YYYY-MM-DD' });
  }
  if (from < today) from = today;
  const days = Math.min(Math.max(parseInt(req.query.days) || 6, 1), MAX_DAYS);

  try {
    const r = await getAvailability(barberId, businessId, serviceId, from, days);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Error GET /api/availability:', err.message);
    res.status(500).json({ error: 'Error obteniendo disponibilidad' });
  }
});

module.exports = router;
