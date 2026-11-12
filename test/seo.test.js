const test = require('node:test');
const assert = require('node:assert');
const { robotsTxt, sitemapXml, bookingHead, bookingIcons } = require('../services/seo');
const { isReservedSlug } = require('../config/reserved-slugs');

test('slugs reservados', () => {
  for (const s of ['panel', 'admin', 'Mis-Turnos', ' api ', 'sitemap', 'demo']) assert.ok(isReservedSlug(s), s);
  for (const s of ['barberia-demo', 'panaderia', 'admin-barber', '']) assert.ok(!isReservedSlug(s), s);
});

test('robots.txt bloquea el panel sin tapar slugs parecidos', () => {
  const r = robotsTxt();
  assert.match(r, /^Disallow: \/panel\$$/m);
  assert.match(r, /^Disallow: \/api\/$/m);
  assert.match(r, /^Sitemap: https:\/\/agendaste\.com\.ar\/sitemap\.xml$/m);
  assert.doesNotMatch(r, /^Disallow: \/panel$/m);
});

test('sitemap: home + negocios con lastmod', () => {
  const xml = sitemapXml([{ slug: 'la-barbe', lastmod: '2026-10-01T12:00:00Z' }, { slug: 'a&b', lastmod: null }]);
  assert.match(xml, /<loc>https:\/\/agendaste\.com\.ar\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/agendaste\.com\.ar\/la-barbe<\/loc><lastmod>2026-10-01<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/agendaste\.com\.ar\/a%26b<\/loc><\/url>/);
});

test('head de reserva: title, servicios, canonical, og:image, JSON-LD y noindex', () => {
  const business = { name: 'Barbería <Don>', slug: 'don', address: 'Av. Corrientes 1234', phone: '1123456789', logo_url: 'https://x.supabase.co/logo.webp' };
  const head = bookingHead({ business, services: [{ name: 'Corte' }, { name: 'Barba' }], active: true });
  assert.match(head, /<title>Reservá turno en Barbería &lt;Don&gt; \| Av\. Corrientes 1234<\/title>/);
  assert.match(head, /name="description" content="[^"]*Corte, Barba/);
  assert.match(head, /<link rel="canonical" href="https:\/\/agendaste\.com\.ar\/don">/);
  assert.match(head, /og:image" content="https:\/\/x\.supabase\.co\/logo\.webp"/);
  assert.doesNotMatch(head, /noindex/);
  const ld = JSON.parse(head.match(/<script type="application\/ld\+json">(.*)<\/script>/)[1]);
  assert.strictEqual(ld['@type'], 'LocalBusiness');
  assert.strictEqual(ld.name, 'Barbería <Don>');
  assert.strictEqual(ld.address.streetAddress, 'Av. Corrientes 1234');
  assert.strictEqual(ld.telephone, '1123456789');
  assert.doesNotMatch(head, /<Don>/); // el "<" del JSON-LD va escapado

  const inactive = bookingHead({ business: { ...business, address: '', logo_url: 'http://inseguro/logo.png' }, active: false });
  assert.match(inactive, /<meta name="robots" content="noindex">/);
  assert.match(inactive, /<title>Reservá turno en Barbería &lt;Don&gt;<\/title>/);
  assert.doesNotMatch(inactive, /og:image/);
});

test('favicon de reserva: logo https del negocio, si no el de Agendaste', () => {
  assert.strictEqual(bookingIcons({ logo_url: 'https://x.supabase.co/9/logo.webp?a=1&b="2"' }), '<link rel="icon" href="https://x.supabase.co/9/logo.webp?a=1&amp;b=&quot;2&quot;">');
  assert.strictEqual(bookingIcons({ logo_url: 'http://inseguro/logo.png' }), null);
  assert.strictEqual(bookingIcons({ logo_url: null }), null);
});
