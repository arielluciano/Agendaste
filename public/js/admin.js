// ==============================
// Agendaste — Panel del dueño
// ==============================
// Una sola página con secciones (#inicio, #servicios, #barberos, #horarios, #negocio,
// #personalizacion, #suscripcion). Las de configuración las maneja settings.js.

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DAY_NAMES  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Lun→Dom

// Íconos de línea (Lucide)
const svg = (paths, cls = 'icon icon-sm') =>
  `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  more:   svg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
  check:  svg('<path d="M20 6 9 17l-5-5"/>'),
  userX:  svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" x2="22" y1="8" y2="13"/><line x1="22" x2="17" y1="8" y2="13"/>'),
  chat:   svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
  pencil: svg('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  clock:  svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>')
};

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const money = n => '$' + Number(n || 0).toLocaleString('es-AR');

// ── Sesión ────────────────────────────────────
function renderUserArea(user) {
  document.getElementById('user-area').innerHTML = `
    <div class="user-pill">
      <img src="${escHtml(user.picture)}" alt="">
      <span>${escHtml(user.name)}</span>
      <a href="/auth/logout" class="btn btn-outline" style="font-size:12px;padding:5px 10px">Salir</a>
    </div>`;
}

async function checkAuth() {
  try {
    const res  = await fetch('/auth/me');
    const data = await res.json();

    if (!data.loggedIn) {
      document.getElementById('login-view').style.display = 'flex';
      return;
    }
    document.body.classList.add('is-authed'); // muestra el menú (sin sesión, login limpio)
    renderUserArea(data.user);

    // Prueba vencida sin suscripción: solo el paywall
    const statusRes = await fetch('/api/subscriptions/status');
    if (statusRes.status === 402) { showPaywall(); return; }

    document.getElementById('admin-view').style.display = 'block';
    showSection(location.hash.slice(1));

    updatePanelBusiness(await loadBusiness()); // settings.js: completa Mi negocio, Horarios y Personalización
    loadAppointments();
    renderServices();
    renderBarbers();
    loadSubscriptionStatus();
    loadSubscriptionCard();
  } catch {
    document.getElementById('login-view').style.display = 'flex';
  }
}

// ── Navegación única (#sección) ───────────────
const SECTIONS = ['inicio', 'servicios', 'barberos', 'horarios', 'negocio', 'personalizacion', 'suscripcion'];
const SECTION_ALIASES = { horario: 'horarios', turnos: 'inicio', configuracion: 'negocio' };

function showSection(name) {
  name = SECTION_ALIASES[name] || name;
  if (!SECTIONS.includes(name)) name = 'inicio';
  document.querySelectorAll('.panel-section').forEach(s => s.classList.toggle('active', s.id === 'sec-' + name));
  document.querySelectorAll('.nav-item').forEach(a => {
    if (a.dataset.section === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  setNavOpen(false);
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', () => {
  if (document.body.classList.contains('is-authed')) showSection(location.hash.slice(1));
});

function setNavOpen(open) {
  document.body.classList.toggle('nav-open', open);
  const btn = document.getElementById('nav-toggle');
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
}
function toggleNav() { setNavOpen(!document.body.classList.contains('nav-open')); }

// ── Datos del negocio en el panel (link, QR, checklist, mensajes) ──
let panelBiz     = null;
let panelBizName = '';   // para el mensaje de WhatsApp al cliente

// Lo llaman la carga inicial y los guardados de settings.js (Mi negocio, Personalización, logo)
function updatePanelBusiness(patch) {
  if (!patch) return;
  panelBiz = { ...(panelBiz || {}), ...patch };
  panelBizName = panelBiz.name || '';
  renderLinkCard();
  refreshChecklist();
}

function bookingLink() {
  return panelBiz?.slug ? `${window.location.origin}/${panelBiz.slug}` : '';
}

function renderLinkCard() {
  const link = bookingLink();
  document.getElementById('link-card').hidden = !link;
  document.getElementById('booking-link').value = link;
}

// "Link compartido" del checklist: businesses.link_shared_at, se marca al copiar o compartir
// (queda en la base, así vale en todos los dispositivos)
function linkShared() {
  return !!panelBiz?.link_shared_at;
}
async function markLinkShared() {
  if (linkShared()) return;
  try {
    const res = await fetch('/api/business/link-shared', { method: 'POST' });
    if (!res.ok) return;
    updatePanelBusiness(await res.json());
  } catch {}
}

async function copyBookingLink() {
  const input = document.getElementById('booking-link');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  showToast('✅ Link copiado');
  markLinkShared();
}

function shareBookingLink() {
  const url = waShareLink(`Reservá tu turno en ${panelBizName || 'mi negocio'}: ${bookingLink()}`);
  window.open(url, '_blank', 'noopener');
  markLinkShared();
}

// ── QR (se genera en el navegador con js/qr.js) ──
let qrCanvas = null;
function openQr() {
  const link = bookingLink();
  if (!link) return;
  qrCanvas = AgendasteQR.toCanvas(link, { scale: 10, margin: 4 });
  qrCanvas.setAttribute('role', 'img');
  qrCanvas.setAttribute('aria-label', `Código QR de ${link}`);
  document.getElementById('qr-box').replaceChildren(qrCanvas);
  openModal('qr-overlay');
}
function closeQr() { closeModal('qr-overlay'); }
function downloadQr() {
  if (!qrCanvas) return;
  qrCanvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qr-reservas-${panelBiz?.slug || 'agendaste'}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

// ── Checklist de configuración (se oculta al completarse) ──
let activeServiceCount = null;   // lo actualiza renderServices
let barbersWithSchedule = null;  // barberos activos con algún día de atención

let barbersPromise = null;      // una sola consulta aunque se pida varias veces seguidas

function loadBarbersWithSchedule() {
  barbersPromise = (async () => {
    try {
      const res = await fetch('/api/barbers?with_schedule=1');
      const list = await res.json();
      barbersWithSchedule = Array.isArray(list) ? list.length : 0;
    } catch {
      barbersWithSchedule = 0;
    }
  })();
  return barbersPromise;
}

// reloadBarbers = true después de guardar horarios o barberos
async function refreshChecklist(reloadBarbers = false) {
  if (reloadBarbers) await loadBarbersWithSchedule();
  else if (barbersWithSchedule === null) await (barbersPromise || loadBarbersWithSchedule());
  const box = document.getElementById('setup-checklist');
  if (!panelBiz || activeServiceCount === null) return; // todavía cargando: no mostrar a medias

  const branded = !!(panelBiz.logo_url || panelBiz.brand_primary || panelBiz.brand_bg || panelBiz.brand_text || panelBiz.brand_font);
  const items = [
    { done: activeServiceCount > 0,     text: 'Cargá al menos un servicio',          href: '#servicios',       cta: 'Ir a Servicios' },
    { done: barbersWithSchedule > 0,    text: 'Cargá un barbero con su horario',     href: '#barberos',        cta: 'Ir a Barberos' },
    { done: !!(panelBiz.phone || '').trim(), text: 'Agregá el teléfono del negocio', href: '#negocio',         cta: 'Ir a Mi negocio' },
    { done: branded,                    text: 'Subí tu logo o elegí tus colores',    href: '#personalizacion', cta: 'Personalizar' },
    { done: linkShared(),               text: 'Compartí tu link de reservas',        href: null,               cta: null }
  ];
  // Ya lo ocultó con "Ocultar" (businesses.onboarding_dismissed_at): no se muestra más
  if (panelBiz.onboarding_dismissed_at) { box.hidden = true; return; }
  const done = items.filter(i => i.done).length;
  const complete = done === items.length;
  box.hidden = false;
  document.getElementById('checklist-done').hidden = !complete;
  document.getElementById('checklist-steps').hidden = complete;
  if (complete) return;
  document.getElementById('checklist-count').textContent = `${done} de ${items.length}`;
  document.getElementById('checklist-items').innerHTML = items.map(i => `
    <li class="${i.done ? 'done' : ''}">
      <span class="check-dot">${i.done ? ICONS.check : ''}</span>
      <span class="check-text">${i.text}<span class="visually-hidden">${i.done ? ' (hecho)' : ' (pendiente)'}</span></span>
      ${!i.done && i.href ? `<a href="${i.href}">${i.cta}</a>` : ''}
    </li>`).join('');
}

async function dismissChecklist() {
  const btn = document.getElementById('btn-dismiss-checklist');
  btn.disabled = true;
  try {
    const res  = await fetch('/api/business/onboarding-dismissed', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast('❌ ' + (data.error || 'No se pudo ocultar')); return; }
    updatePanelBusiness(data); // con onboarding_dismissed_at el checklist queda oculto
  } catch {
    showToast('❌ Error de conexión');
  } finally {
    btn.disabled = false;
  }
}

// ── Modales, confirmaciones y menú "⋯" ────────
let lastFocus = null;
function openModal(id) {
  lastFocus = document.activeElement;
  const el = document.getElementById(id);
  el.classList.add('open');
  el.querySelector('button')?.focus();
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  lastFocus?.focus?.();
}

let confirmResolve = null;
// Devuelve una promesa: true si confirma
function confirmDialog({ title, text, ok = 'Confirmar' }) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent  = text;
  document.getElementById('confirm-ok').textContent    = ok;
  openModal('confirm-overlay');
  document.getElementById('confirm-cancel').focus();
  return new Promise(resolve => { confirmResolve = resolve; });
}
function closeConfirm(value) {
  closeModal('confirm-overlay');
  if (confirmResolve) { confirmResolve(value); confirmResolve = null; }
}

// items: [{ label, action (código JS), danger }]
function kebabHtml(label, items) {
  return `
    <div class="kebab">
      <button type="button" class="kebab-btn" aria-label="${escHtml(label)}" aria-haspopup="menu" aria-expanded="false" onclick="toggleKebab(this, event)">${ICONS.more}</button>
      <div class="kebab-menu" role="menu" hidden>
        ${items.map(i => `<button type="button" role="menuitem" class="${i.danger ? 'danger' : ''}" onclick="closeKebabs(); ${i.action}">${escHtml(i.label)}</button>`).join('')}
      </div>
    </div>`;
}
function closeKebabs() {
  document.querySelectorAll('.kebab-menu').forEach(m => { m.hidden = true; });
  document.querySelectorAll('.kebab-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
function toggleKebab(btn, ev) {
  ev.stopPropagation();
  const menu = btn.nextElementSibling;
  const open = menu.hidden;
  closeKebabs();
  if (open) {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus();
  }
}
document.addEventListener('click', closeKebabs);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeKebabs();
  if (document.getElementById('confirm-overlay').classList.contains('open')) closeConfirm(false);
  else if (document.getElementById('qr-overlay').classList.contains('open')) closeQr();
  else if (document.getElementById('schedule-panel').classList.contains('open')) closeSchedule();
  else if (document.body.classList.contains('nav-open')) setNavOpen(false);
});

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

// Los turnos cancelados no cuentan en contadores ni ingresos
const isActive = a => a.status !== 'cancelled';

// ── Cargar próximos turnos (un solo fetch) ───
async function loadAppointments() {
  const list = document.getElementById('appointments-list');

  try {
    const res = await fetch('/api/appointments?from=today');
    if (res.status === 402) { showPaywall(); return; }
    allAppointments = await res.json();

    const todayKey    = arDateKey();
    const tomorrowKey = arDateKey(new Date(Date.now() + 86400000));
    const todayAppts  = allAppointments.filter(a => apptDateKey(a) === todayKey && isActive(a));

    document.getElementById('stat-today').textContent   = todayAppts.length;
    document.getElementById('stat-pending').textContent  = allAppointments.filter(a => apptDateKey(a) === tomorrowKey && isActive(a)).length;
    document.getElementById('stat-revenue').textContent  = money(todayAppts.reduce((sum, a) => sum + (a.price || 0), 0));

    if (!selectedDateKey) selectedDateKey = todayKey;

    renderDayPills();
    renderAppointmentsForSelectedDay();
  } catch {
    list.innerHTML = `<p class="text-muted" style="text-align:center;padding:2rem">Error cargando turnos</p>`;
  }
}

// ── Selector de día (pills) ───────────────────
function renderDayPills() {
  const container = document.getElementById('day-pills');
  const now       = new Date();

  const pillsHtml = [];
  for (let i = 0; i < DAY_PILLS_COUNT; i++) {
    const key   = arDateKey(new Date(now.getTime() + i * 86400000));
    const dow   = new Date(key + 'T12:00:00').getDay();
    const label = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : DAY_ABBR_SHORT[dow];
    const dayNum  = Number(key.split('-')[2]);
    const count   = allAppointments.filter(a => apptDateKey(a) === key && isActive(a)).length;
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
// Acciones principales: WhatsApp al cliente y Asistió / No vino (hoy o antes). Cancelar va al "⋯".
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

  const summaryBar = `<div style="font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);padding:8px 0 12px;border-bottom:1px solid var(--border);margin-bottom:12px">CONFIRMADOS: ${confirmed} · CANCELADOS: ${cancelled} · TOTAL: ${money(total)}</div>`;
  const todayKey = arDateKey();

  list.innerHTML = summaryBar + appts.map(a => {
    const id       = Number(a.id);
    const name     = a.client_name || a.clientName || '—';
    const phone    = a.client_phone || a.clientPhone || '';
    const wa       = clientWaLink(a);
    const canMark  = isActive(a) && apptDateKey(a) <= todayKey;
    const badge    = a.status === 'confirmed' ? 'Confirmado' : a.status === 'pending' ? 'Pendiente' : 'Cancelado';
    const actions  = [];
    if (wa) actions.push(`<a class="btn-sm wa" href="${escHtml(wa)}" target="_blank" rel="noopener">${ICONS.chat} WhatsApp</a>`);
    if (canMark) {
      actions.push(`<button type="button" class="btn-sm att-yes" aria-pressed="${a.attendance === 'attended'}" onclick="setAttendance(${id}, 'attended')">${ICONS.check} Asistió</button>`);
      actions.push(`<button type="button" class="btn-sm att-no" aria-pressed="${a.attendance === 'no_show'}" onclick="setAttendance(${id}, 'no_show')">${ICONS.userX} No vino</button>`);
    }
    if (isActive(a)) actions.push(kebabHtml(`Más opciones del turno de ${name}`, [{ label: 'Cancelar turno', action: `cancelAppointment(${id})`, danger: true }]));

    return `
      <div class="card appt-card" id="appt-${id}">
        <div class="appt-top">
          <div>
            <div class="appt-name">${escHtml(name)}</div>
            <div class="appt-detail">${escHtml(a.service_name || a.service || 'Servicio')} · ${escHtml(phone || 'Sin teléfono')}</div>
          </div>
          <div>
            <div class="appt-time">${a.time ? escHtml(String(a.time).substring(0, 5)) : '—'}</div>
            <div class="appt-price">${money(a.price)}</div>
            <div style="text-align:right;margin-top:4px"><span class="badge badge-${escHtml(a.status)}">${badge}</span></div>
          </div>
        </div>
        ${actions.length ? `<div class="appt-actions">${actions.join('')}</div>` : ''}
      </div>`;
  }).join('');
}

function apptDayLabel(a) {
  const [y, m, d] = apptDateKey(a).split('-').map(Number);
  return `${DAY_NAMES[new Date(y, m - 1, d).getDay()].toLowerCase()} ${d}/${m}`;
}

// Desde el panel, el dueño le escribe al CLIENTE
function clientWaLink(a) {
  const phone = a.client_phone || a.clientPhone;
  if (!phone) return null;
  const name = String(a.client_name || '').trim();
  const hora = a.time ? String(a.time).substring(0, 5) : '';
  return waLink(phone, `Hola ${name}, te escribo de ${panelBizName || 'la barbería'} por tu turno del ${apptDayLabel(a)} ${hora}`.replace(/\s+/g, ' ').trim());
}

// ── Asistencia: tocar el mismo botón otra vez la desmarca ──
async function setAttendance(id, value) {
  const appt = allAppointments.find(a => Number(a.id) === id);
  if (!appt) return;
  const next = appt.attendance === value ? null : value;
  try {
    const res  = await fetch(`/api/appointments/${id}/attendance`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ attendance: next })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast('❌ ' + (data.error || 'No se pudo guardar la asistencia')); return; }
    appt.attendance = data.attendance ?? null;
    renderAppointmentsForSelectedDay();
  } catch {
    showToast('❌ Error de conexión');
  }
}

async function cancelAppointment(id) {
  const a = allAppointments.find(x => Number(x.id) === id);
  if (!a) return;
  const hora = a.time ? String(a.time).substring(0, 5) : '';
  const ok = await confirmDialog({
    title: `¿Cancelar el turno de ${a.client_name || 'este cliente'}?`,
    text:  `Es el ${apptDayLabel(a)} a las ${hora}. El horario vuelve a quedar libre para reservas.`,
    ok:    'Cancelar turno'
  });
  if (ok) updateStatus(id, 'cancelled');
}

async function updateStatus(id, status) {
  try {
    const res = await fetch(`/api/appointments/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) { showToast('❌ No se pudo actualizar el turno'); return; }
    showToast(status === 'confirmed' ? '✅ Turno confirmado' : 'Turno cancelado');
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
  document.getElementById('new-appt-date').min = arDateKey();

  try {
    const [barbersRes, servicesRes] = await Promise.all([
      fetch('/api/barbers'),
      fetch('/api/services')
    ]);
    const barbers  = await barbersRes.json();
    manualServices = await servicesRes.json();

    barberSelect.innerHTML = '<option value="">Seleccioná un barbero</option>' +
      barbers.map(b => `<option value="${Number(b.id)}">${escHtml(b.name)}</option>`).join('');
    serviceSelect.innerHTML = '<option value="">Seleccioná un servicio</option>' +
      manualServices.map(s => `<option value="${Number(s.id)}">${escHtml(s.name)} — ${money(s.price)}</option>`).join('');
  } catch {
    showToast('❌ Error cargando barberos/servicios');
  }
}

