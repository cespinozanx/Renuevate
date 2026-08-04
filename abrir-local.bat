@echo off
REM abrir-local.bat
REM Doble clic para: (1) levantar el sitio local con "vercel dev" (sirve
REM tambien las funciones /api/* de login, carrito, resenas, etc. -- un
REM servidor estatico normal NO las corre) y (2) abrirlo automaticamente en
REM el navegador Comet, igual que antes con un solo clic.
REM
REM Requisito unico: tener el Vercel CLI instalado una vez (npm install -g vercel)
REM y un archivo .env en esta misma carpeta con tus variables reales (copia
REM .env.example y llena los valores).

cd /d "%~dp0"

echo Levantando servidor local (vercel dev)...
start "Renuevate - servidor local" cmd /k "vercel dev"

echo Esperando a que el servidor arranque...
timeout /t 5 /nobreak >nul

set COMET1=%LOCALAPPDATA%\Perplexity\Comet\Application\Comet.exe
set COMET2=%LOCALAPPDATA%\Comet\Application\Comet.exe

if exist "%COMET1%" (
  start "" "%COMET1%" "http://localhost:3000"
) else if exist "%COMET2%" (
  start "" "%COMET2%" "http://localhost:3000"
) else (
  echo No encontre Comet en las rutas conocidas -- abriendo con tu navegador predeterminado.
  echo Si Comet SI esta instalado, dame la ruta exacta de su .exe ^(clic derecho en su
  echo acceso directo -^> Propiedades -^> campo "Destino"^) y ajusto este script.
  start "" "http://localhost:3000"
)
