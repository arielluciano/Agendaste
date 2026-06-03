// ==============================
// Conexión a Supabase/PostgreSQL
// ==============================
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Probar la conexión al arrancar
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error conectando a la base de datos:', err.message);
  } else {
    console.log('✅ Conectado a Supabase PostgreSQL');
    release();
  }
});

module.exports = pool;