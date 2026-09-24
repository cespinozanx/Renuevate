// api/products.js
// Catalogo server-side (coleccion `products`, ver db/collections.js y
// db/seed-products.js). Fuente de verdad para validar sku/precio -- el
// frontend puede seguir mostrando su copia estatica para renderizar rapido,
// pero api/cart.js y api/reviews.js SIEMPRE consultan aqui antes de aceptar
// un sku o mostrar un precio, nunca confian en lo que manda el navegador.
//
// GET /api/products              -> todos los productos activos
// GET /api/products?vertical=nacar -> solo esa vertical
// GET /api/products?sku=NACAR-01   -> un producto puntual
// GET /api/products?includeInactive=1 -> Fix 137: tambien incluye los
//   marcados status:'inactive' (ver nota junto al filtro mas abajo). Solo lo
//   usa la hidratacion del catalogo publico en index.html.

const { MongoClient } = require('mongodb');
const { applyCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rateLimit');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'azura';

let cachedClient = null;
async function getDb() {
  if (cachedClient) return cachedClient.db(MONGODB_DB);
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db(MONGODB_DB);
}

module.exports = async (req, res) => {
  applyCors(req, res, 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const db = await getDb();
    // Fix 109: catalogo publico, se espera alto trafico legitimo (cada carga
    // de pagina lo consulta) -- limite generoso, solo para frenar scripts.
    if (!(await checkRateLimit(req, res, db, { scope: 'products', limit: 120, windowSec: 60 }))) return;
    // Fix 137: includeInactive es opcional y aditivo -- SOLO cuando se manda
    // explicitamente, la respuesta tambien incluye productos status:'inactive'.
    // Sin el parametro, el comportamiento es identico al de siempre (solo
    // activos), asi que ningun consumidor existente cambia: cart.js/reviews.js
    // ni siquiera llaman este endpoint (consultan Mongo directo, ver esos
    // archivos), y el fetch original del catalogo publico tampoco lo manda.
    const { vertical, sku, includeInactive } = req.query || {};
    const filter = {};
    if (!includeInactive) filter.status = 'active';
    if (vertical) filter.vertical = String(vertical);
    if (sku) filter.sku = String(sku);

    const products = await db
      .collection('products')
      .find(filter)
      .project({ _id: 0 })
      .toArray();

    res.status(200).json({ ok: true, products });
  } catch (err) {
    console.error('products.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
