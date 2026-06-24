@echo off
echo Останавливаю процессы...
taskkill /F /IM node.exe 2>nul
taskkill /F /IM uvicorn.exe 2>nul
taskkill /F /IM python.exe 2>nul
echo Готово. Все процессы остановлены.
pause
