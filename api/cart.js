// api/cart.js
// Carrito persistente por cliente (coleccion `carts`, un documento activo por
// customer_id -- ver db/collections.js). El precio/nombre mostrado SIEMPRE se
// recalcula contra `products` al leer el carrito; lo que se guarda en
// `items[].unit_price_snapshot` es solo informativo (para detectar cambios de
// precio entre que se agrego y que se compra), nunca la fuente de verdad.
//
// GET    /api/cart?customerId=...                                 -> carrito con precios actuales
// POST   /api/cart { customerId, sku, qty, shade? }                -> agrega/incrementa
// PUT    /api/cart { customerId, sku, qty, shade? }                -> fija cantidad exacta (qty=0 elimina el item)
// PUT    /api/cart { customerId, sku, saved: true|false, shade? }  -> "Guardar para mas tarde" / regresar al carrito
//                                                                      (no toca qty; un item guardado no cuenta en subtotal)
// DELETE /api/cart?customerId=...                                 -> vacia el carrito completo
// DELETE /api/cart?customerId=...&sku=...&shade=...               -> elimina un item
//
// Fix 84: "shade" (tono, ver NACAR-11/12 con shades[] en el catalogo) es
// OPCIONAL y solo lo mandan los productos que traen selector de tonos -- el
// resto del catalogo sigue funcionando exactamente igual que antes (shade
// undefined/'' se trata como "sin tono", mismo comportamiento previo a este
// fix). Cuando SI viene, la misma sku puede tener varias lineas en el
// carrito (una por tono elegido) -- por eso el "identificador" real de una
// linea pasa a ser el PAR (sku, shade), no solo sku. Ver itemMatchFilter()
// abajo, que centraliza esa logica en vez de repetirla en cada metodo.
//
// Fix 109 (antes): no habia sesion de servidor -- se confiaba en el
// customerId que mandaba el navegador via querystring/body. Ahora la
// identidad se toma SIEMPRE de la cookie de sesion firmada (ver
// lib/session.js); el customerId que el cliente siga mandando en el body o
// la URL se ignora por completo para efectos de autorizacion. Si no hay
// sesion valida, se responde 401 en vez de proceder.

const { MongoClient, ObjectId } = require('mongodb');
const { applyCors } = require('../lib/cors');
const { getSessionCustomerId } = require('../lib/session');
const { checkRateLimit } = require('../lib/rateLimit');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'azura';
// Fix 89: tope superior de cantidad por linea de carrito (ver comentario en
// el POST mas abajo) -- antes no existia, qty solo se validaba >= 1/0.
const MAX_CART_QTY = 20;

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

// Fix 109: unico punto de entrada de identidad para este archivo. Si no hay
// cookie de sesion valida, responde 401 ahi mismo y regresa null -- el
// caller solo necesita hacer "if (!custId) return;".
function requireSessionCustomer(req, res) {
  const custId = parseCustomerId(getSessionCustomerId(req));
  if (!custId) {
    res.status(401).json({ error: 'Tu sesion expiro o no has iniciado sesion. Inicia sesion de nuevo.', code: 'SESSION_REQUIRED' });
    return null;
  }
  return custId;
}

// Normaliza shade a string-o-undefined (nunca '', null, u otro falsy) para
// que "sin tono" siempre se represente de la misma forma en todo el archivo.
function normalizeShade(raw) {
  return (typeof raw === 'string' && raw.trim()) ? raw.trim() : undefined;
}

// Fix 84: centraliza el filtro que identifica UNA linea del carrito. Antes
// del selector de tonos, sku alcanzaba; ahora una misma sku puede repetirse
// con distinto tono, asi que agregar el arrayFilter/elemMatch correcto en
// cada metodo (POST/PUT/DELETE) por separado hubiera sido facil de
// desalinear. matchStage es para el filtro del updateOne/findOne de mas
// afuera; arrayFilters (o null) es lo que hay que pasarle a la opcion
// arrayFilters cuando se use la sintaxis 'items.$[el]'.
function itemMatchFilter(sku, shade) {
  if (shade) {
    return {
      matchStage: { 'items': { $elemMatch: { sku: sku, shade: shade } } },
      arrayFilters: [{ 'el.sku': sku, 'el.shade': shade }],
      pullFilter: { sku: sku, shade: shade },
    };
  }
  return {
    matchStage: { 'items.sku': sku, 'items.shade': { $exists: false } },
    arrayFilters: null, // se usa 'items.$' (el positional normal) en vez de arrayFilters
    pullFilter: { sku: sku, shade: { $exists: false } },
  };
}

