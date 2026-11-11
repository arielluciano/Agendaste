// ==============================
// Agendaste — Mis turnos del cliente
// ==============================

const MESES_CORTOS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const DIAS_CORTOS  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const PAST_PAGE    = 5;

let upcomingAppts  = [];   // futuros vigentes
let cancelledAppts = [];   // futuros cancelados
let pastAppts      = [];
let pastShown     = PAST_PAGE;

const ICONS = {
  calendarX: '<svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m14 14-4 4"/><path d="m10 14 4 4"/></svg>',
  calendarPlus: '<svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M12 14v4"/><path d="M10 16h4"/></svg>',
  calendarSync: '<svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 10v4h4"/><path d="m11 14 1.535-1.605a5 5 0 0 1 8 1.5"/><path d="M16 2v4"/><path d="m21 18-1.535 1.605a5 5 0 0 1-8-1.5"/><path d="M21 22v-4h-4"/><path d="M21 8.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4.3"/><path d="M3 10h4"/><path d="M8 2v4"/></svg>',
  mapPin: '<svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
  clock4: '<svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  whatsapp: '<svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
  rotate: '<svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'
};

// ── Utilidades ────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function capitalize(s) { s = String(s || '').trim(); return s ? s[0].toLocaleUpperCase('es') + s.slice(1) : s; }
function hhmm(t) { return t ? String(t).substring(0, 5) : ''; }
function dateOnly(d) { return String(d).split('T')[0]; }

// "Lun 22 jun"
function shortDate(dateStr) {
  const [y, m, d] = dateOnly(dateStr).split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return `${DIAS_CORTOS[dow]} ${d} ${MESES_CORTOS[m - 1]}`;
}

// Inicio del turno como instante real (Argentina es UTC-3 todo el año)
function apptStart(a) { return new Date(`${dateOnly(a.date)}T${hhmm(a.time)}:00-03:00`); }

function statusOf(a, isUpcoming) {
  if (a.status === 'cancelled') return { key: 'cancelled', label: 'Cancelado' };
  return isUpcoming ? { key: 'confirmed', label: 'Confirmado' } : { key: 'done', label: 'Realizado' };
}

