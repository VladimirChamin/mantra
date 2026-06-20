@echo off
echo Starting Mantra Trading NN...

start "Backend" cmd /k "cd /d D:\webDev\trading-nn\trading-nn && D:\webDev\trading-nn\.venv\Scripts\uvicorn.exe api_server:app --reload --port 8000"

timeout /t 2 /nobreak >nul

start "Landing" cmd /k "cd /d D:\webDev\trading-nn\landing && npm run dev"

start "Terminal" cmd /k "cd /d D:\webDev\trading-nn\trading-nn\frontend && npm run dev"

echo.
echo Backend:  http://localhost:8000
echo Landing:  http://localhost:3001
echo Terminal: http://localhost:3000
echo.
echo Логин по умолчанию: admin@trading.local / admin123
echo.
pause
