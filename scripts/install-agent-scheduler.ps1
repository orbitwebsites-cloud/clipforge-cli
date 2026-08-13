<# Registers the daily ClipForge discovery/production task. #>
param(
  [string]$Time = '00:30',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $root 'scripts\agent-next.cmd'
$name = 'ClipForge Discover 0030'

if ($Remove) {
  Get-ScheduledTask -TaskName 'ClipForge Discover*' -ErrorAction SilentlyContinue |
    Unregister-ScheduledTask -Confirm:$false
  Write-Host 'ClipForge discovery task removed.'
  return
}

if (-not (Test-Path $runner)) { throw "Runner not found: $runner" }

$action = New-ScheduledTaskAction -Execute $runner -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6) `
  -MultipleInstances IgnoreNew

Get-ScheduledTask -TaskName 'ClipForge Discover*' -ErrorAction SilentlyContinue |
  Unregister-ScheduledTask -Confirm:$false
$name = 'ClipForge Discover ' + ($Time -replace ':','')
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Finds fresh Minecraft uploads and queues captioned Shorts' | Out-Null

Write-Host "registered: $name"
Write-Host "Daily discovery/production time: $Time"
