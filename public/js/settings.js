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
    if (data.address) showMapPreview(data.address);
    renderBizSchedule(data.schedule);

    if (data.slug) {
      const link = `${window.location.origin}/${data.slug}`;
      document.getElementById('business-link').value = link;
      document.getElementById('business-link-container').style.display = 'block';
    }
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

  try {
    const res = await fetch('/api/business', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, address, phone, description, schedule })
    });
    if (!res.ok) { const err = await res.json(); showToast('❌ ' + err.error); return; }
    showToast('✅ Configuración guardada');
    if (address) showMapPreview(address);
  } catch {
    showToast('❌ Error guardando configuración');
  }
}

// ── Horario del local ──────────────────────────
function renderBizSchedule(schedule) {
  const byDay = {};
  (schedule || []).forEach(s => byDay[s.day_of_week] = s);

  document.getElementById('biz-schedule-days').innerHTML = DAYS_ORDER.map(dow => {
    const d     = byDay[dow] || { is_open: false, open_time: '09:00', close_time: '18:00' };
    const open  = (d.open_time  || '09:00').substring(0, 5);
    const close = (d.close_time || '18:00').substring(0, 5);
    return `
      <div class="schedule-day" data-dow="${dow}">
        <div class="schedule-day-head">
          <button class="toggle ${d.is_open ? 'on' : ''}" onclick="this.classList.toggle('on')"></button>
          <span class="schedule-day-name">${DAY_NAMES[dow]}</span>
        </div>
        <div class="schedule-franjas">
          <div class="schedule-franja-row">
            <input type="time" class="biz-sched-open"  value="${open}">
            <span class="schedule-sep">a</span>
            <input type="time" class="biz-sched-close" value="${close}">
          </div>
        </div>
      </div>`;
  }).join('');
}

function readBizSchedule() {
  const days = document.querySelectorAll('#biz-schedule-days .schedule-day');
  return Array.from(days).map(day => ({
    day_of_week: Number(day.dataset.dow),
    is_open:     day.querySelector('.toggle').classList.contains('on'),
    open_time:   day.querySelector('.biz-sched-open').value,
    close_time:  day.querySelector('.biz-sched-close').value
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
loadSubscriptionStatus();
