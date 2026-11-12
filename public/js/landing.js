// ==============================
// Agendaste — Landing: calculadora de ausencias, FAQ y botones de WhatsApp
// ==============================
(function () {
  // $ argentino sin decimales: 283800 → "$283.800"
  const fmtARS = (n) => '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // ── Calculadora: pérdida mensual = precio × ausencias por semana × 4,3 ──
  const calc = document.querySelector('[data-calc]');
  if (calc) {
    const state = { price: 22000, noShows: 3 };
    const limits = {
      price:   { min: 5000, max: 60000, step: 1000 },
      noShows: { min: 0,    max: 30,    step: 1 }
    };
    const out = (name) => calc.querySelector(`[data-calc-out="${name}"]`);

    function render() {
      out('price').textContent = fmtARS(state.price);
      out('noShows').textContent = String(state.noShows);
      out('loss').textContent = fmtARS(state.price * state.noShows * 4.3);
      calc.querySelectorAll('[data-calc-step]').forEach((btn) => {
        const key = btn.dataset.calcStep;
        const dir = Number(btn.dataset.dir);
        const atLimit = dir < 0 ? state[key] <= limits[key].min : state[key] >= limits[key].max;
        btn.setAttribute('aria-disabled', String(atLimit)); // aria-disabled (no disabled) para no perder el foco
      });
    }

    calc.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-calc-step]');
      if (!btn) return;
      const key = btn.dataset.calcStep;
      const { min, max, step } = limits[key];
      state[key] = Math.min(max, Math.max(min, state[key] + Number(btn.dataset.dir) * step));
      render();
    });

    render();
  }

  // ── FAQ: acordeón, una abierta por vez (arranca la primera) ──
  const faq = document.querySelector('[data-faq]');
  if (faq) {
    const buttons = Array.from(faq.querySelectorAll('.faq__q'));
    const setOpen = (btn, open) => {
      btn.setAttribute('aria-expanded', String(open));
      btn.querySelector('.faq__icon').textContent = open ? '−' : '+';
      document.getElementById(btn.getAttribute('aria-controls')).hidden = !open;
    };
    faq.addEventListener('click', (e) => {
      const btn = e.target.closest('.faq__q');
      if (!btn) return;
      const wasOpen = btn.getAttribute('aria-expanded') === 'true';
      buttons.forEach((b) => setOpen(b, false));
      if (!wasOpen) setOpen(btn, true);
    });
  }

  // ── WhatsApp de ventas (SALES_WHATSAPP, inyectado por el servidor) ──
  // Sin número válido, los botones quedan ocultos.
  const meta = document.querySelector('meta[name="sales-whatsapp"]');
  const href = meta && window.waLink ? window.waLink(meta.content, 'Hola! Quiero info sobre Agendaste') : null;
  if (href) {
    document.querySelectorAll('[data-wa]').forEach((a) => {
      a.href = href;
      a.hidden = false;
    });
  }
})();
