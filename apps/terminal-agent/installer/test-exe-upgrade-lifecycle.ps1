[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PredecessorExePath,
  [Parameter(Mandatory = $true)][string]$CandidateExePath
)

$ErrorActionPreference = "Stop"
$PREDECESSOR_VERSION = "0.4.0"
$CANDIDATE_VERSION = "0.4.1"
$resolvedPredecessor = (Resolve-Path -LiteralPath $PredecessorExePath).Path
$resolvedCandidate = (Resolve-Path -LiteralPath $CandidateExePath).Path
$installRoot = Join-Path $env:ProgramFiles "AIJobPrintAgent"
$stateRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$nodePath = Join-Path $installRoot "node\node.exe"
$serviceName = "aijobprintagent.exe"
$programMenuRoot = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\AI Job Print Terminal"
$panelShortcutPath = Join-Path $programMenuRoot "AI Job Print Terminal.url"
$provisionShortcutName = -join ([char[]](0x8BBE, 0x5907, 0x7ED1, 0x5B9A, 0x5411, 0x5BFC))
$provisionShortcutPath = Join-Path $programMenuRoot ($provisionShortcutName + ".lnk")
$provisionLauncherPath = Join-Path $installRoot "provision\provision-terminal.cmd"
$sentinelPath = Join-Path $stateRoot "installer-upgrade-state-sentinel.json"
$logRoot = Join-Path (Split-Path -Parent $resolvedCandidate) "lifecycle-logs"
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

function Assert-ProvisioningShortcut {
  if (-not (Test-Path -LiteralPath $provisionShortcutPath -PathType Leaf)) {
    throw "$CANDIDATE_VERSION upgrade did not install the device provisioning Start Menu shortcut"
  }
  if (-not (Test-Path -LiteralPath $provisionLauncherPath -PathType Leaf)) {
    throw "$CANDIDATE_VERSION upgrade did not install the device provisioning launcher"
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($provisionShortcutPath)
  $shortcutTarget = [string]$shortcut.TargetPath
  if ([string]::IsNullOrWhiteSpace($shortcutTarget)) {
    $shellApplication = New-Object -ComObject Shell.Application
    $shortcutFolder = $shellApplication.Namespace($programMenuRoot)
    $shortcutItem = if ($null -eq $shortcutFolder) { $null } else { $shortcutFolder.ParseName((Split-Path -Leaf $provisionShortcutPath)) }
    if ($null -ne $shortcutItem) {
      $shortcutTarget = [string]$shortcutItem.ExtendedProperty("System.Link.TargetParsingPath")
    }
  }
  if ([string]::IsNullOrWhiteSpace($shortcutTarget)) {
    # WScript.Shell returns an empty TargetPath for some Windows Installer-created
    # links on hosted runners. If both Shell APIs decline to resolve it, verify the
    # persisted link payload instead of passing an empty value to GetFullPath.
    $shortcutBytes = [System.IO.File]::ReadAllBytes($provisionShortcutPath)
    $unicodePayload = [System.Text.Encoding]::Unicode.GetString($shortcutBytes)
    $ansiPayload = [System.Text.Encoding]::Default.GetString($shortcutBytes)
    if (-not $unicodePayload.Contains($provisionLauncherPath) -and -not $ansiPayload.Contains($provisionLauncherPath)) {
      throw "Device provisioning shortcut target is unreadable or missing"
    }
    return
  }
  if ([System.IO.Path]::GetFullPath($shortcutTarget) -ne [System.IO.Path]::GetFullPath($provisionLauncherPath)) {
    throw "Device provisioning shortcut target mismatch"
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

  Invoke-Bundle -ExePath $resolvedPredecessor -Action "/install" -LogName "upgrade-predecessor-install.log"
  $predecessorInstalled = $true
  Assert-AgentProductVersion -ExpectedVersion $PREDECESSOR_VERSION
  Assert-StoppedManualService
  Assert-PanelShortcut
  if (
    (Test-Path -LiteralPath $provisionShortcutPath) -or
    (Test-Path -LiteralPath $provisionLauncherPath)
  ) {
    throw "0.4.0 predecessor unexpectedly contains the 0.4.1 provisioning wizard"
  }

  New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
  [System.IO.File]::WriteAllText(
    $sentinelPath,
    $sentinel,
    [System.Text.UTF8Encoding]::new($false)
  )

  Invoke-Bundle -ExePath $resolvedCandidate -Action "/install" -LogName "upgrade-candidate-install.log"
  $candidateInstalled = $true
  Assert-AgentProductVersion -ExpectedVersion $CANDIDATE_VERSION
  Assert-StoppedManualService
  Assert-PanelShortcut
  Assert-ProvisioningShortcut
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
  Invoke-Bundle -ExePath $resolvedCandidate -Action "/repair" -LogName "upgrade-candidate-repair.log"
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "Candidate repair did not restore the managed Node runtime after upgrade"
  }

  Invoke-Bundle -ExePath $resolvedCandidate -Action "/uninstall" -LogName "upgrade-candidate-uninstall.log"
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
  if (Test-Path -LiteralPath $provisionShortcutPath) {
    throw "Device provisioning Start Menu shortcut remains after upgraded candidate uninstall"
  }

  Write-Host "EXE_UPGRADE_LIFECYCLE_PASS from=$PREDECESSOR_VERSION to=$CANDIDATE_VERSION stateRetained=true"
} finally {
  if ($candidateInstalled) {
    try {
      Invoke-Bundle -ExePath $resolvedCandidate -Action "/uninstall" -LogName "upgrade-cleanup-candidate.log"
    } catch {
      Write-Warning "Candidate cleanup failed: $($_.Exception.Message)"
    }
  }
  if ($predecessorInstalled -and -not $upgradeCompleted) {
    try {
      Invoke-Bundle -ExePath $resolvedPredecessor -Action "/uninstall" -LogName "upgrade-cleanup-predecessor.log"
    } catch {
      Write-Warning "Predecessor cleanup failed: $($_.Exception.Message)"
    }
  }
  if (Test-Path -LiteralPath $sentinelPath -PathType Leaf) {
    Remove-Item -LiteralPath $sentinelPath -Force
  }
}
