// lib/session.js
// Fix 109: sesion de servidor firmada -- cierra el gap documentado desde Fix 89
// en cart.js/addresses.js/orders.js/checkout.js/complete-profile.js/
// index.html (saveSessionLocal): antes, el customerId que "prueba" quien es
// el cliente viajaba en la URL (querystring) o en el body de cada llamada, y
// el servidor lo aceptaba tal cual, sin verificar nada. Cualquiera que
// obtuviera ese ObjectId (logs de Vercel, historial del navegador, un
// analytics/proxy que loguee URLs, o simplemente adivinando IDs secuenciales
// no-tan-aleatorios) podia leer o modificar el carrito/direcciones/ordenes de
// otro cliente sin que el sitio lo notara.
//
// Este modulo reemplaza esa confianza ciega por un token firmado
// (HMAC-SHA256) guardado en una cookie HttpOnly que el navegador nunca deja
// leer/modificar desde JS -- solo el servidor puede emitirla (setSessionCookie,
// llamado desde api/register.js al hacer login) y verificarla
// (getSessionCustomerId, llamado desde cada endpoint protegido).
//
// Deliberadamente NO se agrega ninguna dependencia nueva a package.json: se
// usa el modulo `crypto` que ya trae Node incluido. Tampoco se crea una
// coleccion nueva en Mongo -- el token es autocontenido y "sin estado"
// (stateless): su propia firma + fecha de expiracion son suficientes para
// verificarlo, no hace falta ir a la base a confirmar que existe.
//
// Formato del token: "<payload_base64url>.<firma_base64url>"
//   payload = { cid: "<customerId ObjectId como string>", iat, exp } (epoch, segundos)
//   firma   = HMAC-SHA256(payload_base64url, SESSION_SECRET)
//
// Variable de entorno requerida (agregar en Vercel > Project Settings >
// Environment Variables, igual que las demas -- ver .env.example):
//   SESSION_SECRET  - cadena aleatoria larga (ej. 64+ caracteres). Generarla
//                      una sola vez y NUNCA cambiarla sin querer invalidar la
//                      sesion de todos los clientes logueados.

const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET;
const COOKIE_NAME = 'azura_session';
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 dias, mismo horizonte que la sesion "recordada" que ya existia en localStorage

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

// Crea un token firmado para un customerId. Lanza si falta SESSION_SECRET --
// a proposito: mejor que el login truene con un error claro en los logs a
// que emita sesiones sin firma real (equivalente a no tener seguridad).
function createSessionToken(customerId) {
  if (!SESSION_SECRET) throw new Error('Falta SESSION_SECRET en las variables de entorno.');
  const now = Math.floor(Date.now() / 1000);
  const payload = { cid: String(customerId), iat: now, exp: now + SESSION_MAX_AGE_SEC };
  const payloadB64 = base64url(JSON.stringify(payload));
  return payloadB64 + '.' + sign(payloadB64);
}

// Verifica firma + expiracion. Regresa el payload decodificado si es valido,
// o null ante CUALQUIER problema (firma invalida, formato roto, expirado,
// SESSION_SECRET no configurado) -- nunca lanza, para que cada endpoint
// pueda tratar "sesion invalida" igual que "sin sesion".
function verifySessionToken(token) {
  if (!token || !SESSION_SECRET || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expected = sign(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  // Comparacion en tiempo constante: evita que un atacante infiera la firma
  // correcta byte a byte midiendo cuanto tarda la comparacion (timing attack).
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64));
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload.cid !== 'string' || !payload.cid) return null;
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

// Punto de entrada que usan los endpoints protegidos: regresa el customerId
// (string) verificado desde la cookie de sesion, o null si no hay sesion
// valida. A proposito NUNCA lee ni acepta un customerId que venga del query
// string o del body -- ese es justo el vector que se esta cerrando.
function getSessionCustomerId(req) {
  const cookies = parseCookies(req);
  const payload = verifySessionToken(cookies[COOKIE_NAME]);
  return payload ? payload.cid : null;
}

function appendSetCookie(res, cookieStr) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) res.setHeader('Set-Cookie', cookieStr);
  else if (Array.isArray(existing)) res.setHeader('Set-Cookie', existing.concat(cookieStr));
  else res.setHeader('Set-Cookie', [existing, cookieStr]);
}

// Emite la cookie de sesion. HttpOnly (JS del navegador no puede leerla ni
// modificarla -- cierra el robo via XSS), Secure (solo viaja por HTTPS,
// vercel.app siempre sirve HTTPS) y SameSite=Lax (no se manda en requests
// cross-site de terceros, solo en navegacion normal same-site).
function setSessionCookie(res, customerId) {
  const token = createSessionToken(customerId);
  const cookie = `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}`;
  appendSetCookie(res, cookie);
}

// Logout real de servidor: Max-Age=0 le dice al navegador que borre la
// cookie de inmediato. JS no puede hacer esto por su cuenta porque la cookie
// es HttpOnly -- por eso logout() en el frontend ahora tiene que llamar a un
// endpoint (DELETE /api/register) que use esta funcion, en vez de solo
// limpiar localStorage como hacia antes.
function clearSessionCookie(res) {
  const cookie = `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
  appendSetCookie(res, cookie);
}

module.exports = {
  COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  getSessionCustomerId,
  setSessionCookie,
  clearSessionCookie,
};
