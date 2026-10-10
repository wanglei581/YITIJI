# External normal stop/start controller. Windows PowerShell 5.1, ASCII log only.
param(
  [string]$ServiceName = "aijobprintagent.exe",
  [string]$StateDir = (Join-Path $env:ProgramData "AIJobPrintAgent")
)
$ErrorActionPreference = "Stop"
$marker = Join-Path $StateDir "agent-restart.state"
$logDir = Join-Path $StateDir "logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
function Write-RestartStage([string]$Stage, [string]$Result) {
  $line = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") + " stage=$Stage result=$Result"
  Add-Content -LiteralPath (Join-Path $logDir "agent-restart.log") -Value $line -Encoding ASCII
}
# Close only the kiosk browser the watchdog launched (it alone carries the marker switch;
# an operator's own Edge or Chrome window never does). The watchdog in the user session
# relaunches it within seconds with a fresh boot ticket, so the screen also picks up a newly
# deployed page. Called only once the service is running again, because the relaunch needs
# the Agent for that ticket. A failure here never fails the restart.
function Stop-KioskBrowser {
  $kioskMarker = "--aijobprint-kiosk=1"
  try {
    $stopped = 0
    $candidates = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe' OR Name = 'chrome.exe'" -ErrorAction Stop)
    foreach ($candidate in $candidates) {
      $commandLine = [string]$candidate.CommandLine
      # Browser main process only; its renderer and utility children exit with it.
      if ($commandLine -like "*$kioskMarker*" -and $commandLine -notlike "*--type=*") {
        Stop-Process -Id $candidate.ProcessId -Force -ErrorAction Stop
        $stopped++
      }
    }
    Write-RestartStage "browser" "stopped=$stopped"
  } catch {
    Write-RestartStage "browser" "failed"
  }
}
try {
  $service = Get-Service -Name $ServiceName -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $marker)) {
    Set-Content -LiteralPath $marker -Value "stopping" -Encoding ASCII
    Write-RestartStage "stop" "requested"
    # ServiceController.Stop sends the request without waiting indefinitely.
    if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) { $service.Stop() }
  } else {
    Write-RestartStage "resume" "marker-present"
    $service.Refresh()
    if ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running) {
      Stop-KioskBrowser
      Remove-Item -LiteralPath $marker -Force
      Write-RestartStage "complete" "success"
      exit 0
    }
  }
  try {
    $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromMinutes(4))
    Write-RestartStage "stop" "stopped"
  } catch {
    Write-RestartStage "stop" "timeout"
    exit 1
  }
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      $service.Refresh()
      if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) { $service.Start() }
      $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(60))
      Write-RestartStage "start" "running"
      Stop-KioskBrowser
      Remove-Item -LiteralPath $marker -Force
      Write-RestartStage "complete" "success"
      exit 0
    } catch {
      Write-RestartStage "start" "failed"
      if ($attempt -lt 5) { Start-Sleep -Seconds 10 }
    }
  }
  exit 1
} catch {
  Write-RestartStage "controller" "failed"
  exit 1
}
