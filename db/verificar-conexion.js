// db/verificar-conexion.js
//
// Fix 179 (Carlos, 2026-10-02): eliminar-contorno-duplicado.bat reporto
// "No se encontro ningun producto con sku CREMA PARA CONTORNO DE OJOS",
// pero la API publica del sitio en vivo (renuevatehoy.vercel.app) sigue
// mostrando ese mismo producto duplicado en ese mismo momento. Eso solo
// tiene una explicacion razonable: el .env de este proyecto (el que usan
// TODOS los scripts de la carpeta db/) y las variables de entorno que usa
// Vercel en produccion NO apuntan al mismo cluster/base de datos.
//
// Este script NO borra nada. Solo se conecta con tu .env actual (el mismo
// que usan los demas scripts) y muestra:
//   1) el host del cluster (ej. cluster0.rjvahbu.mongodb.net) y el nombre
//      de base de datos -- esto es informacion publica de conexion, NO es
//      tu usuario ni tu password, nunca se imprime eso.
//   2) cuantos productos hay en total en esa base, y si el producto
//      duplicado (sku malformado) existe ahi.
//
// Que hacer con el resultado: entra a Vercel -> tu proyecto -> Settings ->
// Environment Variables -> abre MONGODB_URI y compara el HOST (la parte
// despues de la @, antes del primer /) contra lo que este script imprime.
// Si son distintos, ese es el bug: tu .env local apunta a un cluster
// diferente al que usa el sitio en produccion. La correccion es copiar el
// MONGODB_URI exacto de Vercel a tu .env local (y confirmar tambien
// MONGODB_DB), y despues volver a correr eliminar-contorno-duplicado.bat.
//
// Uso: node db/verificar-conexion.js (o doble clic en
// verificar-conexion.bat). Corre 100% en tu maquina.

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

function hostOnly(uri) {
  // Extrae solo el host (nunca el usuario/password) para comparar contra Vercel.
  const m = uri.match(/@([^/?]+)/);
  return m ? m[1] : '(no se pudo leer el host -- revisa el formato del URI)';
}

async function main() {
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en el .env de este proyecto.');

  console.log('==============================================');
  console.log(' Verificando a que base de datos apunta tu .env');
  console.log('==============================================');
  console.log('Host del cluster (.env local):', hostOnly(MONGODB_URI));
  console.log('Base de datos (.env local):   ', MONGODB_DB);
  console.log('');
  console.log('Compara el host de arriba contra Vercel -> Settings -> Environment');
  console.log('Variables -> MONGODB_URI. Si no coinciden, ahi esta el problema.');
  console.log('');

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(MONGODB_DB);
    const total = await db.collection('products').countDocuments();
    const dup = await db.collection('products').findOne({ sku: SKU_MALFORMADO });

    console.log('Productos totales en esta base:', total);
    if (dup) {
      console.log('Producto duplicado SI existe aqui (sku: "' + SKU_MALFORMADO + '").');
      console.log('-> Esta es la base correcta para correr eliminar-contorno-duplicado.bat.');
    } else {
      console.log('Producto duplicado NO existe en esta base.');
      console.log('-> Si el sitio en vivo SI lo sigue mostrando, confirmado: tu .env');
      console.log('   apunta a una base distinta a la de produccion. Corrige el .env');
      console.log('   con el MONGODB_URI/MONGODB_DB exactos de Vercel y vuelve a correr');
      console.log('   eliminar-contorno-duplicado.bat.');
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('error:', err.message);
  process.exit(1);
});
