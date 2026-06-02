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
          <a href="/auth/logout" class="btn btn-outline" style="font-size:12px;padding:5px 10px;margin-left:4px">Salir</a>
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
            <span class="text-muted" style="font-size:12px">${b.active ? 'Activo' : 'Inactivo'}</span>
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
