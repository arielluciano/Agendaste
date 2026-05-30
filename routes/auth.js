// ==============================
// Rutas de autenticación Google
// ==============================
const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

// Creamos el cliente OAuth con las credenciales del .env
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Permisos que pedimos al usuario de Google
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

// GET /auth/google → redirige al login de Google
router.get('/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',   // offline = nos da refresh_token
    scope: SCOPES,
    prompt: 'consent'
  });
  res.redirect(url);
});

// GET /auth/google/callback → Google nos devuelve el código
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;

  try {
    // Intercambiamos el código por tokens reales
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Guardamos los tokens en la sesión del usuario
    req.session.tokens = tokens;

    // Obtenemos info del usuario
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    req.session.user = {
      name: data.name,
      email: data.email,
      picture: data.picture
    };

    console.log(`✅ Usuario conectado: ${data.email}`);
    res.redirect('/admin');

  } catch (error) {
    console.error('Error en OAuth callback:', error);
    res.redirect('/?error=auth_failed');
  }
});

// GET /auth/logout → cierra la sesión
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// GET /auth/me → devuelve info del usuario actual (para el frontend)
router.get('/me', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

module.exports = router;
