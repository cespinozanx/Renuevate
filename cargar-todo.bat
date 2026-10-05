@echo off
REM cargar-todo.bat (Fix 205) -- UN SOLO doble clic: deja la base Atlas al dia.
REM   1) db\collections.js            -> esquema/indices (idempotente)
REM   2) db\seed-products.js          -> catalogo (ROBLE-01/02/03, NACAR-18 -v2, etc.)
REM   3) db\seed-reviews-ejemplo.js   -> resenas de EJEMPLO con foto (marcadas)
REM Para quitar las resenas de ejemplo: node db\seed-reviews-ejemplo.js --purge
cd /d "%~dp0"
echo ============================================
echo  Cargando todo en Atlas (catalogo + resenas de ejemplo)
echo ============================================
call node db\collections.js
if errorlevel 1 goto :fail
call node db\seed-products.js
if errorlevel 1 goto :fail
call node db\seed-reviews-ejemplo.js
if errorlevel 1 goto :fail
echo.
echo Listo. Atlas actualizado. Recarga el sitio con Ctrl+Shift+R.
pause
exit /b 0
:fail
echo.
echo Hubo un error. Revisa el mensaje de arriba (.env, MONGODB_URI, red).
pause
exit /b 1
