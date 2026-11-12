// ==============================
// SEO: robots.txt, sitemap.xml y <head> de las páginas de reserva
// ==============================
const SITE_URL = 'https://agendaste.com.ar';

// Negocio "activo" (se indexa y va al sitemap) = el mismo criterio que el acceso al panel
const { ACTIVE_BUSINESS_SQL } = require('./access');

// Las rutas que bloqueamos llevan "$" y "/" para no tapar slugs que empiezan igual (ej. /panaderia-x)
function robotsTxt() {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /panel$',
    'Disallow: /panel/',
    'Disallow: /admin$',
    'Disallow: /admin/',
    'Disallow: /mis-turnos$',
    'Disallow: /mis-turnos/',
    'Disallow: /api/',
    'Disallow: /auth/',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    ''
  ].join('\n');
}

const xmlEscape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const isoDate = (d) => {
  const t = d ? new Date(d) : null;
  return t && !isNaN(t) ? t.toISOString().slice(0, 10) : null;
};

// businesses: [{ slug, lastmod }]
function sitemapXml(businesses) {
  const urls = [{ loc: `${SITE_URL}/`, lastmod: isoDate(new Date()) }]
    .concat(businesses.map((b) => ({ loc: `${SITE_URL}/${encodeURIComponent(b.slug)}`, lastmod: isoDate(b.lastmod) })));
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')
    + '\n</urlset>\n';
}

const htmlEscape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// JSON dentro de <script>: escapar "<" para que nadie cierre el tag con "</script>"
const jsonForScript = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

function httpsUrl(u) {
  try { return new URL(u).protocol === 'https:' ? u : null; } catch { return null; }
}

function truncate(s, max) {
  return s.length <= max ? s : s.slice(0, max - 1).replace(/[\s,·]+\S*$/, '') + '…';
}

// <head> de /{slug}: title, description, canonical, Open Graph, JSON-LD LocalBusiness y noindex si está inactivo
function bookingHead({ business, services = [], active }) {
  const name     = String(business.name || '').trim() || 'Tu negocio';
  const address  = String(business.address || '').trim();
  const url      = `${SITE_URL}/${encodeURIComponent(business.slug)}`;
  const logo     = httpsUrl(business.logo_url);
  const title    = `Reservá turno en ${name}${address ? ` | ${address}` : ''}`;

  const serviceNames = [...new Set(services.map((s) => String(s.name || '').trim()).filter(Boolean))];
  const description = truncate(
    serviceNames.length
      ? `Reservá online tu turno en ${name}: ${serviceNames.join(', ')}. Elegí día y horario en segundos.`
      : `Reservá online tu turno en ${name}. Elegí servicio, día y horario en segundos.`,
    160
  );

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name,
    url,
    ...(address ? { address: { '@type': 'PostalAddress', streetAddress: address, addressCountry: 'AR' } } : {}),
    ...(business.phone ? { telephone: String(business.phone) } : {}),
    ...(logo ? { image: logo, logo } : {})
  };

  return [
    `<title>${htmlEscape(title)}</title>`,
    `<meta name="description" content="${htmlEscape(description)}">`,
    `<link rel="canonical" href="${htmlEscape(url)}">`,
    active ? '' : '<meta name="robots" content="noindex">',
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="es_AR">',
    '<meta property="og:site_name" content="Agendaste">',
    `<meta property="og:url" content="${htmlEscape(url)}">`,
    `<meta property="og:title" content="${htmlEscape(title)}">`,
    `<meta property="og:description" content="${htmlEscape(description)}">`,
    logo ? `<meta property="og:image" content="${htmlEscape(logo)}">` : '',
    '<meta name="twitter:card" content="summary">',
    `<script type="application/ld+json">${jsonForScript(jsonLd)}</script>`
  ].filter(Boolean).join('\n  ');
}

// Favicon de /{slug}: el logo del negocio si tiene uno https (si no, null = queda el de Agendaste)
function bookingIcons(business) {
  const logo = httpsUrl(business && business.logo_url);
  return logo ? `<link rel="icon" href="${htmlEscape(logo)}">` : null;
}

module.exports = { SITE_URL, ACTIVE_BUSINESS_SQL, robotsTxt, sitemapXml, bookingHead, bookingIcons };
