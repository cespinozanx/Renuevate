// api/promotions.js
// Endpoint serverless (Vercel) para crear, modificar, activar, pausar y archivar
// promociones y reglas de lealtad. Es el "apagar/prender/activar/crear/modificar"
// que pidio Carlos, expuesto como API — un panel de administracion (UI) puede
// consumir este mismo endpoint despues.
//
// SEGURIDAD: protegido con un header simple (ADMIN_API_KEY) como minimo viable.
// Esto NO es autenticacion real de nivel produccion — antes de exponer un panel
// de administracion de verdad, esto debe reemplazarse por sesion + rol de admin
// (ver Marco de Cumplimiento Enterprise, Bloque A, control de acceso).
//
// Variables de entorno adicionales a las de api/register.js:
//   ADMIN_API_KEY - secreto compartido para llamadas de administracion
//
// Uso:
//   GET  /api/promotions?status=active          -> lista (filtro opcional)
//   POST /api/promotions   { action: "create", type, name, discount, ... }
//   POST /api/promotions   { action: "update", id, ...campos a modificar }
//   POST /api/promotions   { action: "activate" | "pause" | "archive", id }

const { MongoClient, ObjectId } = require('mongodb');
const { applyCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rateLimit');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'azura';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

let cachedClient = null;
async function getDb() {
  if (cachedClient) return cachedClient.db(MONGODB_DB);
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db(MONGODB_DB);
}

const VALID_TRANSITIONS = {
  draft: ['active'],
  active: ['paused', 'expired'],
  paused: ['active', 'archived'],
  expired: ['archived'],
  archived: [],
};

function requireAdmin(req, res) {
  if (!ADMIN_API_KEY) {
    res.status(500).json({ error: 'Falta ADMIN_API_KEY en las variables de entorno del servidor.' });
    return false;
  }
  const provided = req.headers['x-admin-key'];
  if (provided !== ADMIN_API_KEY) {
    res.status(401).json({ error: 'No autorizado.' });
    return false;
  }
  return true;
}

async function createPromotion(db, body, adminUser) {
  const now = new Date();
  const doc = {
    code: body.code,
    name: body.name,
    type: body.type, // fixed_date | date_range | birthday
    status: 'draft',
    discount: body.discount, // { kind, value, currency }
    scope: body.scope || null,
    schedule: body.schedule || null,
    requires_profile: body.requires_profile || { email: true, phone: false, birth_date: false },
    usage_limit: body.usage_limit || { per_customer: null, total: null },
    created_by: adminUser || null,
    updated_by: adminUser || null,
    created_at: now,
    updated_at: now,
    activated_at: null,
    deactivated_at: null,
    status_log: [{ status: 'draft', by: adminUser || null, at: now }],
  };
  const result = await db.collection('promotions').insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function updatePromotion(db, id, patch, adminUser) {
  const now = new Date();
  const updatable = ['name', 'discount', 'scope', 'schedule', 'requires_profile', 'usage_limit'];
  const $set = { updated_by: adminUser || null, updated_at: now };
  for (const key of updatable) {
    if (patch[key] !== undefined) $set[key] = patch[key];
  }
  // includeResultMetadata:true -- ver nota en register.js: el driver mongodb v6
  // cambio el default a false y rompia "result.value".
  const result = await db.collection('promotions').findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set },
    { returnDocument: 'after', includeResultMetadata: true }
  );
  return result.value;
}

async function transitionStatus(db, id, targetStatus, adminUser) {
  const now = new Date();
  const promo = await db.collection('promotions').findOne({ _id: new ObjectId(id) });
  if (!promo) throw new Error('Promocion no encontrada.');

  const allowed = VALID_TRANSITIONS[promo.status] || [];
  if (!allowed.includes(targetStatus)) {
    throw new Error(`Transicion invalida: ${promo.status} -> ${targetStatus}. Permitidas desde ${promo.status}: ${allowed.join(', ') || '(ninguna)'}`);
  }

  const $set = { status: targetStatus, updated_by: adminUser || null, updated_at: now };
  if (targetStatus === 'active') $set.activated_at = now;
  if (targetStatus === 'paused' || targetStatus === 'expired') $set.deactivated_at = now;

  const result = await db.collection('promotions').findOneAndUpdate(
    { _id: new ObjectId(id) },
    {
      $set,
      $push: { status_log: { status: targetStatus, by: adminUser || null, at: now } },
    },
    { returnDocument: 'after', includeResultMetadata: true }
  );
  return result.value;
}

module.exports = async (req, res) => {
  applyCors(req, res, 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const db = await getDb();
    // Fix 109: se aplica ANTES de requireAdmin -- ver rationale en
    // api/loyalty-rules.js.
    if (!(await checkRateLimit(req, res, db, { scope: 'promotions', limit: 20, windowSec: 60 }))) return;
    if (!requireAdmin(req, res)) return;

    if (req.method === 'GET') {
      const filter = {};
      if (req.query && req.query.status) filter.status = req.query.status;
      if (req.query && req.query.type) filter.type = req.query.type;
      const items = await db.collection('promotions').find(filter).sort({ created_at: -1 }).toArray();
      res.status(200).json({ ok: true, items });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const body = req.body || {};
    const adminUser = req.headers['x-admin-user'] || null;

    switch (body.action) {
      case 'create': {
        if (!body.code || !body.name || !body.type || !body.discount) {
          res.status(400).json({ error: 'Faltan campos requeridos: code, name, type, discount.' });
          return;
        }
        const created = await createPromotion(db, body, adminUser);
        res.status(201).json({ ok: true, promotion: created });
        return;
      }
      case 'update': {
        if (!body.id) { res.status(400).json({ error: 'Falta id.' }); return; }
        const updated = await updatePromotion(db, body.id, body, adminUser);
        if (!updated) { res.status(404).json({ error: 'Promocion no encontrada.' }); return; }
        res.status(200).json({ ok: true, promotion: updated });
        return;
      }
      case 'activate':
      case 'pause':
      case 'archive':
      case 'expire': {
        if (!body.id) { res.status(400).json({ error: 'Falta id.' }); return; }
        const targetStatus = { activate: 'active', pause: 'paused', archive: 'archived', expire: 'expired' }[body.action];
        const updated = await transitionStatus(db, body.id, targetStatus, adminUser);
        res.status(200).json({ ok: true, promotion: updated });
        return;
      }
      default:
        res.status(400).json({ error: 'action invalida. Usa: create, update, activate, pause, archive, expire.' });
    }
  } catch (err) {
    console.error('promotions.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
