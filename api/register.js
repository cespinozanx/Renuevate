// api/register.js
// Endpoint serverless (Vercel) que recibe el resultado de login de Google/Facebook
// desde el frontend, verifica el token con el proveedor y guarda/actualiza el
// registro del usuario en MongoDB Atlas (free tier).
//
// Escribe en la coleccion `customers` (ver db/schema.md y db/collections.js) --
// antes escribia en `users`; se unifico para que el mismo documento sirva de
// identidad de login y de perfil de marketing (telefono/cumpleanos/consentimiento).
// El registro devuelve `profile_complete`; el frontend usa ese valor para decidir
// si debe abrir el formulario "completa tu perfil" (ver api/complete-profile.js).
//
// Variables de entorno requeridas (configurar en Vercel > Project Settings > Environment Variables):
//   MONGODB_URI          - connection string de MongoDB Atlas
//   MONGODB_DB           - nombre de la base (default: "azura")
//   GOOGLE_CLIENT_ID     - Client ID de Google Cloud (OAuth 2.0)
//   FACEBOOK_APP_ID      - App ID de Meta for Developers
//   FACEBOOK_APP_SECRET  - App Secret de Meta for Developers (NUNCA en el frontend)

const { MongoClient } = require('mongodb');
const { OAuth2Client } = require('google-auth-library');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_RAW = process.env.MONGODB_DB || 'azura';
// Defensa en profundidad: un MONGODB_DB mal configurado en Vercel (ej. con un
// dominio o URL pegado por error, con un ".") revienta el driver de Mongo con
// un error interno crudo. Validamos el formato y damos un error accionable.
const MONGODB_DB_NAME_RE = /^[^/\\. "$*<>:|?]{1,64}$/;
const MONGODB_DB = MONGODB_DB_NAME_RE.test(MONGODB_DB_RAW) ? MONGODB_DB_RAW : null;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;

let cachedClient = null;

async function getDb() {
  if (!MONGODB_DB) {
    throw new Error(
      `MONGODB_DB tiene un valor invalido ("${MONGODB_DB_RAW}"). Revisa Vercel > Project Settings > ` +
      'Environment Variables: MONGODB_DB debe ser solo el nombre de la base (ej. "azura"), sin URL, dominio, puntos ni espacios.'
    );
  }
  if (cachedClient) return cachedClient.db(MONGODB_DB);
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db(MONGODB_DB);
}

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

async function verifyGoogle(idToken) {
  if (!googleClient) throw new Error('Falta GOOGLE_CLIENT_ID en las variables de entorno.');
  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  return {
    provider: 'google',
    provider_user_id: payload.sub,
    name: payload.name || null,
    email: payload.email || null,
    picture: payload.picture || null,
  };
}

async function verifyFacebook(accessToken) {
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    throw new Error('Falta FACEBOOK_APP_ID / FACEBOOK_APP_SECRET en las variables de entorno.');
  }
  const appToken = `${FACEBOOK_APP_ID}|${FACEBOOK_APP_SECRET}`;
  const debugUrl = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`;
  const debugResp = await fetch(debugUrl);
  const debugData = await debugResp.json();
  if (!debugData || !debugData.data || !debugData.data.is_valid || debugData.data.app_id !== FACEBOOK_APP_ID) {
    throw new Error('Token de Facebook invalido o de otra app.');
  }
  const profileUrl = `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${encodeURIComponent(accessToken)}`;
  const profileResp = await fetch(profileUrl);
  const profile = await profileResp.json();
  return {
    provider: 'facebook',
    provider_user_id: profile.id,
    name: profile.name || null,
    email: profile.email || null,
    picture: (profile.picture && profile.picture.data && profile.picture.data.url) || null,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body || {};
    const { provider, credential } = body;

    if (!provider || !credential) {
      res.status(400).json({ error: 'Faltan campos requeridos: provider y credential.' });
      return;
    }

    let profile;
    if (provider === 'google') {
      profile = await verifyGoogle(credential);
    } else if (provider === 'facebook') {
      profile = await verifyFacebook(credential);
    } else {
      res.status(400).json({ error: 'Provider no soportado: ' + provider });
      return;
    }

    if (!profile.email) {
      // La coleccion `customers` requiere email unico (ver db/schema.md y db/collections.js).
      // Facebook puede omitir el email si el usuario niega ese permiso; sin email no hay
      // forma segura de identificar/unificar la cuenta, asi que se rechaza explicitamente
      // en vez de arriesgar una colision en el indice unico de email.
      res.status(422).json({
        error:
          profile.provider === 'facebook'
            ? 'No pudimos obtener tu correo desde Facebook. Revisa los permisos de la app e intenta de nuevo, o usa Google.'
            : 'No pudimos obtener tu correo. Intenta de nuevo.',
      });
      return;
    }

    const db = await getDb();
    const customers = db.collection('customers');
    const now = new Date();
    const email = profile.email.toLowerCase();

    // Divide "name" en first_name/last_name lo mejor posible (OAuth solo da un nombre completo).
    const nameParts = (profile.name || '').trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts.length ? nameParts[0] : null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;
    const authEntry = { provider: profile.provider, provider_user_id: profile.provider_user_id };

    // Match por email (identidad primaria de `customers`). Si el mismo correo ya existia
    // (ej. se registro antes con Google y ahora entra con Facebook), se une el proveedor
    // nuevo a auth_providers en vez de crear un cliente duplicado.
    const result = await customers.findOneAndUpdate(
      { email },
      {
        $set: {
          email,
          first_name: firstName,
          last_name: lastName,
          picture: profile.picture,
          updated_at: now,
        },
        $addToSet: { auth_providers: authEntry },
        $setOnInsert: {
          phone: null,
          birth_date: null,
          birth_month_day: null,
          marketing_consent: null,
          profile_complete: false,
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
        name: profile.name,
        email: customer.email,
        provider: profile.provider,
        profile_complete: Boolean(customer.profile_complete),
      },
    });
  } catch (err) {
    if (err && err.code === 11000) {
      res.status(409).json({ error: 'Ya existe una cuenta con ese correo o telefono.' });
      return;
    }
    // *** MODO DEBUG TEMPORAL (a peticion de Carlos, 2026-08-03) ***
    // Mientras se diagnostica el error real, se manda el detalle tecnico al navegador
    // para no tener que estar saltando a Vercel > Runtime Logs en cada intento.
    // ESTO EXPONE DETALLE INTERNO (posiblemente fragmentos de config/infra) A CUALQUIER
    // VISITANTE DEL SITIO Y DEBE REVERTIRSE ANTES DE TRAFICO REAL / GO-LIVE.
    // Revertir a: res.status(500).json({ error: 'No pudimos completar tu inicio de sesión en este momento. Intenta de nuevo en unos minutos.' });
    console.error('register.js error:', err);
    res.status(500).json({ error: 'DEBUG: ' + (err && err.message ? err.message : String(err)) });
  }
};
