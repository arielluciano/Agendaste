// ==============================
// BarberApp — Servidor principal
// ==============================
require('dotenv').config();
const db = require('./config/database');
const express = require('express');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/auth');
const calendarRoutes = require('./routes/calendar');
const appointmentRoutes = require('./routes/appointments');
const serviceRoutes = require('./routes/services');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ──────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-123',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));

// ── Rutas ────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/barbers', require('./routes/barbers'));

// Ruta raíz → página del cliente
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Panel del dueño
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'admin.html'));
});

// ── Iniciar servidor ─────────────────────────
app.listen(PORT, () => {
  console.log(`✅ BarberApp corriendo en http://localhost:${PORT}`);
  console.log(`   Cliente:  http://localhost:${PORT}/`);
  console.log(`   Admin:    http://localhost:${PORT}/admin`);
});
