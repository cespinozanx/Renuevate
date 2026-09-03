// lib/cors.js
// Fix 89: antes, TODOS los endpoints (cart, checkout, addresses, orders,
// payment-methods, complete-profile, register, reviews, promotions,
// loyalty-rules, products) mandaban Access-Control-Allow-Origin: '*'. Eso
// permite que CUALQUIER pagina web -- no solo renuevatehoy.vercel.app -- haga
// fetch() con Content-Type: application/json contra estos endpoints y LEA la
// respuesta via JS. Como todavia no hay sesion de servidor (ver nota en
// api/cart.js y db/schema.md: "se confia en el customerId que manda el
// navegador"), el customerId es hoy el unico dato que protege el carrito,
// direcciones, metodos de pago y ordenes de un cliente. Con CORS abierto, un
// sitio malicioso que consiguiera o adivinara un customerId podria leer o
// modificar ese carrito/direcciones desde el navegador de la víctima sin que
// el navegador lo bloquee.
//
// Esto NO cierra el gap de fondo (eso requiere sesion/cookie firmada, ver
// db/schema.md) pero si cierra la via de explotacion mas facil: un atacante
// externo ya no puede hacer esas llamadas desde SU propio dominio y leer la
// respuesta, porque el navegador bloquea el preflight (todas estas llamadas
// usan Content-Type: application/json, que SI dispara preflight OPTIONS).
//
// Nota importante: esto NO afecta el funcionamiento normal del sitio. El
// frontend (index.html) llama a estos endpoints con rutas relativas
// ('/api/cart', etc.), que siempre son "same-origin" sin importar si el sitio
// corre en produccion o en un preview de Vercel -- el navegador ni siquiera
// aplica la revision de Access-Control-Allow-Origin a llamadas same-origin.
// Este header solo entra en juego cuando OTRO origen intenta llamar la API.
//
// Fix 109: se agrega Access-Control-Allow-Credentials: true porque ahora la
// identidad del cliente viaja en una cookie firmada (ver lib/session.js), no
// solo en el body/query de cada llamada. Sin este header, un navegador que
// SI mandara la llamada desde un origen cross-site (Access-Control-Allow-Origin
// ya lo permitiria si estuviera en ALLOWED_ORIGINS) igual descartaria la
// respuesta si la llamada llevara cookies. Es seguro agregarlo aqui porque
// allowOrigin NUNCA es '*' -- siempre es un origen explicito de la whitelist
// de arriba o el default; el spec de CORS prohibe combinar
// Allow-Credentials:true con Allow-Origin:'*' precisamente por el riesgo que
// eso abriria, y este archivo nunca cae en ese caso.
const ALLOWED_ORIGINS = [
  'https://renuevatehoy.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function applyCors(req, res, methods) {
  const origin = req.headers && req.headers.origin;
  const allowOrigin = (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

module.exports = { applyCors, ALLOWED_ORIGINS };
