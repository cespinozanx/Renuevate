// api/orders.js
// Contrato de datos minimo viable para ordenes (ver db/schema.md, seccion 6, y
// db/collections.js -> VALIDATORS.orders). Al confirmar una orden, inserta el
// documento y dispara lib/promotionsEngine.js -> recordPurchaseForLoyalty para
// que el programa de lealtad tenga de donde contar.
//
// IMPORTANTE - lo que este endpoint NO hace (a proposito, por instruccion explicita):
//   - No procesa pagos ni se conecta a una pasarela (Stripe/Conekta/etc).
//   - No valida ni reserva inventario.
//   - No calcula envio ni impuestos.
//   - No aplica automaticamente los descuentos de loyalty_progress "reward_ready"
//     (eso es una decision de negocio/UX pendiente: si se aplica en esta orden o
//     en la siguiente). Este endpoint solo informa cuales reglas quedaron listas.
//
// POST /api/orders { customerId, items: [{sku, name, vertical, unit_price, qty}], currency }
//
// Fix 109: ya no se confia en el customerId que manda el navegador -- se usa
// la cookie de sesion firmada (lib/session.js), igual que cart.js/addresses.js.

const { MongoClient, ObjectId } = require('mongodb');
const { applyCors } = require('../lib/cors');
const { getSessionCustomerId } = require('../lib/session');
const { checkRateLimit } = require('../lib/rateLimit');
const { recordPurchaseForLoyalty } = require('../lib/promotionsEngine');

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
  applyCors(req, res, 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const db = await getDb();
    // Fix 109: endpoint no usado hoy por el frontend real (ver comentario de
    // archivo) pero sigue siendo alcanzable -- limite estricto.
    if (!(await checkRateLimit(req, res, db, { scope: 'orders', limit: 10, windowSec: 60 }))) return;

    const body = req.body || {};
    const { items, currency } = body;

    const sessionCid = getSessionCustomerId(req);
    if (!sessionCid || !ObjectId.isValid(sessionCid)) {
      res.status(401).json({ error: 'Tu sesion expiro o no has iniciado sesion. Inicia sesion de nuevo.', code: 'SESSION_REQUIRED' });
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'La orden necesita al menos un item.' });
      return;
    }

    let subtotal = 0;
    const cleanItems = [];
    for (const raw of items) {
      const sku = raw && raw.sku;
      const name = raw && raw.name;
      const unitPrice = Number(raw && raw.unit_price);
      const qty = Number(raw && raw.qty);
      if (!sku || !name || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isInteger(qty) || qty < 1) {
        res.status(400).json({ error: 'Cada item necesita sku, name, unit_price (>=0) y qty (entero >=1) validos.' });
        return;
      }
      subtotal += unitPrice * qty;
      // Fix 84: shade (tono, ver NACAR-11/12) es opcional -- este endpoint no
      // se usa hoy desde el frontend (el flujo real de pago es api/checkout.js
      // -> Mercado Pago -> webhook), pero se mantiene consistente con ese
      // mismo contrato por si se vuelve a conectar mas adelante.
      cleanItems.push({ sku, name, vertical: raw.vertical || null, unit_price: unitPrice, qty, shade: raw.shade || null });
    }

    const now = new Date();
    const custId = new ObjectId(sessionCid);

    const order = {
      customer_id: custId,
      items: cleanItems,
      subtotal,
      applied_promotions: [],
      total: subtotal, // MVP: sin envio/impuestos/descuentos aplicados todavia
      currency: currency || 'MXN',
      status: 'confirmed',
      created_at: now,
    };

    const insertResult = await db.collection('orders').insertOne(order);
    order._id = insertResult.insertedId;

    const readyList = await recordPurchaseForLoyalty(db, { customerId: custId, order, now });

    res.status(201).json({
      ok: true,
      order: { id: order._id, total: order.total, currency: order.currency, status: order.status },
      loyalty_rules_reward_ready: readyList.map((r) => ({
        loyalty_rule_id: r.rule._id,
        name: r.rule.name,
        qualifying_count: r.progress.qualifying_count,
      })),
    });
  } catch (err) {
    console.error('orders.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
