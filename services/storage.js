// ==============================
// Supabase Storage — logos de los negocios
// ==============================
// Usa la clave SECRETA de Supabase (solo backend, nunca al frontend): saltea RLS, así que
// el bucket no necesita policies de escritura. La lectura es pública (bucket público).
const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'logos';

let client = null;
function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

function isConfigured() {
  return !!getClient();
}

// Crea el bucket "logos" (público, solo WebP de hasta 1 MB) si todavía no existe. Una vez por proceso.
let bucketReady = null;
function ensureBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const sb = getClient();
      const { data } = await sb.storage.getBucket(BUCKET);
      if (data) return;
      const { error } = await sb.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: '1MB',
        allowedMimeTypes: ['image/webp']
      });
      if (error && !/already exists/i.test(error.message)) throw new Error(`No se pudo crear el bucket: ${error.message}`);
    })().catch(err => { bucketReady = null; throw err; });
  }
  return bucketReady;
}

// URL pública base de los logos de un negocio: {SUPABASE_URL}/storage/v1/object/public/logos/{id}/
function publicPrefix(businessId) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${BUCKET}/${businessId}/`;
}

// Borra los archivos de la carpeta del negocio, salvo `keepPath`
async function removeBusinessLogos(businessId, keepPath = null) {
  const sb = getClient();
  const { data, error } = await sb.storage.from(BUCKET).list(String(businessId), { limit: 100 });
  if (error) {
    if (/not found/i.test(error.message)) return; // todavía no hay bucket: no hay nada que borrar
    throw new Error(error.message);
  }
  const paths = (data || []).map(f => `${businessId}/${f.name}`).filter(p => p !== keepPath);
  if (paths.length === 0) return;
  const { error: rmError } = await sb.storage.from(BUCKET).remove(paths);
  if (rmError) throw new Error(rmError.message);
}

// Sube el logo ya procesado y devuelve { path, publicUrl }
async function uploadBusinessLogo(businessId, buffer) {
  const sb = getClient();
  await ensureBucket();
  const path = `${businessId}/logo-${Date.now()}.webp`;
  const { error } = await sb.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'image/webp',
    cacheControl: '31536000', // el nombre cambia en cada subida, se puede cachear para siempre
    upsert: false
  });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

module.exports = { BUCKET, isConfigured, publicPrefix, uploadBusinessLogo, removeBusinessLogos };
