// db/seed-reviews.js
// Siembra resenas de ejemplo en `product_reviews` para que las fichas de los
// 4 productos reales de skincare (NACAR-06/07/08/09) no se vean vacias
// mientras no hay trafico real de compra verificada -- el POST real de
// /api/reviews exige una orden confirmada antes de aceptar una resena (ver
// Fix 60/90/91), asi que sin clientes/ordenes reales todavia, la unica forma
// de que las fichas muestren contenido es sembrando directo a la base, igual
// que sembrar-productos.bat siembra el catalogo.
//
// Instruccion de Carlos: "carga algunos comentarios de los que hicimos
// antes, 2 y tres comentarios en cada uno [de 4 productos]". Los textos de
// abajo son los mismos 6 comentarios de ejemplo que antes vivian
// hardcodeados en el frontend (demoComments, eliminados en Fix 90 porque no
// estaban ligados a ningun producto ni compra real) mas 4 nuevos en el mismo
// tono, ahora repartidos 3/2/3/2 entre los 4 productos reales y guardados
// como filas reales de product_reviews (sku -> products.sku), no como texto
// de relleno en el frontend -- exactamente la estructura que se corrigio en
// Fix 90/91.
//
// Idempotente: cada resena trae seed_tag='renuevate-demo-v1'. Si se vuelve a
// correr, borra las que el mismo script haya insertado antes y las vuelve a
// crear -- nunca toca una resena real de un cliente (esas no traen ese tag).
// Al final recalcula products.rating {stars, count} para los 4 skus, igual
// que recomputeRating() en api/reviews.js.
//
// Correr una sola vez (o cuantas veces se quiera refrescar):
//   node db/seed-reviews.js
//
// Requisito: el mismo .env (MONGODB_URI/MONGODB_DB) que ya usa seed-products.js.

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'azura';
const SEED_TAG = 'renuevate-demo-v1';

const REVIEWS = [
  // NACAR-06 -- Espuma Limpiadora Facial (3 resenas)
  { sku: 'NACAR-06', name: 'Renata M.', stars: 5, title: 'Llega rápido y no reseca', text: 'Llego rápido y bien empacado. La espuma no reseca, la uso a diario.', photo: 'media/nacar-06-espuma-lifestyle-mano.webp' },
  { sku: 'NACAR-06', name: 'Paola S.', stars: 5, title: 'Textura increíble', text: 'Me encanto la textura, no deja la piel grasosa.' },
  { sku: 'NACAR-06', name: 'Lucia P.', stars: 4, title: 'Rinde bastante', text: 'Buena espuma, rinde bastante. Solo me gustaria que el dispensador durara un poco mas.' },

  // NACAR-07 -- Omniplus Gel Premium (2 resenas)
  { sku: 'NACAR-07', name: 'Diego H.', stars: 4, title: 'Buen producto', text: 'Buen producto, aunque el envío se tardo un poco mas de lo que decia.' },
  { sku: 'NACAR-07', name: 'Sofia R.', stars: 5, title: 'Ligero y refrescante', text: 'El gel se siente ligero y refresca al instante, ya es parte de mi rutina de las mananas.' },

  // NACAR-08 -- Crema de Dia FPS 30 (3 resenas)
  { sku: 'NACAR-08', name: 'Andrea Q.', stars: 4, title: 'Cumple lo que promete', text: 'Cumple, aunque el precio esta un poco alto para lo que rinde.' },
  { sku: 'NACAR-08', name: 'Miguel T.', stars: 5, title: 'Se la regale a mi esposa y le encanto', text: 'Se la regale a mi esposa y le encanto, ya la volvio a pedir.' },
  { sku: 'NACAR-08', name: 'Karla M.', stars: 5, title: 'Perfecta para uso diario', text: 'Hidrata bien sin sentirse pesada bajo el maquillaje, buena opcion para uso diario.' },

  // NACAR-09 -- Protector Solar Facial FPS 50+ (2 resenas)
  { sku: 'NACAR-09', name: 'Fernanda L.', stars: 5, title: 'No deja la cara blanca', text: 'El protector solar no deja la cara blanca, eso ya es ganancia.', photo: 'media/nacar-09-spf50-abierto.webp' },
  { sku: 'NACAR-09', name: 'Roberto G.', stars: 4, title: 'Buena proteccion', text: 'Buen protector, no irrita los ojos. Le doy 4 estrellas porque tarda un poco en absorber.' },
];

// Misma logica que recomputeRating() en api/reviews.js -- se duplica aqui
// (en vez de importarla) porque este script corre standalone con `node
// db/seed-reviews.js`, sin pasar por el runtime de Vercel.
async function recomputeRating(db, sku) {
  const published = await db.collection('product_reviews').find({ sku, status: 'published' }).toArray();
  const count = published.length;
  const stars = count ? Math.round((published.reduce((sum, r) => sum + r.stars, 0) / count) * 10) / 10 : 0;
  await db.collection('products').updateOne({ sku }, { $set: { rating: { stars, count }, updated_at: new Date() } });
  return { stars, count };
}

async function main() {
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(MONGODB_DB);

    const del = await db.collection('product_reviews').deleteMany({ seed_tag: SEED_TAG });
    if (del.deletedCount) console.log(`[seed-reviews] ${del.deletedCount} resenas de siembra anteriores eliminadas (re-siembra limpia).`);

    const now = Date.now();
    const docs = REVIEWS.map((r, i) => ({
      sku: r.sku,
      customer_id: new ObjectId(),
      customer_display_name: r.name,
      stars: r.stars,
      title: r.title || null,
      text: r.text,
      photos: r.photo ? [{ data_url: r.photo, uploaded_at: new Date(now) }] : [],
      status: 'published',
      // Escalonadas en el tiempo (la mas nueva = ultima del arreglo) para que
      // el orden "mas reciente primero" del GET /api/reviews (sort created_at:-1)
      // se vea natural, no todas con el mismo timestamp exacto.
      created_at: new Date(now - (REVIEWS.length - i) * 3600000),
      seed_tag: SEED_TAG,
    }));

    await db.collection('product_reviews').insertMany(docs);
    console.log(`[seed-reviews] ${docs.length} resenas insertadas.`);

    const skus = [...new Set(REVIEWS.map((r) => r.sku))];
    for (const sku of skus) {
      const rating = await recomputeRating(db, sku);
      console.log(`[seed-reviews] ${sku} -> rating recalculado: ${rating.stars} (${rating.count} resenas)`);
    }

    console.log('[seed-reviews] listo.');
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed-reviews] error:', err);
    process.exit(1);
  });
}

module.exports = { REVIEWS, SEED_TAG };
