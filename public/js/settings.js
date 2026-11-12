// ==============================
// Agendaste — Configuración del negocio
// ==============================

const DAY_NAMES  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Lun→Dom

// ── Navbar / sesión ───────────────────────────
async function loadUser() {
  try {
    const res  = await fetch('/auth/me');
    const data = await res.json();
    if (data.loggedIn) {
      document.getElementById('user-area').innerHTML = `
        <div class="user-pill">
          <img src="${data.user.picture}" alt="${data.user.name}">
          <span>${data.user.name}</span>
          <a href="/auth/logout" class="btn btn-outline" style="font-size:12px;padding:5px 10px">Salir</a>
        </div>`;
    }
  } catch {
    // si falla, el navbar simplemente queda sin el pill de usuario
  }
}

// ── Menú lateral / secciones ──────────────────
function showSection(name) {
  document.querySelectorAll('.settings-menu-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
  document.querySelector(`.settings-menu-item[data-section="${name}"]`).classList.add('active');
  document.getElementById('section-' + name).classList.add('active');
}

// ── Mi negocio ─────────────────────────────────
async function loadBusiness() {
  try {
    const res  = await fetch('/api/business');
    const data = await res.json();
    document.getElementById('biz-name').value        = data.name        || '';
    document.getElementById('biz-address').value     = data.address     || '';
    document.getElementById('biz-phone').value       = data.phone       || '';
    document.getElementById('biz-description').value = data.description || '';
    document.getElementById('biz-cancel-hours').value = data.cancel_min_hours ?? 2;
    if (data.address) showMapPreview(data.address);
    renderBizSchedule(data.schedule);

    if (data.slug) {
      const link = `${window.location.origin}/${data.slug}`;
      document.getElementById('business-link').value = link;
      document.getElementById('business-link-container').style.display = 'block';
      document.getElementById('embed-snippet').value =
        `<div data-agendaste="${data.slug}"></div>\n<script src="${window.location.origin}/embed.js" async></script>`;
    }
    fillBrandForm(data);
  } catch {
    showToast('❌ Error cargando configuración');
  }
}

function showMapPreview(address) {
  const encoded = encodeURIComponent(address);
  document.getElementById('map-frame').innerHTML =
    `<iframe src="https://maps.google.com/maps?q=${encoded}&output=embed&hl=es&z=15"
       allowfullscreen loading="lazy"></iframe>`;
  document.getElementById('map-preview').style.display = 'block';
}

function copyLink() {
  const link = document.getElementById('business-link').value;
  navigator.clipboard.writeText(link);
  showToast('✅ Link copiado!');
}

async function saveBusiness() {
  const name        = document.getElementById('biz-name').value.trim();
  const address     = document.getElementById('biz-address').value.trim();
  const phone       = document.getElementById('biz-phone').value.trim();
  const description = document.getElementById('biz-description').value.trim();
  const schedule    = readBizSchedule();
  const cancelRaw   = document.getElementById('biz-cancel-hours').value.trim();
  const cancel_min_hours = cancelRaw === '' ? 0 : Number(cancelRaw);
  if (!Number.isInteger(cancel_min_hours) || cancel_min_hours < 0 || cancel_min_hours > 720) {
    showToast('❌ Las horas para cancelar tienen que ser un número entero entre 0 y 720');
    return;
  }

  try {
    const res = await fetch('/api/business', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, address, phone, description, schedule, cancel_min_hours })
    });
    if (!res.ok) { const err = await res.json(); showToast('❌ ' + err.error); return; }
    showToast('✅ Configuración guardada');
    if (address) showMapPreview(address);
  } catch {
    showToast('❌ Error guardando configuración');
  }
}

// ── Personalización (marca) ────────────────────
const BRAND_DEFAULTS = { brand_primary: '#9A3412', brand_bg: '#F8F7F4', brand_text: '#1A1A17' };
const BRAND_COLOR_IDS = { brand_primary: 'brand-primary', brand_bg: 'brand-bg', brand_text: 'brand-text' };
let brandBizName = '';
let brandLogoUrl = null; // lo manejan /api/business/logo (subir/quitar), no el form

function toPickerHex(hex) {
  // <input type=color> solo acepta #RRGGBB
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) return '#' + hex.slice(1).split('').map(c => c + c).join('');
  return hex;
}

