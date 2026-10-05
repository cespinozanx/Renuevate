// db/seed-reviews-reales.js  (Fix 207)
// Testimonios REALES que Carlos recibe de clientes (WhatsApp, etc.) y me pasa
// en el chat. Se cargan con el texto TAL CUAL lo escribio la persona; no se
// redacta ni se embellece nada. Si una entrada no trae nombre, se muestra como
// "Cliente Seytú" (sin marcarla como compra verificada, porque no lo es).
//
// Para agregar uno: Carlos pega el mensaje en el chat; Claude agrega una
// entrada abajo, hace commit y Carlos corre cargar-todo.bat.
// Idempotente por seed_tag; NO toca las de ejemplo ni resenas de compradores.
// products.rating no se modifica (el resumen de la ficha se calcula en cliente).

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'azura';
const SEED_TAG = 'renuevate-real-v1';

const REALES = [
  // WhatsApp reenviado, 2026-10-05: "Testimonial de producto / Es genial! Me encanta"
  // Sin nombre ni calificacion en el mensaje: se muestra como Cliente Seytú y 5 estrellas
  // (decision de Carlos: el texto es claramente positivo). Foto: Shampoo Fortificante.
  { sku: 'VIGOR-01', name: 'Cliente Seytú', stars: 5, title: 'Testimonio de producto', text: 'Es genial! Me encanta', photo: 'media/review-vigor-01-shampoo.webp' },
];

async function main() {
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const col = client.db(MONGODB_DB).collection('product_reviews');
    const del = await col.deleteMany({ seed_tag: SEED_TAG });
    if (del.deletedCount) console.log(`[seed-reviews-reales] ${del.deletedCount} anteriores eliminadas (re-siembra limpia).`);
    const now = Date.now();
    const docs = REALES.map((r, i) => ({
      sku: r.sku,
      customer_id: new ObjectId(),
      customer_display_name: r.name,
      stars: r.stars,
      title: r.title || null,
      text: r.text,
      photos: r.photo ? [{ data_url: r.photo, uploaded_at: new Date(now) }] : [],
      status: 'published',
      created_at: new Date(now - (REALES.length - i) * 60000),
      seed_tag: SEED_TAG,
    }));
    if (docs.length) await col.insertMany(docs);
    console.log(`[seed-reviews-reales] ${docs.length} testimonios cargados.`);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('[seed-reviews-reales] error:', err); process.exit(1); });
}

module.exports = { REALES, SEED_TAG };
