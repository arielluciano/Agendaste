// ==============================
// Agendaste — Lógica del cliente (reserva en una pantalla)
// ==============================

const MONTHS    = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DOW_SHORT = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const DAYS_SHOWN = 6;
const PENDING_KEY = 'agendaste:pending-booking';

// ── Contexto del negocio ─────────────────────
const slug       = window.location.pathname.split('/').filter(Boolean)[0] || null;
const isEmbed    = document.documentElement.classList.contains('embed');
let businessId   = 1;

// Preselección desde la URL (?service=ID&barber=ID, ej. "Volver a reservar" en Mis turnos)
const urlParams    = new URLSearchParams(window.location.search);
const preServiceId = parseInt(urlParams.get('service'), 10) || null;
const preBarberId  = parseInt(urlParams.get('barber'), 10) || null;
// ?reschedule=ID: cambiar un turno existente (desde Mis turnos; requiere login, no aplica en embed)
const rescheduleId = isEmbed ? null : (parseInt(urlParams.get('reschedule'), 10) || null);
let rescheduleAppt = null;   // el turno original, si es del cliente y sigue vigente

function confirmLabel() { return rescheduleAppt ? 'Confirmar cambio' : 'Confirmar turno'; }

let services = [];
let barbers  = [];
let days     = [];      // próximos días hábiles del barbero elegido: [{ key, date }]

let selService = null;
let selBarber  = null;
let selDate    = null;
let selSlot    = null;
let slotsReq   = 0;     // para descartar respuestas viejas de /slots

// ── Datos del turno confirmado (para WhatsApp/Calendar) ──
let confBusinessName = '';
let confDay      = '';
let confTime     = '';
let confService  = '';
let confBarber   = '';
let confAddress  = '';
let confPhone    = '';
let confDate     = '';
let confPrice    = 0;

// ── Cliente logueado con Google ──────────────
let loggedClient = null;

// ── Utilidades ───────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function $(id) { return document.getElementById(id); }
function money(n) { return '$' + Number(n || 0).toLocaleString('es-AR'); }
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function longDay(key) {
  const d = parseKey(key);
  return `${DOW_SHORT[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

// ── Resolver negocio desde slug ──────────────
async function initBusiness() {
  if (!slug) return;
  try {
    const res = await fetch(`/api/business?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) {
      console.error(`[initBusiness] slug "${slug}" devolvió ${res.status}`);
      return;
    }
    const biz = await res.json();
    if (biz.id != null) {
      businessId = biz.id;
      confBusinessName = biz.name || '';
      confAddress      = biz.address || '';
      applyBusinessBrand(biz);
    } else {
      console.error('[initBusiness] respuesta sin id:', biz);
    }
  } catch (err) {
    console.error('[initBusiness] error de red:', err);
  }
}

// ── Marca del negocio ────────────────────────
function applyBusinessBrand(biz) {
  if (window.AgendasteBrand) AgendasteBrand.applyBrand(document.documentElement, biz);

  // Logo en el header (solo https; el backend ya lo valida al guardar)
  if (biz.logo_url && /^https:\/\//i.test(biz.logo_url)) {
    const brand = $('navbar-brand');
    const img   = document.createElement('img');
    img.className      = 'biz-logo';
    img.src            = biz.logo_url;
    img.alt            = biz.name || '';
    img.referrerPolicy = 'no-referrer';
    brand.replaceChildren(img);
    brand.href = `/${encodeURIComponent(slug)}`;
  }
}

// ── Modo embed: avisar la altura al sitio que nos embebe ──
function initEmbedHeight() {
  if (!isEmbed || window.parent === window) return;
  let last = 0;
  const send = () => {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (height === last) return;
    last = height;
    window.parent.postMessage({ type: 'agendaste:height', height }, '*');
  };
  new ResizeObserver(send).observe(document.body);
  send();
}

// ── Sesión del cliente ───────────────────────
// En un iframe de terceros el login de Google no funciona (Google no se deja embeber
// y la cookie de sesión no viaja): en embed se reserva como invitado.
async function checkClientLogin() {
  if (isEmbed) return;
  try {
    const data = await (await fetch('/auth/client/me')).json();
    if (data.loggedIn) {
      loggedClient = data.client;
      $('btn-logout-client').style.display = '';
      $('link-mis-turnos').style.display = '';
    }
  } catch {}
}