function fillBrandForm(data) {
  brandBizName = data.name || '';
  const fontSel = document.getElementById('brand-font');
  if (fontSel.options.length === 1) {
    AgendasteBrand.FONTS.forEach(f => fontSel.add(new Option(f, f)));
  }

  Object.entries(BRAND_COLOR_IDS).forEach(([key, id]) => {
    const color = document.getElementById(id + '-color');
    const text  = document.getElementById(id + '-text');
    text.value  = data[key] || '';
    color.value = toPickerHex(data[key] || BRAND_DEFAULTS[key]);
    color.oninput = () => { text.value = color.value.toUpperCase(); onBrandInput(); };
    text.oninput  = () => {
      const v = text.value.trim();
      if (AgendasteBrand.isHex(v)) color.value = toPickerHex(v);
      onBrandInput();
    };
  });
  fontSel.value = data.brand_font || '';
  setLogo(data.logo_url || null);
}

function readBrandForm() {
  const val = id => document.getElementById(id).value.trim();
  return {
    brand_primary: val('brand-primary-text') || null,
    brand_bg:      val('brand-bg-text')      || null,
    brand_text:    val('brand-text-text')    || null,
    brand_font:    val('brand-font')         || null
  };
}

// ── Logo ──────────────────────────────────────
const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_TYPES     = ['image/png', 'image/jpeg', 'image/webp'];

function setLogo(url) {
  brandLogoUrl = url;
  const img   = document.getElementById('logo-thumb-img');
  const empty = document.getElementById('logo-thumb-empty');
  if (url) img.src = url; else img.removeAttribute('src');
  img.hidden   = !url;
  empty.hidden = !!url;
  document.getElementById('btn-remove-logo').hidden = !url;
  onBrandInput(); // la vista previa usa brandLogoUrl
}

function setLogoStatus(msg, isError = false) {
  const el = document.getElementById('logo-status');
  el.textContent = msg || '';
  el.classList.toggle('error', isError);
}

function setLogoBusy(busy) {
  document.getElementById('logo-file').disabled = busy;
  document.getElementById('btn-upload-logo').setAttribute('aria-disabled', busy ? 'true' : 'false');
  document.getElementById('btn-remove-logo').disabled = busy;
}

async function uploadLogo(input) {
  const file = input.files && input.files[0];
  input.value = ''; // permite volver a elegir el mismo archivo
  if (!file) return;

  // Chequeos rápidos en el navegador (el servidor igual valida el contenido real)
  if (file.size > LOGO_MAX_BYTES) {
    setLogoStatus(`❌ El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El máximo es 5 MB.`, true);
    return;
  }
  // Algunos celulares no informan el tipo: en ese caso decide el servidor por el contenido
  if (file.type && !LOGO_TYPES.includes(file.type)) {
    setLogoStatus('❌ Formato no permitido. Subí un PNG, JPG o WebP.', true);
    return;
  }

  const form = new FormData();
  form.append('logo', file);
  setLogoBusy(true);
  setLogoStatus('Subiendo…');
  try {
    const res  = await fetch('/api/business/logo', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setLogoStatus('❌ ' + (data.error || 'No se pudo subir el logo'), true); return; }
    setLogo(data.logo_url);
    setLogoStatus('✅ Logo actualizado');
  } catch {
    setLogoStatus('❌ Error de conexión. Probá de nuevo.', true);
  } finally {
    setLogoBusy(false);
  }
}

async function removeLogo() {
  setLogoBusy(true);
  setLogoStatus('Quitando…');
  try {
    const res  = await fetch('/api/business/logo', { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setLogoStatus('❌ ' + (data.error || 'No se pudo quitar el logo'), true); return; }
    setLogo(null);
    setLogoStatus('Logo quitado');
  } catch {
    setLogoStatus('❌ Error de conexión. Probá de nuevo.', true);
  } finally {
    setLogoBusy(false);
  }
}

function resetBrandColor(key) {
  const id = BRAND_COLOR_IDS[key];
  document.getElementById(id + '-text').value  = '';
  document.getElementById(id + '-color').value = BRAND_DEFAULTS[key];
  onBrandInput();
}

// Preview en vivo: aplica la marca sobre el contenedor de la preview
function onBrandInput() {
  const brand   = { ...readBrandForm(), logo_url: brandLogoUrl };
  const preview = document.getElementById('brand-preview');
  AgendasteBrand.applyBrand(preview, brand);

  const head = document.getElementById('brand-preview-head');
  head.replaceChildren();
  if (brand.logo_url && /^https:\/\//i.test(brand.logo_url)) {
    const img = document.createElement('img');
    img.src = brand.logo_url;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => img.remove();
    head.appendChild(img);
  }
  head.appendChild(document.createTextNode(brandBizName || 'Tu negocio'));
}

// La preview muestra el primer servicio activo real del negocio (nombre, precio y duración)
async function loadPreviewService() {
  const set = (id, text) => { document.getElementById(id).textContent = text; };
  let svc = null;
  try {
    // Sin business_id usa el negocio de la sesión; devuelve solo los activos, ordenados por id
    const res = await fetch('/api/services');
    if (res.ok) svc = (await res.json()).find(s => s.active) || null;
  } catch {}
  if (!svc) {
    set('preview-svc-name', 'Todavía no tenés servicios activos');
    set('preview-svc-price', '');
    set('preview-svc-dur', 'Cargalos desde el panel');
    return;
  }
  set('preview-svc-name', svc.name);
  set('preview-svc-price', '$' + Number(svc.price || 0).toLocaleString('es-AR'));
  set('preview-svc-dur', `${svc.duration} min`);
}

async function saveBrand() {
  const brand = readBrandForm();
  for (const key of Object.keys(BRAND_COLOR_IDS)) {
    if (brand[key] && !AgendasteBrand.isHex(brand[key])) { showToast('❌ Los colores tienen que ser hex, ej: #9A3412'); return; }
  }

  try {
    const res = await fetch('/api/business/brand', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(brand)
    });
    if (!res.ok) { const err = await res.json(); showToast('❌ ' + err.error); return; }
    showToast('✅ Personalización guardada');
  } catch {
    showToast('❌ Error guardando la personalización');
  }
}