// Recalcula el carrito contra el catalogo real (products). Si un sku ya no
// existe o esta inactivo, se marca unavailable:true y se excluye del total,
// en vez de tronar o cobrar un precio viejo. Los items marcados saved:true
// ("Guardar para mas tarde", ver PUT mas abajo) se separan en su propia
// lista y NUNCA suman al subtotal -- son solo un recordatorio para el
// cliente, no forman parte de lo que va a pagar.
async function hydrateCart(db, cartDoc) {
  if (!cartDoc || !cartDoc.items || !cartDoc.items.length) {
    return { items: [], saved_items: [], subtotal: 0, currency: 'MXN' };
  }
  const skus = cartDoc.items.map((i) => i.sku);
  const products = await db.collection('products').find({ sku: { $in: skus } }).toArray();
  const bySku = new Map(products.map((p) => [p.sku, p]));

  let subtotal = 0;
  const items = [];
  const savedItems = [];

  cartDoc.items.forEach((i) => {
    const product = bySku.get(i.sku);
    // Fix 84: shade viaja intacto del documento de Mongo al carrito hidratado
    // -- nunca se recalcula contra products (no hay "precio por tono", el
    // tono no afecta precio), solo se propaga para mostrarlo y para que el
    // frontend pueda mandarlo de vuelta en changeCartQty/removeCartItem/etc.
    const shade = normalizeShade(i.shade);
    let hydrated;
    if (!product || product.status !== 'active') {
      hydrated = { sku: i.sku, qty: i.qty, shade: shade || null, unavailable: true };
    } else {
      const lineTotal = product.unit_price * i.qty;
      hydrated = {
        sku: i.sku,
        qty: i.qty,
        shade: shade || null,
        name: product.name_i18n,
        unit_price: product.unit_price,
        line_total: lineTotal,
        vertical: product.vertical,
      };
      if (!i.saved) subtotal += lineTotal;
    }
    if (i.saved) savedItems.push(hydrated); else items.push(hydrated);
  });

  return { items, saved_items: savedItems, subtotal, currency: 'MXN' };
}

