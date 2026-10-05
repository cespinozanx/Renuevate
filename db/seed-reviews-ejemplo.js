// db/seed-reviews-ejemplo.js  (Fix 204)
// Carga reseñas de EJEMPLO con foto, claramente marcadas como tales, para que
// la ficha del producto muestre la maqueta completa (foto + estrellas + texto)
// mientras Carlos redacta o recibe las reseñas reales.
//
// Criterio: NO se inventan opiniones de clientes con nombre y voz propia. Cada
// entrada lleva autor "Reseña de ejemplo" y un texto que dice que es de
// ejemplo, para que nadie lo lea como una opinion real. Carlos reemplaza
// `text`, `title`, `name` y `stars` por la reseña real (con autorizacion del
// cliente para usar su foto) y vuelve a correr el script.
//
// Como editar:
//   1) Cambia los campos en el arreglo EJEMPLOS de abajo y corre
//      `node db/seed-reviews-ejemplo.js` (idempotente: borra y reinserta solo
//      las del seed_tag 'renuevate-ejemplo-v1'), o
//   2) Edita el documento directo en Mongo (coleccion product_reviews).
// Para quitarlas todas antes del lanzamiento:
//   node db/seed-reviews-ejemplo.js --purge
//
// No toca products.rating (los ejemplos no deben mover el promedio de la
// tarjeta). El resumen de estrellas dentro de la ficha si las cuenta, porque
// se calcula en el cliente sobre las resenas publicadas: ajusta `stars`.

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
const SEED_TAG = 'renuevate-ejemplo-v1';

const NAME = 'Reseña de ejemplo';
const TITLE = 'Ejemplo: reemplazar con reseña real';
const TEXT = 'Texto de ejemplo para maquetación. Reemplázalo con la reseña real del cliente antes de publicar.';

const EJEMPLOS = [
  // NACAR-16 Crema para Contorno de Ojos (en la foto aparece junto a la Crema de Dia Time-Specialist)
  { sku: 'NACAR-16', photo: 'media/review-ejemplo-nacar-16-contorno-ojos.webp' },
  // VIGOR-01 Shampoo Fortificante
  { sku: 'VIGOR-01', photo: 'media/review-ejemplo-vigor-01-shampoo.webp' },
  // VIGOR-02 Locion Capilar Fortificante (en la foto aparece junto al Shampoo)
  { sku: 'VIGOR-02', photo: 'media/review-ejemplo-vigor-02-locion.webp' },
  // NACAR-09 Protector Solar Facial FPS 50+
  { sku: 'NACAR-09', photo: 'media/review-ejemplo-nacar-09-protector.webp' },
  // NACAR-10 Suero Facial de Hidratacion Profunda con Aloe Vera
  { sku: 'NACAR-10', photo: 'media/review-ejemplo-nacar-10-suero-aloe.webp' },
].map((e) => ({ name: NAME, stars: 5, title: TITLE, text: TEXT, ...e }));

async function main() {
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const purge = process.argv.includes('--purge');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const col = client.db(MONGODB_DB).collection('product_reviews');
    const del = await col.deleteMany({ seed_tag: SEED_TAG });
    console.log(`[seed-reviews-ejemplo] ${del.deletedCount} reseñas de ejemplo anteriores eliminadas.`);
    if (purge) { console.log('[seed-reviews-ejemplo] purga completa.'); return; }
    const now = Date.now();
    const docs = EJEMPLOS.map((r, i) => ({
      sku: r.sku,
      customer_id: new ObjectId(),
      customer_display_name: r.name,
      stars: r.stars,
      title: r.title,
      text: r.text,
      photos: r.photo ? [{ data_url: r.photo, uploaded_at: new Date(now) }] : [],
      status: 'published',
      created_at: new Date(now - (EJEMPLOS.length - i) * 60000),
      seed_tag: SEED_TAG,
    }));
    await col.insertMany(docs);
    console.log(`[seed-reviews-ejemplo] ${docs.length} reseñas de ejemplo insertadas.`);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('[seed-reviews-ejemplo] error:', err); process.exit(1); });
}

module.exports = { EJEMPLOS, SEED_TAG };
