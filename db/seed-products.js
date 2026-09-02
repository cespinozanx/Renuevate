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

// Skus que este seed ya NO siembra en Renuévate. Dos grupos:
// 1) Raiz/Suplementos (Optimus/Omniplus/Power Maker/Magnus): se separo a su
//    propio sitio/marca -- ver decision de division de sitios (2026-08-06).
//    Los mismos 4 productos se siembran activos en la base del sitio nuevo.
// 2) NACAR-01 a 04: eran productos mock del prototipo original (precio y
//    rating inventados, sin foto ni ficha real), nunca correspondieron a un
//    producto SEYTU/OMNILIFE real. Se retiran al limpiar el catalogo Nacar
//    para dejar solo los 4 productos reales (NACAR-06/07/08/09) cargados con
//    foto, precio e ingredientes verdaderos (2026-08-11).
// Se desactivan en vez de borrarse, por si algun carrito/orden ya los
// referencia en esta base, no truena una validacion contra un sku que
// desaparecio de golpe.
const RETIRED_DEMO_SKUS = ['RAIZ-01', 'RAIZ-02', 'RAIZ-03', 'RAIZ-04', 'OPTIMUS', 'OMNIPLUS', 'POWERMAKER', 'MAGNUS', 'NACAR-01', 'NACAR-02', 'NACAR-03', 'NACAR-04'];

