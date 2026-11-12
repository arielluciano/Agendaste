const test = require('node:test');
const assert = require('node:assert');
const { getPlanFeatures, planPrice, founderPrice, isFounderActive } = require('../services/access');
const { monthRangeAR, usageLevel, usageMessage, countMonthlyAppointments, notifyUsageIfNeeded } = require('../services/usage');
const { runFounderJobs, changePlan } = require('../services/billing');

const DAY = 864e5;
const NOW = Date.parse('2026-11-12T15:00:00Z');
const PLANS = [
  { id: 1, code: 'inicial', name: 'Inicial', monthly_price: 14900, monthly_appointment_limit: 80,  custom_branding: false, embed: false, whatsapp: false, deposits: false, remove_agendaste_footer: false, priority_support: false },
  { id: 2, code: 'pro',     name: 'Pro',     monthly_price: 24900, monthly_appointment_limit: 250, custom_branding: true,  embed: true,  whatsapp: false, deposits: false, remove_agendaste_footer: false, priority_support: false },
  { id: 3, code: 'plus',    name: 'Plus',    monthly_price: 39900, monthly_appointment_limit: 600, custom_branding: true,  embed: true,  whatsapp: false, deposits: false, remove_agendaste_footer: true,  priority_support: true }
];
const iso = (ms) => new Date(ms).toISOString();
const biz = (o) => ({ plans: PLANS, owner_plan: 'trial', trial_ends_at: iso(NOW - DAY), access_until: null, courtesy_until: null, plan_id: null, ...o });

// ── Funciones por plan ──
test('features por plan: Inicial, Pro y Plus con suscripción activa', () => {
  const ini = getPlanFeatures(biz({ owner_plan: 'active', plan_id: 1 }), NOW);
  assert.deepStrictEqual(
    [ini.code, ini.monthly_appointment_limit, ini.custom_branding, ini.embed, ini.remove_agendaste_footer],
    ['inicial', 80, false, false, false]);
  const pro = getPlanFeatures(biz({ owner_plan: 'active', plan_id: 2 }), NOW);
  assert.deepStrictEqual(
    [pro.code, pro.monthly_appointment_limit, pro.custom_branding, pro.embed, pro.remove_agendaste_footer, pro.whatsapp, pro.deposits],
    ['pro', 250, true, true, false, false, false]);
  const plus = getPlanFeatures(biz({ owner_plan: 'active', plan_id: 3 }), NOW);
  assert.deepStrictEqual(
    [plus.code, plus.custom_branding, plus.embed, plus.remove_agendaste_footer, plus.priority_support],
    ['plus', true, true, true, true]);
  assert.strictEqual(plus.source, 'plan');
});

test('prueba y cortesía tienen todo lo del Pro', () => {
  const trial = getPlanFeatures(biz({ trial_ends_at: iso(NOW + 3 * DAY) }), NOW);
  assert.strictEqual(trial.source, 'trial');
  assert.strictEqual(trial.code, 'pro');
  assert.ok(trial.custom_branding && trial.embed);

  for (const courtesy_until of [null, iso(NOW + DAY)]) {
    const c = getPlanFeatures(biz({ owner_plan: 'courtesy', courtesy_until, plan_id: 1 }), NOW);
    assert.strictEqual(c.source, 'courtesy');
    assert.strictEqual(c.code, 'pro');
    assert.strictEqual(c.monthly_appointment_limit, 250);
  }
  // Cortesía vencida y prueba vencida: ya no es Pro
  const expired = getPlanFeatures(biz({ owner_plan: 'courtesy', courtesy_until: iso(NOW - DAY) }), NOW);
  assert.strictEqual(expired.source, 'none');
  assert.strictEqual(expired.code, 'inicial');
});

test('suscripción activa manda sobre la prueba; cancelada conserva su plan hasta access_until', () => {
  const f = getPlanFeatures(biz({ owner_plan: 'active', plan_id: 1, trial_ends_at: iso(NOW + 5 * DAY) }), NOW);
  assert.strictEqual(f.code, 'inicial');
  const c = getPlanFeatures(biz({ owner_plan: 'cancelled', plan_id: 3, access_until: iso(NOW + 10 * DAY) }), NOW);
  assert.strictEqual(c.code, 'plus');
  const gone = getPlanFeatures(biz({ owner_plan: 'cancelled', plan_id: 3, access_until: iso(NOW - DAY) }), NOW);
  assert.strictEqual(gone.source, 'none');
  // Suscripción vieja (sin plan elegido): Pro
  assert.strictEqual(getPlanFeatures(biz({ owner_plan: 'active' }), NOW).code, 'pro');
});

