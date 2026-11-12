// ==============================
// Agendaste — Secciones de configuración del panel
// (Horarios del local, Mi negocio, Personalización y Suscripción)
// ==============================
// Se carga en el panel antes de admin.js, que define DAY_NAMES, DAYS_ORDER, showToast,
// subscribe, los selects de hora (timePickHtml / readTime) y el checklist (refreshChecklist).

// ── Mi negocio ─────────────────────────────────
// Devuelve los datos del negocio (los usa el inicio: link, QR y checklist) o null si falla
async function loadBusiness() {
  try {
    const res  = await fetch('/api/business');
    if (!res.ok) throw new Error();
    const data = await res.json();
    document.getElementById('biz-name').value        = data.name        || '';
    document.getElementById('biz-address').value     = data.address     || '';
    document.getElementById('biz-phone').value       = data.phone       || '';
    document.getElementById('biz-description').value = data.description || '';
    document.getElementById('biz-cancel-hours').value = data.cancel_min_hours ?? 2;
    if (data.address) showMapPreview(data.address);
    renderBizSchedule(data.schedule);

    if (data.slug) {
      document.getElementById('embed-snippet').value =
        `<div data-agendaste="${data.slug}"></div>\n<script src="${window.location.origin}/embed.js" async></script>`;
    }
    fillBrandForm(data);
    return data;
  } catch {
    showToast('❌ Error cargando configuración');
    return null;
  }
}

