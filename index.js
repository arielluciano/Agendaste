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
const { requireAuth } = require('./middleware/auth');

app.use('/auth', authRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/barbers', require('./routes/barbers'));
app.use('/api/appointments', appointmentRoutes);
app.use('/api/calendar', requireAuth, calendarRoutes);
app.use('/api/business', require('./routes/business'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/otp', require('./routes/otp'));
app.use(require('./routes/register'));

// Ruta raíz → página del cliente
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Panel del dueño
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'admin.html'));
});

// Ruta dinámica por slug → página del cliente del negocio
app.get('/:slug', async (req, res) => {
  try {
    const result = await db.query('SELECT id FROM businesses WHERE slug = $1', [req.params.slug]);
    if (result.rows.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Negocio no encontrado — BarberApp</title>
          <link rel="stylesheet" href="/css/styles.css">
        </head>
        <body>
          <div style="text-align:center;padding:4rem 1rem">
            <h1>404</h1>
            <p>Negocio no encontrado</p>
            <a href="/" class="btn btn-primary">Volver al inicio</a>
          </div>
        </body>
        </html>
      `);
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (err) {
    console.error('Error verificando slug:', err.message);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ── Iniciar servidor ─────────────────────────
app.listen(PORT, () => {
  console.log(`✅ BarberApp corriendo en http://localhost:${PORT}`);
  console.log(`   Cliente:  http://localhost:${PORT}/`);
  console.log(`   Admin:    http://localhost:${PORT}/admin`);
});