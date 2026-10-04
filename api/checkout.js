// api/checkout.js
// FIX 199: pasarela activa = CLIP (ver bloque CLIP al final de este archivo y
// CLIP-ISO27001.md). El flujo de Mercado Pago de abajo se conserva como rollback
// (PAYMENT_PROVIDER=mercadopago).
//
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

function siteUrl() {
  const raw = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://renuevatehoy.vercel.app');
  return raw.replace(/\/$/, '');
}

module.exports = async (req, res) => {
  applyCors(req, res, 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const action = req.query && req.query.action;
  // Webhooks y conciliacion: ambos proveedores siguen atendidos aunque el activo cambie
  // (pagos en vuelo durante un rollback no se pierden).
  if (action === 'webhook') { return handleWebhook(req, res); }          // Mercado Pago
  if (action === 'clip-webhook') { return handleClipWebhook(req, res); }  // Clip
  if (action === 'confirm') { return handleClipConfirm(req, res); }       // Clip: regreso del cliente

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  // Fix 199: Clip es la pasarela activa; PAYMENT_PROVIDER=mercadopago hace rollback sin redeploy de codigo.
  if (paymentProvider() === 'clip') { return handleCreateClipLink(req, res); }
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

    // Fix 109: la identidad para cobrar viene de la cookie de sesion firmada,
    // no del customerId que mande el body -- este es el endpoint que mas
    // importa cerrar bien (crea el cargo real en Mercado Pago), ya que su
    // metadata.customer_id es lo que despues usa handleWebhook() de abajo
    // para grabar la orden.
    const sessionCid = getSessionCustomerId(req);
    if (!sessionCid || !ObjectId.isValid(sessionCid)) {
      res.status(401).json({ error: 'Tu sesion expiro o no has iniciado sesion. Inicia sesion de nuevo.', code: 'SESSION_REQUIRED' });
      return;
    }
    const custId = new ObjectId(sessionCid);

    const db = await getDb();
    // Fix 109: limite estricto -- este endpoint llama a la API real de
    // Mercado Pago (costo/riesgo de fraude mas alto que el resto). Se aplica
    // SOLO aqui, no en el webhook (handleWebhook, mas abajo), que es
    // trafico server-to-server legitimo de Mercado Pago y no debe frenarse
    // por IP igual que un cliente final.
    if (!(await checkRateLimit(req, res, db, { scope: 'checkout', limit: 10, windowSec: 60 }))) return;
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


// =============================================================================
// CLIP (Checkout Redireccionado) -- Fix 199 (Carlos, 2026-10-04)
// =============================================================================
// Clip reemplaza a Mercado Pago como pasarela activa. El cliente paga en la
// pagina hospedada por Clip (completa-tu-pago.payclip.com): el sitio y este
// servidor NUNCA ven el numero de tarjeta (alcance PCI SAQ-A).
//
// Flujo:
//   1. POST /api/checkout            -> recalcula el carrito en servidor, guarda una
//                                        sesion en `checkout_sessions`, crea el link en Clip
//                                        y devuelve { ok, redirect_url }.
//   2. El cliente paga en Clip y vuelve a /?checkout=success|error|default&ref=<sesion>.
//   3. POST /api/checkout?action=confirm        (la pagina, al volver) y
//      POST /api/checkout?action=clip-webhook   (Clip, server-to-server)
//      ambos llaman a settleClipSession(): consulta el estado REAL del pago en la API de
//      Clip, valida monto y moneda contra lo que se guardo en el paso 1 y crea la orden
//      de forma idempotente (indice unico orders.clip_payment_request_id).
//
// Variables de entorno (SOLO en Vercel, nunca en el repo ni en el navegador):
//   CLIP_API_KEY / CLIP_SECRET_KEY   credenciales de la cuenta Clip (Basic auth)
//   SITE_URL                         base para redirection_url y webhook_url
//   PAYMENT_PROVIDER                 'clip' (default) | 'mercadopago' (rollback sin redeploy)
//   MIN_UNIT_PRICE_MXN               piso de precio por linea (default 20); rechaza el cobro si
//                                    algun precio queda por debajo (control contra datos corruptos,
//                                    ver incidente VIGOR-03 a $1 MXN, Fix 195)
//
// Controles ISO/IEC 27001:2022 y plan de pruebas: ver CLIP-ISO27001.md.
// Vive en este archivo (no en api/clip.js) por el tope de 12 Serverless
// Functions del plan Hobby de Vercel (hoy hay 12, una nueva tumbaria el build).

const CLIP_API_BASE = 'https://api.payclip.com';
const CLIP_TIMEOUT_MS = 10000;
const CLIP_HOST = 'payclip.com';
const CLIP_MIN_AMOUNT = 1; // minimo que acepta Clip por link de pago
const CLIP_ID_RE = /^[0-9a-fA-F-]{8,36}$/;

function paymentProvider() {
  return String(process.env.PAYMENT_PROVIDER || 'clip').toLowerCase() === 'mercadopago' ? 'mercadopago' : 'clip';
}

function minUnitPrice() {
  const n = Number(process.env.MIN_UNIT_PRICE_MXN);
  return Number.isFinite(n) && n >= 0 ? n : 20;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function clipAuthHeader() {
  const key = process.env.CLIP_API_KEY;
  const secret = process.env.CLIP_SECRET_KEY;
  if (!key || !secret) return null;
  return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
}

// Unico punto de salida hacia Clip: solo https://api.payclip.com, con timeout y
// sin seguir redirecciones. Nunca se registran headers ni credenciales.
async function clipRequest(path, method, bodyObj) {
  const auth = clipAuthHeader();
  if (!auth) { const e = new Error('CLIP_NOT_CONFIGURED'); e.code = 'CLIP_NOT_CONFIGURED'; throw e; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLIP_TIMEOUT_MS);
  try {
    return await fetch(CLIP_API_BASE + path, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: bodyObj ? JSON.stringify(bodyObj) : undefined,
      signal: ctrl.signal,
      redirect: 'error',
    });
  } finally {
    clearTimeout(timer);
  }
}

// La URL de pago que regresa Clip solo se acepta si es https y de *.payclip.com
// (defensa en profundidad contra una respuesta alterada / open redirect).
function isClipUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && (x.hostname === CLIP_HOST || x.hostname.endsWith('.' + CLIP_HOST));
  } catch (e) {
    return false;
  }
}

