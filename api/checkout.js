// api/checkout.js
// Crea una preferencia de pago en Mercado Pago Checkout Pro a partir del
// carrito real del cliente (recalculado siempre contra `products`, nunca se
// confia en lo que mande el navegador -- misma disciplina que api/cart.js).
// El sitio NUNCA ve ni procesa el numero de tarjeta: Mercado Pago hospeda el
// formulario de pago completo en su propio dominio. Este endpoint solo pide
// la URL de ese formulario (init_point) y el frontend redirige ahi.
//
// POST /api/checkout { customerId }
//   -> 200 { ok:true, init_point, sandbox_init_point, preference_id }
//   -> 400 si el carrito esta vacio, no tiene items disponibles, o customerId invalido
//   -> 501 { error:'NOT_CONFIGURED' } si falta MERCADOPAGO_ACCESS_TOKEN
//   -> 502 si Mercado Pago rechaza la solicitud
//
// GET|POST /api/checkout?action=webhook  -- webhook de Mercado Pago (notifications v2).
// Vive en este mismo archivo (en vez de api/checkout-webhook.js) porque el plan
// Hobby de Vercel limita a 12 Serverless Functions por deployment: separarlo en
// dos archivos nos puso en 13 y tumbo el build (ver Deploy Logs del 09-ago-2026,
// commit 1f1c083, error "No more than 12 Serverless Functions..."). Mercado Pago
// llama a esta URL cuando cambia el estado de un pago (se manda automaticamente
// en notification_url al crear cada preferencia, mas abajo). Por seguridad,
// NUNCA confiamos en el payload que llega solo -- siempre se vuelve a consultar
// el pago directamente contra la API de Mercado Pago usando el Access Token
// antes de dar por buena una compra. Cuando el pago esta 'approved': crea la
// orden (coleccion `orders`, mismo contrato que api/orders.js), dispara el
// motor de lealtad y vacia el carrito del cliente. Es idempotente por
// mp_payment_id -- Mercado Pago puede reintentar el mismo webhook varias veces.
//
// Ver README.md seccion "Mercado Pago" para el paso a paso de configuracion
// de la cuenta y las variables de entorno.
//
// Variables de entorno requeridas:
//   MERCADOPAGO_ACCESS_TOKEN   Access Token (prueba o produccion) de tu cuenta de Mercado Pago
//   SITE_URL                   ej. https://renuevatehoy.vercel.app (para back_urls y el webhook)

const { MongoClient, ObjectId } = require('mongodb');
const { applyCors } = require('../lib/cors');
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

function siteUrl() {
  const raw = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://renuevatehoy.vercel.app');
  return raw.replace(/\/$/, '');
}

module.exports = async (req, res) => {
  applyCors(req, res, 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const isWebhook = req.query && req.query.action === 'webhook';
  if (isWebhook) { return handleWebhook(req, res); }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  return handleCreatePreference(req, res);
};

async function handleCreatePreference(req, res) {
  try {
    const ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!ACCESS_TOKEN) {
      res.status(501).json({
        error: 'NOT_CONFIGURED',
        message: 'Mercado Pago todavia no esta configurado en este sitio (falta MERCADOPAGO_ACCESS_TOKEN). Ver README.md seccion Mercado Pago.',
      });
      return;
    }

    const { customerId } = req.body || {};
    if (!customerId || !ObjectId.isValid(customerId)) {
      res.status(400).json({ error: 'customerId invalido o faltante.' });
      return;
    }
    const custId = new ObjectId(customerId);

    const db = await getDb();
    const cartDoc = await db.collection('carts').findOne({ customer_id: custId, status: 'active' });
    if (!cartDoc || !cartDoc.items || !cartDoc.items.length) {
      res.status(400).json({ error: 'El carrito esta vacio.' });
      return;
    }

    // Recalcula SIEMPRE contra products (nunca contra unit_price_snapshot del
    // carrito, ni contra nada que mande el navegador) -- misma logica que
    // hydrateCart() en api/cart.js. Los items marcados saved:true ("Guardar
    // para mas tarde") nunca se cobran.
    const activeSkus = cartDoc.items.filter((i) => !i.saved).map((i) => i.sku);
    const products = await db.collection('products').find({ sku: { $in: activeSkus }, status: 'active' }).toArray();
    const bySku = new Map(products.map((p) => [p.sku, p]));

    const mpItems = [];
    for (const line of cartDoc.items) {
      if (line.saved) continue;
      const product = bySku.get(line.sku);
      if (!product) continue; // sku inactivo/retirado -- se ignora, igual que en el carrito visible
      const baseTitle = (product.name_i18n && product.name_i18n.es) || product.sku;
      // Fix 84: el tono elegido (ver NACAR-11/12 con shades[]) viaja en 2
      // lugares -- (a) metido en el titulo, para que aparezca en el
      // checkout/recibo hospedado por Mercado Pago (esa pantalla es de
      // Mercado Pago, no nuestra, y no tiene un campo separado para
      // variante/tono); y (b) como campo "shade" independiente en
      // metadata.items, que es lo que handleWebhook() lee mas abajo para
      // grabar la orden -- eso es lo que de verdad importa para poder
      // surtir el pedido con el tono correcto.
      mpItems.push({
        id: product.sku,
        title: line.shade ? `${baseTitle} - Tono: ${line.shade}` : baseTitle,
        quantity: line.qty,
        unit_price: product.unit_price,
        currency_id: product.currency || 'MXN',
        shade: line.shade || null,
      });
    }

    if (!mpItems.length) {
      res.status(400).json({ error: 'Ninguno de los productos en el carrito esta disponible para comprar.' });
      return;
    }

    const base = siteUrl();
    const preferenceBody = {
      items: mpItems,
      back_urls: {
        success: `${base}/?checkout=success`,
        failure: `${base}/?checkout=failure`,
        pending: `${base}/?checkout=pending`,
      },
      auto_return: 'approved',
      external_reference: String(custId),
      notification_url: `${base}/api/checkout?action=webhook`,
      // metadata viaja de vuelta intacta en el objeto payment que consulta
      // handleWebhook() mas abajo -- es la forma en que el webhook sabe que
      // cliente y que items exactos corresponden a este pago, sin tener que
      // volver a leer el carrito (que para entonces pudo haber cambiado).
      metadata: { customer_id: String(custId), items: mpItems },
    };

    const mpResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preferenceBody),
    });

    const mpData = await mpResp.json().catch(() => ({}));
    if (!mpResp.ok) {
      console.error('checkout.js - Mercado Pago rechazo la preferencia:', mpResp.status, mpData);
      res.status(502).json({ error: 'No se pudo crear la preferencia de pago en Mercado Pago.', detail: mpData.message || null });
      return;
    }

    res.status(200).json({
      ok: true,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point,
      preference_id: mpData.id,
    });
  } catch (err) {
    console.error('checkout.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
}

async function handleWebhook(req, res) {
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
      console.error('checkout.js (webhook) - no se pudo leer el pago en Mercado Pago:', payResp.status, payment);
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
      console.error('checkout.js (webhook) - pago aprobado pero sin metadata utilizable:', payment.id);
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
      // Fix 84: tono elegido (NACAR-11/12) -- viaja desde
      // handleCreatePreference() via metadata.items. null cuando el producto
      // no tiene selector de tonos (todo el resto del catalogo).
      shade: it.shade || null,
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
    console.error('checkout.js (webhook) error:', err);
    res.status(200).json({ ok: true, error: 'INTERNAL_ERROR' });
  }
}
