// db/eliminar-contorno-duplicado.js
//
// Fix 173 (Carlos, 2026-10-02): diagnostico confirmado via la API publica
// del catalogo (GET /api/products?includeInactive=1, sin necesidad de
// credenciales): el catalogo en vivo tiene 21 productos, y el que
// corresponde a "Crema para Contorno de Ojos" NO tiene sku "NACAR-16"
// (el que usan index.html y seed-products.js) -- tiene sku literal
// "CREMA PARA CONTORNO DE OJOS" (el nombre quedo metido en el campo sku,
// probablemente al editarlo alguna vez desde el panel admin). El panel
// admin NO permite borrar productos (api/admin.js solo tiene GET y PUT
// para resource=products, ningun DELETE) -- por eso Carlos no podia
// quitarlo el mismo desde ahi.
//
// Por que se ve "duplicado": el catalogo fijo (objeto V en index.html)
// siempre muestra su propia ficha de NACAR-16, y applyAdminOverridesToV()
// inyecta ADEMAS cualquier producto de Mongo cuyo sku no haga match con
// ninguno ya existente en V -- como "CREMA PARA CONTORNO DE OJOS" no
// matchea "NACAR-16", se inyecta como ficha aparte: 2 tarjetas idénticas
// en el catalogo. Ademas, mientras ese sku este mal, agregar el producto
// real NACAR-16 al carrito puede fallar en checkout (no hay documento con
// ese sku exacto en products).
//
// Este script BORRA ese documento malformado (sku="CREMA PARA CONTORNO DE
// OJOS"). Igual que db/delete-retired-products.js: antes de borrar,
// revisa la coleccion `orders` por si algun pedido ya lo referencio -- si
// lo encuentra, NO borra y lo reporta para revision manual.
//
// Despues de correr esto, dale doble clic a sembrar-productos.bat para
// recrear la ficha correcta con sku NACAR-16 (upsert, no duplica).
//
// Uso: node db/eliminar-contorno-duplicado.js (o doble clic en
// eliminar-contorno-duplicado.bat). Corre 100% en tu maquina -- Claude
// nunca ve tu cadena de conexion ni tus credenciales.

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
const SKU_MALFORMADO = 'CREMA PARA CONTORNO DE OJOS';

async function main() {
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en el .env de este proyecto.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(MONGODB_DB);

    const doc = await db.collection('products').findOne({ sku: SKU_MALFORMADO });
    if (!doc) {
      console.log('No se encontro ningun producto con sku "' + SKU_MALFORMADO + '". Puede que ya se haya corregido.');
      return;
    }
    console.log('Encontrado:', JSON.stringify({ _id: String(doc._id), sku: doc.sku, name: doc.name_i18n && doc.name_i18n.es, status: doc.status }));

    const orderCount = await db.collection('orders').countDocuments({ 'items.sku': SKU_MALFORMADO });
    if (orderCount > 0) {
      console.warn('SALTADO: hay ' + orderCount + ' orden(es) que referencian este sku exacto -- no se borra, revisar a mano.');
      return;
    }

    const result = await db.collection('products').deleteOne({ sku: SKU_MALFORMADO });
    if (result.deletedCount > 0) {
      console.log('Borrado. Ahora corre sembrar-productos.bat para recrear la ficha correcta (sku NACAR-16).');
    } else {
      console.log('No se borro nada (no deletedCount).');
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('error:', err);
  process.exit(1);
});