async function loadManualSlots() {
  const barberId  = document.getElementById('new-appt-barber').value;
  const serviceId = document.getElementById('new-appt-service').value;
  const date      = document.getElementById('new-appt-date').value;
  const grid      = document.getElementById('new-appt-slots');
  manualSelectedSlot = null;
  checkManualForm();

  // La grilla depende de la duración del servicio (misma lógica que valida el alta)
  if (!barberId || !serviceId || !date) {
    grid.innerHTML = '<p class="text-muted" style="grid-column:1/-1;font-size:13px">Elegí barbero, servicio y fecha</p>';
    return;
  }

  grid.innerHTML = '<p class="text-muted" style="grid-column:1/-1;font-size:13px">Cargando horarios...</p>';

  try {
    const res   = await fetch(`/api/appointments/slots/${date}?barber_id=${barberId}&service_id=${serviceId}`);
    const slots = await res.json();
    if (!res.ok || !Array.isArray(slots)) throw new Error();

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
        service_id:  Number(serviceId),   // el precio lo pone el servidor
        barberId:    Number(barberId),
        date,
        time:        manualSelectedSlot
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
// Mismos límites que services/validation.js (el backend vuelve a validar)
const SVC_PRICE_MIN = 1, SVC_PRICE_MAX = 10000000;
const SVC_DUR_MIN = 5, SVC_DUR_MAX = 480;
const isIntIn = (v, min, max) => /^\d+$/.test(String(v).trim()) && Number(v) >= min && Number(v) <= max;
function svcPriceError(v) {
  return isIntIn(v, SVC_PRICE_MIN, SVC_PRICE_MAX) ? null
    : `El precio tiene que ser un número entero entre $${SVC_PRICE_MIN.toLocaleString('es-AR')} y $${SVC_PRICE_MAX.toLocaleString('es-AR')}`;
}
function svcDurationError(v) {
  return isIntIn(v, SVC_DUR_MIN, SVC_DUR_MAX) ? null
    : `La duración tiene que ser un número entero de minutos entre ${SVC_DUR_MIN} y ${SVC_DUR_MAX}`;
}
// Primer error de un servicio (nombre, duración, precio) o null
function svcFormError(name, dur, price) {
  if (!name) return 'El nombre del servicio es obligatorio';
  return svcDurationError(dur) || svcPriceError(price);
}

let svcList = [];
let editingSvcId = null;

// Campos de servicio con label visible y unidad (min, $). prefix distingue alta de edición.
function svcFieldsHtml(prefix, s = {}) {
  const num = 'type="number" inputmode="numeric" step="1" class="no-spin" onwheel="this.blur()"';
  return `
    <div class="form-group svc-f-name">
      <label for="${prefix}-name">Nombre</label>
      <input type="text" id="${prefix}-name" maxlength="80" placeholder="Ej: Corte" value="${escHtml(s.name || '')}">
    </div>
    <div class="form-group">
      <label for="${prefix}-dur">Duración</label>
      <div class="unit-input"><input id="${prefix}-dur" ${num} min="${SVC_DUR_MIN}" max="${SVC_DUR_MAX}" placeholder="30" value="${s.duration ?? ''}"><span class="unit">min</span></div>
    </div>
    <div class="form-group">
      <label for="${prefix}-price">Precio</label>
      <div class="unit-input"><span class="unit">$</span><input id="${prefix}-price" ${num} min="${SVC_PRICE_MIN}" max="${SVC_PRICE_MAX}" placeholder="8000" value="${s.price ?? ''}"></div>
    </div>`;
}

async function renderServices() {
  const list = document.getElementById('services-list');
  list.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem">Cargando...</p>';
  try {
    const res = await fetch('/api/services/all'); // incluye los desactivados
    if (!res.ok) throw new Error();
    svcList = await res.json();
  } catch {
    list.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem">Error cargando servicios</p>';
    return;
  }
  editingSvcId = null;
  drawServices();
  activeServiceCount = svcList.filter(s => s.active).length;
  setPreviewService(svcList.find(s => s.active) || null); // vista previa de Personalización
  refreshChecklist();
}

function drawServices() {
  const rows = svcList.map(s => {
    const id = Number(s.id);
    if (id === editingSvcId) {
      return `
        <div class="service-row">
          <form class="svc-form" onsubmit="event.preventDefault(); saveService(${id})">
            ${svcFieldsHtml('edit-svc', s)}
            <div class="svc-form-actions">
              <button type="submit" class="btn btn-primary">Guardar</button>
              <button type="button" class="btn btn-outline" onclick="cancelEditService()">Cancelar</button>
            </div>
          </form>
        </div>`;
    }
    return `
      <div class="service-row ${s.active ? '' : 'row-off'}">
        <div>
          <div class="svc-name">${escHtml(s.name)}</div>
          <div class="svc-meta">${Number(s.duration)} min · ${money(s.price)}${s.active ? '' : ' · Desactivado'}</div>
        </div>
        <div class="row-actions">
          <button type="button" class="toggle ${s.active ? 'on' : ''}" role="switch" aria-checked="${!!s.active}"
                  aria-label="${escHtml(s.name)} visible en las reservas" onclick="toggleService(${id}, ${!!s.active})"></button>
          <button type="button" class="btn-sm" onclick="editService(${id})">${ICONS.pencil} Editar</button>
          ${kebabHtml(`Más opciones de ${s.name}`, [{ label: 'Borrar servicio', action: `deleteService(${id})`, danger: true }])}
        </div>
      </div>`;
  }).join('');

  document.getElementById('services-list').innerHTML = `
    ${rows || '<p class="text-muted">Todavía no cargaste servicios.</p>'}
    <div class="add-block">
      <p class="add-block-title">Agregar servicio</p>
      <form class="svc-form" onsubmit="event.preventDefault(); addService()">
        ${svcFieldsHtml('new-svc')}
        <div class="svc-form-actions"><button type="submit" class="btn btn-primary">+ Agregar servicio</button></div>
      </form>
    </div>`;
}

function editService(id) {
  editingSvcId = id;
  drawServices();
  document.getElementById('edit-svc-name')?.focus();
}

function cancelEditService() {
  editingSvcId = null;
  drawServices();
}

async function saveService(id) {
  const name  = document.getElementById('edit-svc-name').value.trim();
  const dur   = document.getElementById('edit-svc-dur').value;
  const price = document.getElementById('edit-svc-price').value;
  const err = svcFormError(name, dur, price);
  if (err) { showToast('❌ ' + err); return; }
  try {
    const res = await fetch(`/api/services/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, duration: Number(dur), price: Number(price) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast('❌ ' + (data.error || 'No se pudo guardar el servicio')); return; }
    showToast('✅ Servicio actualizado');
    renderServices();
  } catch {
    showToast('❌ Error de conexión');
  }
}

async function addService() {
  const name  = document.getElementById('new-svc-name').value.trim();
  const dur   = document.getElementById('new-svc-dur').value;
  const price = document.getElementById('new-svc-price').value;
  const err = svcFormError(name, dur, price);
  if (err) { showToast('❌ ' + err); return; }

  try {
    const res = await fetch('/api/services', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, duration: Number(dur), price: Number(price) })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); showToast('❌ ' + (e.error || 'No se pudo agregar')); return; }
    showToast('✅ Servicio agregado');
    renderServices();
  } catch {
    showToast('❌ Error al agregar servicio');
  }
}

async function deleteService(id) {
  const s = svcList.find(x => Number(x.id) === id);
  if (!s) return;
  const ok = await confirmDialog({
    title: `¿Borrar ${s.name}?`,
    text:  'Los turnos ya reservados no se tocan.',
    ok:    'Borrar'
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/services/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast('❌ ' + (data.error || 'No se pudo borrar el servicio')); return; }
    showToast('Servicio borrado');
    renderServices();
  } catch {
    showToast('❌ Error al borrar el servicio');
  }
}

async function toggleService(id, currentActive) {
  try {
    const res = await fetch(`/api/services/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ active: !currentActive })
    });
    if (!res.ok) { showToast('❌ No se pudo cambiar el estado'); return; }
    renderServices();
    showToast(currentActive ? '⏸ Servicio desactivado' : '✅ Servicio activado');
  } catch {
    showToast('❌ Error al cambiar estado');
  }
}

