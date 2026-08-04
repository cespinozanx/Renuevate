// db/seed-products.js
// Siembra la coleccion `products` con el mismo catalogo (sku, nombre, precio,
// rating, related) que hoy vive solo en JS estatico dentro de index.html.
// Objetivo: que `products` en Mongo sea la fuente de verdad real para que
// api/cart.js y api/reviews.js puedan validar sku/precio contra el servidor
// (ver db/schema.md seccion 7/8 -- cierra ese gap para estos 16 productos).
//
// Correr una sola vez (o cuando cambie el catalogo real):
//   node db/seed-products.js
//
// Es idempotente: usa upsert por sku, se puede correr varias veces sin duplicar.
//
// Nota: al ejecutarlo directo con "node db/seed-products.js" Node no lee el
// .env por si mismo -- se carga aqui a mano (ver misma logica en collections.js).

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'azura';

// price viene como "$389 MXN" en el frontend -- se parsea a numero aqui.
function parsePrice(str) {
  const match = String(str).match(/[\d.]+/);
  return match ? Number(match[0]) : 0;
}

// Productos reales de Carlos (2026-08-03), reemplazan los 4 placeholders RAIZ-01..04.
// `long_description_es` / `usage_es` / `disclaimer_es` no estan validados por el
// $jsonSchema de `products` (products no tiene additionalProperties:false), asi
// que se guardan igual para cuando exista una vista de detalle de producto --
// por ahora el frontend solo pinta `description_i18n` (texto corto) en la tarjeta.
// `image` sigue la convencion acordada con Carlos: el nombre del producto en
// minusculas, sin espacios, en media/products/ -- mismo valor que el campo
// "img" del catalogo estatico en index.html.
const REAL_PRODUCTS = [
  { sku: 'OPTIMUS', vertical: 'raiz', price: '$574 MXN', image: 'media/products/optimus.jpg', related: [],
    name_i18n: { es: 'Optimus 30 sobres', en: 'Optimus 30 sachets', fr: 'Optimus 30 sachets' },
    description_i18n: {
      es: 'Colina, glicina, complejo B, vitaminas C y E con endulzantes naturales.',
      en: 'Choline, glycine, B-complex, vitamins C and E with natural sweeteners.',
      fr: 'Choline, glycine, complexe B, vitamines C et E avec edulcorants naturels.' },
    long_description_es: 'Suplemento alimenticio en polvo sabor a lima-limon. Caja con 30 sobres, contenido neto 240 gramos. Apoya tu nutricion diaria con una formula que combina colina, glicina, vitaminas del complejo B, vitaminas C y E, minerales esenciales y endulzantes de origen natural. Una opcion practica para complementar un estilo de vida saludable y acompanarte en tu rutina diaria.',
    ingredients_es: ['Colina y glicina.', 'Vitaminas del complejo B.', 'Vitaminas C y E.', 'Calcio, cobre, cromo, fosforo y zinc.', 'Endulzado naturalmente con fruto del monje y estevia.'],
    usage_es: 'Puede consumirse en cualquier momento del dia como parte de una alimentacion equilibrada y un estilo de vida saludable.',
    disclaimer_es: 'Este producto no es un medicamento. Su consumo es responsabilidad de quien lo recomienda y de quien lo utiliza.' },

  { sku: 'OMNIPLUS', vertical: 'raiz', price: '$755 MXN', image: 'media/products/omniplus.jpg', related: [],
    name_i18n: { es: 'Omniplus 30 sobres', en: 'Omniplus 30 sachets', fr: 'Omniplus 30 sachets' },
    description_i18n: {
      es: 'Vitaminas A, D, E, complejo B y sabila, sabor naranja.',
      en: 'Vitamins A, D, E, B-complex and aloe vera, orange flavor.',
      fr: 'Vitamines A, D, E, complexe B et aloe vera, saveur orange.' },
    long_description_es: 'Sabor naranja. Caja con 30 sobres, contenido neto 600 mililitros. Un suplemento alimenticio de alta calidad con una exclusiva combinacion de vitaminas, minerales y extractos herbales de origen natural. Su formula micelizada y su agradable sabor a naranja lo convierten en una excelente opcion para complementar tu nutricion diaria.',
    ingredients_es: ['Formula micelizada de alta calidad.', 'Concentrado nutritivo con vitaminas y minerales esenciales.', 'Vitaminas A, D, E y complejo B.', 'Minerales como calcio, magnesio, zinc, cobre, manganeso, selenio e yodo.', 'Gel de sabila (Aloe vera) y una seleccion de extractos herbales.', 'Endulzado con ingredientes de origen natural.'],
    usage_es: 'Sabor naranja.',
    disclaimer_es: 'Este producto no es un medicamento. Su consumo es responsabilidad de quien lo recomienda y de quien lo utiliza.' },

  { sku: 'POWERMAKER', vertical: 'raiz', price: '$950 MXN', image: 'media/products/powermaker.jpg', related: [],
    name_i18n: { es: 'Power Maker 30 sobres', en: 'Power Maker 30 sachets', fr: 'Power Maker 30 sachets' },
    description_i18n: {
      es: '3g de L-arginina, aminoacidos y vitaminas para tu rutina activa.',
      en: '3g of L-arginine, amino acids and vitamins for your active routine.',
      fr: '3g de L-arginine, acides amines et vitamines pour votre routine active.' },
    long_description_es: 'Suplemento alimenticio en polvo sabor naranja. Caja con 30 sobres, contenido neto 300 gramos. Power Maker combina L-arginina, aminoacidos, vitaminas y minerales en un practico suplemento alimenticio con delicioso sabor a naranja, disenado para complementar un estilo de vida activo.',
    ingredients_es: ['3 g de L-arginina por porcion.', 'Contiene colina y glicina.', 'Enriquecido con vitaminas B5, C y E.', 'Aporta minerales como calcio, cobre, cromo, boro y zinc.', 'Endulzado con ingredientes de origen natural: fruto del monje y estevia.'],
    usage_es: 'Puede consumirse a cualquier hora del dia o aproximadamente una hora antes de realizar actividad fisica. Disfrutalo frio o a temperatura ambiente.',
    disclaimer_es: 'Este producto no es un medicamento. Su consumo es responsabilidad de quien lo recomienda y de quien lo utiliza.' },

  { sku: 'MAGNUS', vertical: 'raiz', price: '$590 MXN', image: 'media/products/magnus.jpg', related: [],
    name_i18n: { es: 'Magnus 30 sobres', en: 'Magnus 30 sachets', fr: 'Magnus 30 sachets' },
    description_i18n: {
      es: 'Aminoacidos, vitaminas y cafeina para acompanar tu actividad diaria.',
      en: 'Amino acids, vitamins and caffeine to support your daily activity.',
      fr: 'Acides amines, vitamines et cafeine pour accompagner votre activite quotidienne.' },
    long_description_es: 'Suplemento alimenticio en polvo sabor citrico. Caja con 30 sobres, contenido neto 405 gramos. Complementa tu nutricion diaria con una formula que combina aminoacidos, vitaminas, minerales y cafeina, disenada para acompanar un estilo de vida activo.',
    ingredients_es: ['Contiene aminoacidos como taurina, glicina y fenilalanina.', 'Enriquecido con vitaminas del complejo B, ademas de vitaminas C y E.', 'Aporta minerales esenciales como zinc, cobre y cromo.', 'Contiene cafeina.', 'Ideal para complementar una alimentacion equilibrada y un estilo de vida activo.'],
    usage_es: 'Consumelo de acuerdo con las indicaciones del producto como parte de una alimentacion balanceada, actividad fisica regular, una adecuada hidratacion y un buen descanso.',
    disclaimer_es: 'Este producto no es un medicamento. Su consumo es responsabilidad de quien lo recomienda y de quien lo utiliza.' },
];

