// ==============================
// Rutas de Google Calendar
// ==============================
const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

// Middleware: verificar que el usuario esté logueado
function requireAuth(req, res, next) {
  if (!req.session.tokens) {
    return res.status(401).json({ error: 'No autenticado. Iniciá sesión con Google.' });
  }
  next();
}

// Helper: crear cliente OAuth con los tokens guardados en sesión
function getAuthClient(tokens) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI
  );
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

// POST /api/calendar/add → agrega un turno al Google Calendar del dueño
router.post('/add', requireAuth, async (req, res) => {
  const { clientName, service, date, time, duration = 30, price } = req.body;

  try {
    const auth = getAuthClient(req.session.tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    // Armamos la fecha/hora de inicio y fin
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const startDate = new Date(year, month - 1, day, hour, minute);
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

    const event = {
      summary: `✂️ ${service} — ${clientName}`,
      description: `Servicio: ${service}\nCliente: ${clientName}\nPrecio: $${price}\n\nReservado via BarberApp`,
      start: {
        dateTime: startDate.toISOString(),
        timeZone: 'America/Argentina/Buenos_Aires'
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: 'America/Argentina/Buenos_Aires'
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 30 }
        ]
      }
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event
    });

    console.log(`📅 Evento creado: ${response.data.htmlLink}`);
    res.json({
      success: true,
      eventId: response.data.id,
      eventLink: response.data.htmlLink
    });

  } catch (error) {
    console.error('Error creando evento:', error.message);
    res.status(500).json({ error: 'No se pudo crear el evento en Google Calendar' });
  }
});

// GET /api/calendar/events → lista los próximos turnos del calendario
router.get('/events', requireAuth, async (req, res) => {
  try {
    const auth = getAuthClient(req.session.tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 20,
      singleEvents: true,
      orderBy: 'startTime',
      q: 'BarberApp' // solo eventos creados por nuestra app
    });

    res.json({ events: response.data.items });

  } catch (error) {
    console.error('Error listando eventos:', error.message);
    res.status(500).json({ error: 'No se pudieron obtener los eventos' });
  }
});

module.exports = router;