function showMapPreview(address) {
  const encoded = encodeURIComponent(address);
  document.getElementById('map-frame').innerHTML =
    `<iframe src="https://maps.google.com/maps?q=${encoded}&output=embed&hl=es&z=15"
       allowfullscreen loading="lazy"></iframe>`;
  document.getElementById('map-preview').style.display = 'block';
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
    updatePanelBusiness(await res.json().catch(() => null));
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
    updatePanelBusiness({ logo_url: data.logo_url });
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
    updatePanelBusiness({ logo_url: null });
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
  // Plan sin colores ni fuente: la preview muestra el diseño de Agendaste (lo que ve el cliente)
  const brand   = { ...(brandLocked ? {} : readBrandForm()), logo_url: brandLogoUrl };
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

// La preview muestra el primer servicio activo real del negocio (nombre, precio y duración).
// La llama renderServices (admin.js) cada vez que carga la lista de servicios.
function setPreviewService(svc) {
  const set = (id, text) => { document.getElementById(id).textContent = text; };
  if (!svc) {
    set('preview-svc-name', 'Todavía no tenés servicios activos');
    set('preview-svc-price', '');
    set('preview-svc-dur', 'Cargalos en Servicios');
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
    updatePanelBusiness(brand);
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

  // Mismo armado que el horario de cada barbero (scheduleDayHtml en admin.js)
  document.getElementById('biz-schedule-days').innerHTML =
    DAYS_ORDER.map(dow => scheduleDayHtml(dow, byDay[dow] || { is_open: false })).join('');
}

function readBizSchedule() {
  return readScheduleDays('#biz-schedule-days').map(d => ({
    ...d,
    // El horario base guarda el segundo tramo solo si es partido
    open_time_2:  d.has_split ? d.open_time_2  : null,
    close_time_2: d.has_split ? d.close_time_2 : null
  }));
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
    refreshChecklist(true);
  } catch {
    showToast('❌ Error aplicando horario a los barberos');
  }
}

// ── Suscripción ─────────────────────────────────
// Tarjeta de la sección Suscripción (el banner de prueba del inicio lo maneja admin.js)
// ── Suscripción y planes ───────────────────────
// Todo sale de GET /api/subscriptions/status: estado, plan actual, precios (con precio fundador),
// funciones del plan (features) y uso del mes.
let subStatus = null;
const AR_DATE = { timeZone: 'America/Argentina/Buenos_Aires' };
const fmtDate = d => new Date(d).toLocaleDateString('es-AR', AR_DATE);
const fmtMoney = n => '$' + Number(n || 0).toLocaleString('es-AR');

async function loadSubscriptionCard() {
  const card = document.getElementById('sub-card');
  try {
    const res = await fetch('/api/subscriptions/status');
    if (!res.ok) {
      card.innerHTML = '<p class="text-muted" style="padding:1rem 0">Error cargando la suscripción</p>';
      return null;
    }
    subStatus = await res.json();
    renderSubscription(subStatus);
    renderPlanCards(subStatus, document.getElementById('plan-cards'));
    applyPlanLocks(subStatus.features);
    return subStatus;
  } catch {
    card.innerHTML = '<p class="text-muted" style="padding:1rem 0">Error cargando la suscripción</p>';
    return null;
  }
}

// Suscripción paga y al día (se puede cambiar de plan)
function hasActiveSubscription(d) {
  return d.plan === 'active' && d.subscription_status === 'authorized';
}

function usageHtml(u) {
  if (!u || !u.limit) return '';
  const pct = Math.min(100, Math.round(u.count * 100 / u.limit));
  const cls = u.level >= 100 ? 'full' : u.level >= 80 ? 'warn' : '';
  return `
    <div class="usage">
      <div class="usage-head"><span>Turnos este mes</span><strong>${u.count} de ${u.limit}</strong></div>
      <div class="usage-bar ${cls}" role="progressbar" aria-label="Turnos usados este mes" aria-valuemin="0" aria-valuemax="${u.limit}" aria-valuenow="${u.count}"><span style="width:${pct}%"></span></div>
      ${u.level ? `<p class="usage-note">${escHtml(u.message)}. Tus clientes siguen reservando normalmente.</p>` : ''}
    </div>`;
}

function renderSubscription(d) {
  const card = document.getElementById('sub-card');
  const accessUntilDate = d.access_until ? new Date(d.access_until) : null;
  const hasGraceAccess  = accessUntilDate && accessUntilDate.getTime() > Date.now();
  const current = (d.plans || []).find(p => p.code === d.plan_code) || null;
  const founderNote = d.founder_active
    ? `<p class="usage-note">Precio fundador: 50% hasta el ${fmtDate(d.founder_until)}.</p>` : '';
  let head;

  if (d.courtesy_active) {
    // Cortesía vigente: acceso completo sin cobro → sin botón de suscribirse
    const until = d.courtesy_until ? ` hasta el <strong>${fmtDate(d.courtesy_until)}</strong>` : '';
    head = `
      <span class="badge badge-confirmed">CUENTA DE CORTESÍA</span>
      <p style="margin:.75rem 0 0;font-size:14px">Tenés todo lo del plan Pro sin cargo${until}.</p>`;
  } else if (hasActiveSubscription(d)) {
    const amount = d.subscription_amount || 0;
    const old = current && Number(amount) < current.monthly_price ? `<span class="sub-price-old">${fmtMoney(current.monthly_price)}</span>` : '';
    head = `
      <div class="flex-between">
        <div>
          <span class="badge badge-confirmed">PLAN ${escHtml((current?.name || 'activo').toUpperCase())}</span>
          <p class="text-muted" style="margin-top:8px">Tu suscripción está al día.</p>
          ${founderNote}
        </div>
        <div class="sub-status-plan">
          ${old}${fmtMoney(amount)}
          <span style="font-family:var(--font-sans);font-size:12px;font-weight:400;text-transform:none;color:var(--text-muted)"> /mes</span>
        </div>
      </div>
      ${usageHtml(d.usage)}
      <div class="divider"></div>
      <button class="btn btn-outline-danger" onclick="openCancelModal()">Cancelar suscripción</button>`;
  } else if (d.plan === 'cancelled' && hasGraceAccess) {
    head = `
      <span class="badge badge-cancelled">SUSCRIPCIÓN CANCELADA</span>
      <p style="margin:.75rem 0 0;font-size:14px">Tenés acceso${current ? ` al plan ${escHtml(current.name)}` : ''} hasta el <strong>${accessUntilDate.toLocaleDateString('es-AR')}</strong>. Para seguir, elegí un plan abajo.</p>
      ${founderNote}`;
  } else if (d.trial_active) {
    head = `
      <span class="badge badge-pending">PERÍODO DE PRUEBA</span>
      <p style="margin:.75rem 0 0;font-size:14px">Te quedan <strong>${d.days_left}</strong> día${d.days_left === 1 ? '' : 's'} de prueba con todo lo del plan Pro. Elegí tu plan abajo.</p>
      ${founderNote}`;
  } else {
    head = `
      <span class="badge badge-cancelled">PRUEBA VENCIDA</span>
      <p style="margin:.75rem 0 0;font-size:14px">Tu período de prueba terminó. Elegí un plan para seguir usando Agendaste.</p>
      ${founderNote}`;
  }

  card.innerHTML = head + (hasActiveSubscription(d) ? '' : usageHtml(d.usage));
}

// Qué incluye cada plan (a partir de sus flags; cada plan muestra "Todo lo del" anterior)
function planItems(p, prev) {
  const items = [[`${p.monthly_appointment_limit} turnos por mes`], ['Profesionales ilimitados']];
  if (!prev) items.push(['Link, QR y recordatorios por mail'], ['Tu logo en la página de reservas']);
  else items.push([`Todo lo del ${prev.name}`]);
  if (p.custom_branding && !prev?.custom_branding) items.push(['Colores y fuente propios']);
  if (p.embed && !prev?.embed) items.push(['Reserva dentro de tu web']);
  if (p.code === 'pro') {
    items.push(p.whatsapp ? ['Recordatorios por WhatsApp'] : ['Recordatorios por WhatsApp (próximamente)', 'soon']);
    items.push(p.deposits ? ['Señas con Mercado Pago'] : ['Señas con Mercado Pago (próximamente)', 'soon']);
  }
  if (p.remove_agendaste_footer && !prev?.remove_agendaste_footer) items.push(['Sin "Reservas con Agendaste"']);
  if (p.priority_support && !prev?.priority_support) items.push(['Soporte prioritario']);
  return items;
}

// Tarjetas de los 3 planes. Con suscripción activa: cambiar de plan; si no: elegir (Mercado Pago).
function renderPlanCards(d, container) {
  if (!container) return;
  const plans = d.plans || [];
  const active = hasActiveSubscription(d);
  container.innerHTML = plans.map((p, i) => {
    const isCurrent = active && p.code === d.plan_code;
    const featured  = !isCurrent && !active && p.code === 'pro';
    const price = p.price < p.monthly_price
      ? `<s>${fmtMoney(p.monthly_price)}</s>${fmtMoney(p.price)} <small>/mes · precio fundador</small>`
      : `${fmtMoney(p.price)} <small>/mes</small>`;
    let btn = '';
    if (d.courtesy_active) btn = '';
    else if (isCurrent) btn = '<button type="button" class="btn btn-outline" disabled>Tu plan actual</button>';
    else if (active) btn = `<button type="button" class="btn btn-outline" onclick="changePlanFlow('${escHtml(p.code)}')">Cambiar a ${escHtml(p.name)}</button>`;
    else btn = `<button type="button" class="btn ${featured ? 'btn-primary' : 'btn-outline'}" onclick="subscribe('${escHtml(p.code)}')">Elegir ${escHtml(p.name)}</button>`;
    const tag = isCurrent ? 'Tu plan' : featured ? 'Recomendado' : '';
    return `
      <div class="plan-card${isCurrent ? ' current' : featured ? ' featured' : ''}">
        ${tag ? `<span class="plan-card-tag">${tag}</span>` : ''}
        <div class="plan-card-name">${escHtml(p.name)}</div>
        <div class="plan-card-price">${price}</div>
        <ul>${planItems(p, plans[i - 1]).map(([t, soon]) => `<li${soon ? ' class="soon"' : ''}>${escHtml(t)}</li>`).join('')}</ul>
        ${btn}
      </div>`;
  }).join('');
}

// Cambio de plan: confirmación con el monto nuevo → PreApproval actualizado (si falla, no cambia nada)
async function changePlanFlow(code) {
  const p = (subStatus?.plans || []).find(x => x.code === code);
  if (!p) return;
  const ok = await confirmDialog({
    title: `¿Cambiar al plan ${p.name}?`,
    text:  `Desde tu próximo cobro vas a pagar ${fmtMoney(p.price)} (plan ${p.name}).`,
    ok:    'Cambiar de plan',
    danger: false
  });
  if (!ok) return;
  try {
    const res  = await fetch('/api/subscriptions/change-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: code })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast('❌ ' + (data.error || 'No se pudo cambiar de plan')); return; }
    showToast(`✅ Listo: desde tu próximo cobro pasás al plan ${data.plan_name}`);
    loadSubscriptionCard();
    loadSubscriptionStatus();
  } catch {
    showToast('❌ Error de conexión');
  }
}

// Personalización y embed según el plan (el backend también lo valida)
let brandLocked = false;
function applyPlanLocks(features) {
  if (!features) return;
  brandLocked = !features.custom_branding;
  document.getElementById('brand-fields').disabled = brandLocked;
  document.getElementById('brand-lock').hidden     = !brandLocked;
  document.getElementById('btn-save-brand').hidden = brandLocked;
  const embedLocked = !features.embed;
  document.getElementById('embed-lock').hidden  = !embedLocked;
  document.getElementById('embed-block').hidden = embedLocked;
  onBrandInput(); // la vista previa muestra lo que se ve de verdad con este plan
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
    loadSubscriptionCard();
    loadSubscriptionStatus();
  } catch {
    showToast('❌ Error de conexión');
    btn.disabled = false;
    btn.textContent = 'Sí, cancelar';
  }
}
