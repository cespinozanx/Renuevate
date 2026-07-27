// api/phone-auth.js
// Registro/login alterno por telefono (sin Google/Facebook), con verificacion
// real de posesion del numero via codigo OTP de 6 digitos -- ver
// db/collections.js (coleccion `phone_verifications`) y db/schema.md.
//
// Por que OTP y no solo "capturar el telefono": sin verificarlo, cualquiera
// podria escribir el numero de otra persona y crear una cuenta a su nombre
// (spoofing de identidad). El OTP es el control minimo de integridad para que
// "registro por telefono" sea una alternativa real a OAuth, no un formulario
// sin dueno verificado.
//
// Seguridad del OTP (ISO 27001 A.8.24 / A.9.4):
//  - Nunca se guarda el codigo en claro -- solo sha256(otp + salt aleatorio).
//  - Expira en 10 minutos (TTL index en Mongo lo purga solo).
//  - Maximo 5 intentos de verificacion por codigo; despues se invalida.
//  - Maximo 1 solicitud de codigo nuevo cada 60s por numero (anti-flood/anti-costo,
//    porque cada SMS real tiene costo -- ver lib/sendSms.js).
//  - El nombre/fecha de nacimiento/consentimiento se capturan ANTES de verificar
//    y viajan pegados al intento de verificacion (pending_profile), no se vuelven
//    a confiar del cliente en el segundo paso.
//
// POST /api/phone-auth?action=request { phone, firstName, birthDate, marketingConsent }
// POST /api/phone-auth?action=verify  { phone, otp }
//
// Variables de entorno requeridas ademas de MONGODB_URI/MONGODB_DB:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (ver lib/sendSms.js)

const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const { sendSms } = require('../lib/sendSms');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'azura';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutos
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 segundos
const MAX_ATTEMPTS = 5;
const PHONE_RE = /^\+[1-9][0-9]{7,14}$/; // E.164

let cachedClient = null;
async function getDb() {
  if (cachedClient) return cachedClient.db(MONGODB_DB);
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db(MONGODB_DB);
}

function hashOtp(otp, salt) {
  return crypto.createHash('sha256').update(`${otp}:${salt}`).digest('hex');
}