// Skus viejos de demostracion que este seed ya NO siembra (se reemplazaron por
// los 4 reales de arriba). Se desactivan en vez de borrarse -- por si algun
// carrito/orden de prueba ya los referencia, no truena una validacion contra
// un sku que desaparecio de golpe.
const RETIRED_DEMO_SKUS = ['RAIZ-01', 'RAIZ-02', 'RAIZ-03', 'RAIZ-04'];

const PRODUCTS = [
  ...REAL_PRODUCTS,

  // NACAR
  { sku: 'NACAR-01', vertical: 'nacar', price: '$549 MXN', rating: { stars: 4.7, count: 410 }, related: ['NACAR-02'],
    name_i18n: { es: 'Luz Nacar Vitamina C', en: 'Nacar Glow Vitamin C', fr: 'Eclat Nacar Vitamine C' },
    description_i18n: { es: 'Luminosidad inmediata, uso diario.', en: 'Instant radiance, daily use.', fr: 'Luminosite immediate, usage quotidien.' } },
  { sku: 'NACAR-02', vertical: 'nacar', price: '$479 MXN', rating: { stars: 4.6, count: 356 }, related: ['NACAR-01'],
    name_i18n: { es: 'Crema Perla Hidratante', en: 'Pearl Hydrating Cream', fr: 'Creme Perle Hydratante' },
    description_i18n: { es: 'Hidratacion profunda 24h.', en: '24h deep hydration.', fr: 'Hydratation profonde 24h.' } },
  { sku: 'NACAR-03', vertical: 'nacar', price: '$399 MXN', rating: { stars: 4.4, count: 89 }, related: ['NACAR-04'],
    name_i18n: { es: 'Aceite Brillo Sedoso', en: 'Silky Shine Oil', fr: 'Huile Brillance Soyeuse' },
    description_i18n: { es: 'Brillo y suavidad sin sensacion grasosa.', en: 'Shine and softness with no greasy feel.', fr: 'Brillance et douceur sans effet gras.' } },
  { sku: 'NACAR-04', vertical: 'nacar', price: '$419 MXN', rating: { stars: 4.5, count: 203 }, related: ['NACAR-01'],
    name_i18n: { es: 'Contorno de Ojos Nacar', en: 'Nacar Eye Contour', fr: 'Contour des Yeux Nacar' },
    description_i18n: { es: 'Reduce signos de cansancio.', en: 'Reduces signs of tiredness.', fr: 'Reduit les signes de fatigue.' } },

  // VIGOR
  { sku: 'VIGOR-01', vertical: 'vigor', price: '$699 MXN', rating: { stars: 4.8, count: 521 }, related: ['VIGOR-03'],
    name_i18n: { es: 'Proteina Vegetal Vigor', en: 'Vigor Plant Protein', fr: 'Proteine Vegetale Vigor' },
    description_i18n: { es: '22g de proteina limpia por porcion.', en: '22g of clean protein per serving.', fr: '22g de proteine pure par portion.' } },
  { sku: 'VIGOR-02', vertical: 'vigor', price: '$459 MXN', rating: { stars: 4.5, count: 178 }, related: ['VIGOR-04'],
    name_i18n: { es: 'Energia Natural Pre-Entreno', en: 'Natural Pre-Workout Energy', fr: 'Energie Naturelle Pre-Entrainement' },
    description_i18n: { es: 'Foco y energia sin picos ni caidas.', en: 'Focus and energy with no spikes or crashes.', fr: 'Concentration et energie sans pics ni chutes.' } },
  { sku: 'VIGOR-03', vertical: 'vigor', price: '$389 MXN', rating: { stars: 4.6, count: 134 }, related: ['VIGOR-01'],
    name_i18n: { es: 'Recovery Magnesio+', en: 'Recovery Magnesium+', fr: 'Recovery Magnesium+' },
    description_i18n: { es: 'Apoyo muscular post actividad.', en: 'Muscle support after activity.', fr: "Soutien musculaire apres l'effort." } },
  { sku: 'VIGOR-04', vertical: 'vigor', price: '$299 MXN', rating: { stars: 4.7, count: 245 }, related: ['VIGOR-02'],
    name_i18n: { es: 'Electrolitos Naturales', en: 'Natural Electrolytes', fr: 'Electrolytes Naturels' },
    description_i18n: { es: 'Hidratacion funcional sin azucares anadidos.', en: 'Functional hydration with no added sugars.', fr: 'Hydratation fonctionnelle sans sucres ajoutes.' } },

  // ROBLE
  { sku: 'ROBLE-01', vertical: 'roble', price: '$339 MXN', rating: { stars: 4.5, count: 167 }, related: ['ROBLE-02'],
    name_i18n: { es: 'Limpiador Roble Carbon', en: 'Roble Charcoal Cleanser', fr: 'Nettoyant Roble au Charbon' },
    description_i18n: { es: 'Limpieza profunda sin resecar.', en: 'Deep cleansing without drying out.', fr: 'Nettoyage profond sans dessecher.' } },
  { sku: 'ROBLE-02', vertical: 'roble', price: '$379 MXN', rating: { stars: 4.6, count: 142 }, related: ['ROBLE-01'],
    name_i18n: { es: 'Aceite de Barba Cedro', en: 'Cedar Beard Oil', fr: 'Huile a Barbe Cedre' },
    description_i18n: { es: 'Suaviza y da forma sin efecto grasoso.', en: 'Softens and shapes with no greasy feel.', fr: 'Adoucit et sculpte sans effet gras.' } },
  { sku: 'ROBLE-03', vertical: 'roble', price: '$259 MXN', rating: { stars: 4.3, count: 98 }, related: ['ROBLE-04'],
    name_i18n: { es: 'Desodorante Natural Roble', en: 'Natural Roble Deodorant', fr: 'Deodorant Naturel Roble' },
    description_i18n: { es: 'Proteccion 24h sin sales de aluminio.', en: '24h protection, no aluminum salts.', fr: "Protection 24h sans sels d'aluminium." } },
  { sku: 'ROBLE-04', vertical: 'roble', price: '$389 MXN', rating: { stars: 4.4, count: 176 }, related: ['ROBLE-03'],
    name_i18n: { es: 'Shampoo Anticaida Roble', en: 'Roble Anti-Hair-Loss Shampoo', fr: 'Shampoing Anti-Chute Roble' },
    description_i18n: { es: 'Fortalece desde la raiz.', en: 'Strengthens from the root.', fr: 'Renforce depuis la racine.' } },
];

