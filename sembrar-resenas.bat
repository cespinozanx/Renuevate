@echo off
REM sembrar-resenas.bat
REM Doble clic para cargar en tu MongoDB Atlas real 20 resenas de ejemplo
REM (product_reviews) en los 8 productos reales de Nacar: NACAR-06 (3),
REM NACAR-07 (2), NACAR-08 (3), NACAR-09 (2), NACAR-10 (3), NACAR-11 (3),
REM NACAR-12 (2), NACAR-13 (2). Al final recalcula products.rating
REM {stars, count} para esos 8 skus, igual que hace api/reviews.js cuando
REM un cliente real publica una resena.
REM
REM Fix 105: se agregaron las resenas de NACAR-10/11/12/13 (antes solo
REM tenian NACAR-06/07/08/09). VIGOR-01..04 y ROBLE-01..04 siguen sin
REM resenas de siembra a proposito -- son placeholders sin ficha de
REM detalle real todavia.
REM
REM Idempotente: se puede correr varias veces sin duplicar -- cada corrida
REM borra primero las resenas de siembra anteriores (marcadas con
REM seed_tag='renuevate-demo-v1') y las vuelve a crear. Nunca toca una
REM resena real de un cliente.
REM
REM Requisito unico: tener Node.js instalado y correr primero
REM sembrar-productos.bat al menos una vez (crea la coleccion product_reviews
REM y sus indices/validador). Usa el mismo .env con MONGODB_URI/MONGODB_DB
REM que ya usan sembrar-productos.bat y Vercel. Este script corre 100% en tu
REM maquina -- Claude nunca ve tu cadena de conexion ni tus credenciales.

cd /d "%~dp0"

echo ============================================
echo  Cargando resenas de ejemplo (8 productos)
echo ============================================
call node db\seed-reviews.js
if errorlevel 1 (
  echo.
  echo Hubo un error en db\seed-reviews.js. Revisa el mensaje de arriba
  echo ^(por ejemplo: falta .env, MONGODB_URI invalido, o no corriste
  echo sembrar-productos.bat todavia^) y corrigelo antes de continuar.
  pause
  exit /b 1
)

echo.
echo Listo. Las resenas de ejemplo ya estan en tu base de datos Atlas.
pause
