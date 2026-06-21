// ==============================
// Middleware de autenticación JWT
// ==============================
const jwt = require('jsonwebtoken');
const db  = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'agendaste-secret-jwt-2026';

// Generar token
function generateToken(user) {
  return jwt.sign(
    { email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Resuelve req.user / req.businessId a partir de la sesión o el JWT.
// Devuelve true si quedó autenticado (y ya respondió el error si no).
function resolveAuth(req, res) {
  // Primero verificar sesión de Google OAuth
  if (req.session && req.session.user) {
    if (!req.session.business_id) {
      res.status(401).json({ error: 'Sesión sin negocio asociado, volvé a iniciar sesión' });
      return false;
    }
    req.user       = req.session.user;
    req.businessId = req.session.business_id;
    return true;
  }

  // Después verificar JWT en header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded  = jwt.verify(token, JWT_SECRET);
      req.user       = decoded;
      req.businessId = decoded.business_id || 1;
      return true;
    } catch (err) {
      res.status(401).json({ error: 'Token inválido o expirado' });
      return false;
    }
  }

  res.status(401).json({ error: 'No autenticado' });
  return false;
}

// Verifica si el negocio puede seguir operando (trial vigente, suscripción activa,
// o todavía dentro del período ya pagado de una suscripción cancelada)
async function checkSubscription(businessId, res) {
  try {
    const result = await db.query(
      'SELECT plan, trial_ends_at, access_until FROM owners WHERE business_id = $1 LIMIT 1',
      [businessId]
    );
    const owner = result.rows[0];
    if (!owner) return true;

    const trialActive        = owner.trial_ends_at && new Date(owner.trial_ends_at) > new Date();
    const subscriptionActive = owner.plan === 'active';
    const withinAccessUntil  = owner.access_until && new Date(owner.access_until) > new Date();

    if (!trialActive && !subscriptionActive && !withinAccessUntil) {
      res.status(402).json({ error: 'Trial vencido. Suscribite para continuar.' });
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error verificando suscripción:', err.message);
    return true; // no bloquear el acceso por un error de la consulta
  }
}

// Verificar token — para rutas API. Bloquea con 402 si el trial venció y no hay suscripción activa.
async function requireAuth(req, res, next) {
  if (!resolveAuth(req, res)) return;
  if (!(await checkSubscription(req.businessId, res))) return;
  next();
}

// Igual que requireAuth pero sin el bloqueo por trial vencido.
// Necesario para que el dueño pueda consultar su estado y suscribirse aunque el trial ya haya vencido.
function requireAuthNoTrialGate(req, res, next) {
  if (!resolveAuth(req, res)) return;
  next();
}

// Verificar sesión — para rutas de páginas HTML
function requireSession(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/admin?error=not_authenticated');
}

module.exports = { generateToken, requireAuth, requireAuthNoTrialGate, requireSession };
