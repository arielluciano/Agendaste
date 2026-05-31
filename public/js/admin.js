// ==============================
// BarberApp — Panel del dueño
// ==============================

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Servicios locales (en Fase 2 vienen de la DB)
let services = [
  { id: 1, name: 'Corte de pelo', price: 4500, dur: '30 min', active: true },
  { id: 2, name: 'Barba',         price: 3000, dur: '20 min', active: true },
  { id: 3, name: 'Corte + barba', price: 6500, dur: '50 min', active: true },
  { id: 4, name: 'Degradé',       price: 5000, dur: '40 min', active: true },
  { id: 5, name: 'Coloración',    price: 8000, dur: '60 min', active: true },
];

// ── Verificar sesión al cargar ───────────────
async function checkAuth() {
  try {
    const res  = await fetch('/auth/me');
    const data = await res.json();

    if (data.loggedIn) {
      // Mostrar nombre y foto del usuario
      document.getElementById('user-area').innerHTML = `
        <div class="user-pill">
          <img src="${data.user.picture}" alt="${data.user.name}">
          <span>${data.user.name}</span>
          <a href="/auth/logout" class="btn btn-outline" style="font-size:12px;padding:5px 10px;margin-left:4px">Salir</a>
        </div>`;
      document.getElementById('admin-view').style.display = 'block';
      loadAppointments();
      renderServices();
    } else {
      document.getElementById('login-view').style.display = 'block';
    }
  } catch {
    document.getElementById('login-view').style.display = 'block';
  }
}

// ── Cargar turnos del día ────────────────────
async function loadAppointments() {
  const today = new Date().toISOString().split('T')[0];
  const list  = document.getElementById('appointments-list');

  try {
    const res = await fetch('/api/appointments');
    const appts = await res.json();

    // Stats
    const pending = appts.filter(a => a.status === 'pending').length;
    const revenue = appts.reduce((sum, a) => sum + (a.price || 0), 0);
    document.getElementById('stat-today').textContent   = appts.length;
    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-revenue').textContent = '$' + revenue.toLocaleString('es-AR');

    if (appts.length === 0) {
      list.innerHTML = `<p class="text-muted" style="text-align:center;padding:2rem">No hay turnos para hoy</p>`;
      return;
    }

    list.innerHTML = appts.map(a => `
      <div class="card appt-card" id="appt-${a.id}">
        <div>
          <div class="appt-name">${a.clientName}</div>
          <div class="appt-detail">${a.service} · ${a.clientPhone || 'Sin teléfono'}</div>
          <div class="appt-actions">
            ${a.status === 'pending' ? `<button class="btn-sm confirm" onclick="updateStatus(${a.id}, 'confirmed')">✓ Confirmar</button>` : ''}
            <button class="btn-sm cancel" onclick="updateStatus(${a.id}, 'cancelled')">✕ Cancelar</button>
            <button class="btn-sm" onclick="addToCalendar(${JSON.stringify(a).replace(/"/g,'&quot;')})">📅 Cal</button>
          </div>
        </div>
        <div>
          <div class="appt-time">${a.time}</div>
          <div class="appt-price">$${(a.price || 0).toLocaleString('es-AR')}</div>
          <div style="text-align:right;margin-top:4px"><span class="badge badge-${a.status}">${a.status === 'confirmed' ? 'Confirmado' : a.status === 'pending' ? 'Pendiente' : 'Cancelado'}</span></div>
        </div>
      </div>
    `).join('');

  } catch {
    list.innerHTML = `<p class="text-muted" style="text-align:center;padding:2rem">Error cargando turnos</p>`;
  }
}

// ── Confirmar / cancelar turno ───────────────
async function updateStatus(id, status) {
  try {
    await fetch(`/api/appointments/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    showToast(status === 'confirmed' ? '✅ Turno confirmado' : '❌ Turno cancelado');
    loadAppointments();
  } catch {
    showToast('Error al actualizar');
  }
}

// ── Agregar turno al Google Calendar ─────────
async function addToCalendar(appt) {
  try {
    const res = await fetch('/api/calendar/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: appt.clientName,
        clientPhone: appt.clientPhone || 'Sin teléfono',
        service:    appt.service,
        date:       appt.date,
        time:       appt.time,
        price:      appt.price,
        duration:   30
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('📅 Turno agregado a tu Google Calendar');
      window.open(data.eventLink, '_blank');
    } else {
      showToast('❌ ' + data.error);
    }
  } catch {
    showToast('❌ Error conectando con Calendar');
  }
}

// ── Ver eventos de Google Calendar ───────────
async function loadCalendarEvents() {
  const container = document.getElementById('calendar-events');
  container.innerHTML = '<p class="text-muted">Cargando eventos...</p>';

  try {
    const res    = await fetch('/api/calendar/events');
    const data   = await res.json();

    if (data.error) {
      container.innerHTML = `<p class="text-muted">${data.error}</p>`;
      return;
    }

    if (!data.events.length) {
      container.innerHTML = '<p class="text-muted">No hay próximos eventos</p>';
      return;
    }

    container.innerHTML = data.events.map(e => {
      const start = new Date(e.start?.dateTime || e.start?.date);
      return `
        <div class="card" style="margin-bottom:8px;padding:.75rem">
          <div style="font-size:14px;font-weight:600">${e.summary}</div>
          <div class="text-muted">${start.toLocaleDateString('es-AR')} — ${start.toLocaleTimeString('es-AR', {hour:'2-digit',minute:'2-digit'})}</div>
        </div>`;
    }).join('');

  } catch {
    container.innerHTML = '<p class="text-muted">Error cargando eventos</p>';
  }
}

// ── Servicios ────────────────────────────────
function renderServices() {
  const list = document.getElementById('services-list');
  list.innerHTML = services.map(s => `
    <div class="service-row">
      <div>
        <div style="font-size:14px;font-weight:600">${s.name}</div>
        <div class="text-muted">${s.dur}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="text-muted" style="font-size:13px">$</span>
        <input class="price-input" type="number" value="${s.price}" onchange="updatePrice(${s.id}, this.value)">
        <button class="toggle ${s.active ? 'on' : ''}" onclick="toggleService(${s.id})" title="${s.active ? 'Desactivar' : 'Activar'}"></button>
      </div>
    </div>
  `).join('');
}

function updatePrice(id, val) {
  const s = services.find(x => x.id === id);
  if (s) { s.price = parseInt(val) || 0; showToast('💰 Precio actualizado'); }
}

function toggleService(id) {
  const s = services.find(x => x.id === id);
  if (s) { s.active = !s.active; renderServices(); showToast(s.active ? '✅ Servicio activado' : '⏸ Servicio desactivado'); }
}

// ── Tabs ──────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

// ── Toast ─────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Init ──────────────────────────────────────
checkAuth();