// ── Barberos (mismo patrón que Servicios) ────
let barberList = [];
let editingBarberId = null;

function barberFieldsHtml(prefix, b = {}) {
  return `
    <div class="form-group svc-f-name">
      <label for="${prefix}-name">Nombre</label>
      <input type="text" id="${prefix}-name" maxlength="60" placeholder="Ej: Martín" value="${escHtml(b.name || '')}">
    </div>
    <div class="form-group" style="grid-column:span 2">
      <label for="${prefix}-role">Rol</label>
      <input type="text" id="${prefix}-role" maxlength="50" placeholder="Barbero" value="${escHtml(b.role || '')}">
    </div>`;
}

async function renderBarbers() {
  const list = document.getElementById('barbers-list');
  list.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem">Cargando...</p>';

  try {
    const res  = await fetch('/api/barbers/all');
    barberList = await res.json();
    if (!res.ok || !Array.isArray(barberList)) throw new Error();
  } catch {
    barberList = [];
    list.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem">Error cargando barberos</p>';
    return;
  }
  editingBarberId = null;
  drawBarbers();

  // Sección Horarios: un acceso por barbero
  document.getElementById('schedule-barbers-list').innerHTML = barberList.length
    ? barberList.map(b => `
        <div class="service-row ${b.active ? '' : 'row-off'}">
          <div class="svc-name">${escHtml(b.name)}</div>
          <button class="btn-sm" onclick="openSchedule(${Number(b.id)})">${ICONS.clock} Editar horario</button>
        </div>`).join('')
    : '<p class="text-muted">Todavía no cargaste barberos. <a href="#barberos">Agregá uno</a>.</p>';
}

