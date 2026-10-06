# Daily maintenance reboot. Waits out an active print queue, then reboots.
# A print spooler that is not running counts as idle and still reboots: that is
# the state left behind when the boot guard cannot delete spool files.
# If the spooler is running and reading the queue throws, the script still fails closed.
# -DryRun prints the decision and does not call shutdown.
# Windows PowerShell 5.1. The log records the time and the result only.

[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$logDir = Join-Path $env:ProgramData "AIJobPrintAgent\logs"
$logPath = Join-Path $logDir "daily-reboot.log"

function Write-DailyRebootLog([string]$Result) {
  $allowed = @("reboot", "postpone", "dry-run-reboot", "dry-run-postpone", "reboot-spooler-stopped", "dry-run-reboot-spooler-stopped")
  if ($allowed -notcontains $Result) { throw "daily-reboot log result is not allowed" }
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $stamp = [DateTimeOffset]::Now.ToString("yyyy-MM-ddTHH:mm:ssK")
  $line = "$stamp daily-reboot result=$Result"
  [System.IO.File]::AppendAllText($logPath, ($line + "`r`n"), [System.Text.Encoding]::ASCII)
}

function Get-ConfiguredPrinterName {
  $configPath = Join-Path $env:ProgramData "AIJobPrintAgent\agent-config.json"
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "agent config is missing"
  }
  $raw = [System.IO.File]::ReadAllText($configPath)
  $config = $raw | ConvertFrom-Json
  $printerName = [string]$config.printerName
  if ([string]::IsNullOrWhiteSpace($printerName)) {
    throw "printer name is missing"
  }
  return $printerName
}

$printerName = Get-ConfiguredPrinterName
$attempt = 0
while ($attempt -lt 3) {
  $attempt += 1
  $spooler = Get-Service -Name "Spooler" -ErrorAction Stop
  if ([string]$spooler.Status -ne "Running") {
    if ($DryRun) {
      Write-DailyRebootLog -Result "dry-run-reboot-spooler-stopped"
      Write-Output "reboot"
      exit 0
    }
    Write-DailyRebootLog -Result "reboot-spooler-stopped"
    & "$env:SystemRoot\System32\shutdown.exe" /r /t 60 /d p:4:1 /c "AIJobPrint daily maintenance reboot"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    exit 0
  }
  $jobs = @(Get-PrintJob -PrinterName $printerName -ErrorAction Stop)
  $count = $jobs.Count
  if ($count -eq 0) {
    if ($DryRun) {
      Write-DailyRebootLog -Result "dry-run-reboot"
      Write-Output "reboot"
      exit 0
    }
    Write-DailyRebootLog -Result "reboot"
    & "$env:SystemRoot\System32\shutdown.exe" /r /t 60 /d p:4:1 /c "AIJobPrint daily maintenance reboot"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    exit 0
  }
  if ($attempt -ge 3 -or $DryRun) {
    if ($DryRun) {
      Write-DailyRebootLog -Result "dry-run-postpone"
      Write-Output "postpone"
      exit 0
    }
    Write-DailyRebootLog -Result "postpone"
    exit 0
  }
  Start-Sleep -Seconds 600
}

exit 1
