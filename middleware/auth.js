// ==============================
// Middleware de autenticación JWT
// ==============================
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'barberapp-secret-jwt-2026';

// Generar token
function generateToken(user) {
  return jwt.sign(
    { email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Verificar token — para rutas API
function requireAuth(req, res, next) {
  // Primero verificar sesión de Google OAuth
  if (req.session && req.session.user) {
    req.user       = req.session.user;
    req.businessId = req.session.business_id || 1;
    return next();
  }

  // Después verificar JWT en header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded  = jwt.verify(token, JWT_SECRET);
      req.user       = decoded;
      req.businessId = decoded.business_id || 1;
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
  }

  return res.status(401).json({ error: 'No autenticado' });
}

// Verificar sesión — para rutas de páginas HTML
function requireSession(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/admin?error=not_authenticated');
}

module.exports = { generateToken, requireAuth, requireSession };