function drawBarbers() {
  const rows = barberList.map(b => {
    const id = Number(b.id);
    if (id === editingBarberId) {
      return `
        <div class="service-row">
          <form class="svc-form" onsubmit="event.preventDefault(); saveBarber(${id})">
            ${barberFieldsHtml('edit-barber', b)}
            <div class="svc-form-actions">
              <button type="submit" class="btn btn-primary">Guardar</button>
              <button type="button" class="btn btn-outline" onclick="cancelEditBarber()">Cancelar</button>
            </div>
          </form>
        </div>`;
    }
    return `
      <div class="service-row ${b.active ? '' : 'row-off'}">
        <div>
          <div class="svc-name">${escHtml(b.name)}</div>
          <div class="svc-meta">${escHtml(b.role || 'Barbero')}${b.active ? '' : ' · Desactivado'}</div>
        </div>
        <div class="row-actions">
          <button type="button" class="toggle ${b.active ? 'on' : ''}" role="switch" aria-checked="${!!b.active}"
                  aria-label="${escHtml(b.name)} activo" onclick="toggleBarber(${id}, ${!!b.active})"></button>
          <button type="button" class="btn-sm" onclick="editBarber(${id})">${ICONS.pencil} Editar</button>
          ${kebabHtml(`Más opciones de ${b.name}`, [
            { label: 'Horario', action: `openSchedule(${id})` },
            { label: 'Borrar barbero', action: `deleteBarber(${id})`, danger: true }
          ])}
        </div>
      </div>`;
  }).join('');

  document.getElementById('barbers-list').innerHTML = `
    ${rows || '<p class="text-muted">Todavía no cargaste barberos.</p>'}
    <div class="add-block">
      <p class="add-block-title">Agregar barbero</p>
      <form class="svc-form" onsubmit="event.preventDefault(); addBarber()">
        ${barberFieldsHtml('new-barber')}
        <div class="svc-form-actions"><button type="submit" class="btn btn-primary">+ Agregar barbero</button></div>
      </form>
    </div>`;
}

