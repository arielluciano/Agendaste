// ==============================
// Rutas de barberos/empleados
// ==============================
const express = require('express');
const router = express.Router();

let barbers = [
  {
    id: 1,
    name: 'Ariel',
    role: 'Dueño',
    active: true,
    schedule: {
      lunes:    { open: true, from: '09:00', to: '18:00' },
      martes:   { open: true, from: '09:00', to: '18:00' },
      miercoles:{ open: true, from: '09:00', to: '18:00' },
      jueves:   { open: true, from: '09:00', to: '18:00' },
      viernes:  { open: true, from: '09:00', to: '18:00' },
      sabado:   { open: true, from: '09:00', to: '14:00' },
    },
    serviceIds: [1, 2, 3, 4, 5] // todos los servicios
  }
];
let nextId = 2;

// GET /api/barbers → todos los barberos activos
router.get('/', (req, res) => {
  res.json(barbers.filter(b => b.active));
});

// GET /api/barbers/all → todos incluyendo inactivos (admin)
router.get('/all', (req, res) => {
  res.json(barbers);
});

// GET /api/barbers/:id → un barbero específico
router.get('/:id', (req, res) => {
  const b = barbers.find(x => x.id === parseInt(req.params.id));
  if (!b) return res.status(404).json({ error: 'Barbero no encontrado' });
  res.json(b);
});

// POST /api/barbers → agregar barbero nuevo
router.post('/', (req, res) => {
  const { name, role, serviceIds, schedule } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });

  const newBarber = {
    id: nextId++,
    name,
    role: role || 'Barbero',
    active: true,
    schedule: schedule || {
      lunes:    { open: true, from: '09:00', to: '18:00' },
      martes:   { open: true, from: '09:00', to: '18:00' },
      miercoles:{ open: true, from: '09:00', to: '18:00' },
      jueves:   { open: true, from: '09:00', to: '18:00' },
      viernes:  { open: true, from: '09:00', to: '18:00' },
      sabado:   { open: true, from: '09:00', to: '14:00' },
    },
    serviceIds: serviceIds || [1, 2, 3]
  };

  barbers.push(newBarber);
  res.status(201).json(newBarber);
});

// PATCH /api/barbers/:id → actualizar barbero
router.patch('/:id', (req, res) => {
  const b = barbers.find(x => x.id === parseInt(req.params.id));
  if (!b) return res.status(404).json({ error: 'Barbero no encontrado' });
  const { name, role, active, serviceIds, schedule } = req.body;
  if (name       !== undefined) b.name       = name;
  if (role       !== undefined) b.role       = role;
  if (active     !== undefined) b.active     = active;
  if (serviceIds !== undefined) b.serviceIds = serviceIds;
  if (schedule   !== undefined) b.schedule   = schedule;
  res.json(b);
});

// DELETE /api/barbers/:id → eliminar barbero
router.delete('/:id', (req, res) => {
  const index = barbers.findIndex(x => x.id === parseInt(req.params.id));
  if (index === -1) return res.status(404).json({ error: 'Barbero no encontrado' });
  barbers.splice(index, 1);
  res.json({ success: true });
});

module.exports = router;