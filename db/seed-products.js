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

// Skus que este seed ya NO siembra en Renuévate porque la vertical Raiz
// (Suplementos: Optimus/Omniplus/Power Maker/Magnus) se separo a su propio
// sitio/marca -- ver decision de division de sitios (2026-08-06). Se
// desactivan en vez de borrarse, por si algun carrito/orden ya los
// referencia en esta base, no truena una validacion contra un sku que
// desaparecio de golpe. Los mismos 4 productos se siembran activos en la
// base de datos del sitio nuevo (ver seed-products.js de ese repo).
const RETIRED_DEMO_SKUS = ['RAIZ-01', 'RAIZ-02', 'RAIZ-03', 'RAIZ-04', 'OPTIMUS', 'OMNIPLUS', 'POWERMAKER', 'MAGNUS'];

const PRODUCTS = [
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
  { sku: 'NACAR-06', vertical: 'nacar', price: '$370 MXN', related: ['NACAR-01'],
    name_i18n: { es: 'Espuma Purificante Nacar', en: 'Nacar Purifying Foam', fr: 'Mousse Purifiante Nacar' },
    description_i18n: { es: 'Limpieza diaria profunda, frescura instantanea.', en: 'Deep daily cleansing, instant freshness.', fr: 'Nettoyage quotidien profond, fraicheur instantanee.' },
    image: 'media/nacar-06-espuma-front.webp',
    long_description_es: 'Una espuma cremosa que retira impurezas y exceso de grasa sin resecar la piel. Deja una sensacion de frescura inmediata y el rostro listo para el resto de tu rutina. Formulada para todo tipo de piel. Presentacion de 150 ml.',
    ingredients_es: ['Aqua (Water)', 'Sodium C14-16 Olefin Sulfonate', 'Sodium Cocoyl Isethionate', 'Sodium Lauroamphoacetate', 'Glycerin', 'Disodium Laureth Sulfosuccinate', 'Cocamidopropyl Betaine', 'PEG-8 Caprylic/Capric Glycerides', 'Polysorbate 20', 'Aloe Barbadensis Leaf Extract', 'Alaria Esculenta Extract', 'Moringa Oleifera Leaf Extract', 'Ethylhexylglycerin', 'PEG-12 Dimethicone', 'Cocamide MIPA', 'Benzyl Alcohol', 'Parfum (Fragrance)', 'Citric Acid', 'Benzyl Salicylate', 'Hexyl Cinnamal', 'Limonene'],
    usage_es: '1. Humedece el rostro con agua tibia. 2. Aplica una pequeña cantidad de espuma y masajea con movimientos circulares, evitando el contorno de ojos. 3. Enjuaga con abundante agua tibia y seca con una toalla limpia. Usa por la mañana y por la noche.' },
  { sku: 'NACAR-07', vertical: 'nacar', price: '$340 MXN', related: ['NACAR-01'],
    name_i18n: { es: 'Gel Antioxidante Nacar', en: 'Nacar Antioxidant Gel', fr: 'Gel Antioxydant Nacar' },
    description_i18n: { es: 'Protege de radicales libres, hidratacion profunda.', en: 'Protects from free radicals, deep hydration.', fr: 'Protege des radicaux libres, hydratation profonde.' },
    image: 'media/nacar-07-gel-front.webp',
    long_description_es: 'Un gel ligero que ayuda a proteger la piel del daño de los radicales libres mientras aumenta su nivel de hidratacion. Hidrata, humecta y acondiciona para un aspecto saludable, y ayuda a mejorar la elasticidad de la piel. Presentacion de 30 g.',
    ingredients_es: ['Extracto de levadura', 'Extracto de hoja de olivo', 'Extracto de arnica', 'Extractos de frutas silvestres', 'Aceite de jojoba'],
    usage_es: 'Aplica una pequeña cantidad sobre rostro y/o cuerpo limpio, con un suave masaje hasta su absorcion completa. Uso diario.' },
  { sku: 'NACAR-08', vertical: 'nacar', price: '$725 MXN', related: ['NACAR-01'],
    name_i18n: { es: 'Dia Renovador FPS 30 Nacar', en: 'Nacar Renewing Day SPF 30', fr: 'Jour Renovateur FPS 30 Nacar' },
    description_i18n: { es: 'Renueva y protege, hidratacion con FPS 30.', en: 'Renews and protects, hydration with SPF 30.', fr: 'Renove et protege, hydratation avec FPS 30.' },
    image: 'media/nacar-08-dia-fps30-front.webp',
    long_description_es: 'Una crema de dia que combate los signos visibles de la edad, estimula la produccion de colageno y elastina y mantiene una hidratacion optima de la piel. Con FPS 30 de amplio espectro, protege contra los rayos UVA y UVB mientras ayuda a mejorar la textura y firmeza. Para mejores resultados, usala junto con el resto de tu rutina Nacar. Presentacion de 50 ml.',
    ingredients_es: ['Aqua (Water)', 'Octocrylene', 'Ethylhexyl Methoxycinnamate', 'Butyl Methoxydibenzoylmethane', 'Niacinamide', 'Neopentyl Glycol Diheptanoate', 'Potassium Cetyl Phosphate', 'Cetearyl Alcohol', 'Polymethylsilsesquioxane', 'Glycerin', 'Sodium Acrylates Copolymer', 'Bakuchiol', 'Tocopheryl Acetate', 'Hyaluronic Acid', 'Squalene', 'Triticum Vulgare/Aestivum (Wheat) Grain Extract', 'Helianthus Annuus (Sunflower) Seed Oil', 'Rosmarinus Officinalis (Rosemary) Leaf Extract', 'Portulaca Oleracea Extract', 'Lecithin', 'Hydrogenated Lecithin', 'Phenoxyethanol', 'Decylene Glycol', 'Caprylyl Glycol', 'Butylene Glycol', 'Sodium Hydroxide', 'Tetrasodium EDTA'],
    usage_es: 'Aplica cada mañana sobre el rostro limpio, como ultimo paso de tu rutina antes del maquillaje. Evita el contacto con los ojos. Reaplica en caso de exposicion solar prolongada.' },
  { sku: 'NACAR-09', vertical: 'nacar', price: '$390 MXN', related: ['NACAR-01'],
    name_i18n: { es: 'Escudo Solar FPS 50+ Nacar', en: 'Nacar Solar Shield SPF 50+', fr: 'Bouclier Solaire FPS 50+ Nacar' },
    description_i18n: { es: 'Toque seco, proteccion FPS 50+ para todos los dias.', en: 'Dry touch, SPF 50+ protection for every day.', fr: 'Toucher sec, protection FPS 50+ au quotidien.' },
    image: 'media/nacar-09-spf50-front.webp',
    long_description_es: 'Un protector solar facial de toque seco y absorcion inmediata, formulado con 89% de ingredientes de origen natural. Resistente al agua, libre de fragancia y clinica y dermatologicamente probado, ideal para pieles sensibles y para toda la familia. Formulado sin ingredientes daninos para los arrecifes de coral. Presentacion de 40 ml.',
    ingredients_es: ['Aqua (Water)', 'Dicaprylyl Carbonate', 'Hydrogenated Ethylhexyl Olivate', 'Titanium Dioxide', 'Zinc Oxide (Nano)', 'Butyloctyl Salicylate', 'Hydrogenated Farnesene', 'Beeswax', 'Caprylyl Methicone', 'Glycerin', 'Silica', 'Aluminum Starch Octenylsuccinate', 'Polyhydroxystearic Acid', 'Sodium Chloride', 'Polysilicone-11', 'Sodium Stearoyl Lactylate', 'Benzotriazolyl Dodecyl P-Cresol', 'Cetyl PEG/PPG-10/1 Dimethicone', 'Caprylic/Capric Triglyceride', 'Stearic Acid', 'Hydrogenated Olive Oil Unsaponifiables', 'Dimethicone/Vinyl Dimethicone Crosspolymer', 'Simmondsia Chinensis (Jojoba) Seed Oil', 'Glyceryl Caprylate', 'Glyceryl Undecylenate', 'Helianthus Annuus (Sunflower) Seed Oil', 'Aluminum Hydroxide', 'Pentaerythrityl Tetra-Di-T-Butyl Hydroxyhydrocinnamate', 'Laureth-12', 'Laminaria Ochroleuca Extract', 'Tocopherol', 'Bisabolol', 'Triethoxycaprylylsilane', 'Benzyl Alcohol'],
    usage_es: 'Aplica de manera uniforme sobre la piel seca antes de la exposicion solar. Reaplica cada 3 horas y despues de nadar, transpirar o secarte con la toalla.' },

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

  // Accesorios de carrito (upsell de bolsas, ver BAG_MODELS en index.html).
  // vertical:'accessory' a proposito -- no pertenecen a ninguno de los 4
  // sistemas, asi que nunca aparecen en el grid de productos por vertical,
  // solo en el panel del carrito. Antes de este seed no existian en Mongo,
  // por eso addToCart('BAG-...') tronaba con "producto no existe".
  { sku: 'BAG-LINO-BEIGE', vertical: 'accessory', price: '$249 MXN', related: [],
    name_i18n: { es: 'Bolsa Lino Beige', en: 'Beige Linen Bag', fr: 'Sac Lin Beige' },
    description_i18n: { es: 'Compacta, ideal para tu rutina de 2 a 4 productos.', en: 'Compact, ideal for a 2 to 4 product routine.', fr: 'Compact, ideal pour 2 a 4 produits.' } },
  { sku: 'BAG-TERRACOTA', vertical: 'accessory', price: '$329 MXN', related: [],
    name_i18n: { es: 'Bolsa Terracota XL', en: 'Terracotta XL Bag', fr: 'Sac Terracotta XL' },
    description_i18n: { es: 'Mas espacio, para viajar con tu sistema completo.', en: 'More room, to travel with your full system.', fr: "Plus d'espace pour voyager avec votre systeme complet." } },
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
