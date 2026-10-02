@echo off
REM eliminar-contorno-duplicado.bat
REM Doble clic: borra en tu MongoDB Atlas real el documento de producto con
REM sku malformado "CREMA PARA CONTORNO DE OJOS" (la ficha duplicada de
REM "Crema para Contorno de Ojos"). Antes de borrar, revisa que ningun
REM pedido ya lo haya referenciado -- si lo encuentra, NO borra.
REM
REM Despues de correr esto, dale doble clic a sembrar-productos.bat para
REM recrear la ficha correcta con sku NACAR-16.
REM
REM Requisito unico: tener Node.js instalado y un archivo .env en esta misma
REM carpeta con tu MONGODB_URI y MONGODB_DB reales. Este script corre 100%
REM en tu maquina -- Claude nunca ve tu cadena de conexion ni tus
REM credenciales.

cd /d "%~dp0"

echo ============================================
echo  Borrando producto duplicado (Contorno de Ojos)
echo ============================================
call node db\eliminar-contorno-duplicado.js
if errorlevel 1 (
  echo.
  echo Hubo un error. Revisa el mensaje de arriba y corrigelo antes de
  echo continuar.
  pause
  exit /b 1
)

echo.
echo Listo. Ahora dale doble clic a sembrar-productos.bat para recrear
echo la ficha correcta (sku NACAR-16).
pause