function editBarber(id) {
  editingBarberId = id;
  drawBarbers();
  document.getElementById('edit-barber-name')?.focus();
}

function cancelEditBarber() {
  editingBarberId = null;
  drawBarbers();
}

async function saveBarber(id) {
  const name = document.getElementById('edit-barber-name').value.trim();
  const role = document.getElementById('edit-barber-role').value.trim();
  if (!name) { showToast('❌ El nombre es obligatorio'); return; }
  try {
    const res = await fetch(`/api/barbers/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, role: role || 'Barbero' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast('❌ ' + (data.error || 'No se pudo guardar el barbero')); return; }
    showToast('✅ Barbero actualizado');
    renderBarbers();
  } catch {
    showToast('❌ Error de conexión');
  }
}

async function addBarber() {
  const name = document.getElementById('new-barber-name').value.trim();
  const role = document.getElementById('new-barber-role').value.trim();
  if (!name) { showToast('❌ El nombre es obligatorio'); return; }

  try {
    const res = await fetch('/api/barbers', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, role: role || 'Barbero' })
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); showToast('❌ ' + (err.error || 'No se pudo agregar')); return; }
    showToast('✅ Barbero agregado');
    renderBarbers();
  } catch {
    showToast('❌ Error al agregar barbero');
  }
}

async function deleteBarber(id) {
  const b = barberList.find(x => Number(x.id) === id);
  if (!b) return;
  const ok = await confirmDialog({
    title: `¿Borrar a ${b.name}?`,
    text:  'También se borra su horario. Si tiene turnos por delante no se va a poder borrar: en ese caso desactivalo.',
    ok:    'Borrar'
  });
  if (!ok) return;
  try {
    const res  = await fetch(`/api/barbers/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast('❌ ' + (data.error || 'No se pudo borrar el barbero')); return; }
    showToast('Barbero borrado');
    renderBarbers();
    refreshChecklist(true);
  } catch {
    showToast('❌ Error al borrar el barbero');
  }
}

