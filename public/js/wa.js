// ==============================
// Agendaste — links de WhatsApp (compartido: reservas, Mis turnos y panel)
// ==============================
// Regla: el cliente le escribe al NEGOCIO (businesses.phone); desde el panel el dueño le escribe al CLIENTE.
(function () {
  // Número para wa.me: solo dígitos, con código de país. Para Argentina deja el formato 549 + área + número
  // (10 dígitos), sacando el 0 de larga distancia y el 15 de los celulares. Otros países quedan como vienen.
  // Devuelve null si no parece un teléfono.
  function normalizeArPhone(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('00')) d = d.slice(2);                 // 0054…

    if (d.startsWith('54')) {
      let rest = d.slice(2);
      if (rest.startsWith('9')) rest = rest.slice(1);
      if (rest.startsWith('0')) rest = rest.slice(1);
      rest = dropMobile15(rest);
      return rest.length === 10 ? '549' + rest : (d.length >= 8 && d.length <= 15 ? d : null);
    }

    if (d.startsWith('0')) d = d.replace(/^0+/, '');        // 011…
    d = dropMobile15(d);
    if (d.length === 10) return '549' + d;                  // número argentino sin código de país
    return d.length >= 11 && d.length <= 15 ? d : null;     // ya trae otro código de país
  }

  // "11 15 2345-6789" → "1123456789": el 15 va después del código de área (2 a 4 dígitos)
  function dropMobile15(d) {
    if (d.length !== 12) return d;
    for (const area of [2, 3, 4]) {
      if (d.slice(area, area + 2) === '15') return d.slice(0, area) + d.slice(area + 2);
    }
    return d;
  }

  // Link de WhatsApp con el mensaje ya escrito. encodeURIComponent codifica en UTF-8,
  // así que los emojis (✂️📅…) llegan bien. null si el teléfono no sirve.
  function waLink(phone, text) {
    const n = normalizeArPhone(phone);
    if (!n) return null;
    return `https://wa.me/${n}` + (text ? `?text=${encodeURIComponent(text)}` : '');
  }

  window.normalizeArPhone = normalizeArPhone;
  window.waLink = waLink;
})();
