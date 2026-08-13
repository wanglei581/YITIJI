[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PredecessorExePath,
  [Parameter(Mandatory = $true)][string]$CandidateExePath,
  [ValidatePattern("^\d+\.\d+\.\d+$")][string]$ExpectedPredecessorVersion = "0.4.7",
  [ValidatePattern("^\d+\.\d+\.\d+$")][string]$ExpectedCandidateVersion = "0.4.8"
)

$ErrorActionPreference = "Stop"
$PREDECESSOR_VERSION = $ExpectedPredecessorVersion
$CANDIDATE_VERSION = $ExpectedCandidateVersion
$resolvedPredecessor = (Resolve-Path -LiteralPath $PredecessorExePath).Path
$resolvedCandidate = (Resolve-Path -LiteralPath $CandidateExePath).Path
$installRoot = Join-Path $env:ProgramFiles "AIJobPrintAgent"
$stateRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$nodePath = Join-Path $installRoot "node\node.exe"
$serviceName = "aijobprintagent.exe"
$programMenuRoot = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\AI Job Print Terminal"
$panelShortcutPath = Join-Path $programMenuRoot "AI Job Print Terminal.url"
$desktopShortcutName = -join ([char[]](0x0041, 0x0049, 0x0020, 0x6C42, 0x804C, 0x6253, 0x5370, 0x670D, 0x52A1, 0x7EC8, 0x7AEF))
$desktopShortcutPath = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) ($desktopShortcutName + ".lnk")
$controlCenterShortcutName = -join ([char[]](0x7EC8, 0x7AEF, 0x63A7, 0x5236, 0x4E2D, 0x5FC3))
$controlCenterShortcutPath = Join-Path $programMenuRoot ($controlCenterShortcutName + ".lnk")
$controlCenterScriptPath = Join-Path $installRoot "provision\terminal-control-center.ps1"
$controlCenterLauncherPath = Join-Path $installRoot "provision\launch-control-center.vbs"
$updateHelperPath = Join-Path $installRoot "provision\terminal-update-helper.ps1"
$sentinelPath = Join-Path $stateRoot "installer-upgrade-state-sentinel.json"
$logRoot = Join-Path (Split-Path -Parent $resolvedCandidate) "lifecycle-logs"
$logPrefix = "upgrade-" + ($PREDECESSOR_VERSION -replace "\.", "-") + "-to-" + ($CANDIDATE_VERSION -replace "\.", "-")
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Invoke-Bundle([string]$ExePath, [string]$Action, [string]$LogName) {
  $logPath = Join-Path $logRoot $LogName
  $arguments = @($Action, "/quiet", "/norestart", "/log", ('"' + $logPath + '"'))
  $process = Start-Process -FilePath $ExePath -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) {
    throw "Burn bundle $Action failed with exit code $($process.ExitCode); see $logPath"
  }
}

function Get-AgentProductEntries {
  $uninstallRoots = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  return @(
    Get-ItemProperty -Path $uninstallRoots -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq "AI Job Print Agent" }
  )
}

function Assert-AgentProductVersion([string]$ExpectedVersion) {
  $entries = @(Get-AgentProductEntries)
  if ($entries.Count -ne 1) {
    throw "Expected exactly one installed AI Job Print Agent product, found $($entries.Count)"
  }
  if ([string]$entries[0].DisplayVersion -ne $ExpectedVersion) {
    throw "Installed Agent version mismatch: expected=$ExpectedVersion actual=$($entries[0].DisplayVersion)"
  }
}

function Assert-StoppedManualService {
  $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  if ($null -eq $service -or $service.State -ne "Stopped" -or $service.StartMode -ne "Manual") {
    throw "Upgrade must preserve the unprovisioned Stopped/Manual service contract"
  }
}

function Assert-PanelShortcut {
  if (-not (Test-Path -LiteralPath $panelShortcutPath -PathType Leaf)) {
    throw "$CANDIDATE_VERSION upgrade did not preserve the local status panel Start Menu shortcut"
  }
  $shortcut = Get-Content -Raw -Encoding ASCII -LiteralPath $panelShortcutPath
  if ($shortcut -notmatch "(?m)^URL=http://127\.0\.0\.1:9527/local/panel\r?$") {
    throw "Upgraded local status panel shortcut does not use the fixed loopback URL"
  }
}

function Assert-DesktopShortcut([bool]$RequireUpdateHelper = $false) {
  if (-not (Test-Path -LiteralPath $desktopShortcutPath -PathType Leaf)) {
    throw "$CANDIDATE_VERSION upgrade did not install the terminal control center desktop shortcut"
  }
  if (-not (Test-Path -LiteralPath $controlCenterScriptPath -PathType Leaf) -or -not (Test-Path -LiteralPath $controlCenterLauncherPath -PathType Leaf)) {
    throw "$CANDIDATE_VERSION upgrade did not install the terminal control center payload"
  }
  if ($RequireUpdateHelper -and -not (Test-Path -LiteralPath $updateHelperPath -PathType Leaf)) {
    throw "$CANDIDATE_VERSION upgrade did not install the online update helper"
  }
  if (-not (Test-Path -LiteralPath $controlCenterShortcutPath -PathType Leaf)) {
    throw "$CANDIDATE_VERSION upgrade did not install the terminal control center Start Menu shortcut"
  }
}