// Datos del formulario según el modo: invitado (embed), logueado, o sin loguear (se pide Google al confirmar)
function renderClientFields() {
  const guest = isEmbed;
  $('group-name').style.display  = guest ? '' : 'none';
  $('group-email').style.display = guest ? '' : 'none';
  $('login-hint').style.display  = !guest && !loggedClient ? '' : 'none';
  const who = $('who');
  if (loggedClient) {
    who.innerHTML = `Reservás como <strong>${esc(loggedClient.name || loggedClient.email)}</strong>` +
      (loggedClient.name && loggedClient.email ? ` · ${esc(loggedClient.email)}` : '');
    who.style.display = '';
  } else {
    who.style.display = 'none';
  }
}

// Modo reprogramar: buscar el turno original entre los próximos del cliente
async function initReschedule() {
  if (!rescheduleId || !loggedClient) return;
  let a = null;
  try {
    const data = await (await fetch('/api/appointments/mine')).json();
    a = (data.upcoming || []).find(x => x.id === rescheduleId && x.status !== 'cancelled') || null;
  } catch {}

  const banner = $('resched-banner');
  banner.style.display = '';
  rescheduleAppt = a;
  $('btn-confirm').textContent = confirmLabel();
  if (!a) {
    // No es del cliente, ya pasó o está cancelado: se reserva como turno nuevo
    banner.textContent = 'No encontramos el turno a cambiar. Esta reserva va a ser un turno nuevo.';
    return;
  }
  banner.innerHTML = `Estás cambiando tu turno del <strong>${esc(longDay(String(a.date).split('T')[0]))} ${esc(String(a.time).substring(0, 5))}</strong>`;
  if (a.client_phone && !$('inp-phone').value) $('inp-phone').value = a.client_phone;
}

function endReschedule() {
  rescheduleAppt = null;
  $('resched-banner').style.display = 'none';
  $('btn-confirm').textContent = confirmLabel();
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('reschedule');
    history.replaceState(null, '', url.pathname + url.search);
  } catch {}
}

// ── Servicios ────────────────────────────────
async function loadServices() {
  try {
    const res = await fetch(`/api/services?business_id=${businessId}`);
    services  = await res.json();
    if (!Array.isArray(services)) services = [];
  } catch {
    services = [];
  }
  selService = services.find(s => s.id === preServiceId) || services[0] || null;
  renderServices();
}

function renderServices() {
  const el = $('services');
  if (services.length === 0) { el.innerHTML = '<p class="block-empty">No hay servicios disponibles</p>'; return; }
  el.innerHTML = services.map(s => `
    <button type="button" class="pill ${selService?.id === s.id ? 'selected' : ''}" aria-pressed="${selService?.id === s.id}"
            onclick="selectService(${Number(s.id)})">
      ${esc(s.name)} <small>${money(s.price)}</small>
    </button>`).join('');
}

function selectService(id) {
  selService = services.find(s => s.id === id) || null;
  renderServices();
  loadSlots();
}

// ── Barberos ─────────────────────────────────
async function loadBarbers() {
  try {
    const res = await fetch(`/api/barbers?business_id=${businessId}&with_schedule=1`);
    barbers   = await res.json();
    if (!Array.isArray(barbers)) barbers = [];
  } catch {
    barbers = [];
  }
  selBarber = barbers.find(b => b.id === preBarberId) || barbers[0] || null;
  renderBarbers();
}

function renderBarbers() {
  const el = $('barbers');
  if (barbers.length === 0) { el.innerHTML = '<p class="block-empty">No hay barberos disponibles</p>'; return; }
  el.innerHTML = barbers.map(b => `
    <button type="button" class="pill ${selBarber?.id === b.id ? 'selected' : ''}" aria-pressed="${selBarber?.id === b.id}"
            onclick="selectBarber(${Number(b.id)})">${esc(b.name)}</button>`).join('');
}

async function selectBarber(id) {
  selBarber = barbers.find(b => b.id === id) || null;
  renderBarbers();
  await loadDays();
  await pickFirstAvailableDay();
}

