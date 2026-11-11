// ==============================
// Agendaste — links de WhatsApp (único helper: reservas, Mis turnos y panel)
// ==============================
// Regla de destinos: el cliente le escribe al NEGOCIO (businesses.phone);
// desde el panel, el dueño le escribe al CLIENTE (appointments.client_phone).
(function () {
  // Número para wa.me (solo dígitos, con código de país):
  //   - 549 + …              → se deja como está
  //   - 54 + 10 dígitos      → se agrega el 9 después del 54
  //   - 10 dígitos           → se agrega 549
  // Antes se limpian los formatos locales argentinos: 00 internacional, 0 de larga distancia
  // y el 15 de los celulares ("011 15 2345-6789" → 1123456789).
  // Otros países (11 a 15 dígitos) quedan como vienen. null si no parece un teléfono.
  function normalizeArPhone(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('00')) d = d.slice(2);

    if (d.startsWith('549')) return d.length === 13 ? d : (d.length >= 11 && d.length <= 15 ? d : null);
    if (d.startsWith('54')) {
      const rest = dropMobile15(d.slice(2).replace(/^0/, ''));
      if (rest.length === 10) return '549' + rest;
      return d.length >= 11 && d.length <= 15 ? d : null;
    }

    d = dropMobile15(d.replace(/^0+/, ''));
    if (d.length === 10) return '549' + d;
    return d.length >= 11 && d.length <= 15 ? d : null;
  }

  // "11 15 2345 6789" → "1123456789": el 15 va después del código de área (2 a 4 dígitos)
  function dropMobile15(d) {
    if (d.length !== 12) return d;
    for (const area of [2, 3, 4]) {
      if (d.slice(area, area + 2) === '15') return d.slice(0, area) + d.slice(area + 2);
    }
    return d;
  }

  // https://wa.me/{normalizado}?text={encodeURIComponent(text)}
  // El texto se codifica entero en UTF-8 (emojis y saltos de línea incluidos): nada de escape() ni recortes.
  // null si el teléfono no sirve.
  function waLink(phone, text) {
    const n = normalizeArPhone(phone);
    if (!n) return null;
    return `https://wa.me/${n}` + (text ? `?text=${encodeURIComponent(text)}` : '');
  }

  // Mensaje de turno confirmado (cliente → negocio), una línea por dato
  function bookingConfirmedText({ business, day, time, service, barber, address }) {
    return [
      `✅ ¡Turno confirmado en ${business || 'Agendaste'}!`,
      `📅 ${day}`,
      `🕐 ${time}`,
      service ? `✂️ ${service}` : null,
      barber  ? `💈 ${barber}`  : null,
      address ? `📍 ${address}` : null,
      'Reservado vía Agendaste'
    ].filter(Boolean).join('\n');
  }

  window.normalizeArPhone     = normalizeArPhone;
  window.waLink               = waLink;
  window.bookingConfirmedText = bookingConfirmedText;
})();
