<# Registers the always-on ClipForge upload watcher. #>
param(
  [ValidateRange(30, 3600)]
  [int]$PollSeconds = 120,
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $root 'scripts\agent-watch.ps1'
$name = 'ClipForge Watch'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runValue = 'ClipForgeWatch'

function Stop-ExistingWatchers {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($runner) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Remove-OldTasks {
  @('ClipForge Watch*', 'ClipForge Discover*') | ForEach-Object {
    Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue |
      ForEach-Object {
        Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false -ErrorAction SilentlyContinue
      }
  }
}

if ($Remove) {
  Remove-OldTasks
  Remove-ItemProperty -Path $runKey -Name $runValue -ErrorAction SilentlyContinue
  Stop-ExistingWatchers
  Write-Host 'ClipForge watcher removed.'
  return
}

if (-not (Test-Path $runner)) { throw "Runner not found: $runner" }

$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -PollSeconds $PollSeconds"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Remove-OldTasks
Remove-ItemProperty -Path $runKey -Name $runValue -ErrorAction SilentlyContinue
Stop-ExistingWatchers

$installedAs = 'Windows Scheduled Task'
try {
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal `
    -Description 'Polls creator feeds and immediately produces fresh captioned Shorts' | Out-Null
  Start-ScheduledTask -TaskName $name
} catch {
  # Some locked-down Windows sessions cannot create tasks without elevation.
  # HKCU Run provides the same per-user logon persistence without admin rights.
  $installedAs = 'current-user startup entry'
  New-Item -Path $runKey -Force | Out-Null
  $startupCommand = "powershell.exe $arguments"
  Set-ItemProperty -Path $runKey -Name $runValue -Value $startupCommand
  Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden
}

Write-Host "registered: $name ($installedAs)"
Write-Host "Polling every $PollSeconds seconds; watcher started now and restarts at logon."
Write-Host "Logs: $root\work\logs\agent-watch-YYYY-MM-DD.log"