// ── Días: los próximos 6 en que atiende el barbero ──
async function loadDays() {
  days = [];
  if (!selBarber) { renderDays(); return; }
  let open = [];
  try {
    const sched = await (await fetch(`/api/barbers/${selBarber.id}/schedule?business_id=${businessId}`)).json();
    open = (Array.isArray(sched) ? sched : []).filter(r => r.is_open).map(r => Number(r.day_of_week));
  } catch {}
  const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 60 && days.length < DAYS_SHOWN && open.length; i++) {
    if (open.includes(d.getDay())) days.push({ key: dateKey(d), date: new Date(d) });
    d.setDate(d.getDate() + 1);
  }
  renderDays();
}

function renderDays() {
  const el = $('days');
  if (days.length === 0) {
    el.innerHTML = '<p class="block-empty" style="grid-column:1/-1">No hay días con atención próximamente</p>';
    return;
  }
  const todayKey = dateKey(new Date());
  el.innerHTML = days.map(d => {
    const sel = d.key === selDate;
    const dow = d.key === todayKey ? 'Hoy' : DOW_SHORT[d.date.getDay()];
    return `<button type="button" class="day ${sel ? 'selected' : ''}" aria-pressed="${sel}"
                    aria-label="${esc(longDay(d.key))}" onclick="selectDay('${d.key}')">
              <span class="dow">${dow}</span><span class="num">${d.date.getDate()}</span>
            </button>`;
  }).join('');
}

function selectDay(key) {
  selDate = key;
  renderDays();
  loadSlots();
}

// Elige el primer día (de los 6) que tenga algún horario libre; si ninguno, el primero
async function pickFirstAvailableDay() {
  selDate = null; selSlot = null;
  for (const d of days) {
    const slots = await fetchSlots(d.key);
    if (slots.some(s => s.available)) { selDate = d.key; break; }
  }
  if (!selDate && days.length) selDate = days[0].key;
  renderDays();
  await loadSlots();
}

// ── Horarios disponibles (desde la API) ──────
async function fetchSlots(key) {
  if (!selBarber) return [];
  const res   = await fetch(`/api/appointments/slots/${key}?barber_id=${selBarber.id}&business_id=${businessId}`);
  const slots = await res.json();
  if (!Array.isArray(slots)) return [];
  // Hoy: no mostrar los horarios que ya pasaron
  if (key !== dateKey(new Date())) return slots;
  const now = new Date();
  return slots.filter(s => {
    const [h, m] = s.time.split(':').map(Number);
    const t = new Date(); t.setHours(h, m, 0, 0);
    return t > now;
  });
}

async function loadSlots() {
  selSlot = null;
  updateSummary();
  const el  = $('slots');
  const req = ++slotsReq;
  if (!selDate) { el.innerHTML = '<p class="block-empty" style="grid-column:1/-1">Elegí un día</p>'; return; }
  el.innerHTML = '<p class="block-empty" style="grid-column:1/-1">Cargando horarios...</p>';
  try {
    const slots = await fetchSlots(selDate);
    if (req !== slotsReq) return;
    renderSlots(slots);
  } catch {
    if (req === slotsReq) el.innerHTML = '<p class="block-empty" style="grid-column:1/-1">Error cargando horarios</p>';
  }
}

let currentSlots = [];
function renderSlots(slots) {
  currentSlots = slots || currentSlots;
  const el = $('slots');
  if (currentSlots.length === 0) {
    el.innerHTML = '<p class="block-empty" style="grid-column:1/-1">No hay horarios para este día</p>';
    return;
  }
  el.innerHTML = currentSlots.map(s => {
    if (!s.available) return `<button type="button" class="slot" disabled aria-label="${esc(s.time)} ocupado">${esc(s.time)}</button>`;
    const sel = s.time === selSlot;
    return `<button type="button" class="slot ${sel ? 'selected' : ''}" aria-pressed="${sel}" onclick="selectSlot('${esc(s.time)}')">${esc(s.time)}</button>`;
  }).join('');
}

function selectSlot(time) {
  selSlot = time;
  renderSlots();
  updateSummary();
}

// ── Tarjeta "Tu turno" ───────────────────────
function updateSummary() {
  $('sum-svc').textContent    = selService?.name || '—';
  $('sum-barber').textContent = selBarber?.name || '—';
  $('sum-day').textContent    = selDate ? longDay(selDate) : '—';
  const t = $('sum-time');
  t.textContent = selSlot || 'Elegí un horario';
  t.classList.toggle('pending', !selSlot);
  const total = selService ? money(selService.price) : '—';
  $('sum-price').textContent = total;
  $('mb-total').textContent  = total;
  validate();
}

