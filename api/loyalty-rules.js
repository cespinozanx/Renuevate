// api/loyalty-rules.js
// Mismo patron que api/promotions.js, para el programa de lealtad
// ("N compras en un periodo"). Reglas separadas de promotions.js porque
// loyalty_rules no tiene fecha de vigencia — es una condicion acumulativa
// que se evalua en cada compra (ver lib/promotionsEngine.js).
//
// GET  /api/loyalty-rules?status=active
// POST /api/loyalty-rules { action: "create", name, required_purchase_count, period, reward, ... }
// POST /api/loyalty-rules { action: "update", id, ...campos }
// POST /api/loyalty-rules { action: "activate" | "pause", id }

const { MongoClient, ObjectId } = require('mongodb');

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

function requireAdmin(req, res) {
  if (!ADMIN_API_KEY) {
    res.status(500).json({ error: 'Falta ADMIN_API_KEY en las variables de entorno del servidor.' });
    return false;
  }
  if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
    res.status(401).json({ error: 'No autorizado.' });
    return false;
  }
  return true;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (!requireAdmin(req, res)) return;

  try {
    const db = await getDb();
    const col = db.collection('loyalty_rules');

    if (req.method === 'GET') {
      const filter = {};
      if (req.query && req.query.status) filter.status = req.query.status;
      const items = await col.find(filter).sort({ created_at: -1 }).toArray();
      res.status(200).json({ ok: true, items });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const body = req.body || {};
    const adminUser = req.headers['x-admin-user'] || null;
    const now = new Date();

    if (body.action === 'create') {
      if (!body.name || !body.required_purchase_count || !body.period || !body.reward) {
        res.status(400).json({ error: 'Faltan campos requeridos: name, required_purchase_count, period, reward.' });
        return;
      }
      const doc = {
        name: body.name,
        status: 'paused',
        required_purchase_count: body.required_purchase_count,
        period: body.period, // { mode: "rolling"|"calendar_month", days }
        reward: body.reward, // { kind, value }
        requires_profile: body.requires_profile || { email: true, phone: true, birth_date: true },
        created_at: now,
        updated_at: now,
        status_log: [{ status: 'paused', by: adminUser, at: now }],
      };
      const result = await col.insertOne(doc);
      res.status(201).json({ ok: true, rule: { ...doc, _id: result.insertedId } });
      return;
    }

    if (body.action === 'update') {
      if (!body.id) { res.status(400).json({ error: 'Falta id.' }); return; }
      const updatable = ['name', 'required_purchase_count', 'period', 'reward', 'requires_profile'];
      const $set = { updated_at: now };
      for (const key of updatable) if (body[key] !== undefined) $set[key] = body[key];
      // includeResultMetadata:true -- el driver mongodb v6 cambio el default a false,
      // lo que hace que findOneAndUpdate regrese el documento directo en vez de
      // { value: documento }, rompiendo "result.value" abajo.
      const result = await col.findOneAndUpdate({ _id: new ObjectId(body.id) }, { $set }, { returnDocument: 'after', includeResultMetadata: true });
      if (!result.value) { res.status(404).json({ error: 'Regla no encontrada.' }); return; }
      res.status(200).json({ ok: true, rule: result.value });
      return;
    }

    if (body.action === 'activate' || body.action === 'pause') {
      if (!body.id) { res.status(400).json({ error: 'Falta id.' }); return; }
      const targetStatus = body.action === 'activate' ? 'active' : 'paused';
      const result = await col.findOneAndUpdate(
        { _id: new ObjectId(body.id) },
        { $set: { status: targetStatus, updated_at: now }, $push: { status_log: { status: targetStatus, by: adminUser, at: now } } },
        { returnDocument: 'after', includeResultMetadata: true }
      );
      if (!result.value) { res.status(404).json({ error: 'Regla no encontrada.' }); return; }
      res.status(200).json({ ok: true, rule: result.value });
      return;
    }

    res.status(400).json({ error: 'action invalida. Usa: create, update, activate, pause.' });
  } catch (err) {
    console.error('loyalty-rules.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
