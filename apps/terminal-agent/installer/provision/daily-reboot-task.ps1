# Register or remove the daily maintenance reboot task.
# Dot-source this file. It does not change the machine until a function runs.
# Windows PowerShell 5.1.

$ErrorActionPreference = "Stop"

function Assert-DailyRebootScript([string]$ScriptPath) {
  if ([string]::IsNullOrWhiteSpace($ScriptPath)) { throw "daily reboot script path is empty" }
  if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) { throw "daily reboot script is missing" }
  $full = [System.IO.Path]::GetFullPath($ScriptPath)
  $programFiles = [System.IO.Path]::GetFullPath($env:ProgramFiles)
  $prefix = $programFiles.TrimEnd('\') + "\AIJobPrintAgent\"
  if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "daily reboot script must be launched from Program Files\AIJobPrintAgent"
  }
  $item = Get-Item -LiteralPath $full -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "daily reboot script must not be a reparse point"
  }
  return $full
}

function Install-DailyRebootTask([string]$At, [string]$ScriptPath) {
  if ($At -notmatch "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$") {
    throw "DailyRebootAt must be HH:mm between 00:00 and 23:59"
  }
  $full = Assert-DailyRebootScript $ScriptPath
  $taskName = "AIJobPrintDailyReboot"
  $argumentLine = (@(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", ('"{0}"' -f $full)
  ) -join " ")
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argumentLine
  $trigger = New-ScheduledTaskTrigger -Daily -At $At
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 45) `
    -RestartCount 0 `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  Register-ScheduledTask `
    -TaskName $taskName `
    -Description "Reboots the terminal for daily maintenance when the print queue is idle" `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings | Out-Null
}

function Uninstall-DailyRebootTask {
  $taskName = "AIJobPrintDailyReboot"
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
}

function Get-DailyRebootStatusLine {
  $task = Get-ScheduledTask -TaskName "AIJobPrintDailyReboot" -ErrorAction SilentlyContinue
  if ($null -eq $task) { return "daily-reboot: off" }
  $trigger = @($task.Triggers) | Select-Object -First 1
  $clock = "unknown"
  if ($null -ne $trigger -and -not [string]::IsNullOrWhiteSpace([string]$trigger.StartBoundary)) {
    $parsed = [DateTime]::Parse([string]$trigger.StartBoundary)
    $clock = $parsed.ToString("HH:mm")
  }
  return "daily-reboot: at=$clock"
}