// Recalcula SIEMPRE contra `products` (nunca contra lo que mande el navegador ni
// contra unit_price_snapshot del carrito). Los items "guardar para despues" no se cobran.
async function buildClipCartLines(db, custId) {
  const cartDoc = await db.collection('carts').findOne({ customer_id: custId, status: 'active' });
  if (!cartDoc || !cartDoc.items || !cartDoc.items.length) return { error: 'El carrito esta vacio.', code: 400 };
  const activeLines = cartDoc.items.filter((i) => !i.saved);
  const skus = activeLines.map((i) => i.sku);
  const products = await db.collection('products').find({ sku: { $in: skus }, status: 'active' }).toArray();
  const bySku = new Map(products.map((p) => [p.sku, p]));

  const floor = minUnitPrice();
  const lines = [];
  for (const line of activeLines) {
    const product = bySku.get(line.sku);
    if (!product) continue; // sku inactivo/retirado: se ignora igual que en el carrito visible
    const qty = Number(line.qty);
    const unit = Number(product.unit_price);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) return { error: 'Cantidad invalida en el carrito.', code: 400 };
    if (product.currency && product.currency !== 'MXN') return { error: 'Moneda no soportada para este producto.', code: 400 };
    if (!Number.isFinite(unit) || unit < floor) {
      console.error('checkout.js (clip) - SECURITY PRICE_GUARD: precio por debajo del piso, cobro bloqueado', { sku: product.sku, unit_price: unit, floor });
      return { error: 'Uno de los productos del carrito tiene un precio no valido. Escribenos para ayudarte.', code: 409 };
    }
    const baseName = (product.name_i18n && product.name_i18n.es) || product.sku;
    lines.push({
      sku: product.sku,
      name: line.shade ? `${baseName} - Tono: ${line.shade}` : baseName,
      vertical: product.vertical || null,
      unit_price: unit,
      qty,
      shade: line.shade || null,
    });
  }
  if (!lines.length) return { error: 'Ninguno de los productos en el carrito esta disponible para comprar.', code: 400 };
  return { lines };
}

