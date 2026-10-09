@echo off
cd /d "%~dp0"
if not exist "publish\PRODOS.exe" (
  echo PRODOS has not been built yet.
  echo Run 01_SETUP_AND_BUILD.cmd first.
  pause
  exit /b 1
)
start "PRODOS Demo" "publish\PRODOS.exe" --demo
