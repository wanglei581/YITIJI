# Register or remove the boot spool guard scheduled task.
# Dot-source this file. It does not change the machine until a function runs.
# Windows PowerShell 5.1.

$ErrorActionPreference = "Stop"

function Invoke-BootGuardSc([string[]]$Arguments) {
  $output = & sc.exe @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    $detail = ($output | Out-String).Trim()
    throw "sc.exe $($Arguments -join ' ') failed with exit code ${LASTEXITCODE}: $detail"
  }
  return ($output | Out-String).Trim()
}

function Assert-ProgramFilesAgentScript([string]$ScriptPath) {
  if ([string]::IsNullOrWhiteSpace($ScriptPath)) { throw "provision script path is empty" }
  if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) { throw "provision script is missing" }
  $full = [System.IO.Path]::GetFullPath($ScriptPath)
  $programFiles = [System.IO.Path]::GetFullPath($env:ProgramFiles)
  $prefix = $programFiles.TrimEnd('\') + "\AIJobPrintAgent\"
  if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "provision script must be launched from Program Files\AIJobPrintAgent"
  }
  $item = Get-Item -LiteralPath $full -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "provision script must not be a reparse point"
  }
  return $full
}

function Install-BootSpoolGuard([string]$GuardScriptPath) {
  $full = Assert-ProgramFilesAgentScript $GuardScriptPath
  $taskName = "AIJobPrintBootSpoolGuard"
  $argumentLine = (@(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", ('"{0}"' -f $full)
  ) -join " ")
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argumentLine
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 3) `
    -RestartCount 0 `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  Register-ScheduledTask `
    -TaskName $taskName `
    -Description "Clears leftover print spool files before the print spooler starts" `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings | Out-Null
  Invoke-BootGuardSc @("config", "Spooler", "start=", "demand") | Out-Null
  $readback = Invoke-BootGuardSc @("qc", "Spooler")
  if ($readback -notmatch "DEMAND_START") {
    throw "Spooler start type readback was not Manual"
  }
}

function Uninstall-BootSpoolGuard {
  $taskName = "AIJobPrintBootSpoolGuard"
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  Invoke-BootGuardSc @("config", "Spooler", "start=", "auto") | Out-Null
  $readback = Invoke-BootGuardSc @("qc", "Spooler")
  if ($readback -notmatch "AUTO_START") {
    throw "Spooler start type readback was not Automatic"
  }
  $spooler = Get-Service -Name "Spooler" -ErrorAction Stop
  if ($spooler.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
    Start-Service -Name "Spooler"
    $spooler.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(60))
  }
}

function Get-BootSpoolGuardStatusLine {
  $task = Get-ScheduledTask -TaskName "AIJobPrintBootSpoolGuard" -ErrorAction SilentlyContinue
  $spooler = Get-Service -Name "Spooler" -ErrorAction Stop
  $taskState = if ($null -ne $task) { "registered" } else { "absent" }
  return "boot-spool-guard: task=$taskState spoolerStart=$($spooler.StartType) spoolerStatus=$($spooler.Status)"
}
