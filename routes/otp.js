// ==============================
// Rutas de OTP — Login clientes
// ==============================
const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const db = require('../config/database');

// Configurar Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// Guardar OTPs en memoria (en Fase 3 va a DB)
const otpStore = {};

// Generar código de 6 dígitos
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/otp/send → enviar código al email del cliente
router.post('/send', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email es obligatorio' });

  const code = generateOTP();
  const expires = Date.now() + 10 * 60 * 1000; // 10 minutos

  otpStore[email] = { code, expires };

  try {
    await transporter.sendMail({
      from: `"Agendaste" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: '🔑 Tu código de verificación — Agendaste',
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:2rem;border:1px solid #eee;border-radius:12px">
          <h2 style="color:#9A3412">✂️ Agendaste</h2>
          <p>Tu código de verificación es:</p>
          <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#9A3412;padding:1rem;background:#FAECE7;border-radius:8px;text-align:center">
            ${code}
          </div>
          <p style="color:#666;font-size:13px;margin-top:1rem">Este código expira en 10 minutos.</p>
          <p style="color:#666;font-size:13px">Si no solicitaste este código, ignorá este email.</p>
        </div>
      `
    });

    console.log(`📧 OTP enviado a ${email}: ${code}`);
    res.json({ success: true, message: 'Código enviado' });

  } catch (err) {
    console.error('Error enviando email:', err.message);
    res.status(500).json({ error: 'Error enviando el código' });
  }
});

// POST /api/otp/verify → verificar código
router.post('/verify', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email y código son obligatorios' });

  const stored = otpStore[email];

  if (!stored) return res.status(400).json({ error: 'No hay código para este email' });
  if (Date.now() > stored.expires) {
    delete otpStore[email];
    return res.status(400).json({ error: 'El código expiró' });
  }
  if (stored.code !== code) {
    stored.attempts = (stored.attempts || 0) + 1;
    if (stored.attempts >= 5) {
      delete otpStore[email];
      return res.status(429).json({ error: 'Demasiados intentos fallidos. Pedí un código nuevo.' });
    }
    return res.status(400).json({ error: 'Código incorrecto' });
  }

  // Código válido — guardar sesión del cliente
  delete otpStore[email];
  req.session.client = { email };

  res.json({ success: true, email });
});

// GET /api/otp/me → verificar si el cliente está logueado
router.get('/me', (req, res) => {
  if (req.session.client) {
    res.json({ loggedIn: true, email: req.session.client.email });
  } else {
    res.json({ loggedIn: false });
  }
});

// POST /api/otp/logout → cerrar sesión del cliente
router.post('/logout', (req, res) => {
  delete req.session.client;
  res.json({ success: true });
});

module.exports = router;