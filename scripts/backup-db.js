// ==============================
// Backup de la base: exporta TODAS las tablas de public a backups/backup-AAAA-MM-DD-HHmm.json
// ==============================
// Solo lecturas, en una transacción READ ONLY + REPEATABLE READ (foto consistente de todas las tablas).
// Uso: node scripts/backup-db.js
const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client, types } = require('pg');

// Fechas y horas tal cual las guarda Postgres (sin conversión de zona horaria de JS)
for (const oid of [1082, 1114, 1184]) types.setTypeParser(oid, v => v);

const pad = n => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const backup = { created_at: new Date().toISOString(), schema: 'public', tables: {} };
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: tables } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`
    );
    for (const { table_name: name } of tables) {
      const { rows } = await client.query(`SELECT * FROM public.${client.escapeIdentifier(name)}`);
      backup.tables[name] = { count: rows.length, rows };
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }

  const dir  = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `backup-${stamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));

  const size = fs.statSync(file).size;
  console.log(`Backup: ${path.relative(process.cwd(), file)} (${(size / 1024).toFixed(1)} KB)`);
  for (const [name, t] of Object.entries(backup.tables)) {
    console.log(`  ${name.padEnd(20)} ${String(t.count).padStart(6)} filas`);
  }
}

main().catch(err => {
  console.error('Error en el backup:', err.message);
  process.exit(1);
});
