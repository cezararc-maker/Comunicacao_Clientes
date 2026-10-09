@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (echo Instale Node.js LTS antes de continuar. & pause & exit /b 1)
py -3 -m pip install -r requirements.txt
if errorlevel 1 (echo Falha nas dependencias Python. & pause & exit /b 1)
if not exist "node_modules\electron" (
  call npm install
  if errorlevel 1 (echo Falha ao instalar dependencias Node.js. & pause & exit /b 1)
)
call npm start
pause
