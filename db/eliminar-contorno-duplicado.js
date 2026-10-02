// db/eliminar-contorno-duplicado.js (v2)
//
// Fix 180 (Carlos, 2026-10-02): Carlos tenia razon -- sembrar-productos.bat
// y sembrar-resenas.bat usan el MISMO .env y corren bien contra la base de
// produccion, asi que la base de datos SI es la correcta (descartada la
// teoria de Fix 179). El bug real era mas tonto: la v1 de este script
// buscaba el documento con un match EXACTO de string
// (findOne({sku:'CREMA PARA CONTORNO DE OJOS'})), y la API publica que usé
// para diagnosticar pasa el JSON por un resumen de IA (WebFetch) que
// normaliza mayusculas/espacios al describirlo -- el sku real guardado en
// Mongo puede traer un espacio de mas, una mayuscula distinta, o un
// caracter invisible, y un match exacto falla silenciosamente ahi aunque
// el documento exista.
//
// v2 ya no exige texto exacto: busca con regex case-insensitive cualquier
// producto cuyo sku O nombre (es) contenga "contorno", imprime el sku
// EXACTO tal como esta en la base (con JSON.stringify, para que cualquier
// espacio/caracter raro se vea entre comillas), y borra por _id (no por
// texto) cualquiera de esos resultados cuyo sku no sea el correcto
// "NACAR-16". Misma revision de seguridad contra `orders` antes de borrar.
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
const SKU_CORRECTO = 'NACAR-16';

async function main() {
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en el .env de este proyecto.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(MONGODB_DB);

    const candidatos = await db.collection('products').find({
      $or: [
        { sku: { $regex: 'contorno', $options: 'i' } },
        { 'name_i18n.es': { $regex: 'contorno', $options: 'i' } },
      ],
    }).toArray();

    if (candidatos.length === 0) {
      console.log('No se encontro ningun producto relacionado a "contorno" (ni por sku ni por nombre).');
      return;
    }

    console.log('Encontrados ' + candidatos.length + ' documento(s) relacionados a "contorno":');
    for (const doc of candidatos) {
      console.log('  _id=' + String(doc._id) + ' sku=' + JSON.stringify(doc.sku) + ' name=' + JSON.stringify(doc.name_i18n && doc.name_i18n.es));
    }

    const malformados = candidatos.filter((doc) => doc.sku !== SKU_CORRECTO);
    if (malformados.length === 0) {
      console.log('Ninguno tiene sku distinto a "' + SKU_CORRECTO + '" -- no hay nada que borrar.');
      return;
    }

    for (const doc of malformados) {
      const skuTexto = String(doc.sku || '');
      const orderCount = await db.collection('orders').countDocuments({ 'items.sku': skuTexto });
      if (orderCount > 0) {
        console.warn('SALTADO _id=' + String(doc._id) + ': hay ' + orderCount + ' orden(es) que lo referencian -- no se borra, revisar a mano.');
        continue;
      }
      const result = await db.collection('products').deleteOne({ _id: doc._id });
      if (result.deletedCount > 0) {
        console.log('Borrado _id=' + String(doc._id) + ' (sku=' + JSON.stringify(doc.sku) + ').');
      } else {
        console.log('No se borro _id=' + String(doc._id) + ' (no deletedCount).');
      }
    }

    console.log('Listo. Ahora corre sembrar-productos.bat para asegurar que la ficha correcta (sku NACAR-16) este presente.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('error:', err);
  process.exit(1);
});
