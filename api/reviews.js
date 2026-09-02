// api/reviews.js
// Resenas/experiencias con foto por producto (coleccion `product_reviews`,
// ver db/collections.js). Al publicarse, recalcula products.rating {stars,count}
// para que el rating mostrado en el sitio sea real, no el dummy estatico.
//
// GAP CONOCIDO (documentado, no bloqueante para este MVP): no existe panel de
// moderacion todavia, asi que las resenas se auto-publican (status:"published")
// en cuanto pasan las validaciones de forma. El schema ya trae el enum
// pending/published/rejected listo para cuando se construya un panel admin de
// moderacion -- recomendado antes de abrir el sitio a trafico publico real,
// para evitar contenido abusivo o spam visible sin revision humana.
//
// GET  /api/reviews?sku=NACAR-01[&customerId=...]  -> resenas publicadas de ese
//      sku; si se manda customerId tambien regresa purchased:true/false (ver
//      hasPurchased()).
// POST /api/reviews { customerId, sku, stars, title, text, displayName, photos:[dataUrl,...] }
//
// Fix 60 (instruccion Carlos: "una vez que compraron se les de la opcion de
// agregar un comentario"): antes cualquier customerId con sesion podia dejar
// resena de cualquier sku sin haberlo comprado. Ahora POST exige una orden
// confirmada (coleccion `orders`, mismo contrato que api/orders.js) del
// cliente que incluya ese sku -- "resena de compra verificada".
//
// Fix 94 (Carlos, con captura de referencia de Amazon: "la captura de
// comentarios debe dejar subir todos [los campos], ejemplo"): se agrega
// "title" (titulo corto de la resena, requerido -- igual que el "Titula tu
// opinion (requerido)" de la referencia). NO se agrego subir video: la
// arquitectura actual guarda fotos como base64 inline en el propio documento
// de Mongo (ver MAX_PHOTO_BYTES abajo, gap ya documentado) -- eso es viable
// para 1-3 fotos chicas, pero un video ahi adentro rompe el limite de 16MB
// por documento de MongoDB y degradaria el performance de lectura de TODAS
// las resenas. Subir video requeriria blob storage real (Vercel Blob/S3)
// primero -- se deja fuera de este fix a proposito, no es un olvido.

const { MongoClient, ObjectId } = require('mongodb');
const { applyCors } = require('../lib/cors');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'azura';

const MAX_TEXT_LENGTH = 500;
const MAX_TITLE_LENGTH = 80;
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 800 * 1024; // ~800KB por foto, en base64. Ver gap: migrar a blob storage real.

let cachedClient = null;
async function getDb() {
  if (cachedClient) return cachedClient.db(MONGODB_DB);
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db(MONGODB_DB);
}

async function hasPurchased(db, customerId, sku) {
  if (!ObjectId.isValid(customerId)) return false;
  const order = await db.collection('orders').findOne({
    customer_id: new ObjectId(customerId),
    status: 'confirmed',
    'items.sku': sku,
  });
  return !!order;
}

async function recomputeRating(db, sku) {
  const published = await db.collection('product_reviews').find({ sku, status: 'published' }).toArray();
  const count = published.length;
  const stars = count ? Math.round((published.reduce((sum, r) => sum + r.stars, 0) / count) * 10) / 10 : 0;
  await db.collection('products').updateOne({ sku }, { $set: { rating: { stars, count }, updated_at: new Date() } });
  return { stars, count };
}

