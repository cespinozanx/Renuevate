// api/addresses.js
// Direcciones de envio del cliente (coleccion `addresses`, ver db/collections.js).
// Un cliente puede tener varias (Casa, Oficina, etc.) -- exactamente una puede
// quedar marcada is_default:true a la vez (al marcar una nueva por default se
// desmarcan las demas del mismo cliente).
//
// GET    /api/addresses?customerId=...                          -> lista
// POST   /api/addresses { customerId, label?, recipientName, phone, street, extNo?, intNo?, neighborhood, city, state, zip, references?, isDefault? }
// PUT    /api/addresses { customerId, id, ...mismos campos que POST (parciales) }
// DELETE /api/addresses?customerId=...&id=...

const { MongoClient, ObjectId } = require('mongodb');
const { applyCors } = require('../lib/cors');

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

const ZIP_RE = /^[0-9]{5}$/;

function validateAddressFields(body, { partial } = { partial: false }) {
  const errors = [];
  const fields = {};

  function req(key, srcKey) {
    const v = body[srcKey];
    if (v === undefined) {
      if (!partial) errors.push(`${srcKey} es requerido.`);
      return;
    }
    const s = String(v).trim();
    if (!s) { errors.push(`${srcKey} no puede estar vacio.`); return; }
    fields[key] = s;
  }

  req('recipient_name', 'recipientName');
  req('phone', 'phone');
  req('street', 'street');
  req('neighborhood', 'neighborhood');
  req('city', 'city');
  req('state', 'state');

  if (body.zip !== undefined) {
    const zip = String(body.zip).trim();
    if (!ZIP_RE.test(zip)) errors.push('zip debe ser un codigo postal de 5 digitos.');
    else fields.zip = zip;
  } else if (!partial) {
    errors.push('zip es requerido.');
  }

  if (body.label !== undefined) fields.label = body.label ? String(body.label).trim() : null;
  if (body.extNo !== undefined) fields.ext_no = body.extNo ? String(body.extNo).trim() : null;
  if (body.intNo !== undefined) fields.int_no = body.intNo ? String(body.intNo).trim() : null;
  if (body.references !== undefined) fields.references = body.references ? String(body.references).trim() : null;
  if (body.isDefault !== undefined) fields.is_default = Boolean(body.isDefault);

  return { errors, fields };
}

module.exports = async (req, res) => {
  applyCors(req, res, 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const db = await getDb();

    if (req.method === 'GET') {
      const custId = (req.query || {}).customerId;
      if (!custId || !ObjectId.isValid(custId)) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }
      const list = await db.collection('addresses')
        .find({ customer_id: new ObjectId(custId) })
        .sort({ is_default: -1, created_at: 1 })
        .toArray();
      res.status(200).json({ ok: true, addresses: list });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const { customerId } = body;
      if (!customerId || !ObjectId.isValid(customerId)) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }

      const { errors, fields } = validateAddressFields(body, { partial: false });
      if (errors.length) { res.status(400).json({ error: errors.join(' ') }); return; }

      const customerObjId = new ObjectId(customerId);
      const existingCount = await db.collection('addresses').countDocuments({ customer_id: customerObjId });

      const doc = {
        customer_id: customerObjId,
        label: fields.label || null,
        recipient_name: fields.recipient_name,
        phone: fields.phone,
        street: fields.street,
        ext_no: fields.ext_no || null,
        int_no: fields.int_no || null,
        neighborhood: fields.neighborhood,
        city: fields.city,
        state: fields.state,
        zip: fields.zip,
        references: fields.references || null,
        // La primera direccion de un cliente siempre queda como default,
        // aunque no lo haya marcado explicitamente -- si no, un cliente
        // nuevo se quedaria sin ninguna direccion default para el carrito.
        is_default: existingCount === 0 ? true : Boolean(fields.is_default),
        created_at: new Date(),
      };

      if (doc.is_default) {
        await db.collection('addresses').updateMany({ customer_id: customerObjId }, { $set: { is_default: false } });
      }

      const insertResult = await db.collection('addresses').insertOne(doc);
      doc._id = insertResult.insertedId;
      res.status(201).json({ ok: true, address: doc });
      return;
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      const { customerId, id } = body;
      if (!customerId || !ObjectId.isValid(customerId)) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }
      if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: 'id invalido o faltante.' }); return; }

      const { errors, fields } = validateAddressFields(body, { partial: true });
      if (errors.length) { res.status(400).json({ error: errors.join(' ') }); return; }

      const customerObjId = new ObjectId(customerId);
      const addressObjId = new ObjectId(id);

      if (fields.is_default) {
        await db.collection('addresses').updateMany({ customer_id: customerObjId }, { $set: { is_default: false } });
      }

      const result = await db.collection('addresses').findOneAndUpdate(
        { _id: addressObjId, customer_id: customerObjId },
        { $set: fields },
        { returnDocument: 'after', includeResultMetadata: true }
      );
      if (!result.value) { res.status(404).json({ error: 'Direccion no encontrada.' }); return; }
      res.status(200).json({ ok: true, address: result.value });
      return;
    }

    if (req.method === 'DELETE') {
      const { customerId, id } = req.query || {};
      if (!customerId || !ObjectId.isValid(customerId)) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }
      if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: 'id invalido o faltante.' }); return; }
      const customerObjId = new ObjectId(customerId);
      const addressObjId = new ObjectId(id);

      const deleted = await db.collection('addresses').findOneAndDelete(
        { _id: addressObjId, customer_id: customerObjId },
        { includeResultMetadata: true }
      );

      // Si la que se borro era la default y quedan otras, se promueve la mas
      // antigua restante a default -- para que el carrito siempre tenga una
      // direccion "Enviar a" sugerida mientras exista al menos una guardada.
      if (deleted.value && deleted.value.is_default) {
        const next = await db.collection('addresses')
          .find({ customer_id: customerObjId })
          .sort({ created_at: 1 })
          .limit(1)
          .toArray();
        if (next.length) {
          await db.collection('addresses').updateOne({ _id: next[0]._id }, { $set: { is_default: true } });
        }
      }

      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('addresses.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
