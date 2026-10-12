param([string]$PythonExecutable = '')
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $PythonExecutable) {
    $PythonExecutable = Join-Path $projectRoot '.venv\Scripts\python.exe'
}
$PythonExecutable = (Resolve-Path -LiteralPath $PythonExecutable -ErrorAction Stop).Path
$action = New-ScheduledTaskAction -Execute $PythonExecutable -Argument '-m ady pipeline' -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'ADY201m-Hourly-Prices' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Output 'ADY201m-Hourly-Prices: Python pipeline every hour while logged in.'