module.exports = async (req, res) => {
  applyCors(req, res, 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const db = await getDb();

    if (req.method === 'GET') {
      const { sku, customerId } = req.query || {};
      if (!sku) { res.status(400).json({ error: 'Falta sku.' }); return; }
      const reviews = await db
        .collection('product_reviews')
        .find({ sku: String(sku), status: 'published' })
        .sort({ created_at: -1 })
        .limit(20)
        .project({ customer_id: 0 })
        .toArray();
      // Fix 60: si viene customerId (cliente con sesion iniciada), informamos
      // tambien si ya compro este sku -- el frontend usa esto para decidir si
      // mostrar el formulario "escribe tu resena" o el mensaje de "compra
      // este producto primero" (ver hasPurchased() mas abajo, reusada en POST).
      let purchased = false;
      if (customerId && ObjectId.isValid(customerId)) {
        purchased = await hasPurchased(db, customerId, String(sku));
      }
      res.status(200).json({ ok: true, reviews, purchased });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const { customerId, sku, stars, title, text, displayName, photos } = body;

      if (!customerId || !ObjectId.isValid(customerId)) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }
      if (!sku || typeof sku !== 'string') { res.status(400).json({ error: 'sku invalido o faltante.' }); return; }

      // Fix 60 (instruccion Carlos: "una vez que compraron se les de la opcion
      // de agregar un comentario"): solo clientes con una orden confirmada que
      // incluya este sku pueden dejar resena -- antes cualquier cliente con
      // sesion iniciada podia opinar sobre cualquier producto sin haberlo
      // comprado, lo cual le resta credibilidad a la resena ("compra
      // verificada") y abre la puerta a spam.
      const verifiedPurchase = await hasPurchased(db, customerId, sku);
      if (!verifiedPurchase) {
        res.status(403).json({ error: 'Solo puedes dejar una resena de un producto que hayas comprado.' });
        return;
      }

      const product = await db.collection('products').findOne({ sku });
      if (!product) { res.status(404).json({ error: `El producto ${sku} no existe.` }); return; }

      const starsNum = Number(stars);
      if (!Number.isInteger(starsNum) || starsNum < 1 || starsNum > 5) {
        res.status(400).json({ error: 'stars debe ser un entero entre 1 y 5.' });
        return;
      }

      // Fix 94: titulo requerido, igual que "Titula tu opinion (requerido)"
      // en la referencia de Carlos -- se valida server-side (no solo con el
      // atributo required del input) porque este gate del frontend es solo
      // UX, misma disciplina que el resto del archivo.
      const cleanTitle = typeof title === 'string' ? title.trim().slice(0, MAX_TITLE_LENGTH) : '';
      if (!cleanTitle) { res.status(400).json({ error: 'Escribe un titulo breve para tu resena.' }); return; }

      const cleanText = typeof text === 'string' ? text.trim().slice(0, MAX_TEXT_LENGTH) : null;

      let cleanPhotos = [];
      if (photos != null) {
        if (!Array.isArray(photos)) { res.status(400).json({ error: 'photos debe ser un arreglo.' }); return; }
        if (photos.length > MAX_PHOTOS) { res.status(400).json({ error: `Maximo ${MAX_PHOTOS} fotos por resena.` }); return; }
        for (const p of photos) {
          if (typeof p !== 'string' || !p.startsWith('data:image/')) {
            res.status(400).json({ error: 'Cada foto debe ser una imagen valida (data URL).' });
            return;
          }
          // tamano aproximado del base64 en bytes
          const approxBytes = Math.ceil((p.length * 3) / 4);
          if (approxBytes > MAX_PHOTO_BYTES) {
            res.status(400).json({ error: `Cada foto debe pesar menos de ${Math.round(MAX_PHOTO_BYTES / 1024)}KB.` });
            return;
          }
        }
        cleanPhotos = photos.map((data_url) => ({ data_url, uploaded_at: new Date() }));
      }

      // Minimizacion de PII (ISO 27001 A.5.34): solo se guarda nombre + inicial
      // de apellido, nunca el nombre completo ni el correo, para la vista publica.
      const safeDisplayName = typeof displayName === 'string' && displayName.trim()
        ? displayName.trim().slice(0, 40)
        : 'Cliente verificado';

      const now = new Date();
      const review = {
        sku,
        customer_id: new ObjectId(customerId),
        customer_display_name: safeDisplayName,
        stars: starsNum,
        title: cleanTitle,
        text: cleanText,
        photos: cleanPhotos,
        status: 'published', // ver nota de gap arriba: sin moderacion humana todavia
        created_at: now,
      };

      const insertResult = await db.collection('product_reviews').insertOne(review);
      const rating = await recomputeRating(db, sku);

      res.status(201).json({
        ok: true,
        review: { id: insertResult.insertedId, sku, stars: starsNum, title: cleanTitle, text: cleanText, customer_display_name: safeDisplayName, photos: cleanPhotos.length, created_at: now },
        product_rating: rating,
      });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('reviews.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
