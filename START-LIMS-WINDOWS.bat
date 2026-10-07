@echo off
title MyDNAPedia LIMS (test version)
cd /d "%~dp0"
echo.
echo  MyDNAPedia LIMS (test version)
echo  ------------------------------
echo.
if not exist "src\server.js" goto notextracted
where node >nul 2>nul
if errorlevel 1 goto nonode
echo  Starting... your browser opens on its own in a few seconds.
echo  Keep this window open while you use the LIMS. Close it to stop.
echo.
node --no-warnings src\server.js --demo --open
echo.
echo  The LIMS has stopped. If you see an error above, send a photo of this window to Claude.
pause
exit /b

:notextracted
echo  The zip file has not been extracted yet.
echo  Right-click the zip, choose "Extract All...", open the new folder,
echo  then double-click START-LIMS-WINDOWS.bat inside it.
echo.
pause
exit /b

:nonode
echo  Node.js is not installed on this computer.
echo  1. Go to https://nodejs.org and download the LTS version.
echo  2. Install it with the default options.
echo  3. Double-click START-LIMS-WINDOWS.bat again.
echo.
pause
exit /b
