// ==============================
// Agendaste — Panel del dueño
// ==============================

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];


async function checkAuth() {
  try {
    const res  = await fetch('/auth/me');
    const data = await res.json();

    if (data.loggedIn) {
      // Verificar si el trial venció
      const statusRes = await fetch('/api/subscriptions/status');
      if (statusRes.status === 402) {
        document.getElementById('user-area').innerHTML = `
          <div class="user-pill">
            <img src="${data.user.picture}" alt="${data.user.name}">
            <span>${data.user.name}</span>
            <a href="/auth/logout" class="btn btn-outline" style="font-size:12px;padding:5px 10px">Salir</a>
          </div>`;
        showPaywall();
        return;
      }

      // Mostrar nombre y foto del usuario
      document.getElementById('user-area').innerHTML = `
        <div class="user-pill">
          <img src="${data.user.picture}" alt="${data.user.name}">
          <span>${data.user.name}</span>
          <button class="gear-btn" onclick="location.href='/admin/settings'" title="Configuración del negocio"><svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 10.27 7 3.34"/><path d="m11 13.73-4 6.93"/><path d="M12 22v-2"/><path d="M12 2v2"/><path d="M14 12h8"/><path d="m17 20.66-1-1.73"/><path d="m17 3.34-1 1.73"/><path d="M2 12h2"/><path d="m20.66 17-1.73-1"/><path d="m20.66 7-1.73 1"/><path d="m3.34 17 1.73-1"/><path d="m3.34 7 1.73 1"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="8"/></svg></button>
          <a href="/auth/logout" class="btn btn-outline" style="font-size:12px;padding:5px 10px">Salir</a>
        </div>`;
      document.getElementById('admin-view').style.display = 'block';
      loadAppointments();
      renderServices();
      renderBarbers();
      loadSubscriptionStatus();
    } else {
      document.getElementById('login-view').style.display = 'block';
    }
  } catch {
    document.getElementById('login-view').style.display = 'block';
  }
}

// ── Fecha en horario de Argentina (no UTC) ───
const DAY_ABBR_SHORT = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const DAY_PILLS_COUNT = 14;

function arDateKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d);
}

function apptDateKey(a) {
  return (a.date || '').toString().split('T')[0];
}

let allAppointments = [];
let selectedDateKey = null;

// ── Cargar próximos turnos (un solo fetch) ───
async function loadAppointments() {
  const list = document.getElementById('appointments-list');

  try {
    const res = await fetch('/api/appointments?from=today');
    if (res.status === 402) { showPaywall(); return; }
    allAppointments = await res.json();

    const todayKey    = arDateKey();
    const tomorrowKey = arDateKey(new Date(Date.now() + 86400000));
    const todayAppts  = allAppointments.filter(a => apptDateKey(a) === todayKey);

    document.getElementById('stat-today').textContent   = todayAppts.length;
    document.getElementById('stat-pending').textContent  = allAppointments.filter(a => apptDateKey(a) === tomorrowKey).length;
    document.getElementById('stat-revenue').textContent  = '$' + todayAppts.filter(a => a.status === 'confirmed').reduce((sum, a) => sum + (a.price || 0), 0).toLocaleString('es-AR');

    if (!selectedDateKey) selectedDateKey = todayKey;

    renderDayPills();
    renderAppointmentsForSelectedDay();
  } catch {
    list.innerHTML = `<p class="text-muted" style="text-align:center;padding:2rem">Error cargando turnos</p>`;
  }
}

// ── Selector de día (pills) ───────────────────
function renderDayPills() {
  const todayKey  = arDateKey();
  const container = document.getElementById('day-pills');
  const now       = new Date();

  const pillsHtml = [];
  for (let i = 0; i < DAY_PILLS_COUNT; i++) {
    const key   = arDateKey(new Date(now.getTime() + i * 86400000));
    const dow   = new Date(key + 'T12:00:00').getDay();
    const label = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : DAY_ABBR_SHORT[dow];
    const dayNum  = Number(key.split('-')[2]);
    const count   = allAppointments.filter(a => apptDateKey(a) === key).length;
    const selected = key === selectedDateKey;

    pillsHtml.push(`
      <div class="day-pill ${selected ? 'selected' : ''}" onclick="selectDayPill('${key}')">
        <div class="day-pill-label">${label}</div>
        <div class="day-pill-num">${dayNum}</div>
        <div class="day-pill-count">${count} turno${count === 1 ? '' : 's'}</div>
      </div>`);
  }
  container.innerHTML = pillsHtml.join('');
}

