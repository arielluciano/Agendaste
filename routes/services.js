// ==============================
// Rutas de servicios de barbería
// (En memoria — Fase 1. En Fase 2 conectamos una DB real)
// ==============================
const express = require('express');
const router = express.Router();

let services = [
  { id: 1, name: 'Corte de pelo',  duration: 30, price: 4500, description: 'Corte clásico con tijera o máquina', active: true },
  { id: 2, name: 'Corte + barba',  duration: 45, price: 6500, description: 'Corte de pelo y arreglo de barba',   active: true },
  { id: 3, name: 'Degradé',        duration: 40, price: 5000, description: 'Degradé o fade a máquina',           active: true },
  { id: 4, name: 'Arreglo barba',  duration: 20, price: 2500, description: 'Perfilado y arreglo de barba',       active: true },
  { id: 5, name: 'Afeitado',       duration: 25, price: 3000, description: 'Afeitado clásico con navaja',        active: true },
];
let nextId = 6;

// GET /api/services → todos los servicios (activos por defecto)
router.get('/', (req, res) => {
  const { all } = req.query;
  const result = all === 'true' ? services : services.filter(s => s.active);
  res.json(result);
});

// GET /api/services/:id → un servicio por id
router.get('/:id', (req, res) => {
  const service = services.find(s => s.id === Number(req.params.id));
  if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
  res.json(service);
});

// POST /api/services → crear nuevo servicio
router.post('/', (req, res) => {
  const { name, duration, price, description } = req.body;

  if (!name || !duration || !price) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: name, duration, price' });
  }

  if (services.find(s => s.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'Ya existe un servicio con ese nombre' });
  }

  const newService = {
    id: nextId++,
    name,
    duration: Number(duration),
    price: Number(price),
    description: description || '',
    active: true,
  };

  services.push(newService);
  console.log(`✂️  Nuevo servicio: ${name} — $${price} (${duration} min)`);
  res.status(201).json(newService);
});

// PATCH /api/services/:id → actualizar campos de un servicio
router.patch('/:id', (req, res) => {
  const service = services.find(s => s.id === Number(req.params.id));
  if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });

  const { name, duration, price, description, active } = req.body;

  if (name !== undefined) {
    const duplicate = services.find(s => s.id !== service.id && s.name.toLowerCase() === name.toLowerCase());
    if (duplicate) return res.status(409).json({ error: 'Ya existe un servicio con ese nombre' });
    service.name = name;
  }
  if (duration !== undefined) service.duration = Number(duration);
  if (price     !== undefined) service.price    = Number(price);
  if (description !== undefined) service.description = description;
  if (active    !== undefined) service.active   = Boolean(active);

  res.json(service);
});

// DELETE /api/services/:id → eliminar servicio
router.delete('/:id', (req, res) => {
  const index = services.findIndex(s => s.id === Number(req.params.id));
  if (index === -1) return res.status(404).json({ error: 'Servicio no encontrado' });

  services.splice(index, 1);
  res.json({ success: true });
});

module.exports = router;
