// api/admin-products.js
// Fix 137: CRUD del catalogo real (coleccion `products`, ver
// db/collections.js) para el panel de Administracion -- reemplaza tener que
// correr sembrar-productos.bat a mano para cambios de texto/precio del dia a
// dia. Protegido por sesion de admin (ver lib/adminAuth.js); nunca confia en
// nada que no traiga esa cookie firmada, igual que cart.js/reviews.js nunca
// confian en datos de negocio que manda el navegador sin validarlos.
//
// sembrar-productos.bat sigue siendo el camino para productos que requieran
// cambios de esquema o fotos nuevas (image/shades) -- este endpoint cubre
// edicion de texto, precio, favorito y estado (activo/inactivo) de
// productos ya existentes en Mongo. Alcance deliberado, ver resumen
// entregado a Carlos.
//
// GET /api/admin-products -> TODOS los productos reales (activos e
//                             inactivos), a diferencia de api/products.js
//                             que por default solo expone activos al publico.
// PUT /api/admin-products -> upsert de un producto por sku.

const { MongoClient } = require('mongodb');
const { applyCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rateLimit');
const { isAdminRequest } = require('../lib/adminAuth');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'azura';
const VALID_VERTICALS = ['nacar', 'vigor', 'roble', 'accessory'];

let cachedClient = null;
async function getDb() {
  if (cachedClient) return cachedClient.db(MONGODB_DB);
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db(MONGODB_DB);
}

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

function validatePayload(body) {
  if (!body || typeof body !== 'object') return 'Payload invalido.';
  if (!isNonEmptyString(body.sku)) return 'Falta el SKU.';
  if (VALID_VERTICALS.indexOf(body.vertical) === -1) return 'Vertical invalido.';
  const n = body.name_i18n;
  if (!n || !isNonEmptyString(n.es) || !isNonEmptyString(n.en) || !isNonEmptyString(n.fr)) {
    return 'El nombre necesita texto en español, inglés y francés.';
  }
  if (typeof body.unit_price !== 'number' || !isFinite(body.unit_price) || body.unit_price < 0) {
    return 'El precio debe ser un número válido mayor o igual a 0.';
  }
  if (body.status && ['active', 'inactive'].indexOf(body.status) === -1) return 'Estado invalido.';
  return null;
}

module.exports = async (req, res) => {
  applyCors(req, res, 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // Fix 137: gate de autenticacion antes de tocar la base -- ni siquiera se
  // conecta a Mongo si no hay sesion de admin valida.
  if (!isAdminRequest(req)) {
    res.status(401).json({ error: 'Sesión de administrador requerida.' });
    return;
  }

  try {
    const db = await getDb();
    if (!(await checkRateLimit(req, res, db, { scope: 'admin-products', limit: 60, windowSec: 60 }))) return;

    if (req.method === 'GET') {
      const products = await db.collection('products')
        .find({ vertical: { $in: VALID_VERTICALS } })
        .project({ _id: 0 })
        .sort({ vertical: 1, sku: 1 })
        .toArray();
      res.status(200).json({ ok: true, products });
      return;
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      const errMsg = validatePayload(body);
      if (errMsg) { res.status(400).json({ error: errMsg }); return; }

      const sku = body.sku.trim();
      const now = new Date();
      const setFields = {
        vertical: body.vertical,
        name_i18n: {
          es: body.name_i18n.es.trim(),
          en: body.name_i18n.en.trim(),
          fr: body.name_i18n.fr.trim(),
        },
        unit_price: body.unit_price,
        currency: 'MXN',
        status: body.status || 'active',
        updated_at: now,
      };
      if (body.description_i18n) {
        setFields.description_i18n = {
          es: String(body.description_i18n.es || ''),
          en: String(body.description_i18n.en || ''),
          fr: String(body.description_i18n.fr || ''),
        };
      }
      if (typeof body.favorito === 'boolean') setFields.favorito = body.favorito;
      // Fix 137: estos 3 campos solo existen en español en el catalogo real
      // (ver db/seed-products.js) -- se guardan tal cual, sin intentar
      // traducirlos. El merge hacia el sitio (index.html, applyAdminOverridesToV)
      // solo los aplica al bloque ES para no pisar EN/FR.
      if (isNonEmptyString(body.long_description_es)) setFields.long_description_es = body.long_description_es.trim();
      if (Array.isArray(body.ingredients_es)) {
        setFields.ingredients_es = body.ingredients_es.map(String).map(function (s) { return s.trim(); }).filter(Boolean);
      }
      if (isNonEmptyString(body.usage_es)) setFields.usage_es = body.usage_es.trim();

      await db.collection('products').updateOne(
        { sku: sku },
        { $set: setFields, $setOnInsert: { sku: sku, created_at: now } },
        { upsert: true }
      );
      res.status(200).json({ ok: true, sku: sku });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin-products.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
