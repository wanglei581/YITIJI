# On-demand service restart task. Dot-source only. Windows PowerShell 5.1.
$ErrorActionPreference = "Stop"
function Assert-AgentRestartScript([string]$ScriptPath) {
  if ([string]::IsNullOrWhiteSpace($ScriptPath)) { throw "restart script path is empty" }
  $full = [System.IO.Path]::GetFullPath($ScriptPath)
  $prefix = [System.IO.Path]::GetFullPath($env:ProgramFiles).TrimEnd('\') + "\AIJobPrintAgent\"
  if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "restart script must be in Program Files\AIJobPrintAgent"
  }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "restart script missing" }
  # Reject junctions/symlinks in every ancestor as well as the script itself.
  $item = Get-Item -LiteralPath $full -Force
  while ($null -ne $item) {
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "restart script path must not contain a reparse point"
    }
    $item = if ($item -is [System.IO.FileInfo]) { $item.Directory } else { $item.Parent }
  }
  return $full
}
function Install-AgentRestartTask(
  [string]$ScriptPath,
  [string]$ServiceName = "aijobprintagent.exe",
  [string]$StateDir = (Join-Path $env:ProgramData "AIJobPrintAgent"),
  [string]$TaskName = "AIJobPrintAgentRestart"
) {
  $full = Assert-AgentRestartScript $ScriptPath
  # These local installation parameters are never sourced from remote commands.
  foreach ($value in @($ServiceName, $StateDir, $TaskName)) {
    if ($value -match '["\r\n]' -or [string]::IsNullOrWhiteSpace($value)) { throw "invalid restart task parameter" }
  }
  $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -ServiceName "{1}" -StateDir "{2}"' -f $full, $ServiceName, $StateDir
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 3 `
    -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal `
    -Settings $settings -Description "Normal Agent service stop/start on demand" -Force | Out-Null
}
function Uninstall-AgentRestartTask([string]$TaskName = "AIJobPrintAgentRestart") {
  if ($null -ne (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
}
function Get-AgentRestartStatusLine([string]$TaskName = "AIJobPrintAgentRestart") {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $state = if ($null -eq $task) { "absent" } else { "registered" }
  return "agent-restart: task=$state"
}