async function toggleBarber(id, currentActive) {
  try {
    const res = await fetch(`/api/barbers/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ active: !currentActive })
    });
    if (!res.ok) { showToast('❌ No se pudo cambiar el estado'); return; }
    renderBarbers();
    refreshChecklist(true);
    showToast(currentActive ? '⏸ Barbero desactivado' : '✅ Barbero activado');
  } catch {
    showToast('❌ Error al cambiar estado');
  }
}

// ── Horarios (local y barberos): selects de 24 h, cada 15 minutos ──
const pad2 = n => String(n).padStart(2, '0');
const MINUTES = ['00', '15', '30', '45'];

// value "HH:MM"; si el minuto guardado no es múltiplo de 15 se agrega igual, para no perderlo
function timePickHtml(cls, value, label, disabled) {
  const [h, m] = String(value || '09:00').substring(0, 5).split(':');
  const mins = MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort();
  const opt  = (v, sel) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${v}</option>`;
  const dis  = disabled ? 'disabled' : '';
  return `
    <span class="time-pick ${cls}" role="group" aria-label="${label}">
      <select class="tp-h" aria-label="${label}: hora" ${dis}>${Array.from({ length: 24 }, (_, i) => opt(pad2(i), h)).join('')}</select>
      <span class="tp-colon" aria-hidden="true">:</span>
      <select class="tp-m" aria-label="${label}: minutos" ${dis}>${mins.map(v => opt(v, m)).join('')}</select>
    </span>`;
}

function readTime(dayEl, cls) {
  const w = dayEl.querySelector('.' + cls);
  return `${w.querySelector('.tp-h').value}:${w.querySelector('.tp-m').value}`;
}

// Un día del horario. d: { is_open, open_time, close_time, has_split, open_time_2, close_time_2 }
function scheduleDayHtml(dow, d) {
  const name   = DAY_NAMES[dow];
  const open   = !!d.is_open;
  const split  = !!d.has_split;
  const closed = !open;
  return `
    <div class="schedule-day ${split ? 'split' : ''} ${closed ? 'closed' : ''}" data-dow="${dow}">
      <div class="schedule-day-head">
        <button type="button" class="toggle sched-day-open ${open ? 'on' : ''}" role="switch" aria-checked="${open}"
                aria-label="Abierto el ${name.toLowerCase()}" onclick="toggleDayOpen(this)"></button>
        <span class="schedule-day-name">${name}</span>
        <label class="schedule-split-toggle">
          <button type="button" class="toggle toggle-sm sched-split ${split ? 'on' : ''}" role="switch" aria-checked="${split}"
                  aria-label="Horario partido el ${name.toLowerCase()}" onclick="toggleSplit(this)" ${closed ? 'disabled' : ''}></button>
          Partido
        </label>
      </div>
      <div class="schedule-franjas">
        <div class="schedule-franja-row">
          <span class="schedule-franja-num">1</span>
          ${timePickHtml('sched-open', d.open_time || '09:00', `${name}, desde`, closed)}
          <span class="schedule-sep">a</span>
          ${timePickHtml('sched-close', d.close_time || '18:00', `${name}, hasta`, closed)}
        </div>
        <div class="schedule-franja-row sched-franja-2">
          <span class="schedule-franja-num">2</span>
          ${timePickHtml('sched-open-2', d.open_time_2 || '16:00', `${name}, segundo tramo desde`, closed)}
          <span class="schedule-sep">a</span>
          ${timePickHtml('sched-close-2', d.close_time_2 || '20:00', `${name}, segundo tramo hasta`, closed)}
        </div>
      </div>
    </div>`;
}

function readScheduleDays(containerSel) {
  return Array.from(document.querySelectorAll(`${containerSel} .schedule-day`)).map(day => ({
    day_of_week:  Number(day.dataset.dow),
    is_open:      day.querySelector('.sched-day-open').classList.contains('on'),
    open_time:    readTime(day, 'sched-open'),
    close_time:   readTime(day, 'sched-close'),
    has_split:    day.querySelector('.sched-split').classList.contains('on'),
    open_time_2:  readTime(day, 'sched-open-2'),
    close_time_2: readTime(day, 'sched-close-2')
  }));
}

// Día desactivado: horarios deshabilitados y en gris
function toggleDayOpen(btn) {
  const open = !btn.classList.contains('on');
  btn.classList.toggle('on', open);
  btn.setAttribute('aria-checked', String(open));
  const day = btn.closest('.schedule-day');
  day.classList.toggle('closed', !open);
  day.querySelectorAll('select, .sched-split').forEach(el => { el.disabled = !open; });
}

function toggleSplit(btn) {
  const on = !btn.classList.contains('on');
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-checked', String(on));
  btn.closest('.schedule-day').classList.toggle('split', on);
}

async function openSchedule(barberId) {
  const barber = barberList.find(b => Number(b.id) === barberId);
  document.getElementById('schedule-barber-name').textContent = barber?.name || '';
  document.getElementById('schedule-panel').dataset.barberId = barberId;
  document.getElementById('schedule-days').innerHTML = '<p class="text-muted">Cargando...</p>';
  document.getElementById('schedule-overlay').classList.add('open');
  document.getElementById('schedule-panel').classList.add('open');

  try {
    const res      = await fetch(`/api/barbers/${barberId}/schedule`);
    const schedule = await res.json();
    const byDay    = {};
    schedule.forEach(s => byDay[s.day_of_week] = s);
    document.getElementById('schedule-days').innerHTML =
      DAYS_ORDER.map(dow => scheduleDayHtml(dow, byDay[dow] || { is_open: false })).join('');
    document.querySelector('#schedule-panel .config-close').focus();
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
  const schedule = readScheduleDays('#schedule-days');

  try {
    const res = await fetch(`/api/barbers/${barberId}/schedule`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ schedule })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast('❌ ' + (data.error || 'Error guardando horarios'));
      return;
    }
    showToast('✅ Horarios guardados');
    closeSchedule();
    refreshChecklist(true);
  } catch {
    showToast('❌ Error guardando horarios');
  }
}

// ── Suscripción / Trial (banner del inicio) ──
async function loadSubscriptionStatus() {
  const banner = document.getElementById('trial-banner');
  try {
    const res  = await fetch('/api/subscriptions/status');
    if (!res.ok) return;
    const data = await res.json();

    // Cortesía vigente: sin banner de prueba, solo un texto chico
    const note = document.getElementById('courtesy-note');
    note.hidden = !data.courtesy_active;
    if (data.courtesy_active) {
      note.textContent = 'Cuenta de cortesía' + (data.courtesy_until
        ? ` hasta ${new Date(data.courtesy_until).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`
        : '');
      banner.style.display = 'none';
    } else if (data.plan !== 'active' && data.trial_active) {
      const days = data.days_left;
      document.getElementById('trial-text').textContent =
        days === 1 ? 'Te queda 1 día de prueba' : `Te quedan ${days} días de prueba`;
      banner.classList.toggle('urgent', days <= 3); // 3 días o menos → color de alerta
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

// ── Toast ─────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function showPaywall() {
  document.body.classList.add('paywalled');
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
