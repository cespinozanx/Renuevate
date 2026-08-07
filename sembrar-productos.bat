@echo off
REM sembrar-productos.bat
REM Doble clic para cargar/actualizar en tu MongoDB Atlas real:
REM   1) node db/collections.js   -> crea (si faltan) las colecciones con sus
REM      validadores e indices: products, carts, product_reviews,
REM      payment_methods, phone_verifications, etc.
REM   2) node db/seed-products.js -> inserta/actualiza (upsert, no duplica) el
REM      catalogo de Renuevate (Nacar, Vigor, Roble + accesorios), y desactiva
REM      (sin borrar) los 4 demos RAIZ-01..04 y los 4 productos de Suplementos
REM      (Optimus, Omniplus, Power Maker, Magnus) que se mudaron al sitio nuevo.
REM
REM Requisito unico: tener Node.js instalado y un archivo .env en esta misma
REM carpeta con tu MONGODB_URI y MONGODB_DB reales (los mismos que usa
REM Vercel). Este script corre 100% en tu maquina -- Claude nunca ve tu
REM cadena de conexion ni tus credenciales.

cd /d "%~dp0"

echo ============================================
echo  Paso 1 de 2: creando/actualizando colecciones
echo ============================================
call node db\collections.js
if errorlevel 1 (
  echo.
  echo Hubo un error en db\collections.js. Revisa el mensaje de arriba
  echo ^(por ejemplo: falta .env, MONGODB_URI invalido, etc.^) y corrigelo
  echo antes de continuar.
  pause
  exit /b 1
)

echo.
echo ============================================
echo  Paso 2 de 2: cargando el catalogo de Renuevate
echo ============================================
call node db\seed-products.js
if errorlevel 1 (
  echo.
  echo Hubo un error en db\seed-products.js. Revisa el mensaje de arriba.
  pause
  exit /b 1
)

echo.
echo Listo. El catalogo de Renuevate ya esta en tu base de datos Atlas.
pause
