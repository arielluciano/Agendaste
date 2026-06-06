// ==============================
// BarberApp — Panel del dueño
// ==============================

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];


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
          <button class="gear-btn" onclick="openBusinessPanel()" title="Configuración del negocio">⚙️</button>
          <a href="/auth/logout" class="btn btn-outline" style="font-size:12px;padding:5px 10px">Salir</a>
        </div>`;
      document.getElementById('admin-view').style.display = 'block';
      loadAppointments();
      renderServices();
      renderBarbers();
    } else {
      document.getElementById('login-view').style.display = 'block';
    }
  } catch {
    document.getElementById('login-view').style.display = 'block';
  }
}

// ── Cargar próximos turnos ───────────────────
async function loadAppointments() {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const list  = document.getElementById('appointments-list');

  try {
    const res = await fetch('/api/appointments?from=today');
    const appts = await res.json();

    // Stats
    const tomorrowCount = appts.filter(a => (a.date || '').toString().split('T')[0] === tomorrowStr).length;
    const revenue = appts.reduce((sum, a) => sum + (a.price || 0), 0);
    document.getElementById('stat-today').textContent   = appts.length;
    document.getElementById('stat-pending').textContent = tomorrowCount;
    document.getElementById('stat-revenue').textContent = '$' + revenue.toLocaleString('es-AR');

    if (appts.length === 0) {
      list.innerHTML = `<p class="text-muted" style="text-align:center;padding:2rem">No hay próximos turnos</p>`;
      return;
    }

list.innerHTML = appts.map(a => `
  <div class="card appt-card" id="appt-${a.id}">
    <div>
      <div class="appt-name">${a.client_name || a.clientName || '—'}</div>
      <div class="appt-detail">${a.service_name || a.service || 'Servicio'} · ${a.client_phone || a.clientPhone || 'Sin teléfono'}</div>
          <div class="appt-actions">
            <button class="btn-sm cancel" onclick="updateStatus(${a.id}, 'cancelled')">✕ Cancelar</button>
            <button class="btn-sm" onclick="addToCalendar(${JSON.stringify(a).replace(/"/g,'&quot;')})">📅 Cal</button>
          </div>
        </div>
        <div>
          <div class="appt-time">${a.time ? a.time.substring(0,5) : '—'}</div>
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
async function renderServices() {
  const list = document.getElementById('services-list');
  list.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem">Cargando...</p>';

  try {
    const res      = await fetch('/api/services?all=true');
    const services = await res.json();

    list.innerHTML = `
      ${services.map(s => `
        <div class="service-row">
          <div>
            <div style="font-size:14px;font-weight:600">${s.name}</div>
            <div class="text-muted">${s.duration} min</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="text-muted" style="font-size:13px">$</span>
            <input class="price-input" type="number" value="${s.price}" onchange="updatePrice(${s.id}, this.value)">
            <button class="toggle ${s.active ? 'on' : ''}" onclick="toggleService(${s.id}, ${s.active})" title="${s.active ? 'Desactivar' : 'Activar'}"></button>
            <button class="btn-sm cancel" onclick="deleteService(${s.id})" title="Eliminar">✕</button>
          </div>
        </div>
      `).join('')}
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <p style="font-size:13px;font-weight:600;margin-bottom:8px">Agregar servicio</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="new-svc-name"  placeholder="Nombre"  style="flex:2;min-width:120px;padding:6px 8px;border-radius:6px;border:1px solid var(--border)">
          <input id="new-svc-dur"   placeholder="Min" type="number" style="width:70px;padding:6px 8px;border-radius:6px;border:1px solid var(--border)">
          <input id="new-svc-price" placeholder="Precio"  type="number" style="width:90px;padding:6px 8px;border-radius:6px;border:1px solid var(--border)">
          <button class="btn btn-primary" style="padding:6px 14px" onclick="addService()">+ Agregar</button>
        </div>
      </div>
    `;
  } catch {
    list.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem">Error cargando servicios</p>';
  }
}