function showBookingError(msg) {
  const box = $('booking-error');
  box.textContent = msg || '';
  box.classList.toggle('show', !!msg);
}

// Mismo criterio que EMAIL_RE en routes/appointments.js
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function guestEmail() {
  if (!isEmbed) return null; // fuera del embed el email sale de la sesión de Google
  return $('inp-email').value.trim();
}

function clientName() {
  if (isEmbed) return $('inp-name').value.trim();
  return String(loggedClient?.name || loggedClient?.email?.split('@')[0] || '').trim().slice(0, 60);
}

// Mismas reglas que el backend: nombre 2-60, teléfono 8-15 dígitos, email opcional válido
function formValid() {
  const phoneDigits = $('inp-phone').value.replace(/\D/g, '');
  if (phoneDigits.length < 8 || phoneDigits.length > 15) return false;
  if (isEmbed) {
    const name = clientName();
    if (name.length < 2 || name.length > 60) return false;
    const email = guestEmail();
    if (email && !EMAIL_RE.test(email)) return false;
  }
  return true;
}

function validate() {
  $('btn-confirm').disabled = !(selService && selBarber && selDate && selSlot && formValid());
}

// El aviso de email inválido recién al salir del campo, no mientras escribe
function checkEmailOnBlur() {
  const email = guestEmail();
  if (email && !EMAIL_RE.test(email)) showBookingError('❌ El email no es válido');
  else showBookingError('');
}

// Barra de abajo en el celular → llevar a la tarjeta
function goToTicket() {
  $('ticket').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const first = !selSlot ? null : ['inp-name', 'inp-phone', 'inp-email']
    .map($).find(i => i.offsetParent !== null && !i.value.trim());
  if (first) setTimeout(() => first.focus({ preventScroll: true }), 400);
}

// ── Login con Google al confirmar (fuera del embed) ──
function savePendingAndLogin() {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      slug, serviceId: selService.id, barberId: selBarber.id, date: selDate, time: selSlot,
      phone: $('inp-phone').value.trim(), at: Date.now()
    }));
  } catch {}
  const next = window.location.pathname + window.location.search;
  window.location.href = `/auth/client/google?next=${encodeURIComponent(next)}`;
}

function takePending() {
  let p = null;
  try {
    p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    sessionStorage.removeItem(PENDING_KEY);
  } catch {}
  if (!p || p.slug !== slug || Date.now() - p.at > 30 * 60 * 1000) return null;
  return p;
}

// Vuelta del login: restaurar lo elegido y completar la reserva
async function resumePending(p) {
  const svc = services.find(s => s.id === p.serviceId);
  const brb = barbers.find(b => b.id === p.barberId);
  if (svc) { selService = svc; renderServices(); }
  if (brb && brb !== selBarber) { selBarber = brb; renderBarbers(); await loadDays(); }
  $('inp-phone').value = p.phone || '';
  if (days.some(d => d.key === p.date)) {
    selDate = p.date; renderDays();
    await loadSlots();
  } else {
    await pickFirstAvailableDay();
  }
  if (selDate === p.date && currentSlots.some(s => s.time === p.time && s.available)) {
    selectSlot(p.time);
    if (!$('btn-confirm').disabled) { confirmBooking(); return; }
  } else {
    showBookingError('❌ Ese horario ya no está disponible. Elegí otro.');
  }
  goToTicket();
}

