@echo off
REM borrar-productos-retirados.bat
REM Doble clic para borrar DEFINITIVAMENTE de tu MongoDB Atlas real los SKUs
REM de prueba que Carlos marco con tache (Fix 154, 2026-09-24):
REM   NACAR-01..04, VIGOR-01..04, ROBLE-01..04
REM
REM Este es un DELETE real (no una desactivacion) -- ver db/delete-retired-
REM products.js para el detalle. Antes de borrar cada SKU revisa si alguna
REM orden ya lo referencia; si la tiene, ESE sku se salta (no se borra) y se
REM reporta al final en vez de dejar un pedido historico apuntando a un
REM producto que ya no existe.
REM
REM Requisito unico: tener Node.js instalado y un archivo .env en esta misma
REM carpeta con tu MONGODB_URI y MONGODB_DB reales (los mismos que usa
REM Vercel). Este script corre 100%% en tu maquina -- Claude nunca ve tu
REM cadena de conexion ni tus credenciales.

cd /d "%~dp0"

echo ============================================
echo  Borrando SKUs de prueba retirados (Fix 154)
echo ============================================
call node db\delete-retired-products.js
if errorlevel 1 (
  echo.
  echo Hubo un error en db\delete-retired-products.js. Revisa el mensaje de
  echo arriba ^(por ejemplo: falta .env, MONGODB_URI invalido, etc.^) y
  echo corrigelo antes de continuar.
  pause
  exit /b 1
)

echo.
echo Listo. Revisa arriba el resumen: cuantos se borraron, cuantos se
echo saltaron por tener una orden historica, y cuantos ya no existian.
pause
