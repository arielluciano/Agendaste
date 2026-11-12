// ==============================
// Slugs reservados: rutas propias de Agendaste que ningún negocio puede usar como /{slug}
// ==============================
const RESERVED_SLUGS = new Set([
  'panel', 'admin', 'superadmin', 'login', 'ingresar', 'registro', 'mis-turnos',
  'api', 'auth', 'embed', 'sitemap', 'robots', 'demo', 'ayuda', 'precios',
  'terminos', 'privacidad', 'static', 'assets', 'health'
]);

function isReservedSlug(slug) {
  return RESERVED_SLUGS.has(String(slug || '').trim().toLowerCase());
}

module.exports = { RESERVED_SLUGS, isReservedSlug };
