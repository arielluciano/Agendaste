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

// ==============================
// Planes: funciones y precio (único lugar donde se decide qué puede usar cada negocio)
// ==============================
const PLAN_FLAGS = ['custom_branding', 'embed', 'whatsapp', 'deposits', 'remove_agendaste_footer', 'priority_support'];
const TRIAL_PLAN_CODE  = 'pro';      // prueba y cortesía = todo lo del Pro
const FALLBACK_PLAN    = 'inicial';  // sin acceso ni plan: lo mínimo
const FOUNDER_DISCOUNT = 0.5;

// Todo lo que hace falta para decidir funciones y precio de un negocio, en una consulta.
// plans = catálogo completo ordenado por precio. null si el negocio no existe.
async function loadPlanContext(businessId, q = getDb()) {
  const result = await q.query(
    `SELECT b.id, b.plan_id, b.founder_until, b.courtesy_until,
            o.plan AS owner_plan, o.trial_ends_at, o.access_until,
            COALESCE((SELECT json_agg(p ORDER BY p.monthly_price) FROM plans p), '[]'::json) AS plans
       FROM businesses b
       LEFT JOIN owners o ON o.business_id = b.id
      WHERE b.id = $1
      LIMIT 1`,
    [businessId]
  );
  return result.rows[0] || null;
}

// business: lo que devuelve loadPlanContext (owner_plan, trial_ends_at, access_until, courtesy_until, plan_id, plans).
//   1. Cortesía vigente                       → Pro
//   2. Suscripción activa                     → su plan (Pro si es una suscripción vieja sin plan)
//   3. Prueba vigente                         → Pro
//   4. Cancelada con período pago vigente     → su plan
//   5. Nada de lo anterior                    → su plan o Inicial (igual el panel queda bloqueado)
function getPlanFeatures(business, now = Date.now()) {
  const b      = business || {};
  const plans  = Array.isArray(b.plans) ? b.plans : [];
  const byCode = (code) => plans.find((p) => p.code === code) || null;
  const chosen = plans.find((p) => Number(p.id) === Number(b.plan_id)) || null;
  const fut    = (d) => !!d && new Date(d).getTime() > now;

  let source, plan;
  if (b.owner_plan === 'courtesy' && (!b.courtesy_until || fut(b.courtesy_until))) {
    source = 'courtesy'; plan = byCode(TRIAL_PLAN_CODE);
  } else if (b.owner_plan === 'active') {
    source = 'plan';     plan = chosen || byCode(TRIAL_PLAN_CODE);
  } else if (fut(b.trial_ends_at)) {
    source = 'trial';    plan = byCode(TRIAL_PLAN_CODE);
  } else if (b.owner_plan === 'cancelled' && fut(b.access_until) && chosen) {
    source = 'plan';     plan = chosen;
  } else {
    source = 'none';     plan = chosen || byCode(FALLBACK_PLAN);
  }

  const features = {
    source,
    code: plan ? plan.code : null,
    name: plan ? plan.name : null,
    monthly_appointment_limit: plan ? Number(plan.monthly_appointment_limit) : null
  };
  for (const k of PLAN_FLAGS) features[k] = !!(plan && plan[k]);
  return features;
}

// Colores y fuente propios solo con custom_branding (el logo va en todos los planes).
// Mismo criterio para la página pública y los mails: devuelve una copia sin esos campos si el plan no los incluye.
const BRAND_PRO_KEYS = ['brand_primary', 'brand_bg', 'brand_text', 'brand_font'];
function brandForPlan(business, features) {
  if (!business || (features && features.custom_branding)) return business;
  const copy = { ...business };
  for (const k of BRAND_PRO_KEYS) copy[k] = null;
  return copy;
}

function isFounderActive(founderUntil, now = Date.now()) {
  return !!founderUntil && new Date(founderUntil).getTime() > now;
}

// Precio fundador: 50% redondeado al peso
function founderPrice(monthlyPrice) {
  return Math.round(Number(monthlyPrice) * FOUNDER_DISCOUNT);
}

// Lo que se cobra por mes por ese plan, con el descuento fundador si está vigente
function planPrice(plan, founderUntil, now = Date.now()) {
  return isFounderActive(founderUntil, now) ? founderPrice(plan.monthly_price) : Number(plan.monthly_price);
}

module.exports = {
  isCourtesyActive, getAccess, ACTIVE_BUSINESS_SQL,
  PLAN_FLAGS, loadPlanContext, getPlanFeatures, isFounderActive, founderPrice, planPrice,
  BRAND_PRO_KEYS, brandForPlan
};