function clipDescription(lines) {
  const text = lines.map((l) => `${l.name} x${l.qty}`).join(', ');
  return text.length > 250 ? text.slice(0, 247) + '...' : text;
}

async function handleCreateClipLink(req, res) {
  try {
    if (!clipAuthHeader()) {
      res.status(501).json({
        error: 'NOT_CONFIGURED',
        message: 'Clip todavia no esta configurado en este sitio (faltan CLIP_API_KEY / CLIP_SECRET_KEY). Ver CLIP-ISO27001.md.',
      });
      return;
    }

    // La identidad para cobrar viene de la cookie de sesion firmada, nunca del body.
    const sessionCid = getSessionCustomerId(req);
    if (!sessionCid || !ObjectId.isValid(sessionCid)) {
      res.status(401).json({ error: 'Tu sesion expiro o no has iniciado sesion. Inicia sesion de nuevo.', code: 'SESSION_REQUIRED' });
      return;
    }
    const custId = new ObjectId(sessionCid);

    const db = await getDb();
    if (!(await checkRateLimit(req, res, db, { scope: 'checkout', limit: 10, windowSec: 60 }))) return;

    const built = await buildClipCartLines(db, custId);
    if (built.error) { res.status(built.code).json({ error: built.error }); return; }
    const lines = built.lines;
    const total = round2(lines.reduce((sum, l) => sum + l.unit_price * l.qty, 0));
    if (!(total >= CLIP_MIN_AMOUNT)) { res.status(400).json({ error: 'El total del pedido es menor al minimo permitido.' }); return; }

    // Foto del pedido ANTES de salir a Clip: es la fuente de verdad contra la que se
    // valida el monto cobrado cuando Clip confirma el pago.
    const sessions = db.collection('checkout_sessions');
    const ins = await sessions.insertOne({
      customer_id: custId,
      provider: 'clip',
      status: 'created',
      items: lines,
      total,
      currency: 'MXN',
      created_at: new Date(),
    });
    const ref = String(ins.insertedId); // 24 chars hex, cumple el limite de 36 de external_reference

    const base = siteUrl();
    const body = {
      amount: total,
      currency: 'MXN',
      purchase_description: clipDescription(lines),
      redirection_url: {
        success: `${base}/?checkout=success&ref=${ref}`,
        error: `${base}/?checkout=error&ref=${ref}`,
        default: `${base}/?checkout=default&ref=${ref}`,
      },
      webhook_url: `${base}/api/checkout?action=clip-webhook`,
      // Minimizacion de datos personales: Clip recibe solo la referencia opaca, sin nombre,
      // correo, telefono ni direccion del cliente.
      metadata: { external_reference: ref },
      override_settings: { locale: 'es-MX' },
    };

    let resp;
    let data;
    try {
      resp = await clipRequest('/v2/checkout', 'POST', body);
      data = await resp.json().catch(() => ({}));
    } catch (e) {
      await sessions.updateOne({ _id: ins.insertedId }, { $set: { status: 'failed', failure: 'CLIP_UNREACHABLE', updated_at: new Date() } });
      console.error('checkout.js (clip) - no se pudo contactar a Clip:', e && e.name);
      res.status(502).json({ error: 'No se pudo iniciar el pago con Clip. Intenta de nuevo en unos minutos.' });
      return;
    }

    if (!resp.ok || !data || !data.payment_request_id || !isClipUrl(data.payment_request_url)) {
      await sessions.updateOne({ _id: ins.insertedId }, { $set: { status: 'failed', failure: 'CLIP_REJECTED', updated_at: new Date() } });
      console.error('checkout.js (clip) - Clip rechazo el link de pago:', { http: resp.status, error_code: data && data.error_code, session: ref });
      res.status(502).json({ error: 'No se pudo crear el pago en Clip. Intenta de nuevo.' });
      return;
    }

    await sessions.updateOne(
      { _id: ins.insertedId },
      { $set: { status: 'link_created', clip_payment_request_id: String(data.payment_request_id), updated_at: new Date() } }
    );

    res.status(200).json({ ok: true, provider: 'clip', redirect_url: data.payment_request_url, reference: ref });
  } catch (err) {
    console.error('checkout.js (clip) error:', err && err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

// Consulta el estado REAL del pago en Clip y, si esta completado y el monto coincide,
// crea la orden. Es idempotente: se puede llamar N veces (webhook repetido, regreso del
// cliente, ambos a la vez) y solo existe una orden por clip_payment_request_id.
// Clip no documenta firma en sus webhooks, asi que el payload NUNCA se usa como prueba
// de pago: solo avisa que vale la pena consultar a Clip directamente.
async function settleClipSession(db, session) {
  if (session.status === 'completed') return { status: 'already', order_id: session.order_id || null };
  if (!session.clip_payment_request_id) return { status: 'pending' };

  const sessions = db.collection('checkout_sessions');
  let pay;
  try {
    const resp = await clipRequest(`/v2/checkout/${encodeURIComponent(session.clip_payment_request_id)}`, 'GET');
    pay = await resp.json().catch(() => null);
    if (!resp.ok || !pay) {
      console.error('checkout.js (clip) - no se pudo leer el estado del pago:', { http: resp.status, session: String(session._id) });
      return { status: 'lookup_failed' };
    }
  } catch (e) {
    console.error('checkout.js (clip) - error consultando estado en Clip:', e && e.name, { session: String(session._id) });
    return { status: 'lookup_failed' };
  }

  if (pay.payment_request_id && String(pay.payment_request_id) !== session.clip_payment_request_id) {
    console.error('checkout.js (clip) - SECURITY: payment_request_id de la respuesta no coincide con la sesion', { session: String(session._id) });
    return { status: 'review' };
  }

  if (pay.status === 'CHECKOUT_CANCELLED' || pay.status === 'CHECKOUT_EXPIRED') {
    await sessions.updateOne(
      { _id: session._id, status: { $ne: 'completed' } },
      { $set: { status: pay.status === 'CHECKOUT_EXPIRED' ? 'expired' : 'failed', updated_at: new Date() } }
    );
    return { status: pay.status === 'CHECKOUT_EXPIRED' ? 'expired' : 'cancelled' };
  }
  if (pay.status !== 'CHECKOUT_COMPLETED') return { status: 'pending' };

  // Integridad: lo cobrado debe ser exactamente lo que calculo el servidor al crear el link.
  const paid = Number(pay.amount);
  const currencyOk = !pay.currency || String(pay.currency) === session.currency;
  if (!Number.isFinite(paid) || Math.abs(paid - session.total) > 0.009 || !currencyOk) {
    console.error('checkout.js (clip) - SECURITY: monto o moneda no coinciden, orden NO creada', {
      session: String(session._id), expected: session.total, paid, currency: pay.currency,
    });
    await sessions.updateOne({ _id: session._id }, { $set: { status: 'amount_mismatch', updated_at: new Date() } });
    return { status: 'review' };
  }

  const now = new Date();
  const order = {
    customer_id: session.customer_id,
    items: session.items.map((it) => ({
      sku: it.sku,
      name: it.name,
      vertical: it.vertical || null,
      unit_price: Number(it.unit_price),
      qty: Number(it.qty),
      shade: it.shade || null,
    })),
    subtotal: session.total,
    applied_promotions: [],
    total: session.total,
    currency: session.currency,
    status: 'confirmed',
    payment_provider: 'clip',
    clip_payment_request_id: session.clip_payment_request_id,
    clip_receipt_no: pay.receipt_no ? String(pay.receipt_no) : null,
    checkout_session_id: session._id,
    created_at: now,
  };

  let orderId;
  try {
    const r = await db.collection('orders').insertOne(order);
    orderId = r.insertedId;
    order._id = orderId;
  } catch (e) {
    if (e && e.code === 11000) {
      // Otra llamada concurrente ya creo la orden: indice unico uniq_clip_payment_request.
      const existing = await db.collection('orders').findOne({ clip_payment_request_id: session.clip_payment_request_id });
      await sessions.updateOne({ _id: session._id }, { $set: { status: 'completed', order_id: existing ? existing._id : null, updated_at: new Date() } });
      return { status: 'already', order_id: existing ? existing._id : null };
    }
    throw e;
  }

  await sessions.updateOne({ _id: session._id }, { $set: { status: 'completed', order_id: orderId, completed_at: now, updated_at: now } });

  // La orden ya existe: lo que sigue no debe tumbar la respuesta si algo falla, pero se registra.
  try {
    await recordPurchaseForLoyalty(db, { customerId: session.customer_id, order, now });
  } catch (e) {
    console.error('checkout.js (clip) - orden creada pero fallo el motor de lealtad:', e && e.message, { order: String(orderId) });
  }
  try {
    await db.collection('carts').updateOne(
      { customer_id: session.customer_id, status: 'active' },
      { $set: { items: [], updated_at: now } }
    );
  } catch (e) {
    console.error('checkout.js (clip) - orden creada pero no se pudo vaciar el carrito:', e && e.message, { order: String(orderId) });
  }
  return { status: 'completed', order_id: orderId };
}

// Webhook de Clip (server-to-server). Solo se usa como aviso: se busca el id en nuestras
// sesiones (ids desconocidos se ignoran sin tocar Clip) y el estado se verifica con la API.
async function handleClipWebhook(req, res) {
  try {
    if (!clipAuthHeader()) { res.status(200).json({ ok: true, skipped: 'NOT_CONFIGURED' }); return; }
    const db = await getDb();
    if (!(await checkRateLimit(req, res, db, { scope: 'clip-webhook', limit: 120, windowSec: 60 }))) return;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const query = req.query || {};
    const candidates = [body.payment_request_id, body.id, query.payment_request_id, query.id]
      .filter((v) => typeof v === 'string' && CLIP_ID_RE.test(v));

    let handled = 0;
    for (const id of Array.from(new Set(candidates))) {
      const session = await db.collection('checkout_sessions').findOne({ provider: 'clip', clip_payment_request_id: id });
      if (!session) continue;
      const result = await settleClipSession(db, session);
      handled += 1;
      console.log('checkout.js (clip) webhook:', { session: String(session._id), result: result.status });
    }
    res.status(200).json({ ok: true, handled });
  } catch (err) {
    // 500 invita a Clip a reintentar si hubo una falla transitoria (Mongo caido, etc.).
    console.error('checkout.js (clip) webhook error:', err && err.message);
    res.status(500).json({ ok: false });
  }
}

// El cliente vuelve de Clip con ?checkout=success&ref=<sesion>. Este endpoint concilia en ese
// momento (no depende de que el webhook haya llegado primero). Solo el dueno de la sesion
// (cookie firmada) puede consultar su referencia.
async function handleClipConfirm(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const sessionCid = getSessionCustomerId(req);
    if (!sessionCid || !ObjectId.isValid(sessionCid)) {
      res.status(401).json({ error: 'SESSION_REQUIRED', code: 'SESSION_REQUIRED' });
      return;
    }
    const ref = req.body && req.body.ref;
    if (typeof ref !== 'string' || !ObjectId.isValid(ref)) { res.status(400).json({ error: 'Referencia invalida.' }); return; }

    const db = await getDb();
    if (!(await checkRateLimit(req, res, db, { scope: 'checkout-confirm', limit: 20, windowSec: 60 }))) return;

    const session = await db.collection('checkout_sessions').findOne({
      _id: new ObjectId(ref), customer_id: new ObjectId(sessionCid), provider: 'clip',
    });
    if (!session) { res.status(404).json({ error: 'Pago no encontrado.' }); return; }

    const result = await settleClipSession(db, session);
    const map = { completed: 'completed', already: 'completed', pending: 'pending', lookup_failed: 'pending', cancelled: 'failed', expired: 'failed', review: 'review' };
    res.status(200).json({ ok: true, status: map[result.status] || 'pending', order_id: result.order_id ? String(result.order_id) : null });
  } catch (err) {
    console.error('checkout.js (clip) confirm error:', err && err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