// ── Precio fundador ──
test('precio fundador: 50% mientras founder_until esté vigente', () => {
  assert.strictEqual(founderPrice(14900), 7450);
  assert.strictEqual(founderPrice(24900), 12450);
  assert.strictEqual(founderPrice(39900), 19950);
  assert.strictEqual(planPrice(PLANS[1], iso(NOW + DAY), NOW), 12450);
  assert.strictEqual(planPrice(PLANS[1], iso(NOW - DAY), NOW), 24900);
  assert.strictEqual(planPrice(PLANS[1], null, NOW), 24900);
  assert.ok(isFounderActive(iso(NOW + 1000), NOW));
  assert.ok(!isFounderActive(null, NOW));
});

// ── Conteo mensual en hora AR ──
test('mes calendario en hora de Argentina', () => {
  // 30/11 23:30 en Argentina = 1/12 02:30 UTC → sigue siendo noviembre
  const nov = monthRangeAR(new Date('2026-12-01T02:30:00Z'));
  assert.strictEqual(nov.period, '2026-11');
  assert.strictEqual(nov.start.toISOString(), '2026-11-01T03:00:00.000Z');
  assert.strictEqual(nov.end.toISOString(), '2026-12-01T03:00:00.000Z');
  // 1/12 00:00 en Argentina → diciembre
  assert.strictEqual(monthRangeAR(new Date('2026-12-01T03:00:00Z')).period, '2026-12');
  // Cambio de año
  const jan = monthRangeAR(new Date('2027-01-01T02:59:59Z'));
  assert.strictEqual(jan.period, '2026-12');
  assert.strictEqual(jan.end.toISOString(), '2027-01-01T03:00:00.000Z');
});

test('el conteo usa los límites del mes AR y excluye cancelados', async () => {
  let call;
  const db = { query: async (sql, params) => { call = { sql, params }; return { rows: [{ n: 7 }] }; } };
  const n = await countMonthlyAppointments(9, new Date('2026-12-01T02:30:00Z'), db);
  assert.strictEqual(n, 7);
  assert.deepStrictEqual(call.params, [9, '2026-11-01T03:00:00.000Z', '2026-12-01T03:00:00.000Z']);
  assert.match(call.sql, /status IS DISTINCT FROM 'cancelled'/);
  assert.match(call.sql, /created_at AT TIME ZONE 'UTC' >= \$2/);
});

test('umbrales de uso: 80% y 100%', () => {
  assert.strictEqual(usageLevel(63, 80), 0);
  assert.strictEqual(usageLevel(64, 80), 80);
  assert.strictEqual(usageLevel(79, 80), 80);
  assert.strictEqual(usageLevel(80, 80), 100);
  assert.strictEqual(usageLevel(95, 80), 100);
  assert.strictEqual(usageLevel(10, null), 0);
  assert.strictEqual(usageMessage(72, 80), 'Usaste 72 de 80 turnos este mes');
});

// ── Avisos de límite sin duplicar ──
// Base falsa: negocio con plan Inicial activo, N turnos en el mes y la tabla de avisos en memoria
function usageDb({ count, planId = 1 }) {
  const notices = new Set();
  const db = {
    count, notices,
    query: async (sql, params) => {
      if (/FROM businesses b\s+LEFT JOIN owners o/.test(sql) && /json_agg/.test(sql)) {
        return { rows: [{ id: 9, plan_id: planId, founder_until: null, courtesy_until: null, owner_plan: 'active', trial_ends_at: null, access_until: null, plans: PLANS }] };
      }
      if (/COUNT\(\*\)::int AS n FROM appointments/.test(sql)) return { rows: [{ n: db.count }] };
      if (/INSERT INTO plan_usage_notices/.test(sql)) {
        const [id, period, kinds] = params;
        const rows = [];
        for (const k of kinds) { const key = `${id}|${period}|${k}`; if (!notices.has(key)) { notices.add(key); rows.push({ kind: k }); } }
        return { rows };
      }
      if (/DELETE FROM plan_usage_notices/.test(sql)) {
        const [id, period, kinds] = params;
        kinds.forEach((k) => notices.delete(`${id}|${period}|${k}`));
        return { rows: [] };
      }
      if (/SELECT b.name, o.email/.test(sql)) return { rows: [{ name: 'Barbe', email: 'duenio@example.com' }] };
      throw new Error('SQL inesperado: ' + sql);
    }
  };
  return db;
}

