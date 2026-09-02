@echo off
REM sembrar-resenas.bat
REM Doble clic para cargar en tu MongoDB Atlas real 10 resenas de ejemplo
REM (product_reviews) en los 4 productos reales de skincare: NACAR-06 (3),
REM NACAR-07 (2), NACAR-08 (3), NACAR-09 (2). Al final recalcula
REM products.rating {stars, count} para esos 4 skus, igual que hace
REM api/reviews.js cuando un cliente real publica una resena.
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
echo  Cargando resenas de ejemplo (4 productos)
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
