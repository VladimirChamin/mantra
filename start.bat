@echo off
echo Starting Trading NN...

start "Backend" cmd /k "cd /d D:\webDev\trading-nn\trading-nn && D:\webDev\trading-nn\.venv\Scripts\uvicorn.exe api_server:app --reload --port 8000"

timeout /t 2 /nobreak >nul

start "Frontend" cmd /k "cd /d D:\webDev\trading-nn\trading-nn\frontend && npm run dev"

echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:3000
echo.
pause
