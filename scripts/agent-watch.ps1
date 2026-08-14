<# Poll creator feeds continuously and run one ClipForge producer at a time. #>
param(
  [ValidateRange(30, 3600)]
  [int]$PollSeconds = 120
)

$ErrorActionPreference = 'Continue'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'work\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location $root

while ($true) {
  $stamp = Get-Date -Format 'yyyy-MM-dd'
  $logFile = Join-Path $logDir "agent-watch-$stamp.log"
  $started = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
  Add-Content -LiteralPath $logFile -Value "`r`n===== watcher cycle $started =====" -Encoding UTF8

  & node src\cli.js agent `
    --n 5 `
    --min 15 `
    --max 32 `
    --recent 5 `
    --max-videos 2 `
    --target-pending 10 `
    --priority 100 `
    --post 2>&1 |
      ForEach-Object { Add-Content -LiteralPath $logFile -Value $_ -Encoding UTF8 }

  if ($LASTEXITCODE -ne 0) {
    Add-Content -LiteralPath $logFile `
      -Value "watcher cycle exited $LASTEXITCODE; retrying after $PollSeconds seconds" `
      -Encoding UTF8
  }
  Start-Sleep -Seconds $PollSeconds
}
