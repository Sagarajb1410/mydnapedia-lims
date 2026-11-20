@echo off
title MyDNAPedia LIMS - Windows Server setup
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Please right-click SETUP-WINDOWS-SERVER.bat and choose "Run as administrator".
  echo.
  pause
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows-server.ps1"
echo.
pause