function copyEmbedSnippet() {
  navigator.clipboard.writeText(document.getElementById('embed-snippet').value);
  showToast('✅ Código copiado!');
}

// ── Horario del local ──────────────────────────
function renderBizSchedule(schedule) {
  const byDay = {};
  (schedule || []).forEach(s => byDay[s.day_of_week] = s);

  document.getElementById('biz-schedule-days').innerHTML = DAYS_ORDER.map(dow => {
    const d      = byDay[dow] || { is_open: false, open_time: '09:00', close_time: '18:00' };
    const open   = (d.open_time    || '09:00').substring(0, 5);
    const close  = (d.close_time   || '18:00').substring(0, 5);
    const open2  = (d.open_time_2  || '16:00').substring(0, 5);
    const close2 = (d.close_time_2 || '20:00').substring(0, 5);
    const split  = !!d.has_split;
    return `
      <div class="schedule-day ${split ? 'split' : ''}" data-dow="${dow}">
        <div class="schedule-day-head">
          <button class="toggle biz-sched-open-day ${d.is_open ? 'on' : ''}" onclick="this.classList.toggle('on')"></button>
          <span class="schedule-day-name">${DAY_NAMES[dow]}</span>
          <label class="schedule-split-toggle">
            <button type="button" class="toggle toggle-sm biz-sched-split ${split ? 'on' : ''}" onclick="toggleBizSplit(this)" title="Horario partido"></button>
            Partido
          </label>
        </div>
        <div class="schedule-franjas">
          <div class="schedule-franja-row">
            <span class="schedule-franja-num">1</span>
            <input type="time" class="biz-sched-open"  value="${open}">
            <span class="schedule-sep">a</span>
            <input type="time" class="biz-sched-close" value="${close}">
          </div>
          <div class="schedule-franja-row sched-franja-2">
            <span class="schedule-franja-num">2</span>
            <input type="time" class="biz-sched-open-2"  value="${open2}">
            <span class="schedule-sep">a</span>
            <input type="time" class="biz-sched-close-2" value="${close2}">
          </div>
        </div>
      </div>`;
  }).join('');
}

function toggleBizSplit(btn) {
  btn.classList.toggle('on');
  btn.closest('.schedule-day').classList.toggle('split', btn.classList.contains('on'));
}

function readBizSchedule() {
  const days = document.querySelectorAll('#biz-schedule-days .schedule-day');
  return Array.from(days).map(day => {
    const split = day.querySelector('.biz-sched-split').classList.contains('on');
    return {
      day_of_week:  Number(day.dataset.dow),
      is_open:      day.querySelector('.biz-sched-open-day').classList.contains('on'),
      open_time:    day.querySelector('.biz-sched-open').value,
      close_time:   day.querySelector('.biz-sched-close').value,
      has_split:    split,
      open_time_2:  split ? day.querySelector('.biz-sched-open-2').value  : null,
      close_time_2: split ? day.querySelector('.biz-sched-close-2').value : null
    };
  });
}

