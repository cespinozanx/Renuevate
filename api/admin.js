// api/admin.js
// Fix 140: el ultimo deploy tronaba en Vercel ("Deploying outputs...").
// Causa real, no adivinada: el plan Hobby de Vercel limita a 12 Serverless
// Functions por deployment -- cada archivo bajo /api se cuenta como una
// funcion propia. Antes de Fix 137 el proyecto ya tenia 11 (addresses,
// cart, checkout, complete-profile, loyalty-rules, orders, payment-methods,
// products, promotions, register, reviews). Fix 137 agrego admin-auth.js Y
// admin-products.js como archivos separados -> 13, uno mas del limite. El
// build (compilar el HTML/JS) terminaba bien ("Build Completed"); el error
// pasaba en el paso siguiente, "Deploying outputs", que es exactamente
// donde Vercel aplica este limite de cuenta -- coincide con lo que Carlos
// reporto en el screenshot.
//
// Fix: se fusionan admin-auth.js + admin-products.js en ESTE unico archivo
// (12 funciones totales, justo en el limite del plan Hobby). Misma
// seguridad, mismos endpoints logicos, distinguidos por el query param
// ?resource=auth|products -- el frontend (index.html) ya se actualizo para
// llamar aqui.
//
// OJO para el futuro (se lo advierto a Carlos en el resumen, no lo escondo
// aqui): con esto el proyecto queda EXACTO en el limite de 12. Cualquier
// endpoint nuevo que se agregue como archivo separado va a repetir este
// mismo error. Opciones cuando llegue ese momento: seguir fusionando
// endpoints de bajo trafico en archivos compartidos (mismo patron que este
// archivo), o subir el proyecto a Vercel Pro (sin ese limite).
//
// GET    /api/admin?resource=auth      -> sesion de admin vigente o no
// POST   /api/admin?resource=auth      -> login { password }
// DELETE /api/admin?resource=auth      -> logout
// GET    /api/admin?resource=products  -> catalogo real completo (admin)
// PUT    /api/admin?resource=products  -> upsert de un producto por sku

const { MongoClient } = require('mongodb');
const { applyCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rateLimit');
const {
  isAdminRequest,
  passwordMatches,
  setAdminSessionCookie,
  clearAdminSessionCookie,
} = require('../lib/adminAuth');

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

function validateProductPayload(body) {
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

async function handleAuth(req, res, db) {
  // Fix 137: este endpoint solo lo usa una persona -- 10 intentos en 15
  // minutos es generoso para uso real y corta de raiz cualquier intento de
  // adivinar la contrasena por fuerza bruta.
  if (!(await checkRateLimit(req, res, db, { scope: 'admin-auth', limit: 10, windowSec: 900 }))) return;

  if (req.method === 'GET') {
    res.status(200).json({ ok: true, authenticated: isAdminRequest(req) });
    return;
  }
  if (req.method === 'POST') {
    const { password } = req.body || {};
    if (!passwordMatches(password)) {
      res.status(401).json({ error: 'Contraseña incorrecta.' });
      return;
    }
    setAdminSessionCookie(res);
    res.status(200).json({ ok: true });
    return;
  }
  if (req.method === 'DELETE') {
    clearAdminSessionCookie(res);
    res.status(200).json({ ok: true });
    return;
  }
  res.status(405).json({ error: 'Method not allowed' });
}

async function handleProducts(req, res, db) {
  if (!isAdminRequest(req)) {
    res.status(401).json({ error: 'Sesión de administrador requerida.' });
    return;
  }
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
    const errMsg = validateProductPayload(body);
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
}

module.exports = async (req, res) => {
  applyCors(req, res, 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const resource = (req.query && req.query.resource) || '';


  try {
    const db = await getDb();
    if (resource === 'auth') { await handleAuth(req, res, db); return; }
    if (resource === 'products') { await handleProducts(req, res, db); return; }
    res.status(400).json({ error: 'Falta ?resource=auth|products' });
  } catch (err) {
    console.error('admin.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
