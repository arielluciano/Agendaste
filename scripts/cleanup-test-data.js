// ==============================
// Limpieza de datos de prueba: deja SOLO el negocio barberia-demo (sin turnos)
// ==============================
// Uso:
//   node scripts/cleanup-test-data.js           → prueba en seco: solo muestra qué se borraría (solo lecturas)
//   node scripts/cleanup-test-data.js --cancel-mp → cancela en Mercado Pago las suscripciones pending de los negocios a borrar
//   node scripts/cleanup-test-data.js --apply   → borra todo en UNA transacción (ROLLBACK si algo falla),
//                                                 después borra los logos de Storage y recuenta
// Las tablas que dependen de businesses se descubren por sus foreign keys, así una tabla nueva no queda afuera.
// IRREVERSIBLE: correr antes scripts/backup-db.js.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const KEEP_SLUG = 'barberia-demo';
const BUCKET    = 'logos';
const APPLY     = process.argv.includes('--apply');

// Negocios a borrar: todos menos el demo
const DELETED_BUSINESSES = `SELECT id FROM public.businesses WHERE slug IS DISTINCT FROM '${KEEP_SLUG}'`;

// ── Grafo de foreign keys ─────────────────────
async function loadForeignKeys(client) {
  const { rows } = await client.query(
    `SELECT c.conrelid::regclass::text  AS child,
            c.confrelid::regclass::text AS parent,
            array_length(c.conkey, 1)   AS ncols,
            (SELECT attname FROM pg_attribute WHERE attrelid = c.conrelid  AND attnum = c.conkey[1])  AS col,
            (SELECT attname FROM pg_attribute WHERE attrelid = c.confrelid AND attnum = c.confkey[1]) AS ref
       FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`
  );
  const multi = rows.find(r => r.ncols !== 1);
  if (multi) throw new Error(`FK de varias columnas en ${multi.child} → ${multi.parent}: no soportada, revisar a mano`);
  return rows;
}

// Para cada tabla que depende (directa o indirectamente) de businesses, el WHERE de las filas a borrar
function buildPlan(fks) {
  const where = new Map([['businesses', `id IN (${DELETED_BUSINESSES})`]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const fk of fks) {
      if (fk.child === fk.parent || !where.has(fk.parent)) continue;
      const cond = `${fk.col} IN (SELECT ${fk.ref} FROM public.${fk.parent} WHERE ${where.get(fk.parent)})`;
      const prev = where.get(fk.child);
      if (!prev) { where.set(fk.child, cond); changed = true; }
      else if (!prev.includes(cond)) { where.set(fk.child, `${prev} OR ${cond}`); changed = true; }
    }
  }
  // Los turnos se borran todos, también los del demo, para que arranque limpio
  if (where.has('appointments')) where.set('appointments', 'TRUE');

  // Orden de borrado: hijos primero
  const order = [];
  const visiting = new Set();
  const visit = (t) => {
    if (order.includes(t)) return;
    if (visiting.has(t)) throw new Error(`Ciclo de foreign keys en ${t}: revisar a mano`);
    visiting.add(t);
    for (const fk of fks) if (fk.parent === t && fk.child !== t && where.has(fk.child)) visit(fk.child);
    visiting.delete(t);
    order.push(t);
  };
  for (const t of where.keys()) visit(t);
  return order.map(table => ({ table, where: where.get(table) }));
}

// ── Storage ───────────────────────────────────
function storageClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function listAll(sb, prefix) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 100, offset });
    if (error) {
      if (/not found/i.test(error.message)) return out; // no existe el bucket: nada que borrar
      throw new Error(`Storage: ${error.message}`);
    }
    out.push(...data);
    if (data.length < 100) return out;
  }
}

// Archivos de todas las carpetas que no son del demo (carpetas = business_id), incluidas subcarpetas
async function storageFilesToDelete(sb, keepId) {
  const files = [];
  const walk = async (prefix) => {
    for (const item of await listAll(sb, prefix)) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) await walk(full); // carpeta
      else files.push(full);
    }
  };
  for (const item of await listAll(sb, '')) {
    if (item.id === null) {
      if (item.name !== String(keepId)) await walk(item.name);
    } else {
      files.push(item.name); // archivo suelto en la raíz del bucket
    }
  }
  return files;
}

