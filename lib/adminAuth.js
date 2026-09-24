// lib/adminAuth.js
// Fix 137: sesion de administrador para el nuevo panel de Administracion
// (Carlos: "un formulario que me permita hacer lo que hoy hacemos con el
// bat para sembrar producto... pedira una contrasena fija... con eso solo
// esa persona entrara a modificar").
//
// Correccion deliberada sobre lo literal pedido, explicada aqui y en el
// resumen entregado a Carlos: la contrasena NUNCA vive en el codigo fuente
// ni en el frontend. Se compara contra la variable de entorno ADMIN_PASSWORD
// (Vercel > Project Settings > Environment Variables, exactamente igual que
// MONGODB_URI/SESSION_SECRET). Igual que en sembrar-productos.bat, Claude
// nunca vio ni guardo ese valor -- Carlos lo captura directo en Vercel. Una
// contrasena fija embebida en index.html quedaria visible para cualquiera
// que abra "Ver codigo fuente" del sitio, lo que anula por completo la
// proteccion pedida.
//
// Reutiliza el mismo patron de token firmado de lib/session.js (HMAC-SHA256,
// cookie HttpOnly + Secure + SameSite=Lax) y el mismo SESSION_SECRET que ya
// existe en el proyecto -- se evita pedirle a Carlos una segunda variable de
// entorno solo para esto. El payload lleva role:'admin' (nunca un cid de
// cliente) y una expiracion corta de 4 horas: una sesion de administrador
// olvidada abierta en un equipo no debe quedar vigente 30 dias como una
// sesion normal de cliente (ver lib/session.js).

const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const COOKIE_NAME = 'azura_admin_session';
const ADMIN_SESSION_MAX_AGE_SEC = 4 * 60 * 60; // 4 horas

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function sign(payloadB64) {
  return base64url(crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest());
}

function createAdminSessionToken() {
  if (!SESSION_SECRET) throw new Error('Falta SESSION_SECRET en las variables de entorno.');
  const now = Math.floor(Date.now() / 1000);
  const payload = { role: 'admin', iat: now, exp: now + ADMIN_SESSION_MAX_AGE_SEC };
  const payloadB64 = base64url(JSON.stringify(payload));
  return payloadB64 + '.' + sign(payloadB64);
}

// Verifica firma + expiracion + que el token sea realmente de admin (role).
// Regresa el payload si es valido, null ante cualquier problema -- nunca
// lanza, mismo patron que verifySessionToken en lib/session.js.
function verifyAdminSessionToken(token) {
  if (!token || !SESSION_SECRET || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expected = sign(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64));
  } catch (e) {
    return null;
  }
  if (!payload || payload.role !== 'admin') return null;
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function parseCookies(req) {
  const header = req.headers && req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (!k) return;
    try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; }
  });
  return out;
}

// true si la peticion trae una cookie de admin valida y vigente. Punto de
// entrada unico que usan api/admin-products.js y cualquier endpoint futuro
// que necesite exigir sesion de administrador.
function isAdminRequest(req) {
  const cookies = parseCookies(req);
  return !!verifyAdminSessionToken(cookies[COOKIE_NAME]);
}

// Compara la contrasena recibida contra ADMIN_PASSWORD en tiempo constante.
// Se comparan hashes SHA-256 (no los valores crudos) para que ni la longitud
// de lo que se escribio se filtre por temporizacion.
function passwordMatches(candidate) {
  if (!ADMIN_PASSWORD || typeof candidate !== 'string') return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function appendSetCookie(res, cookieStr) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) res.setHeader('Set-Cookie', cookieStr);
  else if (Array.isArray(existing)) res.setHeader('Set-Cookie', existing.concat(cookieStr));
  else res.setHeader('Set-Cookie', [existing, cookieStr]);
}

function setAdminSessionCookie(res) {
  const token = createAdminSessionToken();
  const cookie = `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ADMIN_SESSION_MAX_AGE_SEC}`;
  appendSetCookie(res, cookie);
}

function clearAdminSessionCookie(res) {
  const cookie = `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
  appendSetCookie(res, cookie);
}

module.exports = {
  COOKIE_NAME,
  isAdminRequest,
  passwordMatches,
  setAdminSessionCookie,
  clearAdminSessionCookie,
};
