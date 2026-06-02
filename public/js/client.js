// ==============================
// BarberApp — Lógica del cliente
// ==============================

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DAYS   = ['Do','Lu','Ma','Mi','Ju','Vi','Sa'];

let services = [];

let selService = null;
let selDate    = null;
let selSlot    = null;
let curYear    = new Date().getFullYear();
let curMonth   = new Date().getMonth();
let step       = 0;

// ── Cargar y renderizar servicios ───────────
async function loadServices() {
  const grid = document.getElementById('services-grid');
  grid.innerHTML = '<p class="text-muted" style="text-align:center;padding:2rem">Cargando servicios...</p>';

  try {
    const res  = await fetch('/api/services');
    const data = await res.json();
    services   = data.map(s => ({ ...s, dur: `${s.duration} min` }));
    renderServices();
  } catch {
    grid.innerHTML = '<p class="text-muted" style="text-align:center;padding:2rem">Error cargando servicios</p>';
  }
}

function renderServices() {
  const grid = document.getElementById('services-grid');
  grid.innerHTML = services.map(s => `
    <div class="card service-card ${selService?.id === s.id ? 'selected' : ''}"
         onclick="selectService(${s.id})">
      <strong>${s.name}</strong>
      <div class="service-price">$${s.price.toLocaleString('es-AR')}</div>
      <div class="service-dur">${s.dur}</div>
    </div>
  `).join('');
}

function selectService(id) {
  selService = services.find(s => s.id === id);
  renderServices();
  setTimeout(() => goStep(1), 250);
}

// ── Navegación entre pasos ───────────────────
function goStep(n) {
  document.getElementById('step' + step).classList.remove('active');
  step = n;
  document.getElementById('step' + step).classList.add('active');
  updateDots();
  if (n === 1) renderCalendar();
  if (n === 2) fillSummary();
}

function updateDots() {
  for (let i = 0; i < 4; i++) {
    const d = document.getElementById('dot' + i);
    d.className = 'dot' + (i === step ? ' active' : i < step ? ' done' : '');
  }
}

