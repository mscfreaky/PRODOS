@echo off
setlocal
cd /d "%~dp0bridge"
node --test
set result=%errorlevel%
pause
exit /b %result%
