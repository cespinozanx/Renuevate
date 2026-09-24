// api/admin-auth.js
// Fix 137: login/logout del panel de Administracion (ver lib/adminAuth.js
// para la razon de fondo de por que la contrasena vive en una variable de
// entorno y no en el codigo).
//
// POST { password } -> valida contra ADMIN_PASSWORD y, si coincide, emite la
//                        cookie firmada de sesion de admin.
// GET                -> confirma si la cookie actual sigue vigente (para que
//                        el panel no vuelva a pedir contrasena en cada
//                        recarga dentro de las 4 horas de sesion).
// DELETE             -> cierra sesion (borra la cookie).

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

let cachedClient = null;
async function getDb() {
  if (cachedClient) return cachedClient.db(MONGODB_DB);
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db(MONGODB_DB);
}

module.exports = async (req, res) => {
  applyCors(req, res, 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const db = await getDb();
    // Fix 137: este endpoint solo lo usa una persona -- 10 intentos en 15
    // minutos es generoso para uso real y corta de raiz cualquier intento de
    // adivinar la contrasena por fuerza bruta (defensa en profundidad, la
    // contrasena en si ya es larga).
    if (!(await checkRateLimit(req, res, db, { scope: 'admin-auth', limit: 10, windowSec: 900 }))) return;

    if (req.method === 'GET') {
      res.status(200).json({ ok: true, authenticated: isAdminRequest(req) });
      return;
    }

    if (req.method === 'POST') {
      const { password } = req.body || {};
      if (!passwordMatches(password)) {
        // Fix 137: mensaje generico a proposito -- nunca revela si el
        // problema fue "contrasena incorrecta" vs. "ADMIN_PASSWORD no
        // configurada en el servidor", para no darle pistas a quien intente
        // entrar sin autorizacion. El detalle real queda solo en los logs
        // del servidor si hiciera falta diagnosticar.
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
  } catch (err) {
    console.error('admin-auth.js error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
};
