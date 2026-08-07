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

const { MongoClient } = require('mongodb');

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const db = await getDb();
    const { vertical, sku } = req.query || {};
    const filter = { status: 'active' };
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