// ── Consultas de reporte ──────────────────────
async function countTables(client, tables) {
  const counts = {};
  for (const t of tables) {
    counts[t] = Number((await client.query(`SELECT COUNT(*) FROM public.${t}`)).rows[0].count);
  }
  return counts;
}

async function report(client, plan, keep) {
  const biz = await client.query(
    `SELECT b.id, b.slug, b.name,
            COALESCE(string_agg(o.email, ', ' ORDER BY o.id), b.owner_email, '(sin dueño)') AS emails
       FROM public.businesses b LEFT JOIN public.owners o ON o.business_id = b.id
      WHERE b.id IN (${DELETED_BUSINESSES})
      GROUP BY b.id ORDER BY b.id`
  );
  console.log(`\nNegocios que se borrarían (${biz.rows.length}):`);
  for (const b of biz.rows) console.log(`  #${b.id}  ${b.slug.padEnd(24)} ${b.name}  —  ${b.emails}`);

  console.log('\nFilas a borrar por tabla (en este orden):');
  for (const step of plan) {
    const total   = Number((await client.query(`SELECT COUNT(*) FROM public.${step.table}`)).rows[0].count);
    const deleted = Number((await client.query(`SELECT COUNT(*) FROM public.${step.table} WHERE ${step.where}`)).rows[0].count);
    console.log(`  ${step.table.padEnd(20)} ${String(deleted).padStart(5)} de ${String(total).padStart(5)}  (quedan ${total - deleted})`);
  }

  const demoAppts = await client.query(
    `SELECT COUNT(*) AS n, MIN(date) AS desde, MAX(date) AS hasta FROM public.appointments WHERE business_id = $1`,
    [keep.id]
  );
  const d = demoAppts.rows[0];
  console.log(`\nTurnos de ${KEEP_SLUG} que también se borran: ${d.n}` +
    (Number(d.n) ? ` (del ${fmtDate(d.desde)} al ${fmtDate(d.hasta)})` : ''));

  const subs = await client.query(
    `SELECT s.id, s.business_id, b.slug, s.mp_preapproval_id, s.status, s.amount, s.updated_at
       FROM public.subscriptions s LEFT JOIN public.businesses b ON b.id = s.business_id
      WHERE s.business_id IN (${DELETED_BUSINESSES})
        AND (s.mp_preapproval_id IS NOT NULL OR s.status = 'authorized')
      ORDER BY (s.status = 'authorized') DESC, s.id`
  );
  return subs.rows;
}

function fmtDate(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
}

function printSubscriptions(subs) {
  if (subs.length === 0) {
    console.log('\nSuscripciones con preapproval o activas en negocios a borrar: ninguna.');
    return;
  }
  const active = subs.filter(s => s.status === 'authorized');
  console.log(`\n⚠️  Suscripciones con preapproval de Mercado Pago o activas (${subs.length}, ${active.length} en 'authorized'):`);
  for (const s of subs) {
    const flag = s.status === 'authorized' ? '  ← ACTIVA: cancelar en MP' : '';
    console.log(`  sub #${s.id}  ${String(s.slug).padEnd(24)} ${String(s.mp_preapproval_id || '—').padEnd(34)} ${String(s.status).padEnd(10)} $${s.amount}${flag}`);
  }
  console.log('   Cancelalas en Mercado Pago ANTES de --apply: al borrar la fila se pierde la referencia y MP seguiría cobrando.');
}

