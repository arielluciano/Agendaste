// ==============================
// Agendaste — Mis turnos del cliente
// ==============================

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function formatDate(dateStr) {
  const [year, month, day] = String(dateStr).split('T')[0].split('-').map(Number);
  return `${day} de ${MESES[month - 1]} de ${year}`;
}

function statusLabel(status) {
  return status === 'confirmed' ? 'Confirmado' : status === 'pending' ? 'Pendiente' : 'Cancelado';
}

const ICONS = {
  calendarCheck: '<svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>',
  calendarX: '<svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m14 14-4 4"/><path d="m10 14 4 4"/></svg>',
  calendarSync: '<svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 10v4h4"/><path d="m11 14 1.535-1.605a5 5 0 0 1 8 1.5"/><path d="M16 2v4"/><path d="m21 18-1.535 1.605a5 5 0 0 1-8-1.5"/><path d="M21 22v-4h-4"/><path d="M21 8.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4.3"/><path d="M3 10h4"/><path d="M8 2v4"/></svg>',
  mapPin: '<svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
  clock4: '<svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'
};

// ── Inicialización ────────────────────────────
async function init() {
  try {
    const res = await fetch('/auth/client/me');
    const data = await res.json();
    if (data.loggedIn) {
      document.getElementById('btn-logout-client').style.display = '';
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
  const addressRow = a.business_address
    ? `<div class="appt-meta-row">${ICONS.mapPin} ${a.business_address}</div>`
    : '';

  const actions = (isUpcoming && a.status !== 'cancelled')
    ? `<div class="appt-actions">
         <button class="btn-sm cancel" onclick="cancelAppointment(${a.id})">${ICONS.calendarX} Cancelar</button>
         <button class="btn-sm reschedule" onclick="rescheduleAppointment(${a.id}, '${a.business_slug || ''}')">${ICONS.calendarSync} Reprogramar</button>
       </div>`
    : '';

  return `
    <div class="card appt-card" id="appt-${a.id}">
      <div class="appt-header">
        <div>
          <div class="appt-business">${a.business_name || 'Agendaste'}</div>
          <div class="appt-service">${a.service_name || 'Servicio'}${a.barber_name ? ' con ' + a.barber_name : ''}</div>
        </div>
        <span class="badge badge-${a.status}">${statusLabel(a.status)}</span>
      </div>
      <div class="appt-meta">
        <div class="appt-meta-row">${ICONS.calendarCheck} ${formatDate(a.date)}</div>
        <div class="appt-meta-row">${ICONS.clock4} ${a.time ? a.time.substring(0,5) : '—'}</div>
        ${addressRow}
      </div>
      ${actions}
    </div>
  `;
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

    upcomingList.innerHTML = data.upcoming.length
      ? data.upcoming.map(a => renderCard(a, true)).join('')
      : '<p class="empty-state">No tenés turnos próximos</p>';

    pastList.innerHTML = data.past.length
      ? data.past.map(a => renderCard(a, false)).join('')
      : '<p class="empty-state">No tenés turnos pasados</p>';

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
      const err = await res.json();
      showToast('❌ ' + (err.error || 'Error al cancelar'));
      return;
    }
    showToast('✅ Turno cancelado');
    loadAppointments();
  } catch {
    showToast('❌ Error de conexión');
  }
}

async function rescheduleAppointment(id, slug) {
  if (!confirm('Vamos a cancelar este turno para que elijas uno nuevo. ¿Continuamos?')) return;
  try {
    const res = await fetch(`/api/appointments/${id}/cancel-mine`, { method: 'PATCH' });
    if (!res.ok) {
      const err = await res.json();
      showToast('❌ ' + (err.error || 'Error al reprogramar'));
      return;
    }
    window.location.href = slug ? `/${slug}` : '/';
  } catch {
    showToast('❌ Error de conexión');
  }
}

// ── Toast ─────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

init();