async function applyScheduleToBarbers() {
  const schedule = readBizSchedule();
  try {
    const res = await fetch('/api/barbers/apply-schedule', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ schedule })
    });
    const data = await res.json();
    if (!res.ok) { showToast('❌ ' + (data.error || 'Error aplicando horario')); return; }
    showToast(`✅ Horario aplicado a ${data.barbersUpdated} barbero${data.barbersUpdated === 1 ? '' : 's'}`);
  } catch {
    showToast('❌ Error aplicando horario a los barberos');
  }
}

// ── Suscripción ─────────────────────────────────
async function loadSubscriptionStatus() {
  const card = document.getElementById('sub-card');
  try {
    const res = await fetch('/api/subscriptions/status');
    if (!res.ok) {
      card.innerHTML = '<p class="text-muted" style="padding:1rem 0">Error cargando la suscripción</p>';
      return;
    }
    renderSubscription(await res.json());
  } catch {
    card.innerHTML = '<p class="text-muted" style="padding:1rem 0">Error cargando la suscripción</p>';
  }
}

function renderSubscription(data) {
  const card = document.getElementById('sub-card');

  const accessUntilDate = data.access_until ? new Date(data.access_until) : null;
  const hasGraceAccess   = accessUntilDate && accessUntilDate.getTime() > Date.now();

  // Cortesía vigente: acceso completo sin cobro → sin botón de suscribirse
  if (data.courtesy_active) {
    const until = data.courtesy_until
      ? ` hasta el <strong>${new Date(data.courtesy_until).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</strong>`
      : '';
    card.innerHTML = `
      <span class="badge badge-confirmed">CUENTA DE CORTESÍA</span>
      <p style="margin:.75rem 0 0;font-size:14px">Tenés acceso completo sin cargo${until}.</p>`;
    return;
  }

  if (data.plan === 'cancelled' && hasGraceAccess) {
    card.innerHTML = `
      <span class="badge badge-cancelled">SUSCRIPCIÓN CANCELADA</span>
      <p style="margin:.75rem 0 0;font-size:14px">Suscripción cancelada · tenés acceso hasta el <strong>${accessUntilDate.toLocaleDateString('es-AR')}</strong></p>`;
    return;
  }

  if (data.plan === 'active') {
    card.innerHTML = `
      <div class="flex-between">
        <div>
          <span class="badge badge-confirmed">PLAN ACTIVO</span>
          <p class="text-muted" style="margin-top:8px">Tu suscripción está al día.</p>
        </div>
        <div class="sub-status-plan">
          $${(data.subscription_amount || 0).toLocaleString('es-AR')}
          <span style="font-family:var(--font-sans);font-size:12px;font-weight:400;text-transform:none;color:var(--text-muted)"> /mes</span>
        </div>
      </div>
      <div class="divider"></div>
      <button class="btn btn-outline-danger" onclick="openCancelModal()">Cancelar suscripción</button>`;
    return;
  }

  if (data.trial_active) {
    card.innerHTML = `
      <span class="badge badge-pending">PERÍODO DE PRUEBA</span>
      <p style="margin:.75rem 0 1.25rem;font-size:14px">Te quedan <strong>${data.days_left}</strong> día${data.days_left === 1 ? '' : 's'} de prueba gratuita.</p>
      <button class="btn btn-primary" onclick="subscribe()">💳 Suscribirme ahora</button>`;
    return;
  }

  card.innerHTML = `
    <span class="badge badge-cancelled">PRUEBA VENCIDA</span>
    <p style="margin:.75rem 0 1.25rem;font-size:14px">Tu período de prueba terminó. Suscribite para seguir usando Agendaste.</p>
    <button class="btn btn-primary" onclick="subscribe()">💳 Suscribirme ahora</button>`;
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

function openCancelModal() {
  document.getElementById('cancel-sub-overlay').classList.add('open');
}

function closeCancelModal() {
  document.getElementById('cancel-sub-overlay').classList.remove('open');
}

async function confirmCancelSubscription() {
  const btn = document.getElementById('btn-confirm-cancel-sub');
  btn.disabled = true;
  btn.textContent = 'Cancelando...';

  try {
    const res  = await fetch('/api/subscriptions/cancel', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showToast('❌ ' + (data.error || 'Error cancelando la suscripción'));
      btn.disabled = false;
      btn.textContent = 'Sí, cancelar';
      return;
    }
    closeCancelModal();
    showToast('✅ Suscripción cancelada');
    loadSubscriptionStatus();
  } catch {
    showToast('❌ Error de conexión');
    btn.disabled = false;
    btn.textContent = 'Sí, cancelar';
  }
}

// ── Toast ─────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Init ──────────────────────────────────────
loadUser();
loadBusiness();
loadPreviewService();
loadSubscriptionStatus();
