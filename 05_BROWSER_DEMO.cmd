@echo off
setlocal
cd /d "%~dp0bridge"
if exist node_modules\qrcode\package.json goto run
call npm ci --ignore-scripts --no-audit --no-fund
if errorlevel 1 goto failed
:run
node launch.js --demo
if errorlevel 1 goto failed
exit /b 0
:failed
echo Demo did not start. Check Node.js and the error message.
pause
exit /b 1
