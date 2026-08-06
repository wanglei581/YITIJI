[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PreviousExePath,
  [Parameter(Mandatory = $true)][string]$CurrentExePath
)

$ErrorActionPreference = "Stop"
$previousExe = (Resolve-Path -LiteralPath $PreviousExePath).Path
$currentExe = (Resolve-Path -LiteralPath $CurrentExePath).Path
$installRoot = Join-Path $env:ProgramFiles "AIJobPrintAgent"
$stateRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$serviceName = "aijobprintagent.exe"
$provisionerGuiPath = Join-Path $installRoot "provisioner\provision-agent-gui.ps1"
$shortcutPath = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\AI求职打印终端\AI求职打印终端配置.lnk"
$canaryPath = Join-Path $stateRoot "upgrade-state-canary.txt"
$stateRegistryPath = "HKLM:\Software\AIJobPrint\Agent"
$logRoot = Join-Path (Split-Path -Parent $currentExe) "upgrade-logs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Invoke-Bundle([string]$BundlePath, [string]$Action, [string]$LogName) {
  $logPath = Join-Path $logRoot $LogName
  $arguments = @($Action, "/quiet", "/norestart", "/log", ('"' + $logPath + '"'))
  $process = Start-Process -FilePath $BundlePath -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) {
    throw "Burn bundle $Action failed with exit code $($process.ExitCode); see $logPath"
  }
}

function Get-AgentService {
  return Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
}

$installAttempted = $false
try {
  if (Test-Path -LiteralPath $installRoot) {
    throw "Upgrade test requires an unused runner: $installRoot already exists"
  }
  if (Test-Path -LiteralPath $stateRoot) {
    throw "Upgrade test requires a clean state root: $stateRoot already exists"
  }

  $installAttempted = $true
  Invoke-Bundle -BundlePath $previousExe -Action "/install" -LogName "install-0.3.1.log"
  $service = Get-AgentService
  if ($null -eq $service -or $service.State -ne "Stopped" -or $service.StartMode -ne "Manual") {
    throw "The 0.3.1 baseline did not install as Stopped/Manual"
  }
  if (-not (Test-Path -LiteralPath $provisionerGuiPath -PathType Leaf)) {
    throw "The 0.3.1 baseline Provisioner GUI is missing"
  }
  if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
    throw "The 0.3.1 baseline Start menu shortcut is missing"
  }

  [System.IO.File]::WriteAllText($canaryPath, "retain-across-upgrade", [System.Text.UTF8Encoding]::new($false))

  Invoke-Bundle -BundlePath $currentExe -Action "/install" -LogName "upgrade-to-0.3.2.log"
  $service = Get-AgentService
  if ($null -eq $service) { throw "Service is missing after the 0.3.1 to 0.3.2 upgrade" }
  if ($service.State -ne "Stopped" -or $service.StartMode -ne "Manual") {
    throw "An unprovisioned upgrade must remain Stopped/Manual until the GUI succeeds"
  }
  if ((Get-Content -Raw -LiteralPath $canaryPath) -ne "retain-across-upgrade") {
    throw "ProgramData state was not retained across the 0.3.1 to 0.3.2 upgrade"
  }
  if (-not (Test-Path -LiteralPath $provisionerGuiPath -PathType Leaf)) {
    throw "The 0.3.2 Provisioner GUI is missing after upgrade"
  }
  if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
    throw "The 0.3.2 Start menu shortcut is missing after upgrade"
  }

  Invoke-Bundle -BundlePath $currentExe -Action "/repair" -LogName "repair-0.3.2.log"
  $service = Get-AgentService
  if ($null -eq $service -or $service.State -ne "Stopped" -or $service.StartMode -ne "Manual") {
    throw "Repair must retain the unprovisioned Stopped/Manual contract"
  }
  if ((Get-Content -Raw -LiteralPath $canaryPath) -ne "retain-across-upgrade") {
    throw "ProgramData state was not retained across repair"
  }

  Write-Host "EXE_UPGRADE_PASS from=0.3.1 to=0.3.2 unprovisionedSafe=true stateRetained=true provisionerRetained=true"
} finally {
  if ($installAttempted) {
    try {
      Invoke-Bundle -BundlePath $currentExe -Action "/uninstall" -LogName "cleanup-uninstall.log"
    } catch {
      Write-Warning "Upgrade test bundle cleanup failed: $($_.Exception.Message)"
    }
    if ($null -eq (Get-AgentService) -and (Test-Path -LiteralPath $stateRoot)) {
      Remove-Item -LiteralPath $stateRoot -Recurse -Force
    }
    if ($null -eq (Get-AgentService) -and (Test-Path -LiteralPath $stateRegistryPath)) {
      Remove-ItemProperty -LiteralPath $stateRegistryPath -Name "StateDirectoryCreated" -Force -ErrorAction SilentlyContinue
    }
  }
}
