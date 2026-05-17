@echo off
title SOC Server Launcher

echo ============================================================
echo  Starting SOC - Backend + Frontend
echo ============================================================

:: Kill any existing node processes on port 3000
echo [1/3] Clearing old processes...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 "') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Start Backend (node server.js)
echo [2/3] Starting Backend (port 3000)...
start "SOC Backend" cmd /k "cd /d %~dp0backend && node server.js"

:: Wait 3 seconds for backend to initialize
timeout /t 3 /nobreak >nul

:: Start Frontend (npm start)
echo [3/3] Starting Frontend...
start "SOC Frontend" cmd /k "cd /d %~dp0frontend && npm start"

echo.
echo ============================================================
echo  Backend  : http://localhost:3000
echo  Frontend : http://localhost:3001
echo ============================================================
echo  Close the two terminal windows to stop the servers.
echo ============================================================
pause