// ── Calendario ───────────────────────────────
function renderCalendar() {
  document.getElementById('cal-title').textContent = MONTHS[curMonth] + ' ' + curYear;
  const today = new Date();
  const firstDay = new Date(curYear, curMonth, 1).getDay();
  const daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();

  let html = DAYS.map(d => `<div class="day-label">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += `<div class="day-cell empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(curYear, curMonth, d);
    const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isSun  = date.getDay() === 0;
    const isToday = date.toDateString() === today.toDateString();
    const key = `${curYear}-${String(curMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isSel = selDate === key;

    const classes = ['day-cell', isPast || isSun ? 'disabled' : '', isToday ? 'today' : '', isSel ? 'selected' : ''].filter(Boolean).join(' ');
    const click = !isPast && !isSun ? `onclick="selectDay('${key}')"` : '';
    html += `<div class="${classes}" ${click}>${d}</div>`;
  }

  document.getElementById('cal-grid').innerHTML = html;
  loadSlots();
}

function prevMonth() { if (curMonth === 0) { curMonth = 11; curYear--; } else curMonth--; renderCalendar(); }
function nextMonth() { if (curMonth === 11) { curMonth = 0; curYear++; } else curMonth++; renderCalendar(); }

function selectDay(key) {
  selDate = key;
  selSlot = null;
  renderCalendar();
  loadSlots(); // fuerza consulta al servidor
  checkStep1();
}

// ── Horarios disponibles (desde la API) ──────
async function loadSlots() {
  const grid = document.getElementById('slots-grid');
  if (!selDate) {
    grid.innerHTML = `<p class="text-muted" style="grid-column:1/-1;font-size:13px">Seleccioná un día primero</p>`;
    return;
  }

  try {
    const res = await fetch(`/api/appointments/slots/${selDate}`);
    const slots = await res.json();

    // Filtrar horarios pasados si es el día de hoy
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const isToday = selDate === todayKey;

    const filteredSlots = slots.filter(s => {
      if (!isToday) return true;
      const [h, m] = s.time.split(':').map(Number);
      const slotTime = new Date();
      slotTime.setHours(h, m, 0, 0);
      return slotTime > now;
    });

    if (filteredSlots.length === 0) {
      grid.innerHTML = `<p class="text-muted" style="grid-column:1/-1;font-size:13px">No hay horarios disponibles para hoy</p>`;
      return;
    }

    grid.innerHTML = filteredSlots.map(s => `
      <div class="slot ${s.time === selSlot ? 'selected' : ''} ${!s.available ? 'taken' : ''}"
           onclick="${s.available ? `selectSlot('${s.time}')` : ''}">
        ${s.time}${!s.available ? '<br><small>Ocupado</small>' : ''}
      </div>
    `).join('');
  } catch {
    grid.innerHTML = `<p class="text-muted" style="grid-column:1/-1">Error cargando horarios</p>`;
  }
}

function selectSlot(time) { selSlot = time; loadSlots(); checkStep1(); }

function checkStep1() {
  document.getElementById('btn-to-step2').disabled = !(selDate && selSlot);
}

// ── Resumen ──────────────────────────────────
function fillSummary() {
  const [y, m, d] = selDate.split('-');
  document.getElementById('sum-svc').textContent   = selService.name;
  document.getElementById('sum-day').textContent   = `${d} de ${MONTHS[parseInt(m) - 1]} ${y}`;
  document.getElementById('sum-time').textContent  = selSlot;
  document.getElementById('sum-price').textContent = `$${selService.price.toLocaleString('es-AR')}`;
}

function checkStep2() {
  const name  = document.getElementById('inp-name').value.trim();
  const phone = document.getElementById('inp-phone').value.trim();
  document.getElementById('btn-confirm').disabled = !(name && phone);
}

// ── Confirmar turno (llama a la API) ─────────
async function confirmBooking() {
  const name  = document.getElementById('inp-name').value.trim();
  const phone = document.getElementById('inp-phone').value.trim();
  const btn   = document.getElementById('btn-confirm');

  btn.disabled = true;
  btn.textContent = 'Confirmando...';

  try {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName:  name,
        clientPhone: phone,
        service:     selService.name,
        date:        selDate,
        time:        selSlot,
        price:       selService.price
      })
    });

    if (!res.ok) {
      const err = await res.json();
      showToast('❌ ' + err.error);
      btn.disabled = false;
      btn.textContent = 'Confirmar turno';
      return;
    }

    // Mostrar pantalla de éxito
    const [y, m, d] = selDate.split('-');
    document.getElementById('conf-day').textContent   = `${d} de ${MONTHS[parseInt(m) - 1]}`;
    document.getElementById('conf-time').textContent  = selSlot;
    document.getElementById('conf-svc').textContent   = selService.name;
    document.getElementById('conf-name').textContent  = name;
    document.getElementById('conf-price').textContent = `$${selService.price.toLocaleString('es-AR')}`;
    goStep(3);

  } catch {
    showToast('❌ Error de conexión');
    btn.disabled = false;
    btn.textContent = 'Confirmar turno';
  }
}

// ── Google Calendar (link directo) ───────────
function addToGCal() {
  const [y, m, d] = selDate.split('-').map(Number);
  const [h, min]  = selSlot.split(':').map(Number);
  const start = new Date(y, m - 1, d, h, min);
  const end   = new Date(start.getTime() + 30 * 60000);
  const fmt   = dt => dt.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';

  const title   = encodeURIComponent(`✂️ Turno — ${selService.name}`);
  const details = encodeURIComponent(
    `Servicio: ${selService.name}\n` +
    `Precio: $${selService.price.toLocaleString('es-AR')}\n` +
    `Dirección: [nombre de tu barbería]\n\n` +
    `Reservado via BarberApp`
  );

  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE`
    + `&text=${title}`
    + `&dates=${fmt(start)}/${fmt(end)}`
    + `&details=${details}`;

  window.open(url, '_blank');
}

function resetBooking() {
  selService = null; selDate = null; selSlot = null; step = 0;
  document.getElementById('inp-name').value  = '';
  document.getElementById('inp-phone').value = '';
  document.getElementById('step3').classList.remove('active');
  document.getElementById('step0').classList.add('active');
  updateDots();
  renderServices();
}

// ── Toast ─────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Init ──────────────────────────────────────
loadServices();
