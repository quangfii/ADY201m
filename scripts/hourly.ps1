$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$logDirectory = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
& $nodeExecutable (Join-Path $projectRoot 'src/pipeline.js') >> (Join-Path $logDirectory 'hourly.log') 2>&1
exit $LASTEXITCODE
