@echo off
REM eliminar-contorno-duplicado.bat (v2)
REM Doble clic: busca TODOS los productos relacionados a "contorno" (por
REM sku o por nombre, sin importar mayusculas/espacios) y borra los que no
REM tengan el sku correcto "NACAR-16" -- asi ya no depende de que el sku
REM malformado sea un texto exacto. Antes de borrar, revisa que ningun
REM pedido ya lo haya referenciado -- si lo encuentra, NO borra.
REM
REM Despues de correr esto, dale doble clic a sembrar-productos.bat para
REM asegurar que la ficha correcta con sku NACAR-16 este presente.
REM
REM Requisito unico: tener Node.js instalado y un archivo .env en esta misma
REM carpeta con tu MONGODB_URI y MONGODB_DB reales (el mismo que ya usan
REM sembrar-productos.bat y sembrar-resenas.bat). Este script corre 100% en
REM tu maquina -- Claude nunca ve tu cadena de conexion ni tus credenciales.

cd /d "%~dp0"

echo ============================================
echo  Borrando producto(s) duplicado(s) (Contorno de Ojos)
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
echo Listo. Ahora dale doble clic a sembrar-productos.bat para asegurar
echo que la ficha correcta (sku NACAR-16) este presente.
pause
