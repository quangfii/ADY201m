$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$pythonExecutable = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExecutable)) { throw 'Create .venv and install requirements.txt first.' }
$logDirectory = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
& $pythonExecutable -m ady pipeline >> (Join-Path $logDirectory 'hourly.log') 2>&1
exit $LASTEXITCODE
