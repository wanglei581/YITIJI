[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PredecessorExePath,
  [Parameter(Mandatory = $true)][string]$CandidateExePath
)

$ErrorActionPreference = "Stop"
$PREDECESSOR_VERSION = "0.3.0"
$CANDIDATE_VERSION = "0.3.1"
$resolvedPredecessor = (Resolve-Path -LiteralPath $PredecessorExePath).Path
$resolvedCandidate = (Resolve-Path -LiteralPath $CandidateExePath).Path
$installRoot = Join-Path $env:ProgramFiles "AIJobPrintAgent"
$stateRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$nodePath = Join-Path $installRoot "node\node.exe"
$serviceName = "aijobprintagent.exe"
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
