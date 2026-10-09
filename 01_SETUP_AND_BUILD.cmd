@echo off
setlocal
cd /d "%~dp0"
title PRODOS Production Suite - Build
where node >nul 2>nul
if errorlevel 1 goto missing
where npm >nul 2>nul
if errorlevel 1 goto missing
where dotnet >nul 2>nul
if errorlevel 1 goto missing
pushd bridge
call npm ci --ignore-scripts --no-audit --no-fund
if errorlevel 1 goto dependency_failed
call npm test
if errorlevel 1 goto dependency_failed
popd
dotnet publish "AtemInspector\AtemInspector.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "%~dp0publish"
if errorlevel 1 goto failed
if not exist "publish\bridge" mkdir "publish\bridge"
xcopy "bridge\*" "publish\bridge\" /E /I /Y /Q >nul
if errorlevel 1 goto failed
echo DONE. Run 02_START_PRODOS.cmd or 03_START_DEMO.cmd.
pause
exit /b 0
:dependency_failed
popd
goto failed
:missing
echo Node.js with npm and .NET 8 SDK are required.
echo See 00_INSTALL_PREREQUISITES.cmd and README.md.
:failed
echo Build did not complete. Check the error above.
pause
exit /b 1
