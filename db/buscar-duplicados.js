// db/buscar-duplicados.js
//
// Fix 170 (Carlos, 2026-10-02): Carlos señalo en captura que "Crema para
// Contorno de Ojos" (NACAR-16) aparece duplicada en el catalogo. Los
// archivos fuente (index.html, db/seed-products.js) solo tienen UNA ficha
// de NACAR-16 por idioma -- si el duplicado existe, vive directamente en
// la coleccion `products` de MongoDB Atlas (por ejemplo, una ficha creada
// a mano desde el panel admin con otro SKU pero el mismo nombre/foto).
//
// Este script es SOLO LECTURA -- no borra nada. Busca:
//   1) cualquier documento cuyo nombre (es) contenga "contorno de ojos"
//      (sin importar el SKU exacto)
//   2) cualquier SKU que exista mas de una vez en la coleccion (chequeo
//      general de higiene de datos, por si hay otros duplicados sueltos)
//
// Uso: node db/buscar-duplicados.js  (o doble clic en buscar-duplicados.bat)
//
// Requisito unico: tener Node.js instalado y el .env de este proyecto con
// tu MONGODB_URI/MONGODB_DB reales. Corre 100% en tu maquina -- Claude
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

async function main() {
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en el .env de este proyecto.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(MONGODB_DB);

    console.log('=== 1) Documentos con nombre "contorno de ojos" (cualquier SKU) ===');
    const byName = await db.collection('products').find({ 'name_i18n.es': /contorno de ojos/i }).toArray();
    console.log('Encontrados:', byName.length);
    for (const d of byName) {
      const orderCount = await db.collection('orders').countDocuments({ 'items.sku': d.sku });
      console.log(JSON.stringify({
        _id: String(d._id), sku: d.sku, status: d.status,
        name: d.name_i18n && d.name_i18n.es, price: d.price,
        createdAt: d.createdAt, enOrdenes: orderCount
      }));
    }

    console.log('');
    console.log('=== 2) SKUs repetidos en toda la coleccion products (higiene general) ===');
    const dupes = await db.collection('products').aggregate([
      { $group: { _id: '$sku', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();
    if (dupes.length === 0) {
      console.log('Ninguno -- no hay SKUs repetidos en la coleccion.');
    } else {
      console.log('SKUs repetidos encontrados:', dupes.length);
      for (const d of dupes) console.log(JSON.stringify(d));
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('error:', err);
  process.exit(1);
});