async function addService() {
  const name  = document.getElementById('new-svc-name').value.trim();
  const dur   = document.getElementById('new-svc-dur').value;
  const price = document.getElementById('new-svc-price').value;

  if (!name || !dur || !price) { showToast('Completá todos los campos'); return; }

  try {
    const res = await fetch('/api/services', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, duration: Number(dur), price: Number(price) })
    });
    if (!res.ok) { const err = await res.json(); showToast('❌ ' + err.error); return; }
    showToast('✅ Servicio agregado');
    renderServices();
  } catch {
    showToast('❌ Error al agregar servicio');
  }
}

async function deleteService(id) {
  try {
    await fetch(`/api/services/${id}`, { method: 'DELETE' });
    showToast('Servicio eliminado');
    renderServices();
  } catch {
    showToast('❌ Error al eliminar servicio');
  }
}

async function updatePrice(id, val) {
  try {
    await fetch(`/api/services/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ price: Number(val) })
    });
    showToast('💰 Precio actualizado');
  } catch {
    showToast('❌ Error al actualizar precio');
  }
}

async function toggleService(id, currentActive) {
  try {
    await fetch(`/api/services/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ active: !currentActive })
    });
    renderServices();
    showToast(currentActive ? '⏸ Servicio desactivado' : '✅ Servicio activado');
  } catch {
    showToast('❌ Error al cambiar estado');
  }
}

// ── Barberos ─────────────────────────────────
async function renderBarbers() {
  const list = document.getElementById('barbers-list');
  list.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem">Cargando...</p>';

  try {
    const res     = await fetch('/api/barbers/all');
    const barbers = await res.json();

    list.innerHTML = `
      ${barbers.map(b => `
        <div class="service-row">
          <div>
            <div style="font-size:14px;font-weight:600">${b.name}</div>
            <div class="text-muted" style="font-size:12px">${b.role}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn-sm" onclick="openSchedule(${b.id}, '${b.name.replace(/'/g, "\\'")}')">⏰ Horario</button>
            <button class="toggle ${b.active ? 'on' : ''}" onclick="toggleBarber(${b.id}, ${b.active})" title="${b.active ? 'Desactivar' : 'Activar'}"></button>
            <button class="btn-sm cancel" onclick="deleteBarber(${b.id})" title="Eliminar">✕</button>
          </div>
        </div>
      `).join('')}
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <p style="font-size:13px;font-weight:600;margin-bottom:8px">Agregar barbero</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="new-barber-name" placeholder="Nombre" style="flex:2;min-width:120px;padding:6px 8px;border-radius:6px;border:1px solid var(--border)">
          <input id="new-barber-role" placeholder="Rol (ej: Barbero)" style="flex:2;min-width:120px;padding:6px 8px;border-radius:6px;border:1px solid var(--border)">
          <button class="btn btn-primary" style="padding:6px 14px" onclick="addBarber()">+ Agregar</button>
        </div>
      </div>
    `;
  } catch {
    list.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem">Error cargando barberos</p>';
  }
}

async function addBarber() {
  const name = document.getElementById('new-barber-name').value.trim();
  const role = document.getElementById('new-barber-role').value.trim();

  if (!name) { showToast('El nombre es obligatorio'); return; }

  try {
    const res = await fetch('/api/barbers', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, role: role || 'Barbero' })
    });
    if (!res.ok) { const err = await res.json(); showToast('❌ ' + err.error); return; }
    showToast('✅ Barbero agregado');
    renderBarbers();
  } catch {
    showToast('❌ Error al agregar barbero');
  }
}

async function deleteBarber(id) {
  try {
    await fetch(`/api/barbers/${id}`, { method: 'DELETE' });
    showToast('Barbero eliminado');
    renderBarbers();
  } catch {
    showToast('❌ Error al eliminar barbero');
  }
}

