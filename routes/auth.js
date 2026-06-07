// ==============================
// Rutas de autenticación Google
// ==============================
const express = require('express');
const router = require('express').Router();
const { google } = require('googleapis');
const db = require('../config/database');

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

    // Verificar si el email está registrado como dueño
    const ownerResult = await db.query('SELECT * FROM owners WHERE email = $1', [data.email]);
    if (ownerResult.rows.length === 0) {
      req.session.pendingUser = { name: data.name, email: data.email, picture: data.picture };
      return res.redirect(`/registro?email=${encodeURIComponent(data.email)}`);
    }

    req.session.user        = { name: data.name, email: data.email, picture: data.picture };
    req.session.business_id = ownerResult.rows[0].business_id;

    req.session.save((err) => {
      if (err) console.error('Error guardando sesión:', err);
      console.log(`✅ Usuario conectado: ${data.email} → negocio ${req.session.business_id}`);
      res.redirect('/admin');
    });

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

// ── OAuth para clientes (solo perfil, sin Calendar) ──────────
const clientOAuth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI_CLIENT
);

const CLIENT_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

// GET /auth/client/google → redirige al login de Google (cliente)
router.get('/client/google', (req, res) => {
  if (req.query.next) req.session.clientNext = req.query.next;
  const url = clientOAuth2.generateAuthUrl({
    access_type: 'online',
    scope: CLIENT_SCOPES
  });
  res.redirect(url);
});

// GET /auth/client/callback → Google devuelve el código
router.get('/client/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await clientOAuth2.getToken(code);
    clientOAuth2.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: clientOAuth2 });
    const { data } = await oauth2.userinfo.get();

    req.session.client = {
      name:    data.name,
      email:   data.email,
      picture: data.picture
    };

    const returnTo = req.session.clientNext || '/';
    delete req.session.clientNext;

    console.log(`✅ Cliente conectado: ${data.email} → volviendo a ${returnTo}`);
    req.session.save(() => res.redirect(returnTo));
  } catch (err) {
    console.error('Error en client OAuth callback:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

// GET /auth/client/me → estado de sesión del cliente
router.get('/client/me', (req, res) => {
  if (req.session.client) {
    res.json({ loggedIn: true, client: req.session.client });
  } else {
    res.json({ loggedIn: false });
  }
});

// GET /auth/client/logout → cierra sesión del cliente
router.get('/client/logout', (req, res) => {
  req.session.client = null;
  res.redirect('/');
});

module.exports = router;
