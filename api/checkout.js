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
// Ver README.md seccion "Mercado Pago" para el paso a paso de configuracion
// de la cuenta y las variables de entorno.
//
// Variables de entorno requeridas:
//   MERCADOPAGO_ACCESS_TOKEN   Access Token (prueba o produccion) de tu cuenta de Mercado Pago
//   SITE_URL                   ej. https://azura-wellness-site.vercel.app (para back_urls y el webhook)

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

function siteUrl() {
  const raw = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://azura-wellness-site.vercel.app');
  return raw.replace(/\/$/, '');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

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
      mpItems.push({
        id: product.sku,
        title: (product.name_i18n && product.name_i18n.es) || product.sku,
        quantity: line.qty,
        unit_price: product.unit_price,
        currency_id: product.currency || 'MXN',
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
      notification_url: `${base}/api/checkout-webhook`,
      // metadata viaja de vuelta intacta en el objeto payment que consulta
      // api/checkout-webhook.js -- es la forma en que el webhook sabe que
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
};
