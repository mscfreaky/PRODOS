param([switch]$FrameworkDependent)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function RunNative($exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "$exe failed (exit code $LASTEXITCODE)" }
}
Write-Host 'PRODOS Production Suite - Build and tests' -ForegroundColor Cyan
RunNative -exe node -arguments @('--version')
RunNative -exe npm.cmd -arguments @('--version')
RunNative -exe dotnet -arguments @('--version')
Push-Location (Join-Path $PSScriptRoot 'bridge')
try {
    # The read-only ATEM bridge does not use the transitive native font renderer.
    RunNative -exe npm.cmd -arguments @('ci','--ignore-scripts','--no-audit','--no-fund')
    RunNative -exe npm.cmd -arguments @('test')
} finally { Pop-Location }
$selfContained = if ($FrameworkDependent) { 'false' } else { 'true' }
RunNative -exe dotnet -arguments @('publish','AtemInspector\AtemInspector.csproj','-c','Release','-r','win-x64','--self-contained',$selfContained,'-p:PublishSingleFile=true','-p:IncludeNativeLibrariesForSelfExtract=true','-o',(Join-Path $PSScriptRoot 'publish'))
$dest = Join-Path $PSScriptRoot 'publish\bridge'
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot 'bridge\*') -Destination $dest -Recurse -Force
if (-not (Test-Path (Join-Path $PSScriptRoot 'publish\PRODOS.exe'))) { throw 'Executable missing.' }
Write-Host 'Done. Start: 02_START_PRODOS.cmd / Demo: 03_START_DEMO.cmd' -ForegroundColor Green
