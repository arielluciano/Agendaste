// ==============================
// Rutas de turnos
// (En memoria — Fase 1. En Fase 2 conectamos una DB real)
// ==============================
const express = require('express');
const router = express.Router();

// Base de datos temporal en memoria
// ⚠️ Se borra al reiniciar el servidor — solo para desarrollo
let appointments = [
  { id: 1, clientName: 'Carlos Méndez', service: 'Corte + barba', date: '2026-05-06', time: '10:00', price: 6500, status: 'confirmed' },
  { id: 2, clientName: 'Lucas Pérez',   service: 'Degradé',        date: '2026-05-06', time: '11:00', price: 5000, status: 'confirmed' },
  { id: 3, clientName: 'Tomás Ruiz',    service: 'Corte de pelo',  date: '2026-05-06', time: '14:00', price: 4500, status: 'pending'   },
];
let nextId = 4;

// GET /api/appointments → todos los turnos
router.get('/', (req, res) => {
  const { date } = req.query;
  if (date) {
    return res.json(appointments.filter(a => a.date === date));
  }
  res.json(appointments);
});

// POST /api/appointments → crear nuevo turno
router.post('/', (req, res) => {
  const { clientName, clientPhone, service, date, time, price } = req.body;

  // Validación básica
  if (!clientName || !service || !date || !time) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  // Verificar que el horario no esté ocupado
  const conflict = appointments.find(a => a.date === date && a.time === time);
  if (conflict) {
    return res.status(409).json({ error: 'Ese horario ya está ocupado' });
  }

  const newAppointment = {
    id: nextId++,
    clientName,
    clientPhone,
    service,
    date,
    time,
    price: Number(price),
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  appointments.push(newAppointment);
  console.log(`📋 Nuevo turno: ${clientName} — ${service} el ${date} a las ${time}`);
  res.status(201).json(newAppointment);
});

// PATCH /api/appointments/:id/status → confirmar o cancelar
router.patch('/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const appt = appointments.find(a => a.id === Number(id));
  if (!appt) return res.status(404).json({ error: 'Turno no encontrado' });

  appt.status = status;
  res.json(appt);
});

// DELETE /api/appointments/:id → borrar turno
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const index = appointments.findIndex(a => a.id === Number(id));
  if (index === -1) return res.status(404).json({ error: 'Turno no encontrado' });

  appointments.splice(index, 1);
  res.json({ success: true });
});

// GET /api/appointments/slots/:date → horarios disponibles para una fecha
router.get('/slots/:date', (req, res) => {
  const { date } = req.params;
  const allSlots = ['9:00','9:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30'];
  const taken = appointments.filter(a => a.date === date).map(a => a.time);
  const available = allSlots.map(s => ({ time: s, available: !taken.includes(s) }));
  res.json(available);
});

module.exports = router;
