// ==============================
// Acceso al panel: único lugar donde se decide si un negocio puede operar
// ==============================
// Vigente si: cortesía vigente, suscripción activa, prueba vigente,
// o período ya pagado de una suscripción cancelada (access_until).
// La base se carga recién al usarla: así seo.js (y sus tests) pueden importar el SQL sin abrir conexión
const getDb = () => require('../config/database');

const future = (d) => !!d && new Date(d).getTime() > Date.now();

// plan = 'courtesy' + businesses.courtesy_until opcional (NULL = sin vencimiento)
function isCourtesyActive(plan, courtesyUntil) {
  return plan === 'courtesy' && (!courtesyUntil || future(courtesyUntil));
}

// Estado de acceso del negocio. null si no tiene dueño cargado.
async function getAccess(businessId) {
  const result = await getDb().query(
    `SELECT o.plan, o.trial_ends_at, o.access_until, b.courtesy_until
       FROM owners o JOIN businesses b ON b.id = o.business_id
      WHERE o.business_id = $1 LIMIT 1`,
    [businessId]
  );
  const owner = result.rows[0];
  if (!owner) return null;

  const courtesyActive     = isCourtesyActive(owner.plan, owner.courtesy_until);
  const subscriptionActive = owner.plan === 'active';
  const trialActive        = future(owner.trial_ends_at);
  const withinAccessUntil  = future(owner.access_until);

  return {
    plan: owner.plan || 'trial',
    trial_ends_at: owner.trial_ends_at || null,
    access_until: owner.access_until || null,
    courtesy_until: owner.courtesy_until || null,
    courtesyActive,
    subscriptionActive,
    trialActive,
    withinAccessUntil,
    hasAccess: courtesyActive || subscriptionActive || trialActive || withinAccessUntil
  };
}

// Lo mismo en SQL, para consultas sobre muchos negocios (sitemap, noindex). Uso: WHERE ${ACTIVE_BUSINESS_SQL('b')}
const ACTIVE_BUSINESS_SQL = (alias) => `EXISTS (
  SELECT 1 FROM owners o
   WHERE o.business_id = ${alias}.id
     AND (
       (o.plan = 'courtesy' AND (${alias}.courtesy_until IS NULL OR ${alias}.courtesy_until > NOW()))
       OR o.plan = 'active'
       OR o.trial_ends_at > NOW()
       OR o.access_until > NOW()
     )
)`;

module.exports = { isCourtesyActive, getAccess, ACTIVE_BUSINESS_SQL };