// ── --cancel-mp: cancela en Mercado Pago los preapprovals pending de los negocios a borrar ──
// No toca la base. Sale con código 1 si alguna cancelación falla.
async function cancelMercadoPago() {
  const { MercadoPagoConfig, PreApproval } = require('mercadopago');
  if (!process.env.MP_ACCESS_TOKEN) throw new Error('Falta MP_ACCESS_TOKEN en .env');
  const preApproval = new PreApproval(new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN }));

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let subs;
  try {
    subs = (await client.query(
      `SELECT s.id, b.slug, s.mp_preapproval_id
         FROM public.subscriptions s JOIN public.businesses b ON b.id = s.business_id
        WHERE b.id IN (${DELETED_BUSINESSES})
          AND s.status = 'pending' AND s.mp_preapproval_id IS NOT NULL
        ORDER BY s.id`
    )).rows;
  } finally {
    await client.end();
  }

  console.log(`Suscripciones pending a cancelar en Mercado Pago (${subs.length}):`);
  for (const s of subs) console.log(`  sub #${s.id}  ${s.slug.padEnd(24)} ${s.mp_preapproval_id}`);

  console.log('\nResultado:');
  let failed = 0;
  for (const s of subs) {
    const label = `  sub #${String(s.id).padEnd(3)} ${s.mp_preapproval_id}`;
    try {
      const before = await preApproval.get({ id: s.mp_preapproval_id });
      if (before.status === 'cancelled') {
        console.log(`${label}  ya estaba cancelada en MP ✓`);
        continue;
      }
      const after = await preApproval.update({ id: s.mp_preapproval_id, body: { status: 'cancelled' } });
      if (after.status !== 'cancelled') throw new Error(`MP respondió status "${after.status}"`);
      console.log(`${label}  ${before.status} → cancelled ✓`);
    } catch (err) {
      failed++;
      console.log(`${label}  ❌ ${err.message || err}`);
    }
  }
  console.log(failed ? `\n❌ ${failed} de ${subs.length} fallaron.` : `\nOK: ${subs.length} de ${subs.length} canceladas.`);
  if (failed) process.exitCode = 1;
}

// ── Main ──────────────────────────────────────
async function main() {
  if (process.argv.includes('--cancel-mp')) return cancelMercadoPago();

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const sb = storageClient();

  try {
    // Prueba en seco: todo en una transacción de solo lectura
    await client.query(APPLY ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const keepRows = (await client.query('SELECT id, name FROM public.businesses WHERE slug = $1', [KEEP_SLUG])).rows;
    if (keepRows.length !== 1) throw new Error(`Se esperaba exactamente 1 negocio "${KEEP_SLUG}" y hay ${keepRows.length}. No se toca nada.`);
    const keep = keepRows[0];

    const plan = buildPlan(await loadForeignKeys(client));
    console.log(`${APPLY ? 'APLICANDO' : 'PRUEBA EN SECO (no se borra nada)'} — se conserva #${keep.id} ${KEEP_SLUG} (${keep.name})`);

    const subs = await report(client, plan, keep);
    printSubscriptions(subs);

    let files = [];
    if (sb) {
      files = await storageFilesToDelete(sb, keep.id);
      console.log(`\nArchivos de Storage (bucket ${BUCKET}) a borrar: ${files.length}`);
      for (const f of files) console.log(`  ${f}`);
    } else {
      console.log('\nStorage: falta SUPABASE_URL / SUPABASE_SECRET_KEY, no se revisan los logos.');
    }

    if (!APPLY) {
      await client.query('ROLLBACK');
      console.log('\nNada fue borrado. Para aplicar: node scripts/cleanup-test-data.js --apply');
      return;
    }

    // ── Borrado en una sola transacción, hijos primero ──
    console.log('\nBorrando…');
    for (const step of plan) {
      const r = await client.query(`DELETE FROM public.${step.table} WHERE ${step.where}`);
      console.log(`  ${step.table.padEnd(20)} ${r.rowCount} filas`);
    }
    const left = (await client.query('SELECT COUNT(*) FROM public.businesses')).rows[0].count;
    if (Number(left) !== 1) throw new Error(`Después de borrar quedan ${left} negocios (se esperaba 1)`);
    await client.query('COMMIT');
    console.log('COMMIT ok.');

    // ── Storage (fuera de la transacción: no tiene rollback) ──
    if (sb && files.length) {
      for (let i = 0; i < files.length; i += 100) {
        const { error } = await sb.storage.from(BUCKET).remove(files.slice(i, i + 100));
        if (error) throw new Error(`La base quedó limpia, pero falló el borrado en Storage: ${error.message}`);
      }
      console.log(`Storage: ${files.length} archivos borrados.`);
    }

    // ── Recuento final ──
    const counts = await countTables(client, plan.map(s => s.table).reverse());
    console.log('\nQuedó:');
    for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(20)} ${n}`);
    if (sb) console.log(`  storage ${BUCKET}/ fuera del demo: ${(await storageFilesToDelete(sb, keep.id)).length} archivos`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(`\n❌ ${err.message}${APPLY ? '\nROLLBACK: la base no se modificó (salvo que el error diga lo contrario).' : ''}`);
  process.exit(1);
});
