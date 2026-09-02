// api/complete-profile.js
// Segunda pieza obligatoria del login (ver db/schema.md, seccion 0): Google/Facebook
// nunca entregan telefono ni fecha de nacimiento, asi que este endpoint completa el
// perfil del `customer` ya creado por api/register.js. Solo cuando phone + birth_date +
// marketing_consent.email existen se marca profile_complete = true (formula identica
// a lib/promotionsEngine.js -> isProfileComplete, para que ambos coincidan siempre).
//
// POST /api/complete-profile { customerId, phone, birth_date, marketing_consent: { email, sms, whatsapp } }
//
// Seguridad (MVP, no produccion): no hay sesion de servidor todavia -- se confia en el
// customerId que el propio navegador recibio de api/register.js en el momento del login.
// Antes de trafico real, esto debe amarrarse a una sesion/cookie firmada (ver Marco de
// Cumplimiento Enterprise, Bloque A, control de acceso) para que nadie pueda mandar un
// customerId ajeno. Documentado tambien en README.md.
//
// Este archivo TAMBIEN atiende un segundo caso, sin relacion con lo anterior:
// POST /api/complete-profile { source:'beauty_quiz', email, phone, quiz_answers }
// Contacto OPCIONAL que un visitante SIN cuenta deja al final del cuestionario de
// diagnostico de Belleza (index.html -> submitBeautyQuizLead()). Vive en este mismo
// archivo -- y no en uno nuevo -- porque el plan Hobby de Vercel limita a 12
// Serverless Functions por deployment y ya estamos en el limite (ver commit
// "Fix 27", api/checkout.js). Se guarda en una coleccion separada `leads` (nunca
// en `customers`) para poder distinguir siempre quien se registro de verdad
// (customers) de quien solo dejo su contacto en el diagnostico (leads).

