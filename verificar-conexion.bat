@echo off
REM verificar-conexion.bat
REM Doble clic: NO borra nada. Solo muestra a que cluster/base de datos
REM apunta tu .env (host del cluster, nunca tu usuario/password) y si el
REM producto duplicado (sku malformado) existe en ESA base. Sirve para
REM comparar contra las Environment Variables de Vercel y confirmar si tu
REM .env local y produccion apuntan a la misma base de datos.
REM
REM Requisito unico: tener Node.js instalado y un archivo .env en esta
REM misma carpeta con tu MONGODB_URI y MONGODB_DB reales.

cd /d "%~dp0"

echo ============================================
echo  Verificando conexion y base de datos
echo ============================================
call node db\verificar-conexion.js
if errorlevel 1 (
  echo.
  echo Hubo un error. Revisa el mensaje de arriba.
  pause
  exit /b 1
)

echo.
pause