test('avisos de uso: uno por umbral por mes, sin duplicar', async () => {
  const db = usageDb({ count: 60 });
  const sent = [];
  const deps = { db, now: new Date(NOW), sendEmail: async (m) => sent.push(m) };

  assert.strictEqual(await notifyUsageIfNeeded(9, deps), null);            // 60/80: nada
  db.count = 64;
  assert.strictEqual((await notifyUsageIfNeeded(9, deps)).threshold, 80);  // 80%
  db.count = 65;
  assert.strictEqual(await notifyUsageIfNeeded(9, deps), null);            // ya avisado
  db.count = 80;
  assert.strictEqual((await notifyUsageIfNeeded(9, deps)).threshold, 100); // 100%
  db.count = 95;
  assert.strictEqual(await notifyUsageIfNeeded(9, deps), null);            // ya avisado
  assert.deepStrictEqual(sent.map((m) => m.threshold), [80, 100]);
  assert.strictEqual(sent[0].nextPlan.name, 'Pro');
  assert.strictEqual(sent[0].to, 'duenio@example.com');

  // Mes siguiente: vuelve a avisar
  await notifyUsageIfNeeded(9, { ...deps, now: new Date('2026-12-02T12:00:00Z') });
  assert.strictEqual(sent.length, 3);
});

test('avisos de uso: si se cruzan los dos umbrales de golpe, un solo mail', async () => {
  const db = usageDb({ count: 85 });
  const sent = [];
  const deps = { db, now: new Date(NOW), sendEmail: async (m) => sent.push(m) };
  await notifyUsageIfNeeded(9, deps);
  await notifyUsageIfNeeded(9, deps);
  assert.deepStrictEqual(sent.map((m) => m.threshold), [100]);
  assert.strictEqual(db.notices.size, 2);
});

test('avisos de uso: si el mail falla se libera para reintentar', async () => {
  const db = usageDb({ count: 70 });
  let fail = true;
  const sent = [];
  const deps = { db, now: new Date(NOW), sendEmail: async (m) => { if (fail) throw new Error('Resend caído'); sent.push(m); } };
  const origError = console.error; console.error = () => {};
  try { assert.strictEqual(await notifyUsageIfNeeded(9, deps), null); } finally { console.error = origError; }
  assert.strictEqual(db.notices.size, 0);
  fail = false;
  assert.strictEqual((await notifyUsageIfNeeded(9, deps)).threshold, 80);
  assert.strictEqual(sent.length, 1);
});

// ── Fin del precio fundador (cron) ──
function founderDb(row) {
  const notices = new Set();
  const updates = [];
  return {
    notices, updates, row,
    query: async (sql, params) => {
      if (/JOIN LATERAL/.test(sql)) return { rows: [row] };
      if (/INSERT INTO plan_usage_notices/.test(sql)) {
        const key = params.join('|');
        if (notices.has(key)) return { rows: [] };
        notices.add(key); return { rows: [{ kind: params[2] }] };
      }
      if (/UPDATE subscriptions SET amount/.test(sql)) { updates.push(params); row.amount = String(params[0]); return { rows: [] }; }
      if (/DELETE FROM plan_usage_notices/.test(sql)) return { rows: [] };
      throw new Error('SQL inesperado: ' + sql);
    }
  };
}
const founderRow = (o) => ({
  id: 9, name: 'Barbe', email: 'duenio@example.com', plan_name: 'Pro', monthly_price: 24900,
  subscription_id: 5, mp_preapproval_id: 'pre-1', amount: '12450', founder_until: iso(NOW + 5 * DAY), ...o
});

test('precio fundador: aviso 7 días antes, una sola vez', async () => {
  const db = founderDb(founderRow());
  const mails = [];
  const deps = { db, now: NOW, sendEmail: async (m) => mails.push(m), preApproval: { update: async () => assert.fail('no debería tocar MP') } };
  await runFounderJobs(deps);
  await runFounderJobs({ ...deps, now: NOW + 600e3 });
  assert.strictEqual(mails.length, 1);
  assert.strictEqual(mails[0].amount, 24900);
  // Faltando más de 7 días: nada
  const far = founderDb(founderRow({ founder_until: iso(NOW + 8 * DAY) }));
  const r = await runFounderJobs({ ...deps, db: far });
  assert.deepStrictEqual(r.notified, []);
});

