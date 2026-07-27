// api/cart.js
// Carrito persistente por cliente (coleccion `carts`, un documento activo por
// customer_id -- ver db/collections.js). El precio/nombre mostrado SIEMPRE se
// recalcula contra `products` al leer el carrito; lo que se guarda en
// `items[].unit_price_snapshot` es solo informativo (para detectar cambios de
// precio entre que se agrego y que se compra), nunca la fuente de verdad.
//
// GET    /api/cart?customerId=...                        -> carrito con precios actuales
// POST   /api/cart { customerId, sku, qty }               -> agrega/incrementa
// PUT    /api/cart { customerId, sku, qty }               -> fija cantidad exacta (qty=0 elimina el item)
// DELETE /api/cart?customerId=...                         -> vacia el carrito completo
// DELETE /api/cart?customerId=...&sku=...                 -> elimina un item
//
// Seguridad (MVP, igual que el resto del backend): no hay sesion de servidor
// todavia -- se confia en el customerId que manda el navegador. Ver nota de
// gap en db/schema.md (sesion/cookie firmada pendiente antes de trafico real).

const { MongoClient, ObjectId } = require('mongodb');

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

function parseCustomerId(raw) {
  if (!raw || !ObjectId.isValid(raw)) return null;
  return new ObjectId(raw);
}

// Recalcula el carrito contra el catalogo real (products). Si un sku ya no
// existe o esta inactivo, se marca unavailable:true y se excluye del total,
// en vez de tronar o cobrar un precio viejo.
async function hydrateCart(db, cartDoc) {
  if (!cartDoc || !cartDoc.items || !cartDoc.items.length) {
    return { items: [], subtotal: 0, currency: 'MXN' };
  }
  const skus = cartDoc.items.map((i) => i.sku);
  const products = await db.collection('products').find({ sku: { $in: skus } }).toArray();
  const bySku = new Map(products.map((p) => [p.sku, p]));

  let subtotal = 0;
  const items = cartDoc.items.map((i) => {
    const product = bySku.get(i.sku);
    if (!product || product.status !== 'active') {
      return { sku: i.sku, qty: i.qty, unavailable: true };
    }
    const lineTotal = product.unit_price * i.qty;
    subtotal += lineTotal;
    return {
      sku: i.sku,
      qty: i.qty,
      name: product.name_i18n,
      unit_price: product.unit_price,
      line_total: lineTotal,
      vertical: product.vertical,
    };
  });

  return { items, subtotal, currency: 'MXN' };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const db = await getDb();
    const now = new Date();

    if (req.method === 'GET') {
      const custId = parseCustomerId((req.query || {}).customerId);
      if (!custId) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }
      const cartDoc = await db.collection('carts').findOne({ customer_id: custId, status: 'active' });
      const hydrated = await hydrateCart(db, cartDoc);
      res.status(200).json({ ok: true, cart: hydrated });
      return;
    }

    if (req.method === 'POST') {
      const { customerId, sku, qty } = req.body || {};
      const custId = parseCustomerId(customerId);
      const quantity = Number(qty) || 1;
      if (!custId) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }
      if (!sku || typeof sku !== 'string') { res.status(400).json({ error: 'sku invalido o faltante.' }); return; }
      if (!Number.isInteger(quantity) || quantity < 1) { res.status(400).json({ error: 'qty debe ser un entero >= 1.' }); return; }

      const product = await db.collection('products').findOne({ sku, status: 'active' });
      if (!product) { res.status(404).json({ error: `El producto ${sku} no existe o no esta disponible.` }); return; }

      const existing = await db.collection('carts').findOne({ customer_id: custId, status: 'active', 'items.sku': sku });
      if (existing) {
        await db.collection('carts').updateOne(
          { customer_id: custId, status: 'active', 'items.sku': sku },
          { $inc: { 'items.$.qty': quantity }, $set: { updated_at: now, 'items.$.unit_price_snapshot': product.unit_price } }
        );
      } else {
        await db.collection('carts').updateOne(
          { customer_id: custId, status: 'active' },
          {
            $push: { items: { sku, qty: quantity, unit_price_snapshot: product.unit_price, added_at: now } },
            $set: { updated_at: now },
            $setOnInsert: { customer_id: custId, status: 'active', created_at: now },
          },
          { upsert: true }
        );
      }

      const cartDoc = await db.collection('carts').findOne({ customer_id: custId, status: 'active' });
      const hydrated = await hydrateCart(db, cartDoc);
      res.status(200).json({ ok: true, cart: hydrated });
      return;
    }

    if (req.method === 'PUT') {
      const { customerId, sku, qty } = req.body || {};
      const custId = parseCustomerId(customerId);
      const quantity = Number(qty);
      if (!custId) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }
      if (!sku || typeof sku !== 'string') { res.status(400).json({ error: 'sku invalido o faltante.' }); return; }
      if (!Number.isInteger(quantity) || quantity < 0) { res.status(400).json({ error: 'qty debe ser un entero >= 0.' }); return; }

      if (quantity === 0) {
        await db.collection('carts').updateOne(
          { customer_id: custId, status: 'active' },
          { $pull: { items: { sku } }, $set: { updated_at: now } }
        );
      } else {
        const product = await db.collection('products').findOne({ sku, status: 'active' });
        if (!product) { res.status(404).json({ error: `El producto ${sku} no existe o no esta disponible.` }); return; }
        const result = await db.collection('carts').updateOne(
          { customer_id: custId, status: 'active', 'items.sku': sku },
          { $set: { 'items.$.qty': quantity, 'items.$.unit_price_snapshot': product.unit_price, updated_at: now } }
        );
        if (result.matchedCount === 0) {
          await db.collection('carts').updateOne(
            { customer_id: custId, status: 'active' },
            {
              $push: { items: { sku, qty: quantity, unit_price_snapshot: product.unit_price, added_at: now } },
              $set: { updated_at: now },
              $setOnInsert: { customer_id: custId, status: 'active', created_at: now },
            },
            { upsert: true }
          );
        }
      }

      const cartDoc = await db.collection('carts').findOne({ customer_id: custId, status: 'active' });
      const hydrated = await hydrateCart(db, cartDoc);
      res.status(200).json({ ok: true, cart: hydrated });
      return;
    }

    if (req.method === 'DELETE') {
      const { customerId, sku } = req.query || {};
      const custId = parseCustomerId(customerId);
      if (!custId) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }

      if (sku) {
        await db.collection('carts').updateOne(
          { customer_id: custId, status: 'active' },
          { $pull: { items: { sku: String(sku) } }, $set: { updated_at: now } }
        );
      } else {
        await db.collection('carts').updateOne(
          { customer_id: custId, status: 'active' },
          { $set: { items: [], updated_at: now } }
        );
      }
      const cartDoc = await db.collection('carts').findOne({ customer_id: custId, status: 'active' });
      const hydrated = await hydrateCart(db, cartDoc);
      res.status(200).json({ ok: true, cart: hydrated });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('cart.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
