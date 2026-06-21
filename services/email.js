// ==============================
// Servicio de email — Resend
// ==============================
const { Resend } = require('resend');

let resend;
function getClient() {
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

function buildConfirmationHtml({ clientName, businessName, service, barber, date, time, address }) {
  const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const rows = [
    ['Servicio', service],
    ['Profesional', barber],
    ['Fecha', formattedDate],
    ['Hora', time],
    ['Dirección', address]
  ].filter(([, value]) => value);

  const rowsHtml = rows.map(([label, value], i) => `
    <tr>
      <td style="padding:12px 16px; ${i > 0 ? 'border-top:1px solid #E7E3DC;' : ''} font-size:13px; color:#6B6A63; text-transform:uppercase; letter-spacing:0.04em; width:40%;">${label}</td>
      <td style="padding:12px 16px; ${i > 0 ? 'border-top:1px solid #E7E3DC;' : ''} font-size:15px; color:#1A1A17; font-weight:600; text-align:right;">${value}</td>
    </tr>
  `).join('');

  return `
  <div style="background:#F8F7F4; padding:32px 16px; font-family:'Segoe UI', Arial, sans-serif;">
    <div style="max-width:480px; margin:0 auto; background:#FFFFFF; border-radius:16px; overflow:hidden; border:1px solid #E7E3DC;">

      <div style="background:#1A1A17; padding:28px 32px; text-align:center;">
        <p style="margin:0; color:#F8F7F4; font-size:20px; font-weight:700; letter-spacing:0.02em;">${businessName || 'Agendaste'}</p>
      </div>

      <div style="padding:32px;">
        <p style="margin:0 0 4px; color:#9A3412; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">Turno confirmado</p>
        <h1 style="margin:0 0 16px; color:#1A1A17; font-size:22px;">¡Hola${clientName ? ' ' + clientName : ''}!</h1>
        <p style="margin:0 0 24px; color:#1A1A17; font-size:15px; line-height:1.5;">
          Tu turno fue reservado con éxito. Estos son los detalles:
        </p>

        <table style="width:100%; border-collapse:collapse; background:#FAECE7; border-radius:12px;" cellpadding="0" cellspacing="0">
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <p style="margin:24px 0 0; color:#6B6A63; font-size:14px; line-height:1.5;">
          Si necesitás cambiar o cancelar tu turno, comunicate directamente con ${businessName || 'el negocio'}.
        </p>
      </div>

      <div style="background:#F8F7F4; padding:20px 32px; text-align:center; border-top:1px solid #E7E3DC;">
        <p style="margin:0; color:#6B6A63; font-size:12px;">Reservado vía Agendaste</p>
      </div>

    </div>
  </div>
  `;
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

module.exports = { sendConfirmationEmail };
