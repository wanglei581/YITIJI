[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$ExePath)

$ErrorActionPreference = "Stop"
$resolvedExe = (Resolve-Path -LiteralPath $ExePath).Path
$installRoot = Join-Path $env:ProgramFiles "AIJobPrintAgent"
$stateRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$nodePath = Join-Path $installRoot "node\node.exe"
$serviceName = "aijobprintagent.exe"
$updateHelperPath = Join-Path $installRoot "provision\terminal-update-helper.ps1"
$logRoot = Join-Path (Split-Path -Parent $resolvedExe) "lifecycle-logs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Invoke-Bundle([string]$Action, [string]$LogName) {
  $logPath = Join-Path $logRoot $LogName
  $arguments = @($Action, "/quiet", "/norestart", "/log", ('"' + $logPath + '"'))
  $process = Start-Process -FilePath $resolvedExe -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) {
    throw "Burn bundle $Action failed with exit code $($process.ExitCode); see $logPath"
  }
}

function Assert-StoppedManualService {
  $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  if ($null -eq $service -or $service.State -ne "Stopped" -or $service.StartMode -ne "Manual") {
    throw "Bundle must preserve the unprovisioned Stopped/Manual service contract"
  }
}

$installAttempted = $false
$uninstallCompleted = $false
try {
  if (Test-Path -LiteralPath $installRoot) {
    throw "EXE lifecycle test requires an unused runner: $installRoot already exists"
  }
  if (Test-Path -LiteralPath $stateRoot) {
    throw "EXE lifecycle test must run before another installer creates: $stateRoot"
  }

  $installAttempted = $true
  Invoke-Bundle -Action "/install" -LogName "install.log"
  Assert-StoppedManualService
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "Bundled Node runtime is missing after EXE install"
  }
  if (-not (Test-Path -LiteralPath $updateHelperPath -PathType Leaf)) {
    throw "Online update helper is missing after EXE install"
  }
  if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
    throw "ProgramData state directory is missing after EXE install"
  }

  Remove-Item -LiteralPath $nodePath -Force
  if (Test-Path -LiteralPath $nodePath) {
    throw "Failed to remove the repair probe payload"
  }
  Invoke-Bundle -Action "/repair" -LogName "repair.log"
  Assert-StoppedManualService
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "EXE repair did not restore the managed Node runtime"
  }

  Invoke-Bundle -Action "/uninstall" -LogName "uninstall.log"
  $uninstallCompleted = $true
  if ($null -ne (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue)) {
    throw "Service still exists after EXE uninstall"
  }
  if (Test-Path -LiteralPath $installRoot) {
    throw "Program Files payload still exists after EXE uninstall"
  }
  if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
    throw "ProgramData state directory must be retained after EXE uninstall"
  }

  Write-Host "EXE_LIFECYCLE_PASS service=$serviceName repairRestored=true stateRetained=true"
} finally {
  if ($installAttempted -and -not $uninstallCompleted) {
    try {
      Invoke-Bundle -Action "/uninstall" -LogName "cleanup-uninstall.log"
    } catch {
      Write-Warning "EXE lifecycle cleanup failed: $($_.Exception.Message)"
    }
  }
}