module.exports = async (req, res) => {
  applyCors(req, res, 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const db = await getDb();
    // Fix 109: 60/min por IP+metodo alcanza para uso normal (los botones
    // +/- del carrito ya llevan su propio debounce en el frontend, Fix 89)
    // y frena un abuso automatizado sin estorbar a un cliente real.
    if (!(await checkRateLimit(req, res, db, { scope: 'cart', limit: 60, windowSec: 60 }))) return;
    const now = new Date();

    if (req.method === 'GET') {
      const custId = requireSessionCustomer(req, res);
      if (!custId) return;
      const cartDoc = await db.collection('carts').findOne({ customer_id: custId, status: 'active' });
      const hydrated = await hydrateCart(db, cartDoc);
      res.status(200).json({ ok: true, cart: hydrated });
      return;
    }

    if (req.method === 'POST') {
      const { sku, qty, shade: rawShade } = req.body || {};
      const custId = requireSessionCustomer(req, res);
      if (!custId) return;
      const quantity = Number(qty) || 1;
      const shade = normalizeShade(rawShade);
      if (!sku || typeof sku !== 'string' || sku.length > 40) { res.status(400).json({ error: 'sku invalido o faltante.' }); return; }
      // Fix 89: antes no habia tope superior -- qty=999999999 pasaba la
      // validacion igual que qty=1 (Number.isInteger + >=1 no acota arriba).
      // No es una perdida de dinero real (hydrateCart siempre recalcula
      // contra el precio real de products, nunca contra lo que mande el
      // navegador), pero si es un vector de abuso: alguien podria inflar una
      // sola linea del carrito a un numero absurdo (llamadas repetidas al
      // checkout/Mercado Pago con qty gigantes, carritos ilegibles en el
      // panel, filas de Mongo infladas). MAX_CART_QTY=20 es generoso para
      // compra real (nadie compra 20 protectores solares en una sola linea)
      // y cierra el abuso sin arriesgar tocar un caso de uso legitimo.
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_QTY) { res.status(400).json({ error: `qty debe ser un entero entre 1 y ${MAX_CART_QTY}.` }); return; }

      const product = await db.collection('products').findOne({ sku, status: 'active' });
      if (!product) { res.status(404).json({ error: `El producto ${sku} no existe o no esta disponible.` }); return; }

      // Fix 84: la linea existente se busca por (sku, shade) -- ver
      // itemMatchFilter(). Si el producto no tiene tono (shade undefined) el
      // comportamiento es identico al de antes de este fix.
      const filter = itemMatchFilter(sku, shade);
      const existing = await db.collection('carts').findOne({ customer_id: custId, status: 'active', ...filter.matchStage });
      if (existing) {
        if (filter.arrayFilters) {
          await db.collection('carts').updateOne(
            { customer_id: custId, status: 'active' },
            { $inc: { 'items.$[el].qty': quantity }, $set: { updated_at: now, 'items.$[el].unit_price_snapshot': product.unit_price } },
            { arrayFilters: filter.arrayFilters }
          );
        } else {
          await db.collection('carts').updateOne(
            { customer_id: custId, status: 'active', ...filter.matchStage },
            { $inc: { 'items.$.qty': quantity }, $set: { updated_at: now, 'items.$.unit_price_snapshot': product.unit_price } }
          );
        }
      } else {
        const newItem = { sku, qty: quantity, unit_price_snapshot: product.unit_price, added_at: now };
        if (shade) newItem.shade = shade;
        await db.collection('carts').updateOne(
          { customer_id: custId, status: 'active' },
          {
            $push: { items: newItem },
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
      const { sku, qty, saved, shade: rawShade } = req.body || {};
      const custId = requireSessionCustomer(req, res);
      if (!custId) return;
      const shade = normalizeShade(rawShade);
      if (!sku || typeof sku !== 'string' || sku.length > 40) { res.status(400).json({ error: 'sku invalido o faltante.' }); return; }
      const filter = itemMatchFilter(sku, shade);

      // Caso "Guardar para mas tarde" / "Mover al carrito": solo cambia la
      // bandera saved, no toca la cantidad. Se distingue de un cambio de qty
      // porque el body manda "saved" en vez de "qty".
      if (saved !== undefined && qty === undefined) {
        let result;
        if (filter.arrayFilters) {
          result = await db.collection('carts').updateOne(
            { customer_id: custId, status: 'active' },
            { $set: { 'items.$[el].saved': Boolean(saved), updated_at: now } },
            { arrayFilters: filter.arrayFilters }
          );
        } else {
          result = await db.collection('carts').updateOne(
            { customer_id: custId, status: 'active', ...filter.matchStage },
            { $set: { 'items.$.saved': Boolean(saved), updated_at: now } }
          );
        }
        if (result.matchedCount === 0) { res.status(404).json({ error: `${sku} no esta en el carrito.` }); return; }
        const cartDoc = await db.collection('carts').findOne({ customer_id: custId, status: 'active' });
        const hydrated = await hydrateCart(db, cartDoc);
        res.status(200).json({ ok: true, cart: hydrated });
        return;
      }

      const quantity = Number(qty);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_CART_QTY) { res.status(400).json({ error: `qty debe ser un entero entre 0 y ${MAX_CART_QTY}.` }); return; }

      if (quantity === 0) {
        await db.collection('carts').updateOne(
          { customer_id: custId, status: 'active' },
          { $pull: { items: filter.pullFilter }, $set: { updated_at: now } }
        );
      } else {
        const product = await db.collection('products').findOne({ sku, status: 'active' });
        if (!product) { res.status(404).json({ error: `El producto ${sku} no existe o no esta disponible.` }); return; }
        let result;
        if (filter.arrayFilters) {
          result = await db.collection('carts').updateOne(
            { customer_id: custId, status: 'active' },
            { $set: { 'items.$[el].qty': quantity, 'items.$[el].unit_price_snapshot': product.unit_price, updated_at: now } },
            { arrayFilters: filter.arrayFilters }
          );
        } else {
          result = await db.collection('carts').updateOne(
            { customer_id: custId, status: 'active', ...filter.matchStage },
            { $set: { 'items.$.qty': quantity, 'items.$.unit_price_snapshot': product.unit_price, updated_at: now } }
          );
        }
        if (result.matchedCount === 0) {
          const newItem = { sku, qty: quantity, unit_price_snapshot: product.unit_price, added_at: now };
          if (shade) newItem.shade = shade;
          await db.collection('carts').updateOne(
            { customer_id: custId, status: 'active' },
            {
              $push: { items: newItem },
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
      const { sku, shade: rawShade } = req.query || {};
      const custId = requireSessionCustomer(req, res);
      if (!custId) return;

      if (sku) {
        const shade = normalizeShade(rawShade);
        const filter = itemMatchFilter(String(sku), shade);
        await db.collection('carts').updateOne(
          { customer_id: custId, status: 'active' },
          { $pull: { items: filter.pullFilter }, $set: { updated_at: now } }
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
