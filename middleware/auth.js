// ==============================
// Middleware de autenticación JWT
// ==============================
const jwt = require('jsonwebtoken');
const { getAccess } = require('../services/access');

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET no está configurada. Definila como variable de entorno antes de arrancar el server.');
}
const JWT_SECRET = process.env.JWT_SECRET;

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
      if (!decoded.business_id) {
        res.status(401).json({ error: 'Token inválido: sin business_id' });
        return false;
      }
      req.user       = decoded;
      req.businessId = decoded.business_id;
      return true;
    } catch (err) {
      res.status(401).json({ error: 'Token inválido o expirado' });
      return false;
    }
  }

  res.status(401).json({ error: 'No autenticado' });
  return false;
}

// Verifica si el negocio puede seguir operando (cortesía vigente, trial vigente, suscripción activa,
// o todavía dentro del período ya pagado de una suscripción cancelada) — ver services/access.js
async function checkSubscription(businessId, res) {
  try {
    const access = await getAccess(businessId);
    if (!access) return true;

    if (!access.hasAccess) {
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
  res.redirect('/panel?error=not_authenticated');
}

module.exports = { generateToken, requireAuth, requireAuthNoTrialGate, requireSession };
