@echo off
cd /d "%~dp0"
py -3 -m pip install -r requirements.txt
if errorlevel 1 (echo Falha na instalacao das dependencias & pause & exit /b 1)
start "" http://127.0.0.1:8765
py -3 app.py
pause
