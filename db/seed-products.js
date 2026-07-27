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

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'azura';

// price viene como "$389 MXN" en el frontend -- se parsea a numero aqui.
function parsePrice(str) {
  const match = String(str).match(/[\d.]+/);
  return match ? Number(match[0]) : 0;
}

const PRODUCTS = [
  // RAIZ
  { sku: 'RAIZ-01', vertical: 'raiz', price: '$389 MXN', rating: { stars: 4.6, count: 312 }, related: ['RAIZ-04'],
    name_i18n: { es: 'Bienestar Diario 30 caps', en: 'Daily Wellness 30 caps', fr: 'Bien-etre Quotidien 30 gel.' },
    description_i18n: { es: 'Complejo natural para energia sostenida.', en: 'Natural complex for sustained energy.', fr: 'Complexe naturel pour une energie durable.' } },
  { sku: 'RAIZ-02', vertical: 'raiz', price: '$449 MXN', rating: { stars: 4.7, count: 198 }, related: ['RAIZ-03'],
    name_i18n: { es: 'Equilibrio Ashwagandha', en: 'Ashwagandha Balance', fr: 'Equilibre Ashwagandha' },
    description_i18n: { es: 'Apoyo natural ante el estres diario.', en: 'Natural support against daily stress.', fr: 'Soutien naturel contre le stress quotidien.' } },
  { sku: 'RAIZ-03', vertical: 'raiz', price: '$329 MXN', rating: { stars: 4.5, count: 145 }, related: ['RAIZ-01'],
    name_i18n: { es: 'Fibra Prebiotica Raiz', en: 'Raiz Prebiotic Fiber', fr: 'Fibre Prebiotique Raiz' },
    description_i18n: { es: 'Bienestar digestivo de origen vegetal.', en: 'Plant-based digestive wellness.', fr: "Bien-etre digestif d'origine vegetale." } },
  { sku: 'RAIZ-04', vertical: 'raiz', price: '$369 MXN', rating: { stars: 4.8, count: 267 }, related: ['RAIZ-01'],
    name_i18n: { es: 'Defensa Natural C+Zinc', en: 'Natural Defense C+Zinc', fr: 'Defense Naturelle C+Zinc' },
    description_i18n: { es: 'Refuerzo natural de las defensas.', en: 'Natural immune support.', fr: 'Renfort naturel des defenses.' } },

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
      await db.collection('products').updateOne(
        { sku: p.sku },
        {
          $set: {
            vertical: p.vertical,
            name_i18n: p.name_i18n,
            description_i18n: p.description_i18n,
            unit_price: parsePrice(p.price),
            currency: 'MXN',
            rating: p.rating,
            related: p.related,
            status: 'active',
            updated_at: now,
          },
          $setOnInsert: { created_at: now },
        },
        { upsert: true }
      );
      console.log(`[seed-products] ok: ${p.sku}`);
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
