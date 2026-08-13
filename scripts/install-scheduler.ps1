<#
  Registers daily Windows Scheduled Tasks that each post one queued clip.

  Task Scheduler is used rather than an always-on node process so posting keeps
  working after a reboot and without a terminal open.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1
    powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Times 08:00,09:30,11:00,12:30,14:00,15:30,17:00,18:30,20:00,21:30
    powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Remove
#>
param(
  [string[]]$Times = @('08:00','09:30','11:00','12:30','14:00','15:30','17:00','18:30','20:00','21:30'),
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $root 'scripts\post-next.cmd'
$prefix = 'ClipForge Post'

if ($Remove) {
  Get-ScheduledTask -TaskName "$prefix*" -ErrorAction SilentlyContinue |
    ForEach-Object {
      Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false
      Write-Host "removed $($_.TaskName)"
    }
  Write-Host "`nAll ClipForge posting tasks removed."
  return
}

if (-not (Test-Path $runner)) { throw "Runner not found: $runner" }

$action = New-ScheduledTaskAction -Execute $runner -WorkingDirectory $root

# Wake/catch-up settings matter here: a missed slot should still post rather
# than silently skipping the day.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew

$i = 0
foreach ($t in $Times) {
  $i++
  # Task names cannot contain ':' — Register-ScheduledTask rejects it with a
  # bare "parameter is incorrect" rather than naming the real problem.
  $name = "$prefix $i " + ($t -replace ':','')
  $trigger = New-ScheduledTaskTrigger -Daily -At $t
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
    -Settings $settings -Description 'Posts one queued ClipForge clip to YouTube' | Out-Null
  Write-Host "registered: $name"
}

Write-Host "`n$i daily posting slots registered."
Write-Host "Logs:   $root\work\logs\"
Write-Host "Status: node src\cli.js queue"
Write-Host "Remove: powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Remove"
Write-Host "`nNote: tasks only fire while Windows is running (StartWhenAvailable catches up missed slots)."
