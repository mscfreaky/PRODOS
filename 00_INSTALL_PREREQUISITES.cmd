@echo off
setlocal
echo This script installs Node.js LTS, .NET 8 SDK and Cloudflare cloudflared.
echo Obtain IT approval before installing on corporate PCs.
echo Installers may require administrator rights or consent.
pause
winget install -e --id OpenJS.NodeJS.LTS --source winget
winget install -e --id Microsoft.DotNet.SDK.8 --source winget
winget install -e --id Cloudflare.cloudflared --source winget
echo Check installer output. Reopen the terminal, then run 01_SETUP_AND_BUILD.cmd.
pause
