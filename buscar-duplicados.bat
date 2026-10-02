@echo off
REM buscar-duplicados.bat
REM Doble clic: busca en tu MongoDB Atlas real si "Crema para Contorno de
REM Ojos" (o cualquier otro producto) esta duplicado. SOLO LECTURA, no
REM borra nada. Al terminar, copia el resultado que imprime la consola y
REM mandamelo para confirmar cual ficha quitar.
REM
REM Requisito unico: tener Node.js instalado y un archivo .env en esta misma
REM carpeta con tu MONGODB_URI y MONGODB_DB reales. Este script corre 100%
REM en tu maquina -- Claude nunca ve tu cadena de conexion ni tus
REM credenciales.

cd /d "%~dp0"

echo ============================================
echo  Buscando productos duplicados en MongoDB Atlas
echo ============================================
call node db\buscar-duplicados.js
if errorlevel 1 (
  echo.
  echo Hubo un error. Revisa el mensaje de arriba ^(por ejemplo: falta
  echo .env, MONGODB_URI invalido, etc.^) y corrigelo antes de continuar.
  pause
  exit /b 1
)

echo.
echo Listo. Copia el resultado de arriba y mandaselo a Claude para
echo confirmar cual ficha duplicada se borra.
pause
