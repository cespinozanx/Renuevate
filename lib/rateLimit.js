// lib/rateLimit.js
// Fix 109: limite de tasa por IP para los endpoints de api/. Antes no existia
// ningun control -- un script (o alguien deliberadamente buscando generarte
// costo en MongoDB Atlas / en Mercado Pago) podia mandar peticiones sin
// limite a cualquiera de los 11 endpoints.
//
// No hay Redis/KV en este stack (Vercel Hobby + Atlas free/shared tier), asi
// que se implementa "ventana fija" (fixed window) respaldado en la misma
// base de Mongo que ya usa todo el sitio -- agregar una pieza de
// infraestructura nueva solo para esto no se justifica en esta etapa.
//
// Limitacion conocida (documentada a proposito, no un descuido): una ventana
// fija deja un borde donde 2 rafagas justo antes/despues del corte pueden
// sumar casi el doble del limite nominal en menos de 1 segundo. Para lo que
// se protege aqui (scripts/bots/abuso grosero, no un ataque de precision
// milimetrica) es suficiente -- un "sliding window" o "token bucket" real
// necesitaria mas lecturas/escrituras en Mongo (mas costo, justo lo
// contrario de lo que se busca) sin cambiar la conclusion practica para un
// sitio de este tamano. Subir de nivel aqui es una apuesta estrategica
// futura, no un quick win de hoy.
//
// Fail-open a proposito: si Mongo esta lento/caido, el rate limiter no debe
// ser la razon por la que el sitio completo deja de responder -- se deja
// pasar la peticion y se registra el error para diagnostico.

function clientIp(req) {
  // Vercel siempre agrega x-forwarded-for con la IP real del visitante como
  // primer valor -- Vercel sobreescribe este header antes de que llegue a la
  // funcion serverless, un cliente no puede falsificarlo desde fuera.
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// scope: nombre corto del endpoint/uso (ej. 'cart', 'checkout'). limit: peticiones
// permitidas por ventana. windowSec: tamano de la ventana en segundos.
// Regresa true si la peticion puede continuar; si regresa false, YA respondio
// 429 -- el caller solo necesita hacer "if (!ok) return;".
async function checkRateLimit(req, res, db, { scope, limit, windowSec }) {
  try {
    const ip = clientIp(req);
    const windowMs = windowSec * 1000;
    const now = Date.now();
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
    const bucket = `${scope}:${req.method}:${ip}`;
    // Colchon de 60s sobre el cierre de la ventana antes de que el indice TTL
    // (ver db/collections.js) purgue el documento -- solo para dar margen a
    // que Mongo procese el borrado, no afecta el conteo real.
    const expiresAt = new Date(windowStart.getTime() + windowMs + 60000);

    const result = await db.collection('rate_limits').findOneAndUpdate(
      { bucket, window_start: windowStart },
      { $inc: { count: 1 }, $setOnInsert: { bucket, window_start: windowStart, expires_at: expiresAt } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true }
    );
    const doc = result.value;

    if (doc && doc.count > limit) {
      res.setHeader('Retry-After', String(windowSec));
      res.status(429).json({ error: 'Demasiadas peticiones. Intenta de nuevo en unos segundos.', code: 'RATE_LIMITED' });
      return false;
    }
    return true;
  } catch (err) {
    console.error('rateLimit.js error (fail-open, se deja pasar la peticion):', err);
    return true;
  }
}

module.exports = { checkRateLimit, clientIp };
