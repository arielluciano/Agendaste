// ==============================
// Agendaste — Servidor principal
// ==============================
require('dotenv').config();

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET no está configurada. Definila como variable de entorno antes de arrancar el server.');
}

const db = require('./config/database');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const appointmentRoutes = require('./routes/appointments');
const serviceRoutes = require('./routes/services');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ──────────────────────────────
app.set('trust proxy', 1);

// Anti-clickjacking: nada de la app se puede embeber, salvo la página pública
// de reservas con ?embed=1 (ver allowEmbed en la ruta /:slug).
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Health check para el hosting/monitoreo: no consulta la base, no usa sesión
// y queda fuera del rate limit (que solo aplica a /api) y del sitemap ("health" es slug reservado)
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// index: false → "/" lo sirve la ruta de la landing (inyecta SALES_WHATSAPP)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

// ── Rutas ────────────────────────────────────
const { requireAuth } = require('./middleware/auth');

app.use('/api', generalLimiter);
app.use('/api/otp', otpLimiter);

app.use('/auth', authRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/barbers', require('./routes/barbers'));
app.use('/api/appointments', appointmentRoutes);
app.use('/api/availability', require('./routes/availability'));
app.use('/api/business', require('./routes/business'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/otp', require('./routes/otp'));
app.use('/api/cron', require('./routes/cron'));
app.use(require('./routes/register'));

// Ruta raíz → landing de Agendaste, con el WhatsApp de ventas (SALES_WHATSAPP) en un <meta>.
// Si la variable no está, el meta queda vacío y la landing oculta los botones de WhatsApp.
const fs = require('fs');
const seo = require('./services/seo');
const { loadPlanContext, getPlanFeatures } = require('./services/access');
const { isReservedSlug } = require('./config/reserved-slugs');
const escapeAttr = (v) => String(v).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));
const landingHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
  .replace('<meta name="sales-whatsapp" content="">',
    `<meta name="sales-whatsapp" content="${escapeAttr(process.env.SALES_WHATSAPP || '')}">`);
app.get('/', (req, res) => {
  res.type('html').send(landingHtml);
});

// Centro de ayuda
app.get('/ayuda', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ayuda.html'));
});

// Panel del dueño
app.get('/panel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'admin.html'));
});

// La configuración ahora es una sección más del panel: la URL vieja lleva a "Mi negocio"
app.get('/panel/settings', (req, res) => {
  res.redirect(301, '/panel#negocio');
});

// /admin → /panel (301, con subruta y query). Temporal: /admin queda para un superadmin más adelante.
app.get(['/admin', '/admin/*'], (req, res) => {
  res.redirect(301, req.originalUrl.replace(/^\/admin/, '/panel'));
});

// ── SEO ──
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(seo.robotsTxt());
});

// Home + /{slug} de cada negocio activo (prueba vigente, suscripción o cortesía)
app.get('/sitemap.xml', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.slug, b.created_at AS lastmod
         FROM businesses b
        WHERE b.slug IS NOT NULL AND b.slug <> '' AND ${seo.ACTIVE_BUSINESS_SQL('b')}
        ORDER BY b.id`
    );
    const businesses = result.rows.filter((b) => !isReservedSlug(b.slug));
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(seo.sitemapXml(businesses));
  } catch (err) {
    console.error('Error generando sitemap:', err.message);
    res.status(500).type('text/plain').send('Error generando el sitemap');
  }
});

// "Mis turnos" del cliente (login con Google del lado del cliente)
app.get('/mis-turnos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mis-turnos.html'));
});

// Páginas legales
app.get('/privacidad', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacidad.html'));
});

app.get('/terminos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terminos.html'));
});

// Página de reservas en modo embed: se puede meter en un iframe desde cualquier sitio
function allowEmbed(req, res) {
  if (req.query.embed !== '1') return;
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', 'frame-ancestors *');
}

// Página de reservas: el <title> genérico de client.html se reemplaza por el <head> SEO de cada negocio
const CLIENT_TITLE = '<title>Agendaste — Reservá tu turno</title>';
const clientHtml = fs.readFileSync(path.join(__dirname, 'public', 'client.html'), 'utf8');
if (!clientHtml.includes(CLIENT_TITLE)) {
  throw new Error('client.html: no se encontró el <title> que reemplaza el SEO de /:slug');
}
// Favicon de Agendaste en client.html: se cambia por el logo del negocio cuando tiene uno
const CLIENT_ICONS = /<link rel="icon" href="\/favicon\.ico"[^>]*>\s*<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/;
if (!CLIENT_ICONS.test(clientHtml)) {
  throw new Error('client.html: no se encontraron los <link rel="icon"> que reemplaza el logo del negocio');
}
// Funciones por plan (services/access.js): sin "embed" el ?embed=1 muestra la página normal;
// con "remove_agendaste_footer" no va el "Reservas con Agendaste"
const CLIENT_EMBED_FLAG = "if (new URLSearchParams(location.search).get('embed') === '1') document.documentElement.classList.add('embed');";
const CLIENT_CREDIT = /\s*<p class="embed-credit">[\s\S]*?<\/p>/;
if (!clientHtml.includes(CLIENT_EMBED_FLAG) || !CLIENT_CREDIT.test(clientHtml)) {
  throw new Error('client.html: no se encontró el script de embed o el "Reservas con Agendaste" que se ajustan por plan');
}

// Ruta dinámica por slug → página del cliente del negocio
app.get('/:slug', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.id, b.name, b.slug, b.address, b.phone, b.logo_url, ${seo.ACTIVE_BUSINESS_SQL('b')} AS active
         FROM businesses b WHERE b.slug = $1`,
      [req.params.slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="robots" content="noindex">
          <title>Negocio no encontrado — Agendaste</title>
          <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
          <link rel="icon" type="image/svg+xml" href="/favicon.svg">
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
    const business = result.rows[0];
    const services = await db.query(
      'SELECT name FROM services WHERE business_id = $1 AND active IS NOT FALSE ORDER BY id',
      [business.id]
    );
    const head = seo.bookingHead({ business, services: services.rows, active: business.active });
    allowEmbed(req, res);
    const icons = seo.bookingIcons(business);
    let html = clientHtml.replace(CLIENT_TITLE, () => head);
    if (icons) html = html.replace(CLIENT_ICONS, () => icons);
    try {
      const features = getPlanFeatures(await loadPlanContext(business.id));
      if (!features.embed) html = html.replace(CLIENT_EMBED_FLAG, '');
      if (features.remove_agendaste_footer) html = html.replace(CLIENT_CREDIT, '');
    } catch (err) {
      console.error('Plan del negocio en /:slug:', err.message); // se sirve como siempre
    }
    res.type('html').send(html);
  } catch (err) {
    console.error('Error verificando slug:', err.message);
    allowEmbed(req, res);
    res.sendFile(path.join(__dirname, 'public', 'client.html'));
  }
});

// ── Iniciar servidor ─────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Agendaste corriendo en http://localhost:${PORT}`);
  console.log(`   Cliente:  http://localhost:${PORT}/`);
  console.log(`   Panel:    http://localhost:${PORT}/panel`);
});