test('precio fundador: al vencer actualiza el PreApproval al precio completo, idempotente', async () => {
  const db = founderDb(founderRow({ founder_until: iso(NOW - DAY) }));
  const mp = [];
  const deps = { db, now: NOW, sendEmail: async () => {}, preApproval: { update: async (a) => mp.push(a) } };
  const r = await runFounderJobs(deps);
  assert.deepStrictEqual(r.updated, [9]);
  assert.deepStrictEqual(mp, [{ id: 'pre-1', body: { auto_recurring: { transaction_amount: 24900, currency_id: 'ARS' } } }]);
  assert.deepStrictEqual(db.updates, [[24900, 5]]);
  // Ya actualizado: no vuelve a llamar a MP (ni hoy ni mañana)
  await runFounderJobs(deps);
  await runFounderJobs({ ...deps, now: NOW + DAY });
  assert.strictEqual(mp.length, 1);
});

test('precio fundador: si MP falla reintenta recién al día siguiente', async () => {
  const db = founderDb(founderRow({ founder_until: iso(NOW - DAY) }));
  let fail = true;
  const mp = [];
  const deps = { db, now: NOW, sendEmail: async () => {}, preApproval: { update: async (a) => { mp.push(a); if (fail) throw new Error('MP 500'); } } };
  const origError = console.error; console.error = () => {};
  try {
    assert.deepStrictEqual((await runFounderJobs(deps)).failed, [9]);
    await runFounderJobs({ ...deps, now: NOW + 3600e3 });   // mismo día: no reintenta
    assert.strictEqual(mp.length, 1);
    assert.strictEqual(db.row.amount, '12450');
    fail = false;
    assert.deepStrictEqual((await runFounderJobs({ ...deps, now: NOW + DAY })).updated, [9]);
  } finally { console.error = origError; }
  assert.strictEqual(mp.length, 2);
});

test('precio fundador: no toca suscripciones que no cobran el precio fundador', async () => {
  const db = founderDb(founderRow({ founder_until: iso(NOW - DAY), amount: '24900' }));
  const r = await runFounderJobs({ db, now: NOW, sendEmail: async () => {}, preApproval: { update: async () => assert.fail('no') } });
  assert.deepStrictEqual(r.updated, []);
});

// ── Cambio de plan ──
function changeDb({ owner_plan = 'active', status = 'authorized', plan_id = 1, founder_until = null } = {}) {
  const writes = [];
  return {
    writes,
    query: async (sql, params) => {
      if (/SELECT \* FROM plans WHERE code/.test(sql)) return { rows: PLANS.filter((p) => p.code === params[0]) };
      if (/SELECT b.plan_id, b.founder_until/.test(sql)) return { rows: [{ plan_id, founder_until, owner_plan }] };
      if (/SELECT \* FROM subscriptions/.test(sql)) return { rows: [{ id: 5, status, mp_preapproval_id: 'pre-1', amount: '14900' }] };
      if (/^UPDATE/.test(sql.trim())) { writes.push([sql.trim().split(' ')[1], params]); return { rows: [] }; }
      throw new Error('SQL inesperado: ' + sql);
    }
  };
}

test('cambio de plan: actualiza MP y después el plan del negocio (con precio fundador)', async () => {
  const db = changeDb({ founder_until: iso(Date.now() + 30 * DAY) });
  const mp = [];
  const r = await changePlan(9, 'pro', { db, preApproval: { update: async (a) => mp.push(a) } });
  assert.strictEqual(r.amount, 12450);
  assert.strictEqual(mp[0].body.auto_recurring.transaction_amount, 12450);
  assert.deepStrictEqual(db.writes.map((w) => w[0]), ['subscriptions', 'businesses']);
  assert.deepStrictEqual(db.writes[1][1], [2, 9]);
});

test('cambio de plan: si MP falla no cambia plan_id', async () => {
  const db = changeDb();
  const origError = console.error; console.error = () => {};
  let r;
  try { r = await changePlan(9, 'plus', { db, preApproval: { update: async () => { throw new Error('MP 400'); } } }); }
  finally { console.error = origError; }
  assert.strictEqual(r.status, 502);
  assert.match(r.error, /No se cambió nada/);
  assert.deepStrictEqual(db.writes, []);
});

test('cambio de plan: requiere suscripción activa y otro plan', async () => {
  const mp = { update: async () => assert.fail('no') };
  assert.strictEqual((await changePlan(9, 'pro', { db: changeDb({ owner_plan: 'trial' }), preApproval: mp })).status, 409);
  assert.strictEqual((await changePlan(9, 'pro', { db: changeDb({ status: 'pending' }), preApproval: mp })).status, 409);
  assert.strictEqual((await changePlan(9, 'inicial', { db: changeDb({ plan_id: 1 }), preApproval: mp })).status, 409);
  assert.strictEqual((await changePlan(9, 'gold', { db: changeDb(), preApproval: mp })).status, 400);
});
