$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path 'bridge\node_modules\qrcode')) { throw 'Run 01_SETUP_AND_BUILD.cmd first.' }
$testOutput = Join-Path $PSScriptRoot 'test-output\inspector'
dotnet build tests\InspectorSmoke\InspectorSmoke.csproj -c Release -o $testOutput
if ($LASTEXITCODE -ne 0) { throw 'Could not build test program.' }
New-Item -ItemType Directory -Path "$testOutput\bridge" -Force | Out-Null
Copy-Item 'bridge\*' "$testOutput\bridge" -Recurse -Force
$previousDataPath = $env:PRODOS_DATA_PATH
try {
    $env:PRODOS_DATA_PATH = Join-Path $testOutput ('data-' + [Guid]::NewGuid().ToString('N') + '\production.json')
    $testProcess = Start-Process -FilePath "$testOutput\InspectorSmoke.exe" -WindowStyle Hidden -RedirectStandardOutput "$testOutput\result.log" -RedirectStandardError "$testOutput\error.log" -PassThru
    if (-not $testProcess.WaitForExit(60000)) { throw 'Test is taking longer than expected. Check logs in test-output\inspector.' }
    Get-Content "$testOutput\result.log"
    Get-Content "$testOutput\error.log"
    if ($testProcess.ExitCode -ne 0) { throw 'Inspector test failed.' }
} finally { $env:PRODOS_DATA_PATH = $previousDataPath }