function selectDayPill(key) {
  selectedDateKey = key;
  renderDayPills();
  renderAppointmentsForSelectedDay();
}

// ── Render de la lista del día seleccionado ──
function renderAppointmentsForSelectedDay() {
  const list  = document.getElementById('appointments-list');
  const appts = allAppointments.filter(a => apptDateKey(a) === selectedDateKey);

  if (appts.length === 0) {
    list.innerHTML = `<p class="text-muted" style="text-align:center;padding:2rem">Sin turnos para este día</p>`;
    return;
  }

  let confirmed = 0, cancelled = 0, total = 0;
  for (const a of appts) {
    if (a.status === 'confirmed') { confirmed++; total += a.price || 0; }
    else if (a.status === 'cancelled') { cancelled++; }
  }

  const summaryBar = `<div style="font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);padding:8px 0 12px;border-bottom:1px solid var(--border);margin-bottom:12px">CONFIRMADOS: ${confirmed} · CANCELADOS: ${cancelled} · TOTAL: $${total.toLocaleString('es-AR')}</div>`;

  list.innerHTML = summaryBar + appts.map(a => `
    <div class="card appt-card" id="appt-${a.id}">
      <div>
        <div class="appt-name">${a.client_name || a.clientName || '—'}</div>
        <div class="appt-detail">${a.service_name || a.service || 'Servicio'} · ${a.client_phone || a.clientPhone || 'Sin teléfono'}</div>
            <div class="appt-actions">
              <button class="btn-sm cancel" onclick="updateStatus(${a.id}, 'cancelled')">✕ Cancelar</button>
            </div>
          </div>
          <div>
            <div class="appt-time">${a.time ? a.time.substring(0,5) : '—'}</div>
            <div class="appt-price">$${(a.price || 0).toLocaleString('es-AR')}</div>
            <div style="text-align:right;margin-top:4px"><span class="badge badge-${a.status}">${a.status === 'confirmed' ? 'Confirmado' : a.status === 'pending' ? 'Pendiente' : 'Cancelado'}</span></div>
          </div>
        </div>
      `).join('');
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

// ── Agregar turno manual (cliente por teléfono) ──
let manualServices = [];
let manualSelectedSlot = null;

function toggleAddAppointmentForm() {
  const isOpen = document.getElementById('add-appointment-form').style.display === 'block';
  if (isOpen) closeAddAppointmentForm(); else openAddAppointmentForm();
}

function openAddAppointmentForm() {
  document.getElementById('add-appointment-form').style.display = 'block';
  document.getElementById('btn-toggle-add-appt').textContent = 'Cancelar';
  resetManualForm();
  loadManualFormOptions();
}

function closeAddAppointmentForm() {
  document.getElementById('add-appointment-form').style.display = 'none';
  document.getElementById('btn-toggle-add-appt').textContent = '+ Agregar turno';
  resetManualForm();
}

function resetManualForm() {
  document.getElementById('new-appt-barber').value = '';
  document.getElementById('new-appt-service').value = '';
  document.getElementById('new-appt-date').value = '';
  document.getElementById('new-appt-name').value = '';
  document.getElementById('new-appt-phone').value = '';
  document.getElementById('new-appt-slots').innerHTML = '<p class="text-muted" style="grid-column:1/-1;font-size:13px">Elegí barbero y fecha</p>';
  manualSelectedSlot = null;
  const btn = document.getElementById('btn-save-manual-appt');
  btn.disabled = true;
  btn.textContent = 'Guardar turno';
}

async function loadManualFormOptions() {
  const barberSelect  = document.getElementById('new-appt-barber');
  const serviceSelect = document.getElementById('new-appt-service');
  document.getElementById('new-appt-date').min = new Date().toISOString().split('T')[0];

  try {
    const [barbersRes, servicesRes] = await Promise.all([
      fetch('/api/barbers'),
      fetch('/api/services')
    ]);
    const barbers  = await barbersRes.json();
    manualServices = await servicesRes.json();

    barberSelect.innerHTML = '<option value="">Seleccioná un barbero</option>' +
      barbers.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    serviceSelect.innerHTML = '<option value="">Seleccioná un servicio</option>' +
      manualServices.map(s => `<option value="${s.id}">${s.name} — $${s.price.toLocaleString('es-AR')}</option>`).join('');
  } catch {
    showToast('❌ Error cargando barberos/servicios');
  }
}

async function loadManualSlots() {
  const barberId = document.getElementById('new-appt-barber').value;
  const date      = document.getElementById('new-appt-date').value;
  const grid      = document.getElementById('new-appt-slots');
  manualSelectedSlot = null;
  checkManualForm();

  if (!barberId || !date) {
    grid.innerHTML = '<p class="text-muted" style="grid-column:1/-1;font-size:13px">Elegí barbero y fecha</p>';
    return;
  }

  grid.innerHTML = '<p class="text-muted" style="grid-column:1/-1;font-size:13px">Cargando horarios...</p>';

  try {
    const res   = await fetch(`/api/appointments/slots/${date}?barber_id=${barberId}`);
    const slots = await res.json();

    if (slots.length === 0) {
      grid.innerHTML = '<p class="text-muted" style="grid-column:1/-1;font-size:13px">Sin horarios disponibles ese día</p>';
      return;
    }

    grid.innerHTML = slots.map(s => `
      <div class="slot ${!s.available ? 'taken' : ''}" data-time="${s.time}"
           onclick="${s.available ? `selectManualSlot('${s.time}')` : ''}">
        ${s.time}${!s.available ? '<br><small>Ocupado</small>' : ''}
      </div>
    `).join('');
  } catch {
    grid.innerHTML = '<p class="text-muted" style="grid-column:1/-1;font-size:13px">Error cargando horarios</p>';
  }
}

function selectManualSlot(time) {
  manualSelectedSlot = time;
  document.querySelectorAll('#new-appt-slots .slot').forEach(el => {
    el.classList.toggle('selected', el.dataset.time === time);
  });
  checkManualForm();
}

function checkManualForm() {
  const barberId  = document.getElementById('new-appt-barber').value;
  const serviceId = document.getElementById('new-appt-service').value;
  const date      = document.getElementById('new-appt-date').value;
  const name      = document.getElementById('new-appt-name').value.trim();
  const phone     = document.getElementById('new-appt-phone').value.trim();
  const ok = barberId && serviceId && date && manualSelectedSlot && name && phone;
  document.getElementById('btn-save-manual-appt').disabled = !ok;
}

async function saveManualAppointment() {
  const barberId  = document.getElementById('new-appt-barber').value;
  const serviceId = document.getElementById('new-appt-service').value;
  const date      = document.getElementById('new-appt-date').value;
  const name      = document.getElementById('new-appt-name').value.trim();
  const phone     = document.getElementById('new-appt-phone').value.trim();
  const service   = manualServices.find(s => String(s.id) === serviceId);

  const btn = document.getElementById('btn-save-manual-appt');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const res = await fetch('/api/appointments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName:  name,
        clientPhone: phone,
        service:     service?.name,
        barberId:    Number(barberId),
        date,
        time:        manualSelectedSlot,
        price:       service?.price
      })
    });

    if (!res.ok) {
      const err = await res.json();
      showToast('❌ ' + err.error);
      btn.disabled = false;
      btn.textContent = 'Guardar turno';
      return;
    }

    showToast('✅ Turno agregado');
    closeAddAppointmentForm();
    loadAppointments();
  } catch {
    showToast('❌ Error de conexión');
    btn.disabled = false;
    btn.textContent = 'Guardar turno';
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
          <input id="new-svc-dur"   placeholder="Min" type="number" min="1" style="width:70px;padding:6px 8px;border-radius:6px;border:1px solid var(--border)">
          <input id="new-svc-price" placeholder="Precio"  type="number" min="1" style="width:90px;padding:6px 8px;border-radius:6px;border:1px solid var(--border)">
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

  if (Number(price) <= 0 || Number(dur) <= 0) {
    showToast('El precio y la duración deben ser mayores a 0');
    return;
  }

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
            <button class="btn-sm" onclick="openSchedule(${b.id}, '${b.name.replace(/'/g, "\\'")}')"><svg class="icon icon-sm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Horario</button>
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
      const d = byDay[dow] || { is_open: false, open_time: '09:00', close_time: '18:00', has_split: false, open_time_2: '16:00', close_time_2: '20:00' };
      const open    = (d.open_time    || '09:00').substring(0, 5);
      const close   = (d.close_time   || '18:00').substring(0, 5);
      const open2   = (d.open_time_2  || '16:00').substring(0, 5);
      const close2  = (d.close_time_2 || '20:00').substring(0, 5);
      const hasSplit = !!d.has_split;
      return `
        <div class="schedule-day ${hasSplit ? 'split' : ''}" data-dow="${dow}">
          <div class="schedule-day-head">
            <button class="toggle ${d.is_open ? 'on' : ''}" onclick="this.classList.toggle('on')"></button>
            <span class="schedule-day-name">${DAY_NAMES[dow]}</span>
            <label class="schedule-split-toggle">
              <button type="button" class="toggle toggle-sm sched-split ${hasSplit ? 'on' : ''}" onclick="toggleSplit(this)" title="Horario partido"></button>
              Partido
            </label>
          </div>
          <div class="schedule-franjas">
            <div class="schedule-franja-row">
              <span class="schedule-franja-num">1</span>
              <input type="time" class="sched-open"  value="${open}">
              <span class="schedule-sep">a</span>
              <input type="time" class="sched-close" value="${close}">
            </div>
            <div class="schedule-franja-row sched-franja-2">
              <span class="schedule-franja-num">2</span>
              <input type="time" class="sched-open-2"  value="${open2}">
              <span class="schedule-sep">a</span>
              <input type="time" class="sched-close-2" value="${close2}">
            </div>
          </div>
        </div>`;
    }).join('');
  } catch {
    showToast('Error cargando horarios');
  }
}

