// ==============================
// Servicio de email — Resend
// ==============================
const { Resend } = require('resend');

let resend;
function getClient() {
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

// Parseo manual de YYYY-MM-DD para evitar corrimientos por zona horaria
function formatDateEs(date) {
  const isoDate = date instanceof Date ? date.toISOString() : String(date);
  const [year, month, day] = isoDate.split('T')[0].split('-').map(Number);
  return `${day} de ${MESES_ES[month - 1]} de ${year}`;
}

// Los datos vienen del formulario público: escaparlos para que nadie meta HTML/links en un mail nuestro
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Marca del negocio en los mails ────────────
// Mismos criterios que la página de reservas (routes/business.js / public/js/brand.js).
const HEX_RE      = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const BRAND_FONTS = ['Inter', 'Oswald', 'Anton', 'Playfair Display', 'Montserrat', 'Cinzel'];

function hexToRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Negro o blanco, el que tenga más contraste (luminancia WCAG)
function contrastText(hex) {
  const [r, g, b] = hexToRgb(hex).map(c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000000' : '#FFFFFF';
}

// Mezcla `hex` con blanco (los clientes de mail no soportan color-mix)
function tint(hex, amount) {
  const mixed = hexToRgb(hex).map(c => Math.round(c * amount + 255 * (1 - amount)));
  return '#' + mixed.map(c => c.toString(16).padStart(2, '0')).join('');
}

const DEFAULT_THEME = {
  pageBg: '#F8F7F4', headerBg: '#1A1A17', headerText: '#F8F7F4',
  accent: '#9A3412', tableBg: '#FAECE7', text: '#1A1A17',
  font: "'Segoe UI', Arial, sans-serif", titleFont: null, logoUrl: null
};

// Sin marca configurada (o con valores inválidos) queda el diseño de Agendaste
function themeFromBusiness(biz) {
  const t = { ...DEFAULT_THEME };
  if (!biz) return t;
  if (HEX_RE.test(biz.brand_primary || '')) {
    t.headerBg   = biz.brand_primary;
    t.headerText = contrastText(biz.brand_primary);
    // El acento va sobre blanco: si el color es muy claro no se leería
    t.accent     = t.headerText === '#FFFFFF' ? biz.brand_primary : DEFAULT_THEME.text;
    t.tableBg    = tint(biz.brand_primary, 0.12);
  }
  if (HEX_RE.test(biz.brand_bg || '')) t.pageBg = biz.brand_bg;
  // La tarjeta es blanca: el color de texto propio solo si es oscuro
  if (HEX_RE.test(biz.brand_text || '') && contrastText(biz.brand_text) === '#FFFFFF') t.text = biz.brand_text;
  if (BRAND_FONTS.includes(biz.brand_font)) t.titleFont = `'${biz.brand_font}', ${DEFAULT_THEME.font}`;
  if (typeof biz.logo_url === 'string') {
    try { if (new URL(biz.logo_url).protocol === 'https:') t.logoUrl = biz.logo_url; } catch {}
  }
  return t;
}

// Layout común de los mails. Todo lo que llega acá ya tiene que venir escapado.
function buildEmailHtml({ theme = DEFAULT_THEME, title, eyebrow, businessName, clientName, intro, rows, outro }) {
  const rowsHtml = rows.map(([label, value], i) => `
    <tr>
      <td style="padding:12px 16px; ${i > 0 ? 'border-top:1px solid #E7E3DC;' : ''} font-size:13px; color:#6B6A63; text-transform:uppercase; letter-spacing:0.04em; width:40%;">${label}</td>
      <td style="padding:12px 16px; ${i > 0 ? 'border-top:1px solid #E7E3DC;' : ''} font-size:15px; color:${theme.text}; font-weight:600; text-align:right;">${value}</td>
    </tr>
  `).join('');

  const titleFont = theme.titleFont ? ` font-family:${theme.titleFont};` : '';
  const logoHtml  = theme.logoUrl
    ? `<img src="${escapeHtml(theme.logoUrl)}" alt="" height="40" style="display:block; margin:0 auto 12px; height:40px; width:auto; max-width:180px; border:0;">\n          `
    : '';

  return `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Language" content="es">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
  </head>
  <body style="margin:0; padding:0;">
    <div style="background:${theme.pageBg}; padding:32px 16px; font-family:${theme.font};">
      <div style="max-width:480px; margin:0 auto; background:#FFFFFF; border-radius:16px; overflow:hidden; border:1px solid #E7E3DC;">

        <div style="background:${theme.headerBg}; padding:28px 32px; text-align:center;">
          ${logoHtml}<p style="margin:0; color:${theme.headerText}; font-size:20px; font-weight:700; letter-spacing:0.02em;${titleFont}">${businessName || 'Agendaste'}</p>
        </div>

        <div style="padding:32px;">
          <p style="margin:0 0 4px; color:${theme.accent}; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">${eyebrow}</p>
          <h1 style="margin:0 0 16px; color:${theme.text}; font-size:22px;${titleFont}">¡Hola${clientName ? ' ' + clientName : ''}!</h1>
          <p style="margin:0 0 24px; color:${theme.text}; font-size:15px; line-height:1.5;">
            ${intro}
          </p>

          <table style="width:100%; border-collapse:collapse; background:${theme.tableBg}; border-radius:12px;" cellpadding="0" cellspacing="0">
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <p style="margin:24px 0 0; color:#6B6A63; font-size:14px; line-height:1.5;">
            ${outro}
          </p>
        </div>

        <div style="background:#F8F7F4; padding:20px 32px; text-align:center; border-top:1px solid #E7E3DC;">
          <p style="margin:0; color:#6B6A63; font-size:12px;">Reservado vía Agendaste</p>
        </div>

      </div>
    </div>
  </body>
  </html>
  `;
}

function buildConfirmationHtml(data) {
  const clientName   = data.clientName   ? escapeHtml(data.clientName)   : '';
  const businessName = data.businessName ? escapeHtml(data.businessName) : '';
  const service      = data.service      ? escapeHtml(data.service)      : '';
  const barber       = data.barber       ? escapeHtml(data.barber)       : '';
  const time         = data.time         ? escapeHtml(data.time)         : '';
  const address      = data.address      ? escapeHtml(data.address)      : '';
  const formattedDate = formatDateEs(data.date);

  const rows = [
    ['Servicio', service],
    ['Profesional', barber],
    ['Fecha', formattedDate],
    ['Hora', time],
    ['Dirección', address]
  ].filter(([, value]) => value);

  return buildEmailHtml({
    title: 'Turno confirmado',
    eyebrow: 'Turno confirmado',
    businessName,
    clientName,
    intro: 'Tu turno fue reservado con éxito. Estos son los detalles:',
    rows,
    outro: `Si necesitás cambiar o cancelar tu turno, comunicate directamente con ${businessName || 'el negocio'}.`
  });
}

async function sendConfirmationEmail({ to, clientName, businessName, service, barber, date, time, address }) {
  if (!to) return;

  try {
    await getClient().emails.send({
      from: process.env.EMAIL_FROM,
      to,
      subject: `Turno confirmado en ${businessName || 'Agendaste'}`,
      html: buildConfirmationHtml({ clientName, businessName, service, barber, date, time, address })
    });
    console.log(`📧 Email de confirmación enviado a ${to}`);
  } catch (err) {
    console.error('⚠️ Error enviando email de confirmación:', err.message);
  }
}

// ── Recordatorio ──────────────────────────────
const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// "lunes 4 de enero de 2027" (date = 'YYYY-MM-DD', sin pasar por la zona horaria del server)
function formatDayEs(date) {
  const [y, m, d] = String(date).split('T')[0].split('-').map(Number);
  return `${DIAS_ES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${formatDateEs(date)}`;
}

// business: fila de businesses (con las columnas brand_* si existen)
function buildReminderHtml({ clientName, business, service, barber, date, time }) {
  const businessName = business?.name ? escapeHtml(business.name) : '';
  const rows = [
    ['Negocio', businessName],
    ['Servicio', service ? escapeHtml(service) : ''],
    ['Profesional', barber ? escapeHtml(barber) : ''],
    ['Día', formatDayEs(date)],
    ['Hora', time ? escapeHtml(time) : ''],
    ['Dirección', business?.address ? escapeHtml(business.address) : '']
  ].filter(([, value]) => value);

  return buildEmailHtml({
    theme: themeFromBusiness(business),
    title: 'Recordatorio de turno',
    eyebrow: 'Recordatorio de turno',
    businessName,
    clientName: clientName ? escapeHtml(clientName) : '',
    intro: 'Te recordamos que tenés un turno. Estos son los detalles:',
    rows,
    outro: `Si no podés ir, avisale a ${businessName || 'el negocio'} así le das el lugar a otra persona.`
  });
}

// A diferencia de la confirmación, tira error si falla: el cron lo necesita para liberar el turno y reintentar.
// (Resend v6 no tira excepción ante errores de la API: devuelve { data, error }.)
async function sendReminderEmail({ to, clientName, business, service, barber, date, time }) {
  const { error } = await getClient().emails.send({
    from: process.env.EMAIL_FROM,
    to,
    subject: `Recordatorio: tu turno en ${business?.name || 'Agendaste'}`,
    html: buildReminderHtml({ clientName, business, service, barber, date, time })
  });
  if (error) throw new Error(error.message || 'Resend devolvió un error');
}

module.exports = { sendConfirmationEmail, sendReminderEmail };
