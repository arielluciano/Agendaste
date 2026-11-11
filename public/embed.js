/*!
 * Agendaste — widget de reservas embebible
 * Uso:
 *   <div data-agendaste="SLUG"></div>
 *   <script src="https://agendaste.com.ar/embed.js" async></script>
 */
(function () {
  'use strict';

  // Origen de Agendaste = el del propio script (sirve igual en producción y en local)
  var script = document.currentScript;
  var ORIGIN = 'https://agendaste.com.ar';
  try { if (script && script.src) ORIGIN = new URL(script.src).origin; } catch (e) {}

  var frames = []; // iframes creados por este script

  function mount(el) {
    if (el.getAttribute('data-agendaste-ready')) return;
    var slug = (el.getAttribute('data-agendaste') || '').trim();
    if (!slug) return;
    el.setAttribute('data-agendaste-ready', '1');

    var iframe = document.createElement('iframe');
    iframe.src = ORIGIN + '/' + encodeURIComponent(slug) + '?embed=1';
    iframe.title = 'Reservá tu turno';
    iframe.setAttribute('loading', 'lazy');
    iframe.style.cssText = 'display:block;width:100%;border:0;height:640px;background:transparent;overflow:hidden;';
    el.appendChild(iframe);
    frames.push(iframe);
  }

  function mountAll() {
    var nodes = document.querySelectorAll('[data-agendaste]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== ORIGIN) return;
    var data = event.data;
    if (!data || data.type !== 'agendaste:height') return;
    var height = Number(data.height);
    if (!isFinite(height) || height <= 0) return;
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === event.source) {
        frames[i].style.height = Math.min(Math.ceil(height), 10000) + 'px';
        break;
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
})();