function Assert-ControlCenterSmoke([string]$ExpectedVersion) {
  $outputPath = Join-Path $logRoot ($logPrefix + "-control-center-" + ($ExpectedVersion -replace "\.", "-") + "-smoke.json")
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $controlCenterScriptPath -SmokeTest -SmokeTestOutput $outputPath
  if ($LASTEXITCODE -ne 0) { throw "Upgraded terminal control center smoke test failed" }
  $snapshot = Get-Content -Raw -Encoding UTF8 -LiteralPath $outputPath | ConvertFrom-Json
  if (-not [bool]$snapshot.installed -or [string]$snapshot.version -ne $ExpectedVersion) {
    throw "Upgraded terminal control center smoke snapshot is invalid"
  }
}

$predecessorInstalled = $false
$candidateInstalled = $false
$upgradeCompleted = $false
$sentinel = '{"purpose":"installer-upgrade-state-retention","containsPii":false}'

try {
  if ($resolvedPredecessor -eq $resolvedCandidate) {
    throw "Predecessor and candidate bundles must be distinct files"
  }
  if (Test-Path -LiteralPath $installRoot) {
    throw "EXE upgrade lifecycle requires an unused Program Files root: $installRoot"
  }
  if ($null -ne (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue)) {
    throw "EXE upgrade lifecycle requires the Agent service to be absent"
  }
  if (@(Get-AgentProductEntries).Count -ne 0) {
    throw "EXE upgrade lifecycle requires the Agent MSI product to be absent"
  }

  Invoke-Bundle -ExePath $resolvedPredecessor -Action "/install" -LogName ($logPrefix + "-predecessor-install.log")
  $predecessorInstalled = $true
  Assert-AgentProductVersion -ExpectedVersion $PREDECESSOR_VERSION
  Assert-StoppedManualService
  Assert-PanelShortcut
  Assert-DesktopShortcut -RequireUpdateHelper $false
  Assert-ControlCenterSmoke -ExpectedVersion $PREDECESSOR_VERSION

  New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
  [System.IO.File]::WriteAllText(
    $sentinelPath,
    $sentinel,
    [System.Text.UTF8Encoding]::new($false)
  )

  Invoke-Bundle -ExePath $resolvedCandidate -Action "/install" -LogName ($logPrefix + "-candidate-install.log")
  $candidateInstalled = $true
  Assert-AgentProductVersion -ExpectedVersion $CANDIDATE_VERSION
  Assert-StoppedManualService
  Assert-PanelShortcut
  Assert-DesktopShortcut -RequireUpdateHelper $true
  Assert-ControlCenterSmoke -ExpectedVersion $CANDIDATE_VERSION
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "Bundled Node runtime is missing after upgrade"
  }
  if (-not (Test-Path -LiteralPath $sentinelPath -PathType Leaf)) {
    throw "ProgramData sentinel was not preserved through upgrade"
  }
  if ((Get-Content -Raw -Encoding UTF8 -LiteralPath $sentinelPath) -ne $sentinel) {
    throw "ProgramData sentinel changed during upgrade"
  }
  $upgradeCompleted = $true

  Remove-Item -LiteralPath $nodePath -Force
  Invoke-Bundle -ExePath $resolvedCandidate -Action "/repair" -LogName ($logPrefix + "-candidate-repair.log")
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "Candidate repair did not restore the managed Node runtime after upgrade"
  }
  Assert-DesktopShortcut -RequireUpdateHelper $true
  Assert-ControlCenterSmoke -ExpectedVersion $CANDIDATE_VERSION

  Invoke-Bundle -ExePath $resolvedCandidate -Action "/uninstall" -LogName ($logPrefix + "-candidate-uninstall.log")
  $candidateInstalled = $false
  $predecessorInstalled = $false
  if ($null -ne (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue)) {
    throw "Service still exists after upgraded candidate uninstall"
  }
  if (Test-Path -LiteralPath $installRoot) {
    throw "Program Files payload still exists after upgraded candidate uninstall"
  }
  if (-not (Test-Path -LiteralPath $sentinelPath -PathType Leaf)) {
    throw "ProgramData sentinel was not retained after upgraded candidate uninstall"
  }
  if (Test-Path -LiteralPath $panelShortcutPath) {
    throw "Local status panel Start Menu shortcut remains after upgraded candidate uninstall"
  }
  if (Test-Path -LiteralPath $desktopShortcutPath) {
    throw "Terminal control center desktop shortcut remains after upgraded candidate uninstall"
  }
  if (Test-Path -LiteralPath $controlCenterShortcutPath) {
    throw "Terminal control center Start Menu shortcut remains after upgraded candidate uninstall"
  }

  Write-Host "EXE_UPGRADE_LIFECYCLE_PASS from=$PREDECESSOR_VERSION to=$CANDIDATE_VERSION stateRetained=true"
} finally {
  if ($candidateInstalled) {
    try {
      Invoke-Bundle -ExePath $resolvedCandidate -Action "/uninstall" -LogName ($logPrefix + "-cleanup-candidate.log")
    } catch {
      Write-Warning "Candidate cleanup failed: $($_.Exception.Message)"
    }
  }
  if ($predecessorInstalled -and -not $upgradeCompleted) {
    try {
      Invoke-Bundle -ExePath $resolvedPredecessor -Action "/uninstall" -LogName ($logPrefix + "-cleanup-predecessor.log")
    } catch {
      Write-Warning "Predecessor cleanup failed: $($_.Exception.Message)"
    }
  }
  if (Test-Path -LiteralPath $sentinelPath -PathType Leaf) {
    Remove-Item -LiteralPath $sentinelPath -Force
  }
}
