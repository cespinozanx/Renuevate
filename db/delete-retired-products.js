// db/delete-retired-products.js
//
// Fix 154 (Carlos, 2026-09-24): borrado definitivo de los SKUs mock/de
// prueba que ya estaban desactivados (status:'inactive') pero seguian
// apareciendo en la lista del panel admin -- Carlos los marco con tache en
// captura y pidio explicitamente "quita de la BD y del catalogo... ni como
// deshabilitados los muestres". Este es un DELETE real, distinto del
// mecanismo de RETIRED_DEMO_SKUS en seed-products.js (que solo desactiva).
//
// Seguridad: antes de borrar cada SKU, se revisa la coleccion `orders`
// (api/orders.js / api/checkout.js, campo items[].sku) por si algun pedido
// ya lo referencia. Si hay una orden que lo referencia, ESE sku se salta
// (no se borra) y se reporta al final -- un pedido historico no debe
// quedar apuntando a un producto que ya no existe. Los que no tengan
// ninguna orden asociada si se borran.
//
// Uso: node db/delete-retired-products.js
//
// Ambos grupos son datos de prueba confirmados por Carlos, nunca vendidos:
//  - NACAR-01..04: mock del prototipo original (precio/rating inventados).
//  - VIGOR-01..04 / ROBLE-01..04: "fichas de prueba" de Hair/Spot (Fix 151,
//    2026-09-24) -- los productos reales de esos 2 sistemas se vincularan
//    en un paso posterior, aparte.

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// Mismo cargador manual de .env que db/seed-products.js -- "node
// db/delete-retired-products.js" no lo lee por si solo.
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

const SKUS_TO_DELETE = [
  'NACAR-01', 'NACAR-02', 'NACAR-03', 'NACAR-04',
  'VIGOR-01', 'VIGOR-02', 'VIGOR-03', 'VIGOR-04',
  'ROBLE-01', 'ROBLE-02', 'ROBLE-03', 'ROBLE-04',
];

async function main() {
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(MONGODB_DB);
    const deleted = [];
    const skippedWithOrders = [];
    const notFound = [];

    for (const sku of SKUS_TO_DELETE) {
      const orderCount = await db.collection('orders').countDocuments({ 'items.sku': sku });
      if (orderCount > 0) {
        skippedWithOrders.push({ sku, orderCount });
        console.warn(`[delete-retired-products] SALTADO ${sku}: referenciado en ${orderCount} orden(es) -- no se borra, se deja como esta (inactive).`);
        continue;
      }
      const result = await db.collection('products').deleteOne({ sku });
      if (result.deletedCount > 0) {
        deleted.push(sku);
        console.log(`[delete-retired-products] borrado: ${sku}`);
      } else {
        notFound.push(sku);
        console.log(`[delete-retired-products] no existia en products: ${sku}`);
      }
    }

    console.log('');
    console.log(`[delete-retired-products] resumen: ${deleted.length} borrados, ${skippedWithOrders.length} saltados por orden existente, ${notFound.length} ya no existian.`);
    if (skippedWithOrders.length) {
      console.log('[delete-retired-products] revisar manualmente (tienen historial de pedido):', skippedWithOrders);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('[delete-retired-products] error:', err);
  process.exit(1);
});
