// api/payment-methods.js
// Metodos de pago del cliente (coleccion `payment_methods`, ver db/collections.js).
//
// CONTROL CRITICO (PCI-DSS / ISO 27001 A.8.24): este endpoint NUNCA acepta ni
// guarda el numero de tarjeta completo (PAN) ni el CVV. Si el payload trae
// cualquier campo que se parezca a eso, se rechaza explicitamente con 422 --
// no se procesa "por si las dudas". Lo unico que se guarda es lo necesario
// para MOSTRAR el metodo en el checkout (marca, ultimos 4 digitos, vigencia)
// o, para PayPal, el correo asociado. `provider_token` es un placeholder para
// cuando se integre un procesador certificado PCI real (Stripe, PayPal
// Checkout, Conekta) -- ese token es lo unico que representaria la tarjeta de
// verdad, y lo emitiria el procesador, nunca este servidor.
//
// GET    /api/payment-methods?customerId=...              -> lista (enmascarada)
// POST   /api/payment-methods { customerId, type, brand?, last4?, exp_month?, exp_year?, paypal_email?, is_default? }
// DELETE /api/payment-methods?customerId=...&id=...

const { MongoClient, ObjectId } = require('mongodb');
const { applyCors } = require('../lib/cors');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'azura';

// Cualquier payload que traiga alguna de estas llaves se rechaza de entrada --
// es la senal mas clara de que alguien (frontend mal hecho, integracion de
// terceros, o un intento malicioso) esta tratando de mandar datos de tarjeta
// crudos a un servidor que no esta certificado para recibirlos.
const FORBIDDEN_FIELDS = ['card_number', 'cardNumber', 'number', 'pan', 'cvv', 'cvc', 'cvv2', 'security_code'];

let cachedClient = null;
async function getDb() {
  if (cachedClient) return cachedClient.db(MONGODB_DB);
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db(MONGODB_DB);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  applyCors(req, res, 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const db = await getDb();

    if (req.method === 'GET') {
      const custId = (req.query || {}).customerId;
      if (!custId || !ObjectId.isValid(custId)) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }
      const methods = await db.collection('payment_methods').find({ customer_id: new ObjectId(custId) }).toArray();
      res.status(200).json({ ok: true, payment_methods: methods });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      const foundForbidden = FORBIDDEN_FIELDS.filter((f) => body[f] !== undefined);
      if (foundForbidden.length) {
        res.status(422).json({
          error:
            'Este sistema no captura ni almacena numero de tarjeta completo ni CVV (control PCI-DSS / ISO 27001 A.8.24). ' +
            'Para procesar pagos reales se debe integrar un proveedor certificado (Stripe, PayPal, Conekta) que entregue un token seguro.',
          rejected_fields: foundForbidden,
        });
        return;
      }

      const { customerId, type, brand, last4, exp_month, exp_year, paypal_email, is_default } = body;
      if (!customerId || !ObjectId.isValid(customerId)) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }
      if (type !== 'card' && type !== 'paypal') { res.status(400).json({ error: 'type debe ser "card" o "paypal".' }); return; }

      const doc = {
        customer_id: new ObjectId(customerId),
        type,
        brand: null,
        last4: null,
        exp_month: null,
        exp_year: null,
        paypal_email: null,
        provider_token: null,
        is_default: Boolean(is_default),
        created_at: new Date(),
      };

      if (type === 'card') {
        const allowedBrands = ['visa', 'mastercard', 'amex', 'other'];
        if (!allowedBrands.includes(brand)) { res.status(400).json({ error: 'brand invalido (visa/mastercard/amex/other).' }); return; }
        if (!/^[0-9]{4}$/.test(String(last4 || ''))) { res.status(400).json({ error: 'last4 debe ser exactamente 4 digitos (nunca la tarjeta completa).' }); return; }
        const em = Number(exp_month), ey = Number(exp_year);
        if (!Number.isInteger(em) || em < 1 || em > 12) { res.status(400).json({ error: 'exp_month invalido (1-12).' }); return; }
        if (!Number.isInteger(ey) || ey < new Date().getFullYear()) { res.status(400).json({ error: 'exp_year invalido o vencido.' }); return; }
        doc.brand = brand;
        doc.last4 = String(last4);
        doc.exp_month = em;
        doc.exp_year = ey;
      } else {
        if (!paypal_email || !EMAIL_RE.test(String(paypal_email))) { res.status(400).json({ error: 'paypal_email invalido.' }); return; }
        doc.paypal_email = String(paypal_email).toLowerCase();
      }

      if (doc.is_default) {
        await db.collection('payment_methods').updateMany({ customer_id: doc.customer_id }, { $set: { is_default: false } });
      }

      const insertResult = await db.collection('payment_methods').insertOne(doc);
      doc._id = insertResult.insertedId;
      res.status(201).json({ ok: true, payment_method: doc });
      return;
    }

    if (req.method === 'DELETE') {
      const { customerId, id } = req.query || {};
      if (!customerId || !ObjectId.isValid(customerId)) { res.status(400).json({ error: 'customerId invalido o faltante.' }); return; }
      if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: 'id invalido o faltante.' }); return; }
      await db.collection('payment_methods').deleteOne({ _id: new ObjectId(id), customer_id: new ObjectId(customerId) });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('payment-methods.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
