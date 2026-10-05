@echo off
title MyDNAPedia LIMS (test version)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and then double-click this file again.
  pause
  exit /b
)
start "" http://127.0.0.1:3000
node --no-warnings src\server.js --demo
pause