const PRODUCTS = [
  // NACAR -- solo los 4 productos reales (foto, precio e ingredientes
  // verdaderos). NACAR-01 a 04 eran mock del prototipo original; ver
  // RETIRED_DEMO_SKUS arriba.
  // Fix 72: renombrado + copy nuevo (Carlos, 2026-08-30) -- antes "Espuma
  // Purificante Nacar". Mismo cambio aplicado en index.html.
  { sku: 'NACAR-06', vertical: 'nacar', price: '$370 MXN', related: ['NACAR-08'], favorito: true,
    name_i18n: { es: 'Espuma Limpiadora Facial', en: 'Facial Cleansing Foam', fr: 'Mousse Nettoyante Faciale' },
    description_i18n: { es: 'Contiene ciertos ingredientes naturales, la formula de la espuma limpiadora facial SEYTU es ideal para una limpieza profunda.', en: 'With select natural ingredients, the SEYTU facial cleansing foam formula is ideal for a deep clean.', fr: 'Avec certains ingredients naturels, la formule de la mousse nettoyante faciale SEYTU est ideale pour un nettoyage en profondeur.' },
    image: 'media/nacar-06-espuma-front.webp',
    long_description_es: 'Ideal para la limpieza diaria del cutis, ayuda a remover las impurezas de la piel. Intensa sensacion de frescura. Ideal para todo tipo de piel. Presentacion de 150 ml.',
    ingredients_es: ['Aqua (Water)', 'Sodium C14-16 Olefin Sulfonate', 'Sodium Cocoyl Isethionate', 'Sodium Lauroamphoacetate', 'Glycerin', 'Disodium Laureth Sulfosuccinate', 'Cocamidopropyl Betaine', 'PEG-8 Caprylic/Capric Glycerides', 'Polysorbate 20', 'Aloe Barbadensis Leaf Extract', 'Alaria Esculenta Extract', 'Moringa Oleifera Leaf Extract', 'Ethylhexylglycerin', 'PEG-12 Dimethicone', 'Cocamide MIPA', 'Benzyl Alcohol', 'Parfum (Fragrance)', 'Citric Acid', 'Benzyl Salicylate', 'Hexyl Cinnamal', 'Limonene'],
    usage_es: '1. Humedece el rostro con agua tibia. 2. Aplica una pequeña cantidad de espuma y masajea con movimientos circulares, evitando el contorno de ojos. 3. Enjuaga con abundante agua tibia y seca con una toalla limpia. Usa por la mañana y por la noche.' },
  // Fix 86: renombrado (Carlos, 2026-09-01) -- "Gel Antioxidante Nacar" ->
  // "Omniplus Gel Premium" (mismo producto/precio/30 g, solo cambia
  // nombre/desc/longDesc). Mismo cambio aplicado en index.html.
  { sku: 'NACAR-07', vertical: 'nacar', price: '$340 MXN', related: ['NACAR-09'], favorito: false,
    name_i18n: { es: 'Omniplus Gel Premium', en: 'Omniplus Premium Gel', fr: 'Omniplus Gel Premium' },
    description_i18n: { es: 'Omniplus Gel Premium colabora a mantener la piel protegida de los ataques de los radicales libres y aumentar el nivel de hidratacion.', en: 'Omniplus Premium Gel helps keep skin protected from free-radical damage and increases hydration levels.', fr: "Omniplus Gel Premium aide a garder la peau protegee contre les radicaux libres et a augmenter son niveau d'hydratation." },
    image: 'media/nacar-07-gel-abierto.webp',
    long_description_es: 'Tu mejor aliado para hidratar, humectar y acondicionar la piel. Brinda mayor proteccion, un aspecto saludable y ayuda a mejorar la elasticidad. Presentacion de 30 g.',
    ingredients_es: ['Extracto de levadura', 'Extracto de hoja de olivo', 'Extracto de arnica', 'Extractos de frutas silvestres', 'Aceite de jojoba'],
    usage_es: 'Aplica una pequeña cantidad sobre rostro y/o cuerpo limpio, con un suave masaje hasta su absorcion completa. Uso diario.' },
  // Fix 72: se detecta que este seed nunca recibio el rename de Fix 70 --
  // index.html ya mostraba "Seytú System Time-Specialist" desde entonces,
  // pero este archivo se quedo con el nombre viejo. Se corrige aqui para que
  // ambas fuentes de verdad (ver nota dual-source-of-truth) vuelvan a coincidir.
  { sku: 'NACAR-08', vertical: 'nacar', price: '$725 MXN', related: ['NACAR-06'], favorito: true,
    name_i18n: { es: 'Seytú System Time-Specialist', en: 'Seytú System Time-Specialist', fr: 'Seytú System Time-Specialist' },
    description_i18n: { es: 'Renueva y protege, hidratacion con FPS 30.', en: 'Renews and protects, hydration with SPF 30.', fr: 'Renove et protege, hydratation avec FPS 30.' },
    image: 'media/nacar-08-dia-lifestyle-espejo.webp',
    long_description_es: 'Combate la apariencia de los principales signos de la edad, estimula la produccion de colageno y elastina y ayuda a mejorar la textura y firmeza de la piel. Con propiedades antioxidantes e hidratantes, protege la piel contra los rayos UVA/UVB. Para mejores resultados, usala junto con el resto de tu rutina Nacar. Presentacion de 50 ml.',
    ingredients_es: ['Aqua (Water)', 'Octocrylene', 'Ethylhexyl Methoxycinnamate', 'Butyl Methoxydibenzoylmethane', 'Niacinamide', 'Neopentyl Glycol Diheptanoate', 'Potassium Cetyl Phosphate', 'Cetearyl Alcohol', 'Polymethylsilsesquioxane', 'Glycerin', 'Sodium Acrylates Copolymer', 'Bakuchiol', 'Tocopheryl Acetate', 'Hyaluronic Acid', 'Squalene', 'Triticum Vulgare/Aestivum (Wheat) Grain Extract', 'Helianthus Annuus (Sunflower) Seed Oil', 'Rosmarinus Officinalis (Rosemary) Leaf Extract', 'Portulaca Oleracea Extract', 'Lecithin', 'Hydrogenated Lecithin', 'Phenoxyethanol', 'Decylene Glycol', 'Caprylyl Glycol', 'Butylene Glycol', 'Sodium Hydroxide', 'Tetrasodium EDTA'],
    usage_es: 'Aplica cada mañana sobre el rostro limpio, como ultimo paso de tu rutina antes del maquillaje. Evita el contacto con los ojos. Reaplica en caso de exposicion solar prolongada.' },
  // Fix 87: rename + copy nuevos (Carlos, 2026-09-01) -- name_i18n/description_i18n
  // ya no mencionan "Nacar" ni "Escudo Solar". long_description_es pasa de
  // parrafo a arreglo (Beneficios con vinetas) -- ver misma logica en
  // index.html (p.longDesc puede ser string o arreglo, render en pdLongDescList).
  { sku: 'NACAR-09', vertical: 'nacar', price: '$390 MXN', related: ['NACAR-07'], favorito: false,
    name_i18n: { es: 'Protector Solar Facial FPS 50+', en: 'Facial Sunscreen SPF 50+', fr: 'Protection Solaire Visage FPS 50+' },
    description_i18n: { es: 'Protector solar facial con FPS 50+, ideal para pieles sensibles, toque seco, resistente al agua y libre de fragancia. Completa tu rutina facial y protege tu rostro.', en: 'SPF 50+ facial sunscreen, ideal for sensitive skin: dry touch, water-resistant and fragrance-free. Completes your facial routine and protects your skin.', fr: "Protection solaire visage FPS 50+, ideale pour les peaux sensibles : toucher sec, resistante a l'eau et sans parfum. Complete votre routine visage et protege votre peau." },
    image: 'media/nacar-09-spf50-front.webp',
    long_description_es: ['89% Ingredientes de origen natural', 'Toque Seco', 'Para toda la familia', 'Clinica y dermatologicamente probado', 'FPS 50+', 'Amigable con el oceano', 'Respetuoso de la ley hawaiana de proteccion a los corales'],
    ingredients_es: ['Aqua (Water)', 'Dicaprylyl Carbonate', 'Hydrogenated Ethylhexyl Olivate', 'Titanium Dioxide', 'Zinc Oxide (Nano)', 'Butyloctyl Salicylate', 'Hydrogenated Farnesene', 'Beeswax', 'Caprylyl Methicone', 'Glycerin', 'Silica', 'Aluminum Starch Octenylsuccinate', 'Polyhydroxystearic Acid', 'Sodium Chloride', 'Polysilicone-11', 'Sodium Stearoyl Lactylate', 'Benzotriazolyl Dodecyl P-Cresol', 'Cetyl PEG/PPG-10/1 Dimethicone', 'Caprylic/Capric Triglyceride', 'Stearic Acid', 'Hydrogenated Olive Oil Unsaponifiables', 'Dimethicone/Vinyl Dimethicone Crosspolymer', 'Simmondsia Chinensis (Jojoba) Seed Oil', 'Glyceryl Caprylate', 'Glyceryl Undecylenate', 'Helianthus Annuus (Sunflower) Seed Oil', 'Aluminum Hydroxide', 'Pentaerythrityl Tetra-Di-T-Butyl Hydroxyhydrocinnamate', 'Laureth-12', 'Laminaria Ochroleuca Extract', 'Tocopherol', 'Bisabolol', 'Triethoxycaprylylsilane', 'Benzyl Alcohol'],
    usage_es: 'Recomendacion de Uso: Aplicar de manera uniforme sobre la piel seca antes de la exposicion solar. Reaplicar cada 3 horas y despues de transpirar, nadar o secarte con toalla.' },
  // Fix 71: 5to producto real de Nacar (Carlos, 2026-08-30). Mismo criterio
  // que 06-09: foto/precio/ingredientes verdaderos. No tiene related reciproco
  // desde 06/08 todavia (solo se agrego related en este sku hacia ellos) --
  // ver mismo comentario en index.html sobre el motor de puntaje del
  // cuestionario de belleza, que tampoco lo cubre todavia.
  { sku: 'NACAR-10', vertical: 'nacar', price: '$430 MXN', related: ['NACAR-06', 'NACAR-08'], favorito: true,
    name_i18n: { es: 'Suero Facial de Hidratación Profunda con Aloe Vera', en: 'Aloe Vera Deep Moisturizing Facial Serum', fr: "Serum Facial Hydratant Profond a l'Aloe Vera" },
    description_i18n: { es: 'El Suero Facial de Hidratación Profunda con Aloe Vera SEYTÚ hidrata a profundidad y contribuye a la firmeza y elasticidad de tu piel.', en: "SEYTU's Aloe Vera Deep Moisturizing Facial Serum deeply hydrates and helps improve your skin's firmness and elasticity.", fr: 'Le Serum Facial Hydratant Profond a l\'Aloe Vera SEYTU hydrate en profondeur et aide a ameliorer la fermete et l\'elasticite de votre peau.' },
    image: 'media/nacar-10-suero-lifestyle-mano.webp',
    long_description_es: 'Ideal para ayudar a mejorar la apariencia de las finas líneas de expresión causadas por la resequedad. Textura suave y ligera de fácil absorción.',
    ingredients_es: ['Enriquecido con péptidos precursores del colágeno y ácido hialurónico.'],
    usage_es: 'Aplica 2-3 gotas sobre rostro limpio, por la mañana y por la noche, con un ligero masaje hasta su absorción completa. Puedes usarlo antes de tu crema hidratante.' },
  // Fix 84: primer producto real de la categoria "Maquillaje" (Carlos,
  // 2026-09-01) -- antes vacia (ver comentario historico Fix 72 en index.html).
  // Trae "shades" (9 tonos, uno sin stock: Cocoa) para el selector tipo
  // carrusel del modal de detalle -- misma foto para todos los tonos, ver
  // renderPdShades()/selectPdShade() en index.html.
  { sku: 'NACAR-11', vertical: 'nacar', price: '$535 MXN', related: ['NACAR-08', 'NACAR-13'], favorito: true,
    name_i18n: { es: 'Maquillaje Líquido UP+ FPS15', en: 'UP+ Liquid Foundation SPF15', fr: 'Fond de Teint Liquide UP+ FPS15' },
    description_i18n: { es: 'Base de maquillaje con acabado mate, de larga duracion y cobertura construible, que corrige el tono de tu piel mientras la protege con activos anti edad, humectantes y antioxidantes.', en: 'A matte-finish, long-wearing liquid foundation with buildable coverage that corrects your skin tone while protecting it with anti-aging, moisturizing and antioxidant actives.', fr: 'Fond de teint liquide fini mat, longue tenue et couvrance modulable, qui corrige le teint de la peau tout en la protegeant grace a ses actifs anti-age, hydratants et antioxydants.' },
    image: 'media/nacar-11-maquillaje-front.webp',
    long_description_es: 'Formula a prueba de agua y sudor, con acabado homogeneo y mate. Su efecto soft focus difumina la apariencia de las finas lineas de expresion. Cobertura construible que se adapta a tu piel a lo largo del dia. Presentacion de 40 g. Disponible en 9 tonos.',
    ingredients_es: ['Aqua (Water)', 'Zinc Oxide', 'Cyclopentasiloxane', 'Isododecane', 'Trimethylsiloxysilicate', 'Cetearyl Alcohol', 'Simmondsia Chinensis (Jojoba) Seed Oil', 'Polymethylsilsesquioxane/Trimethylsiloxysilicate', 'Divinyldimethicone/Dimethicone/Phenylsilsesquioxane Crosspolymer', 'Dimethicone', 'PEG-10 Dimethicone', 'Hydrogenated Rapeseed Oil', 'C24-28 Alkyldimethylsiloxy Trimethylsiloxysilicate', 'Polymethylsilsesquioxane', 'Cetyl PEG/PPG-10/1 Dimethicone', 'Hexyl Laurate', 'PEG/PPG-18/18 Dimethicone', 'Microcrystalline Wax', 'Hydrolyzed Collagen', 'Polyglyceryl-4 Isostearate', 'Tocopheryl Acetate', 'Sodium Polyacrylate', 'Parfum (Fragrance)', 'Disteardimonium Hectorite', 'Caprylyl Glycol', 'Aluminum Hydroxide', 'Polysilicone-11', 'Propylene Carbonate', 'Triethoxycaprylylsilane', 'Butylene Glycol', 'Phenoxyethanol', 'DMDM Hydantoin', 'Xanthan Gum', 'Decylene Glycol', 'Hydrolyzed Wheat Protein', 'Ethylhexylglycerin', 'Hydrolyzed Soy Protein', 'Decyl Glucoside', 'Sodium Hyaluronate', 'Pectin', 'Hexylene Glycol', 'Serine', 'Arginine', 'Proline', 'Glucose', 'Carrageenan', 'Alpha-Isomethyl Ionone', 'Amyl Cinnamal', 'Anise Alcohol', 'Cinnamyl Alcohol', 'Citronellol', 'Geraniol', 'Hexyl Cinnamal', 'Hydroxycitronellal', 'Linalool'],
    usage_es: 'Aplica sobre el rostro limpio con los dedos, brocha o esponja, extendiendo del centro hacia afuera. Aumenta la cobertura con capas adicionales en las zonas que lo requieran.',
    disclaimer_es: 'Puede contener/may contain: Titanium Dioxide (CI 77891), Iron Oxides (CI 77491, CI 77492, CI 77499) -- la carga de pigmento varia segun el tono.',
    shades: [
      { name: 'Fair', hex: '#E4CAA8', available: true },
      { name: 'Light Sand', hex: '#D5B695', available: true },
      { name: 'Soft Honey', hex: '#DAB687', available: true },
      { name: 'Natural Beige', hex: '#D9AD87', available: true },
      { name: 'Warm Beige', hex: '#D0AA7B', available: true },
      { name: 'Creamy Natural', hex: '#BB9876', available: true },
      { name: 'Sun Beige', hex: '#BB9564', available: true },
      { name: 'Caramel', hex: '#A67A54', available: true },
      { name: 'Cocoa', hex: '#62402E', available: false },
    ] },
  // Fix 84: segundo producto de "Maquillaje" (Carlos, 2026-09-01). Mismo
  // patron de shades que NACAR-11, 7 tonos, todos con stock.
  { sku: 'NACAR-12', vertical: 'nacar', price: '$340 MXN', related: ['NACAR-11', 'NACAR-13'], favorito: false,
    name_i18n: { es: 'Brillo Labial Diamante', en: 'Diamond Lip Gloss', fr: 'Gloss a Levres Diamant' },
    description_i18n: { es: 'Formula que se funde sobre los labios, con un acabado brillante inigualable y efecto voluminizador.', en: 'A formula that melts onto your lips, delivering an unbeatable glossy finish with a plumping effect.', fr: 'Une formule qui fond sur les levres, pour une finition brillante inegalee et un effet volumateur.' },
    image: 'media/nacar-12-brillo-front.webp',
    long_description_es: 'Acabado brillante y luminoso, con una formula ligera y no pegajosa. Su efecto voluminizador incluye activos que mantienen tus labios suaves e hidratados. Presentacion de 8.5 g. Disponible en 7 tonos.',
    ingredients_es: ['Hydrogenated Polyisobutene', 'Tridecyl Trimellitate', 'Caprylic/Capric Triglyceride', 'Microcrystalline Wax (Cera Microcristalina)', 'Parfum (Fragrance)', 'Hydrogenated Vegetable Oil', 'Beeswax (Cera Alba)', 'Tocopheryl Acetate', 'Simmondsia Chinensis (Jojoba) Seed Oil', 'Hydrogenated Palm Acid', 'Mica', 'Silica', 'Stearyl Stearate', 'Dibutyl Lauroyl Glutamide', 'Calcium Aluminum Borosilicate', 'Bis-Stearyl Dimethicone', 'Phenoxyethanol', 'BHT', 'Cyclamen Aldehyde', 'Iron Oxide (CI 77491)', 'Titanium Dioxide (CI 77891)'],
    usage_es: 'Utilizalo solo o combinalo con tu labial hidratante o mate favorito.',
    shades: [
      { name: 'Diamante', hex: '#E8CFCB', available: true },
      { name: 'Ópalo', hex: '#C46B85', available: true },
      { name: 'Ámbar', hex: '#B97050', available: true },
      { name: 'Topaz', hex: '#BD8148', available: true },
      { name: 'Ágata', hex: '#B87684', available: true },
      { name: 'Rubí', hex: '#9E1F2E', available: true },
      { name: 'Zafiro', hex: '#7A5578', available: true },
    ] },
  // Fix 87: tercer producto de "Maquillaje" (Carlos, 2026-09-01) -- accesorio
  // (brocha), no formula cosmetica: sin ingredients_es/usage_es/shades a
  // proposito. Se agrega como el 3er miembro del cross-sell "Maquillaje": se
  // referencia desde related de NACAR-11/12, pero su propio related queda
  // vacio (instruccion explicita de Carlos -- "cuando compran solo la brocha
  // no le pones nada").
  { sku: 'NACAR-13', vertical: 'nacar', price: '$190 MXN', related: [], favorito: false,
    name_i18n: { es: 'Brocha para Maquillaje Líquido', en: 'Liquid Foundation Brush', fr: 'Pinceau pour Maquillage Liquide' },
    description_i18n: { es: 'Consigue una piel perfecta y sin filtro con nuestra Brocha para Base de Maquillaje, que gracias a sus mas de 200 mil cerdas te brindara un acabado aterciopelado e impecable.', en: 'Get flawless, filter-free skin with our Foundation Brush, whose 200,000+ bristles deliver a velvety, impeccable finish.', fr: 'Obtenez une peau parfaite et sans filtre grace a notre Pinceau Fond de Teint, dont les plus de 200 000 poils offrent un fini veloute et impeccable.' },
    image: 'media/nacar-13-brocha-front.webp',
    long_description_es: ['Especialmente diseñada para base de maquillaje', 'Aplicación de cobertura media a alta', 'Tipo de Cerda: Sintética.'] },

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
      // Fix 84: tonos del selector tipo carrusel (NACAR-11/12) -- ver
      // renderPdShades() en index.html. Solo los productos de Maquillaje
      // traen este campo; el resto del catalogo no se ve afectado.
      if (p.shades !== undefined) setFields.shades = p.shades;
      // Fix 74: atributo "Favoritos de Renuevate" (Carlos, 2026-08-31) -- se
      // filtra por este campo en el nuevo link/submenu del sitio. Se checa
      // !== undefined (no solo truthy) porque false es un valor valido que
      // debe guardarse igual que true.
      if (p.favorito !== undefined) setFields.favorito = p.favorito;

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