// ── Confirmar turno (llama a la API) ─────────
async function confirmBooking() {
  if (!(selService && selBarber && selDate && selSlot && formValid())) return;
  if (!isEmbed && !loggedClient) { savePendingAndLogin(); return; }

  const name  = clientName();
  const phone = $('inp-phone').value.trim();
  const btn   = $('btn-confirm');

  btn.disabled = true;
  btn.textContent = 'Confirmando...';
  showBookingError('');

  const rescheduling = !!rescheduleAppt;
  try {
    const res = await fetch(rescheduling ? `/api/appointments/${rescheduleAppt.id}/reschedule` : '/api/appointments', {
      method:  rescheduling ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName:  name,
        clientPhone: phone,
        clientEmail: loggedClient?.email || guestEmail() || null,
        service_id:  selService.id,   // el precio lo pone el servidor
        barberId:    selBarber.id,
        date:        selDate,
        time:        selSlot,
        businessId,
        website:     $('inp-website').value
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showBookingError('❌ ' + (err.error || 'No se pudo confirmar el turno. Probá de nuevo.'));
      btn.textContent = confirmLabel();
      validate();
      // Si el horario se ocupó mientras tanto, refrescar la grilla
      if (res.status === 409) { const keep = selSlot; await loadSlots(); if (currentSlots.some(s => s.time === keep && s.available)) selectSlot(keep); }
      return;
    }

    confDate    = selDate;
    confDay     = longDay(selDate);
    confTime    = selSlot;
    confService = selService.name;
    confBarber  = selBarber.name;
    confPhone   = phone;
    confPrice   = selService.price;

    $('conf-day').textContent     = confDay;
    $('conf-time').textContent    = confTime;
    $('conf-svc').textContent     = confService;
    $('conf-barber').textContent  = confBarber;
    $('conf-name').textContent    = name;
    $('conf-price').textContent   = money(confPrice);
    $('conf-address').textContent = confAddress || '—';

    $('done-title').textContent = rescheduling ? '¡Turno reprogramado!' : '¡Turno confirmado!';
    if (rescheduleId) endReschedule();
    $('booking').style.display = 'none';
    $('done').style.display    = '';
    document.body.classList.remove('has-bar');
    $('mobile-bar').style.display = 'none';
    window.scrollTo({ top: 0 });
    btn.textContent = confirmLabel();
  } catch {
    showBookingError('❌ Error de conexión');
    btn.textContent = confirmLabel();
    validate();
  }
}

// ── Google Calendar (link directo) ───────────
function addToGCal() {
  const [y, m, d] = confDate.split('-').map(Number);
  const [h, min]  = confTime.split(':').map(Number);
  const start = new Date(y, m - 1, d, h, min);
  const end   = new Date(start.getTime() + 30 * 60000);
  const fmt   = dt => dt.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';

  const title       = encodeURIComponent(`✂️ Turno — ${confService}`);
  const addressLine = confAddress ? `Dirección: ${confAddress}\n` : '';
  const details     = encodeURIComponent(
    `Servicio: ${confService}\n` +
    `Barbero: ${confBarber}\n` +
    `Precio: ${money(confPrice)}\n` +
    addressLine +
    `\nReservado via Agendaste`
  );

  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE`
    + `&text=${title}`
    + `&dates=${fmt(start)}/${fmt(end)}`
    + `&details=${details}`;

  window.open(url, '_blank');
}

// ── Compartir por WhatsApp ───────────────────
function shareWhatsApp() {
  const message =
    `✂️ ¡Turno confirmado en ${confBusinessName || 'Agendaste'}!\n` +
    `📅 Fecha: ${confDay}\n` +
    `⏰ Hora: ${confTime}\n` +
    `💈 Servicio: ${confService}\n` +
    `👤 Profesional: ${confBarber}\n` +
    (confAddress ? `📍 Dirección: ${confAddress}\n` : '') +
    `\nReservado via Agendaste`;

  const phoneDigits = confPhone.replace(/\D/g, '');
  const url = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;

  window.open(url, '_blank');
}

async function resetBooking() {
  $('done').style.display    = 'none';
  $('booking').style.display = '';
  $('mobile-bar').style.display = '';
  if (!isEmbed) document.body.classList.add('has-bar');
  showBookingError('');
  // El horario recién reservado ya no está libre: volver a elegir el primer día con lugar
  selService = services[0] || null;
  renderServices();
  await pickFirstAvailableDay();
}

// ── Init ──────────────────────────────────────
(async () => {
  initEmbedHeight();
  if (!isEmbed) document.body.classList.add('has-bar');
  updateSummary();
  await initBusiness();
  await checkClientLogin();
  renderClientFields();
  await Promise.all([loadServices(), loadBarbers(), initReschedule()]);

  // Sin ningún barbero con horario cargado no hay nada que reservar
  if (barbers.length === 0) {
    $('booking').style.display = 'none';
    $('mobile-bar').style.display = 'none';
    document.body.classList.remove('has-bar');
    $('no-hours').style.display = '';
    return;
  }
  await loadDays();

  const pending = !isEmbed && loggedClient ? takePending() : null;
  if (pending) await resumePending(pending);
  else await pickFirstAvailableDay();
})();
