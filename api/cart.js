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
      const { customerId, sku, qty, shade: rawShade } = req.body || {};
      const custId = parseCustomerId(customerId);
      const quantity = Number(qty) || 1;
      const shade = normalizeShade(rawShade);
      if (!custId) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }
      if (!sku || typeof sku !== 'string') { res.status(400).json({ error: 'sku invalido o faltante.' }); return; }
      if (!Number.isInteger(quantity) || quantity < 1) { res.status(400).json({ error: 'qty debe ser un entero >= 1.' }); return; }

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
      const { customerId, sku, qty, saved, shade: rawShade } = req.body || {};
      const custId = parseCustomerId(customerId);
      const shade = normalizeShade(rawShade);
      if (!custId) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }
      if (!sku || typeof sku !== 'string') { res.status(400).json({ error: 'sku invalido o faltante.' }); return; }
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
      if (!Number.isInteger(quantity) || quantity < 0) { res.status(400).json({ error: 'qty debe ser un entero >= 0.' }); return; }

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
      const { customerId, sku, shade: rawShade } = req.query || {};
      const custId = parseCustomerId(customerId);
      if (!custId) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }

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