// ── Inicialización ────────────────────────────
async function init() {
  try {
    const res = await fetch('/auth/client/me');
    const data = await res.json();
    if (data.loggedIn) {
      document.getElementById('btn-logout-client').style.display = '';
      document.getElementById('nav-user').textContent = data.client?.name || data.client?.email || '';
      showTurnos();
      loadAppointments();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('view-login').style.display = '';
  document.getElementById('view-turnos').style.display = 'none';
}

function showTurnos() {
  document.getElementById('view-login').style.display = 'none';
  document.getElementById('view-turnos').style.display = '';
}

// ── Render de turnos ──────────────────────────
function renderCard(a, isUpcoming) {
  const st = statusOf(a, isUpcoming);
  const active = st.key !== 'cancelled';

  const logo = a.business_logo_url && /^https:\/\//i.test(a.business_logo_url)
    ? `<img class="appt-logo" src="${esc(a.business_logo_url)}" alt="" referrerpolicy="no-referrer">`
    : '';

  const price = a.price != null && a.price !== '' ? ` · $${Number(a.price).toLocaleString('es-AR')}` : '';

  const addressRow = a.business_address
    ? `<div class="appt-meta-row">${ICONS.mapPin}
         <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.business_address)}" target="_blank" rel="noopener">${esc(a.business_address)}</a>
       </div>`
    : '';

  let actions = '';
  if (isUpcoming && active) {
    // El cliente le escribe al NEGOCIO (businesses.phone)
    const wa = waLink(a.business_phone, `Hola, te escribo por mi turno del ${shortDate(a.date)} a las ${hhmm(a.time)}`);
    const waBtn = wa ? `<a class="btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">${ICONS.whatsapp} WhatsApp</a>` : '';
    actions = canChange(a)
      ? `<div class="appt-actions">
          <button class="btn-sm cancel" onclick="cancelAppointment(${Number(a.id)})">${ICONS.calendarX} Cancelar</button>
          <button class="btn-sm" onclick="downloadIcs(${Number(a.id)})">${ICONS.calendarPlus} Agregar al calendario</button>
          ${waBtn}
          ${a.business_slug ? `<a class="btn-sm reschedule" href="${esc(rebookUrl(a, { reschedule: a.id }))}">${ICONS.calendarSync} Reprogramar</a>` : ''}
        </div>`
      : `<p class="appt-locked">Para cambios, escribile al negocio${wa ? '' : '.'}</p>
         <div class="appt-actions">
          <button class="btn-sm" onclick="downloadIcs(${Number(a.id)})">${ICONS.calendarPlus} Agregar al calendario</button>
          ${waBtn}
        </div>`;
  } else if (!isUpcoming && a.business_slug) {
    actions = `<div class="appt-actions">
        <a class="btn-sm reschedule" href="${esc(rebookUrl(a))}">${ICONS.rotate} Volver a reservar</a>
      </div>`;
  }

  return `
    <div class="card appt-card ${active ? '' : 'is-cancelled'}" id="appt-${Number(a.id)}">
      <div class="appt-header">
        <div>
          <div class="appt-business">${logo}${esc(a.business_name || 'Agendaste')}</div>
          <div class="appt-service">${esc(capitalize(a.service_name || 'Servicio'))}${a.barber_name ? ` <span>con ${esc(a.barber_name)}</span>` : ''}</div>
        </div>
        <span class="badge badge-${st.key}">${st.label}</span>
      </div>
      <div class="appt-meta">
        <div class="appt-meta-row appt-when">${ICONS.clock4} ${shortDate(a.date)} · ${esc(hhmm(a.time))}${price}</div>
        ${addressRow}
      </div>
      ${actions}
    </div>
  `;
}

// ¿Todavía está dentro de la anticipación mínima del negocio? (0 = sin límite; mismo criterio que el backend)
function canChange(a) {
  const minHours = parseInt(a.cancel_min_hours, 10) || 0;
  const hoursLeft = (apptStart(a).getTime() - Date.now()) / 3600000;
  return hoursLeft > 0 && (minHours === 0 || hoursLeft >= minHours);
}

function rebookUrl(a, extra = {}) {
  const q = new URLSearchParams();
  if (a.service_id) q.set('service', a.service_id);
  if (a.barber_id)  q.set('barber', a.barber_id);
  if (extra.reschedule) q.set('reschedule', extra.reschedule);
  const qs = q.toString();
  return `/${encodeURIComponent(a.business_slug)}${qs ? '?' + qs : ''}`;
}

// Último negocio donde reservó (el turno creado más recientemente)
function lastBusinessSlug() {
  const all = [...upcomingAppts, ...cancelledAppts, ...pastAppts].filter(a => a.business_slug);
  if (!all.length) return null;
  const key = a => a.created_at ? new Date(a.created_at).getTime() : apptStart(a).getTime();
  return all.reduce((best, a) => key(a) > key(best) ? a : best).business_slug;
}

// Próximos: solo los vigentes
function renderUpcoming() {
  const list = document.getElementById('upcoming-list');
  if (upcomingAppts.length === 0) {
    const slug = lastBusinessSlug();
    list.innerHTML = `<div class="empty-state">
        <p>No tenés turnos próximos</p>
        ${slug ? `<a class="btn btn-primary" href="/${encodeURIComponent(slug)}">Reservar turno</a>` : ''}
      </div>`;
    return;
  }
  list.innerHTML = upcomingAppts.map(a => renderCard(a, true)).join('');
}

// Cancelados con fecha futura: en una sección aparte, colapsada
function renderCancelled() {
  const wrap = document.getElementById('cancelled-wrap');
  wrap.style.display = cancelledAppts.length ? '' : 'none';
  document.getElementById('cancelled-count').textContent = cancelledAppts.length;
  document.getElementById('cancelled-list').innerHTML = cancelledAppts.map(a => renderCard(a, true)).join('');
}

function renderPast() {
  const list = document.getElementById('past-list');
  list.innerHTML = pastAppts.length
    ? pastAppts.slice(0, pastShown).map(a => renderCard(a, false)).join('')
    : '<p class="empty-state">No tenés turnos pasados</p>';
  document.getElementById('past-more').style.display = pastAppts.length > pastShown ? '' : 'none';
}

function showMorePast() {
  pastShown += PAST_PAGE;
  renderPast();
}

async function loadAppointments() {
  const upcomingList = document.getElementById('upcoming-list');
  const pastList = document.getElementById('past-list');

  try {
    const res = await fetch('/api/appointments/mine');
    if (res.status === 401) {
      showLogin();
      return;
    }
    const data = await res.json();

    const future   = data.upcoming || [];
    upcomingAppts  = future.filter(a => a.status !== 'cancelled');
    cancelledAppts = future.filter(a => a.status === 'cancelled');
    // Pasados: del más reciente al más viejo
    pastAppts = (data.past || []).slice().sort((a, b) => apptStart(b) - apptStart(a));

    renderUpcoming();
    renderCancelled();
    renderPast();
  } catch {
    upcomingList.innerHTML = '<p class="empty-state">Error cargando tus turnos</p>';
    pastList.innerHTML = '';
  }
}

// ── Acciones ──────────────────────────────────
async function cancelAppointment(id) {
  if (!confirm('¿Seguro que querés cancelar este turno?')) return;
  try {
    const res = await fetch(`/api/appointments/${id}/cancel-mine`, { method: 'PATCH' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast('❌ ' + (err.error || 'Error al cancelar'));
      return;
    }
    showToast('✅ Turno cancelado');
    loadAppointments();
  } catch {
    showToast('❌ Error de conexión');
  }
}

// ── Agregar al calendario (.ics generado en el navegador) ──
function icsText(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsDate(d) { return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'; }

function downloadIcs(id) {
  const a = upcomingAppts.find(x => x.id === id);
  if (!a) return;
  const start = apptStart(a);
  const end   = new Date(start.getTime() + (parseInt(a.service_duration, 10) || 30) * 60000);
  const title = `${capitalize(a.service_name || 'Turno')} — ${a.business_name || 'Agendaste'}`;
  const desc  = [a.barber_name ? `Con ${a.barber_name}` : '', 'Reservado con Agendaste'].filter(Boolean).join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Agendaste//Mis turnos//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:turno-${a.id}@agendaste.com.ar`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(title)}`,
    `DESCRIPTION:${icsText(desc)}`,
    a.business_address ? `LOCATION:${icsText(a.business_address)}` : null,
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);

  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `turno-${dateOnly(a.date)}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Toast ─────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

init();