async function main() {
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en las variables de entorno.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(MONGODB_DB);
    const now = new Date();
    for (const p of PRODUCTS) {
      const setFields = {
        vertical: p.vertical,
        name_i18n: p.name_i18n,
        description_i18n: p.description_i18n,
        unit_price: parsePrice(p.price),
        currency: 'MXN',
        related: p.related,
        status: 'active',
        updated_at: now,
      };
      // Campos opcionales -- solo se incluyen si el producto los trae, para no
      // pisar con "undefined" (rating de demo vs. productos reales sin rating
      // todavia; image/long_description/ingredients/usage/disclaimer son nuevos
      // y solo los traen los 4 productos reales de Carlos).
      if (p.rating !== undefined) setFields.rating = p.rating;
      if (p.image !== undefined) setFields.image = p.image;
      if (p.long_description_es !== undefined) setFields.long_description_es = p.long_description_es;
      if (p.ingredients_es !== undefined) setFields.ingredients_es = p.ingredients_es;
      if (p.usage_es !== undefined) setFields.usage_es = p.usage_es;
      if (p.disclaimer_es !== undefined) setFields.disclaimer_es = p.disclaimer_es;

      await db.collection('products').updateOne(
        { sku: p.sku },
        { $set: setFields, $setOnInsert: { created_at: now } },
        { upsert: true }
      );
      console.log(`[seed-products] ok: ${p.sku}`);
    }

    // Desactiva (no borra) los skus de demostracion reemplazados por productos
    // reales -- ver RETIRED_DEMO_SKUS arriba.
    for (const sku of RETIRED_DEMO_SKUS) {
      const result = await db.collection('products').updateOne(
        { sku },
        { $set: { status: 'inactive', updated_at: now } }
      );
      if (result.matchedCount) console.log(`[seed-products] desactivado (reemplazado): ${sku}`);
    }
    console.log(`[seed-products] listo: ${PRODUCTS.length} productos.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('[seed-products] error:', err);
  process.exit(1);
});