async function toggleBarber(id, currentActive) {
  try {
    await fetch(`/api/barbers/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ active: !currentActive })
    });
    renderBarbers();
    showToast(currentActive ? '⏸ Barbero desactivado' : '✅ Barbero activado');
  } catch {
    showToast('❌ Error al cambiar estado');
  }
}

// ── Horarios por barbero ──────────────────────
const DAY_NAMES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Lun→Dom

async function openSchedule(barberId, barberName) {
  document.getElementById('schedule-barber-name').textContent = barberName;
  document.getElementById('schedule-panel').dataset.barberId = barberId;
  document.getElementById('schedule-overlay').classList.add('open');
  document.getElementById('schedule-panel').classList.add('open');

  try {
    const res      = await fetch(`/api/barbers/${barberId}/schedule`);
    const schedule = await res.json();
    const byDay    = {};
    schedule.forEach(s => byDay[s.day_of_week] = s);

    document.getElementById('schedule-days').innerHTML = DAYS_ORDER.map(dow => {
      const d = byDay[dow] || { is_open: false, open_time: '09:00', close_time: '18:00' };
      const open  = (d.open_time  || '09:00').substring(0, 5);
      const close = (d.close_time || '18:00').substring(0, 5);
      return `
        <div class="schedule-row" data-dow="${dow}">
          <button class="toggle ${d.is_open ? 'on' : ''}" onclick="this.classList.toggle('on')"></button>
          <span class="schedule-day-name">${DAY_NAMES[dow]}</span>
          <input type="time" class="sched-open"  value="${open}">
          <span class="schedule-sep">a</span>
          <input type="time" class="sched-close" value="${close}">
        </div>`;
    }).join('');
  } catch {
    showToast('Error cargando horarios');
  }
}

function closeSchedule() {
  document.getElementById('schedule-overlay').classList.remove('open');
  document.getElementById('schedule-panel').classList.remove('open');
}

async function saveSchedule() {
  const barberId = document.getElementById('schedule-panel').dataset.barberId;
  const rows     = document.querySelectorAll('#schedule-days .schedule-row');
  const schedule = Array.from(rows).map(row => ({
    day_of_week: Number(row.dataset.dow),
    is_open:     row.querySelector('.toggle').classList.contains('on'),
    open_time:   row.querySelector('.sched-open').value,
    close_time:  row.querySelector('.sched-close').value
  }));

  try {
    const res = await fetch(`/api/barbers/${barberId}/schedule`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ schedule })
    });
    if (!res.ok) throw new Error();
    showToast('✅ Horarios guardados');
    closeSchedule();
  } catch {
    showToast('❌ Error guardando horarios');
  }
}

// ── Configuración del negocio ────────────────
function openBusinessPanel() {
  document.getElementById('config-panel').classList.add('open');
  document.getElementById('config-overlay').classList.add('open');
  loadBusiness();
}

function closeBusinessPanel() {
  document.getElementById('config-panel').classList.remove('open');
  document.getElementById('config-overlay').classList.remove('open');
}

async function loadBusiness() {
  try {
    const res  = await fetch('/api/business');
    const data = await res.json();
    document.getElementById('biz-name').value        = data.name        || '';
    document.getElementById('biz-address').value     = data.address     || '';
    document.getElementById('biz-phone').value       = data.phone       || '';
    document.getElementById('biz-description').value = data.description || '';
    if (data.address) showMapPreview(data.address);
  } catch {
    showToast('❌ Error cargando configuración');
  }
}

async function saveBusiness() {
  const name        = document.getElementById('biz-name').value.trim();
  const address     = document.getElementById('biz-address').value.trim();
  const phone       = document.getElementById('biz-phone').value.trim();
  const description = document.getElementById('biz-description').value.trim();

  try {
    const res = await fetch('/api/business', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, address, phone, description })
    });
    if (!res.ok) { const err = await res.json(); showToast('❌ ' + err.error); return; }
    showToast('✅ Configuración guardada');
    if (address) showMapPreview(address);
  } catch {
    showToast('❌ Error guardando configuración');
  }
}

function showMapPreview(address) {
  const encoded = encodeURIComponent(address);
  document.getElementById('map-frame').innerHTML =
    `<iframe src="https://maps.google.com/maps?q=${encoded}&output=embed&hl=es&z=15"
       allowfullscreen loading="lazy"></iframe>`;
  document.getElementById('map-preview').style.display = 'block';
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