function toggleSplit(btn) {
  btn.classList.toggle('on');
  btn.closest('.schedule-day').classList.toggle('split', btn.classList.contains('on'));
}

function closeSchedule() {
  document.getElementById('schedule-overlay').classList.remove('open');
  document.getElementById('schedule-panel').classList.remove('open');
}

async function saveSchedule() {
  const barberId = document.getElementById('schedule-panel').dataset.barberId;
  const days     = document.querySelectorAll('#schedule-days .schedule-day');
  const schedule = Array.from(days).map(day => ({
    day_of_week:  Number(day.dataset.dow),
    is_open:      day.querySelector('.toggle:not(.sched-split)').classList.contains('on'),
    open_time:    day.querySelector('.sched-open').value,
    close_time:   day.querySelector('.sched-close').value,
    has_split:    day.querySelector('.sched-split').classList.contains('on'),
    open_time_2:  day.querySelector('.sched-open-2').value,
    close_time_2: day.querySelector('.sched-close-2').value
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

// ── Suscripción / Trial ──────────────────────
async function loadSubscriptionStatus() {
  const banner = document.getElementById('trial-banner');
  try {
    const res  = await fetch('/api/subscriptions/status');
    if (!res.ok) return;
    const data = await res.json();

    if (data.plan !== 'active' && data.trial_active) {
      document.getElementById('trial-days').textContent = data.days_left;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  } catch {
    banner.style.display = 'none';
  }
}

async function subscribe() {
  try {
    const res  = await fetch('/api/subscriptions/create', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { showToast('❌ ' + (data.error || 'Error al crear la suscripción')); return; }
    window.location.href = data.init_point;
  } catch {
    showToast('❌ Error conectando con Mercado Pago');
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

  function showPaywall() {
  document.getElementById('admin-view').style.display = 'none';
  document.getElementById('paywall-screen').style.display = 'block';
}

async function suscribirse() {
  try {
    const res = await fetch('/api/subscriptions/create', { method: 'POST' });
    const data = await res.json();
    if (data.init_point) {
      window.location.href = data.init_point;
    } else {
      showToast('❌ Error al crear la suscripción');
    }
  } catch {
    showToast('❌ Error de conexión');
  }
}

// ── Init ──────────────────────────────────────
checkAuth();