function deriveBirthMonthDay(dateObj) {
  if (!dateObj) return null;
  const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

async function handleRequest(req, res, db) {
  const body = req.body || {};
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim().slice(0, 60) : '';
  const birthDateRaw = body.birthDate;
  const marketingConsent = body.marketingConsent || {};

  if (!PHONE_RE.test(phone)) {
    res.status(400).json({ error: 'Telefono invalido. Usa formato internacional E.164, ej. +525512345678.' });
    return;
  }
  if (!firstName) {
    res.status(400).json({ error: 'El nombre es requerido.' });
    return;
  }
  const birthDate = birthDateRaw ? new Date(birthDateRaw) : null;
  if (!birthDate || Number.isNaN(birthDate.getTime())) {
    res.status(400).json({ error: 'Fecha de nacimiento invalida.' });
    return;
  }
  if (!marketingConsent.email) {
    res.status(400).json({ error: 'Se requiere aceptar promociones por correo para completar el registro (igual que en el flujo de Google/Facebook).' });
    return;
  }

  const phoneVerifications = db.collection('phone_verifications');

  // Anti-flood / control de costo: no reenviar un SMS nuevo antes de 60s para el mismo numero.
  const last = await phoneVerifications.find({ phone }).sort({ created_at: -1 }).limit(1).toArray();
  if (last.length && Date.now() - last[0].created_at.getTime() < RESEND_COOLDOWN_MS) {
    res.status(429).json({ error: 'Espera unos segundos antes de pedir un nuevo codigo.' });
    return;
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date();

  const doc = {
    phone,
    otp_hash: hashOtp(otp, salt),
    salt,
    attempts: 0,
    consumed: false,
    pending_profile: {
      first_name: firstName,
      birth_date: birthDate,
      marketing_consent: {
        email: Boolean(marketingConsent.email),
        sms: Boolean(marketingConsent.sms),
        whatsapp: Boolean(marketingConsent.whatsapp),
      },
    },
    expires_at: new Date(now.getTime() + OTP_TTL_MS),
    created_at: now,
  };

  await phoneVerifications.insertOne(doc);

  try {
    await sendSms(phone, `Casa Azura Wellness: tu codigo de verificacion es ${otp}. Vence en 10 minutos. No lo compartas con nadie.`);
  } catch (smsErr) {
    if (smsErr.code === 'SMS_NOT_CONFIGURED') {
      res.status(501).json({ error: smsErr.message });
      return;
    }
    console.error('phone-auth.js sendSms error:', smsErr);
    res.status(502).json({ error: 'No se pudo enviar el SMS en este momento. Intenta de nuevo en unos minutos.' });
    return;
  }

  res.status(200).json({ ok: true, message: 'Codigo enviado por SMS.' });
}

async function handleVerify(req, res, db) {
  const body = req.body || {};
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const otp = typeof body.otp === 'string' ? body.otp.trim() : '';

  if (!PHONE_RE.test(phone) || !/^[0-9]{6}$/.test(otp)) {
    res.status(400).json({ error: 'Telefono o codigo invalido.' });
    return;
  }

  const phoneVerifications = db.collection('phone_verifications');
  const attempt = await phoneVerifications.find({ phone, consumed: false }).sort({ created_at: -1 }).limit(1).toArray();
  const verification = attempt[0];

  if (!verification || verification.expires_at.getTime() < Date.now()) {
    res.status(400).json({ error: 'El codigo expiro o no existe. Solicita uno nuevo.' });
    return;
  }
  if (verification.attempts >= MAX_ATTEMPTS) {
    res.status(429).json({ error: 'Demasiados intentos fallidos. Solicita un codigo nuevo.' });
    return;
  }

  const candidateHash = hashOtp(otp, verification.salt);
  if (candidateHash !== verification.otp_hash) {
    await phoneVerifications.updateOne({ _id: verification._id }, { $inc: { attempts: 1 } });
    res.status(400).json({ error: 'Codigo incorrecto.' });
    return;
  }

  await phoneVerifications.updateOne({ _id: verification._id }, { $set: { consumed: true } });

  const db2 = db;
  const customers = db2.collection('customers');
  const now = new Date();
  const profile = verification.pending_profile || {};
  const authEntry = { provider: 'phone', provider_user_id: phone };

  const result = await customers.findOneAndUpdate(
    { phone },
    {
      $set: {
        phone,
        first_name: profile.first_name || null,
        birth_date: profile.birth_date || null,
        birth_month_day: deriveBirthMonthDay(profile.birth_date),
        marketing_consent: {
          ...(profile.marketing_consent || {}),
          consent_at: now,
          consent_version: 'v1',
        },
        profile_complete: true,
        updated_at: now,
      },
      $addToSet: { auth_providers: authEntry },
      $setOnInsert: {
        email: null,
        last_name: null,
        loyalty_tier: 'none',
        status: 'active',
        created_at: now,
        source: 'azura-site',
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  const customer = result.value;

  res.status(200).json({
    ok: true,
    user: {
      id: customer._id,
      name: customer.first_name,
      phone: customer.phone,
      provider: 'phone',
      profile_complete: true,
    },
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const action = (req.query || {}).action;

  try {
    const db = await getDb();
    if (action === 'request') { await handleRequest(req, res, db); return; }
    if (action === 'verify') { await handleVerify(req, res, db); return; }
    res.status(400).json({ error: 'action invalido. Usa ?action=request o ?action=verify.' });
  } catch (err) {
    if (err && err.code === 11000) {
      res.status(409).json({ error: 'Ya existe una cuenta con ese telefono.' });
      return;
    }
    console.error('phone-auth.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