const { MongoClient, ObjectId } = require('mongodb');
const { applyCors } = require('../lib/cors');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_RAW = process.env.MONGODB_DB || 'azura';
// Misma defensa que register.js/phone-auth.js: un MONGODB_DB mal configurado en
// Vercel (ej. con la connection string completa en vez del nombre de la base)
// revienta el driver de Mongo con un error interno; lo validamos aqui.
const MONGODB_DB_NAME_RE = /^[^/\\. "$*<>:|?]{1,64}$/;
const MONGODB_DB = MONGODB_DB_NAME_RE.test(MONGODB_DB_RAW) ? MONGODB_DB_RAW : null;

let cachedClient = null;
async function getDb() {
  if (!MONGODB_DB) {
    throw new Error(
      `MONGODB_DB tiene un valor invalido ("${MONGODB_DB_RAW}"). Revisa Vercel > Project Settings > ` +
      'Environment Variables: MONGODB_DB debe ser solo el nombre de la base (ej. "azura"), sin URL, ' +
      'dominio, puntos ni espacios.'
    );
  }
  if (cachedClient) return cachedClient.db(MONGODB_DB);
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db(MONGODB_DB);
}

// E.164: + seguido de 8 a 15 digitos, el primero distinto de 0.
const E164_RE = /^\+[1-9]\d{7,14}$/;

function monthDay(date) {
  const d = new Date(date);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

module.exports = async (req, res) => {
  applyCors(req, res, 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = req.body || {};

  // Lead opcional del cuestionario de Belleza -- visitante sin cuenta, no lleva
  // customerId. Se resuelve aparte del flujo normal de abajo (que SIEMPRE exige
  // un customerId valido de un customer ya existente).
  if (body.source === 'beauty_quiz') { return handleBeautyQuizLead(req, res, body); }

  try {
    const { customerId, phone, birth_date, marketing_consent } = body;

    if (!customerId || !ObjectId.isValid(customerId)) {
      res.status(400).json({ error: 'customerId invalido o faltante.' });
      return;
    }
    if (!phone || !E164_RE.test(phone)) {
      res.status(400).json({ error: 'Telefono invalido. Usa formato E.164, ej. +525512345678.' });
      return;
    }
    const parsedBirthDate = birth_date ? new Date(birth_date) : null;
    if (!parsedBirthDate || isNaN(parsedBirthDate.getTime())) {
      res.status(400).json({ error: 'Fecha de nacimiento invalida.' });
      return;
    }
    const now = new Date();
    if (parsedBirthDate > now) {
      res.status(400).json({ error: 'La fecha de nacimiento no puede ser en el futuro.' });
      return;
    }

    const consent = marketing_consent || {};
    const consentDoc = {
      email: Boolean(consent.email),
      sms: Boolean(consent.sms),
      whatsapp: Boolean(consent.whatsapp),
      consent_at: now,
      consent_version: 'v1',
    };

    // Misma formula que lib/promotionsEngine.js -> isProfileComplete, para que
    // profile_complete y la elegibilidad real de promos nunca queden desincronizados.
    const profileComplete = Boolean(phone && parsedBirthDate && consentDoc.email === true);

    const db = await getDb();
    const customers = db.collection('customers');

    const result = await customers.findOneAndUpdate(
      { _id: new ObjectId(customerId) },
      {
        $set: {
          phone,
          birth_date: parsedBirthDate,
          birth_month_day: monthDay(parsedBirthDate),
          marketing_consent: consentDoc,
          profile_complete: profileComplete,
          updated_at: now,
        },
      },
      // includeResultMetadata:true -- ver nota en register.js: el driver mongodb v6
      // cambio el default a false y rompia "result.value".
      { returnDocument: 'after', includeResultMetadata: true }
    );

    if (!result.value) {
      res.status(404).json({ error: 'Cliente no encontrado.' });
      return;
    }

    res.status(200).json({
      ok: true,
      profile_complete: result.value.profile_complete,
      requires_email_consent_note: !consentDoc.email
        ? 'Sin consentimiento de correo, el perfil no califica a promociones de cumpleanos ni lealtad (ver db/schema.md, seccion 5).'
        : null,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      res.status(409).json({ error: 'Ese telefono ya esta registrado en otra cuenta.' });
      return;
    }
    // Igual que en register.js: el detalle tecnico (config/infra) solo va al log del
    // servidor, nunca al navegador.
    console.error('complete-profile.js error:', err);
    res.status(500).json({ error: 'No pudimos guardar tu perfil en este momento. Intenta de nuevo en unos minutos.' });
  }
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Guarda el contacto opcional que un visitante SIN cuenta deja al final del
// cuestionario de diagnostico de Belleza. A proposito NO toca la coleccion
// `customers` -- va a `leads`, con lead_source:'beauty_quiz', para que siempre
// se pueda distinguir un registro real (customers) de un contacto suelto
// dejado en el diagnostico (leads). Si el visitante ya tiene sesion iniciada,
// el frontend ni siquiera muestra este formulario (ver index.html, CURRENT_CUSTOMER.id).
async function handleBeautyQuizLead(req, res, body) {
  try {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';

    if (!email && !phone) {
      res.status(400).json({ error: 'Captura al menos un correo o un telefono.' });
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'Correo invalido.' });
      return;
    }
    if (phone && !E164_RE.test(phone)) {
      res.status(400).json({ error: 'Telefono invalido. Usa formato E.164, ej. +525512345678.' });
      return;
    }

    const db = await getDb();
    const now = new Date();

    // Idempotente por email+telefono: si la misma persona vuelve a dejar su
    // contacto (ej. repite el diagnostico), se actualiza el mismo lead en vez
    // de acumular duplicados.
    const dedupeKey = {};
    if (email) dedupeKey.email = email;
    if (phone) dedupeKey.phone = phone;

    const update = {
      $set: {
        email: email || null,
        phone: phone || null,
        lead_source: 'beauty_quiz',
        quiz_answers: body.quiz_answers && typeof body.quiz_answers === 'object' ? body.quiz_answers : null,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    };

    await db.collection('leads').updateOne(dedupeKey, update, { upsert: true });

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('complete-profile.js (beauty_quiz lead) error:', err);
    res.status(500).json({ error: 'No pudimos guardar tu contacto en este momento. Intenta de nuevo en unos minutos.' });
  }
}
