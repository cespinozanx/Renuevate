// api/checkout-webhook.js
// Webhook de Mercado Pago (notifications v2). Mercado Pago llama a esta URL
// cuando cambia el estado de un pago (la URL se manda automaticamente en
// notification_url al crear cada preferencia, ver api/checkout.js -- tambien
// se puede configurar a mano en tu panel de Mercado Pago, ver README.md
// seccion "Mercado Pago").
//
// Por seguridad, NUNCA confiamos en el payload que llega solo -- siempre se
// vuelve a consultar el pago directamente contra la API de Mercado Pago
// usando el Access Token antes de dar por buena una compra (igual disciplina
// que el resto del backend: no confiar en datos que no vienen validados por
// el servidor).
//
// Cuando el pago esta 'approved': crea la orden (coleccion `orders`, mismo
// contrato que api/orders.js), dispara el motor de lealtad y vacia el
// carrito del cliente. Es idempotente por mp_payment_id -- Mercado Pago
// puede reintentar el mismo webhook varias veces.

const { MongoClient, ObjectId } = require('mongodb');
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
  // Mercado Pago espera una respuesta 2xx rapida. Si algo interno falla, se
  // responde 200 igual (para no generar una tormenta de reintentos por un
  // bug nuestro) pero se deja registrado en los logs de Vercel para revisar.
  try {
    const ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!ACCESS_TOKEN) { res.status(200).json({ ok: true, skipped: 'NOT_CONFIGURED' }); return; }

    const query = req.query || {};
    const body = req.body || {};
    const type = query.type || body.type || query.topic || body.topic;
    const paymentId = query['data.id'] || (body.data && body.data.id) || query.id;

    if (type !== 'payment' || !paymentId) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    const payResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    const payment = await payResp.json().catch(() => null);

    if (!payResp.ok || !payment) {
      console.error('checkout-webhook.js - no se pudo leer el pago en Mercado Pago:', payResp.status, payment);
      res.status(200).json({ ok: true, error: 'PAYMENT_LOOKUP_FAILED' });
      return;
    }

    if (payment.status !== 'approved') {
      // pending, rejected, in_process, etc. -- no se crea orden todavia.
      res.status(200).json({ ok: true, status: payment.status });
      return;
    }

    const metaCustomerId = payment.metadata && (payment.metadata.customer_id || payment.metadata.customerId);
    const metaItems = (payment.metadata && payment.metadata.items) || [];
    if (!metaCustomerId || !ObjectId.isValid(metaCustomerId) || !metaItems.length) {
      console.error('checkout-webhook.js - pago aprobado pero sin metadata utilizable:', payment.id);
      res.status(200).json({ ok: true, error: 'MISSING_METADATA' });
      return;
    }

    const db = await getDb();
    const custId = new ObjectId(metaCustomerId);

    const already = await db.collection('orders').findOne({ mp_payment_id: String(payment.id) });
    if (already) { res.status(200).json({ ok: true, already_processed: true }); return; }

    const now = new Date();
    const cleanItems = metaItems.map((it) => ({
      sku: it.id,
      name: it.title,
      vertical: null,
      unit_price: Number(it.unit_price),
      qty: Number(it.quantity),
    }));
    const total = cleanItems.reduce((sum, it) => sum + it.unit_price * it.qty, 0);

    const order = {
      customer_id: custId,
      items: cleanItems,
      subtotal: total,
      applied_promotions: [],
      total,
      currency: payment.currency_id || 'MXN',
      status: 'confirmed',
      mp_payment_id: String(payment.id),
      created_at: now,
    };
    const insertResult = await db.collection('orders').insertOne(order);
    order._id = insertResult.insertedId;

    await recordPurchaseForLoyalty(db, { customerId: custId, order, now });

    // La compra ya quedo registrada como orden -- se vacia el carrito activo.
    await db.collection('carts').updateOne(
      { customer_id: custId, status: 'active' },
      { $set: { items: [], updated_at: now } }
    );

    res.status(200).json({ ok: true, order_id: order._id });
  } catch (err) {
    console.error('checkout-webhook.js error:', err);
    res.status(200).json({ ok: true, error: 'INTERNAL_ERROR' });
  }
};
