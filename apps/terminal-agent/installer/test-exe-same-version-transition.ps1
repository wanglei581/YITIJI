[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PredecessorExePath,
  [Parameter(Mandatory = $true)][string]$PredecessorMsiPath,
  [Parameter(Mandatory = $true)][string]$PredecessorManifestPath,
  [Parameter(Mandatory = $true)][string]$CandidateExePath,
  [Parameter(Mandatory = $true)][string]$CandidateMsiPath,
  [Parameter(Mandatory = $true)][string]$CandidateManifestPath,
  [Parameter(Mandatory = $true)][string]$ExpectedPredecessorCommit,
  [Parameter(Mandatory = $true)][string]$ExpectedCandidateCommit,
  [string]$ProductVersion = "0.4.11",
  [switch]$InjectCandidateInstallFailure
)

$ErrorActionPreference = "Stop"
$resolvedPredecessor = (Resolve-Path -LiteralPath $PredecessorExePath).Path
$resolvedPredecessorMsi = (Resolve-Path -LiteralPath $PredecessorMsiPath).Path
$resolvedCandidate = (Resolve-Path -LiteralPath $CandidateExePath).Path
$resolvedCandidateMsi = (Resolve-Path -LiteralPath $CandidateMsiPath).Path
$resolvedPredecessorManifest = (Resolve-Path -LiteralPath $PredecessorManifestPath).Path
$resolvedCandidateManifest = (Resolve-Path -LiteralPath $CandidateManifestPath).Path
$predecessorManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedPredecessorManifest | ConvertFrom-Json
$candidateManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedCandidateManifest | ConvertFrom-Json
$installRoot = Join-Path $env:ProgramFiles "AIJobPrintAgent"
$installedManifestPath = Join-Path $installRoot "manifest.json"
$stateRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$serviceName = "aijobprintagent.exe"
$scanRoot = Join-Path $stateRoot "scan-inbox"
$configPath = Join-Path $stateRoot "agent-config.json"
$lastKnownGoodPath = Join-Path $stateRoot "agent-config.last-known-good.json"
$tokenPath = Join-Path $stateRoot "agent.token"
$databasePath = Join-Path $stateRoot "agent.db"
$scanFixturePath = Join-Path $scanRoot "same-version-transition-fixture.pdf"
$fixtureTokenPlaintext = "same-version-fixture-token"
$logRoot = Join-Path (Split-Path -Parent $resolvedCandidate) "same-version-lifecycle-logs"
$logPrefix = if ($InjectCandidateInstallFailure) { "failure-recovery" } else { "recovery-drill" }
$criticalPayloadPaths = @(
  "bootstrap/aijobprintagent.exe",
  "node/node.exe",
  "app/dist/index.js",
  "app/native/secure-scan-reader.exe"
)
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Invoke-Bundle([string]$ExePath, [string]$Action, [string]$LogName) {
  $logPath = Join-Path $logRoot $LogName
  $arguments = @($Action, "/quiet", "/norestart", "/log", ('"' + $logPath + '"'))
  $process = Start-Process -FilePath $ExePath -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) {
    throw "Burn bundle $Action failed with exit code $($process.ExitCode); see $logPath"
  }
}

function Get-PhaseLogName([string]$Name) {
  return "$logPrefix-$Name.log"
}

function Get-UninstallEntries([string]$DisplayName) {
  $uninstallRoots = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  return @(
    Get-ItemProperty -Path $uninstallRoots -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq $DisplayName } |
      Sort-Object PSPath -Unique
  )
}

function Get-MsiProductCode([string]$MsiPath) {
  $installer = New-Object -ComObject WindowsInstaller.Installer
  $database = $null
  $view = $null
  $record = $null
  try {
    $database = $installer.OpenDatabase($MsiPath, 0)
    $view = $database.OpenView("SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = 'ProductCode'")
    $view.Execute()
    $record = $view.Fetch()
    if ($null -eq $record) {
      throw "MSI ProductCode is missing: $MsiPath"
    }
    $productCode = ([string]$record.StringData(1)).Trim()
    if ($productCode -notmatch '^\{[0-9A-Fa-f-]{36}\}$') {
      throw "Invalid MSI ProductCode: $productCode"
    }
    return $productCode.ToUpperInvariant()
  } finally {
    if ($null -ne $view) { $view.Close() }
    foreach ($item in @($record, $view, $database, $installer)) {
      if ($null -ne $item -and [System.Runtime.InteropServices.Marshal]::IsComObject($item)) {
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
      }
    }
  }
}

function Assert-RegistrationCommand([object]$Entry, [ValidateSet("msi", "bundle")][string]$Kind) {
  $uninstallCommand = [string]$Entry.UninstallString
  $quietUninstallCommand = [string]$Entry.QuietUninstallString
  if ([string]::IsNullOrWhiteSpace($uninstallCommand)) {
    throw "$Kind registration is missing UninstallString"
  }
  if ($Kind -eq "msi") {
    if ($uninstallCommand -notmatch '(?i)msiexec(?:\.exe)?' -or $uninstallCommand -notmatch [regex]::Escape([string]$Entry.PSChildName)) {
      throw "MSI uninstall command is not bound to its ProductCode: $uninstallCommand"
    }
  } else {
    if ([string]$Entry.PSChildName -notmatch '^\{[0-9A-Fa-f-]{36}\}$') {
      throw "Burn registration key is not a bundle GUID: $($Entry.PSChildName)"
    }
    if ($uninstallCommand -notmatch '(?i)(?:^|\s)/uninstall(?:\s|$)') {
      throw "Burn uninstall command is missing /uninstall: $uninstallCommand"
    }
    $cachedExecutable = if ($uninstallCommand -match '^\s*"([^"]+\.exe)"') { $Matches[1] } else { ($uninstallCommand -split '\s+')[0].Trim('"') }
    if (-not (Test-Path -LiteralPath $cachedExecutable -PathType Leaf)) {
      throw "Burn cached executable is missing: $cachedExecutable"
    }
    if ([string]::IsNullOrWhiteSpace($quietUninstallCommand) -or $quietUninstallCommand -notmatch '(?i)(?:^|\s)/quiet(?:\s|$)') {
      throw "Burn registration is missing a quiet uninstall command"
    }
  }
}

function Assert-SingleRegistration([string]$DisplayName, [string]$ExpectedVersion) {
  $entries = @(Get-UninstallEntries -DisplayName $DisplayName)
  if ($entries.Count -ne 1) {
    throw "Expected one $DisplayName registration, found $($entries.Count)"
  }
  if ([string]$entries[0].DisplayVersion -ne $ExpectedVersion) {
    throw "$DisplayName version mismatch: expected=$ExpectedVersion actual=$($entries[0].DisplayVersion)"
  }
  return $entries[0]
}

function Assert-NoInstallRegistration {
  foreach ($displayName in @("AI Job Print Agent", "AI Job Print Terminal Setup")) {
    $count = @(Get-UninstallEntries -DisplayName $displayName).Count
    if ($count -ne 0) {
      throw "Expected no $displayName registration, found $count"
    }
  }
}

function Assert-StoppedManualService {
  $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  if ($null -eq $service -or $service.State -ne "Stopped" -or $service.StartMode -ne "Manual") {
    throw "Same-version transition must keep the unprovisioned Stopped/Manual service contract"
  }
}

function Assert-UninstalledPayload {
  if ($null -ne (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue)) {
    throw "Agent service remains after uninstall"
  }
  if (Test-Path -LiteralPath $installRoot) {
    throw "Program Files payload remains after uninstall"
  }
  Assert-NoInstallRegistration
}

function Assert-ManifestContract([object]$Manifest, [string]$ExpectedCommit, [string]$Label) {
  if ([string]$Manifest.productVersion -ne $ProductVersion) {
    throw "$Label manifest version mismatch: expected=$ProductVersion actual=$($Manifest.productVersion)"
  }
  if ([string]$Manifest.gitCommit -ine $ExpectedCommit) {
    throw "$Label manifest commit mismatch: expected=$ExpectedCommit actual=$($Manifest.gitCommit)"
  }
  foreach ($relativePath in $criticalPayloadPaths) {
    if ($null -eq @($Manifest.files | Where-Object { [string]$_.path -eq $relativePath })[0]) {
      throw "$Label manifest is missing critical payload: $relativePath"
    }
  }
}

function Assert-InstalledIdentity(
  [object]$ExpectedManifest,
  [string]$ExpectedCommit,
  [string]$ExpectedProductCode,
  [string]$Label
) {
  $productEntry = Assert-SingleRegistration -DisplayName "AI Job Print Agent" -ExpectedVersion $ProductVersion
  $bundleEntry = Assert-SingleRegistration -DisplayName "AI Job Print Terminal Setup" -ExpectedVersion $ProductVersion
  $registeredProductCode = ([string]$productEntry.PSChildName).Trim().ToUpperInvariant()
  if ($registeredProductCode -ine $ExpectedProductCode.Trim().ToUpperInvariant()) {
    throw "$Label MSI ProductCode mismatch: expected=$ExpectedProductCode actual=$($productEntry.PSChildName)"
  }
  Assert-RegistrationCommand -Entry $productEntry -Kind "msi"
  Assert-RegistrationCommand -Entry $bundleEntry -Kind "bundle"
  Assert-StoppedManualService

  if (-not (Test-Path -LiteralPath $installedManifestPath -PathType Leaf)) {
    throw "$Label installed manifest is missing"
  }
  $installedManifestHash = (Get-FileHash -LiteralPath $installedManifestPath -Algorithm SHA256).Hash
  $expectedManifestPath = if ($Label -eq "predecessor") {
    $resolvedPredecessorManifest
  } else {
    $resolvedCandidateManifest
  }
  $expectedManifestHash = (Get-FileHash -LiteralPath $expectedManifestPath -Algorithm SHA256).Hash
  if ($installedManifestHash -ne $expectedManifestHash) {
    throw "$Label installed manifest hash does not match the approved staging manifest"
  }

  $installedManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $installedManifestPath | ConvertFrom-Json
  if ([string]$installedManifest.gitCommit -ine $ExpectedCommit) {
    throw "$Label installed source commit mismatch: expected=$ExpectedCommit actual=$($installedManifest.gitCommit)"
  }
  if ([string]$installedManifest.productVersion -ne $ProductVersion) {
    throw "$Label installed version mismatch"
  }

  foreach ($record in @($ExpectedManifest.files)) {
    $relativePath = [string]$record.path
    $fullPath = Join-Path $installRoot $relativePath.Replace("/", "\")
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
      throw "$Label installed manifest payload is missing: $relativePath"
    }
    $item = Get-Item -LiteralPath $fullPath
    $actualHash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
    if ([long]$item.Length -ne [long]$record.size -or $actualHash -ne [string]$record.sha256) {
      throw "$Label installed manifest payload mismatch: $relativePath"
    }
  }
  return [ordered]@{
    productCode = [string]$productEntry.PSChildName
    bundleId = [string]$bundleEntry.PSChildName
    productUninstall = [string]$productEntry.UninstallString
    bundleUninstall = [string]$bundleEntry.UninstallString
  }
}

function Write-StateFixture {
  New-Item -ItemType Directory -Path $stateRoot, $scanRoot -Force | Out-Null
  $fixtureConfig = [ordered]@{
    apiBaseUrl = "https://fixture.invalid/api/v1"
    terminalCode = "SAME-VERSION-FIXTURE"
    terminalId = "t_same_version_fixture"
    printerName = "Fixture Printer"
    scanWatchFolder = $scanRoot
    agentVersion = "$ProductVersion-production"
    heartbeatIntervalMs = 30000
    claimIntervalMs = 5000
    localApiPort = 9527
    localApiAllowedOrigins = @("https://fixture.invalid")
    localApiBridgeToken = "fixture-bridge-token-not-a-real-secret"
  }
  [System.IO.File]::WriteAllText(
    $configPath,
    (($fixtureConfig | ConvertTo-Json -Depth 4) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
  Copy-Item -LiteralPath $configPath -Destination $lastKnownGoodPath

  Add-Type -AssemblyName System.Security
  $tokenBytes = [System.Text.Encoding]::UTF8.GetBytes($fixtureTokenPlaintext)
  $protectedToken = [System.Security.Cryptography.ProtectedData]::Protect(
    $tokenBytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  [System.IO.File]::WriteAllText(
    $tokenPath,
    [Convert]::ToBase64String($protectedToken),
    [System.Text.UTF8Encoding]::new($false)
  )

  Assert-InstalledDatabaseRuntime -Mode "create"
  [System.IO.File]::WriteAllBytes($scanFixturePath, [System.Text.Encoding]::ASCII.GetBytes("%PDF-same-version-fixture"))
}

function Assert-InstalledDatabaseRuntime([ValidateSet("create", "verify")][string]$Mode) {
  $nodePath = Join-Path $installRoot "node\node.exe"
  $databaseModulePath = Join-Path $installRoot "app\node_modules\better-sqlite3"
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "Installed Node runtime is missing during database $Mode"
  }
  if (-not (Test-Path -LiteralPath $databaseModulePath -PathType Container)) {
    throw "Installed better-sqlite3 runtime is missing during database $Mode"
  }

  $previousModule = $env:SAME_VERSION_DB_MODULE
  $previousPath = $env:SAME_VERSION_DB_PATH
  $env:SAME_VERSION_DB_MODULE = $databaseModulePath
  $env:SAME_VERSION_DB_PATH = $databasePath
  $databaseProbe = @'
const Database = require(process.env.SAME_VERSION_DB_MODULE)
const db = new Database(process.env.SAME_VERSION_DB_PATH)
const mode = process.argv[1]
if (mode === 'create') {
  db.exec('CREATE TABLE IF NOT EXISTS same_version_fixture (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.prepare('INSERT OR REPLACE INTO same_version_fixture (id, value) VALUES (?, ?)').run('marker', 'preserved')
}
const integrity = db.pragma('integrity_check', { simple: true })
const marker = db.prepare('SELECT value FROM same_version_fixture WHERE id = ?').get('marker')
db.close()
if (integrity !== 'ok' || marker?.value !== 'preserved') process.exit(23)
'@
  try {
    & $nodePath -e $databaseProbe $Mode
    if ($LASTEXITCODE -ne 0) {
      throw "Installed SQLite integrity or marker verification failed during $Mode (exit=$LASTEXITCODE)"
    }
  } finally {
    $env:SAME_VERSION_DB_MODULE = $previousModule
    $env:SAME_VERSION_DB_PATH = $previousPath
  }
}

function Assert-StateUsable([string]$Phase) {
  $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
  $lastKnownGood = Get-Content -Raw -Encoding UTF8 -LiteralPath $lastKnownGoodPath | ConvertFrom-Json
  if ([string]$config.terminalId -ne "t_same_version_fixture" -or [string]$lastKnownGood.terminalId -ne "t_same_version_fixture") {
    throw "Config or last-known-good is unusable during $Phase"
  }

  Add-Type -AssemblyName System.Security
  $protectedToken = [Convert]::FromBase64String((Get-Content -Raw -Encoding UTF8 -LiteralPath $tokenPath).Trim())
  $tokenBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $protectedToken,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  $tokenPlaintext = [System.Text.Encoding]::UTF8.GetString($tokenBytes)
  if ($tokenPlaintext -ne $fixtureTokenPlaintext) {
    throw "DPAPI LocalMachine token is unusable during $Phase"
  }

  Assert-InstalledDatabaseRuntime -Mode "verify"
}

function Get-StateFixtureSnapshot {
  $snapshot = [ordered]@{}
  foreach ($path in @($configPath, $lastKnownGoodPath, $tokenPath, $databasePath, $scanFixturePath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "State fixture is missing: $path"
    }
    $relativePath = $path.Substring($stateRoot.Length).TrimStart("\")
    $snapshot[$relativePath] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  }
  return $snapshot
}

function Assert-StateFixture([System.Collections.IDictionary]$Expected, [string]$Phase) {
  $actual = Get-StateFixtureSnapshot
  foreach ($relativePath in $Expected.Keys) {
    if ($actual[$relativePath] -ne $Expected[$relativePath]) {
      throw "ProgramData state changed during ${Phase}: $relativePath"
    }
  }
}

function Export-SanitizedStateEvidence([string]$Phase) {
  $registrations = @()
  foreach ($displayName in @("AI Job Print Agent", "AI Job Print Terminal Setup")) {
    foreach ($entry in @(Get-UninstallEntries -DisplayName $displayName)) {
      $registrations += [ordered]@{
        displayName = [string]$entry.DisplayName
        displayVersion = [string]$entry.DisplayVersion
        registrationId = [string]$entry.PSChildName
        uninstallCommandPresent = -not [string]::IsNullOrWhiteSpace([string]$entry.UninstallString)
        quietUninstallCommandPresent = -not [string]::IsNullOrWhiteSpace([string]$entry.QuietUninstallString)
      }
    }
  }
  $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
  $stateHashes = [ordered]@{}
  foreach ($path in @($configPath, $lastKnownGoodPath, $tokenPath, $databasePath, $scanFixturePath)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $relativePath = $path.Substring($stateRoot.Length).TrimStart("\")
      $stateHashes[$relativePath] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    }
  }
  $serviceEvidence = $null
  if ($null -ne $service) {
    $serviceEvidence = [ordered]@{
      state = [string]$service.State
      startMode = [string]$service.StartMode
    }
  }
  $evidence = [ordered]@{
    phase = $Phase
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    installedManifestPresent = Test-Path -LiteralPath $installedManifestPath -PathType Leaf
    service = $serviceEvidence
    registrations = $registrations
    stateHashes = $stateHashes
  }
  $safePhase = $Phase -replace '[^A-Za-z0-9_.-]', '-'
  [System.IO.File]::WriteAllText(
    (Join-Path $logRoot "$logPrefix-$safePhase-state.json"),
    (($evidence | ConvertTo-Json -Depth 6) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
}

Assert-ManifestContract -Manifest $predecessorManifest -ExpectedCommit $ExpectedPredecessorCommit -Label "predecessor"
Assert-ManifestContract -Manifest $candidateManifest -ExpectedCommit $ExpectedCandidateCommit -Label "candidate"
if ($ExpectedPredecessorCommit -ieq $ExpectedCandidateCommit) {
  throw "Predecessor and candidate commits must differ"
}
$expectedPredecessorProductCode = Get-MsiProductCode -MsiPath $resolvedPredecessorMsi
$expectedCandidateProductCode = Get-MsiProductCode -MsiPath $resolvedCandidateMsi
if ($expectedPredecessorProductCode -ieq $expectedCandidateProductCode) {
  throw "Same-version predecessor and candidate MSI ProductCodes must differ"
}

$installedBundle = $null
$ownsFixtureState = $false
$stateFixtureSnapshot = $null

try {
  if ($resolvedPredecessor -eq $resolvedCandidate) {
    throw "Predecessor and candidate bundles must be distinct files"
  }
  if (Test-Path -LiteralPath $installRoot) {
    throw "Same-version lifecycle requires an unused Program Files root: $installRoot"
  }
  if ($null -ne (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue)) {
    throw "Same-version lifecycle requires the Agent service to be absent"
  }
  Assert-NoInstallRegistration
  if (Test-Path -LiteralPath $stateRoot) {
    throw "Same-version lifecycle requires an unused ProgramData root: $stateRoot"
  }
  $ownsFixtureState = $true

  $installedBundle = "predecessor"
  Invoke-Bundle -ExePath $resolvedPredecessor -Action "/install" -LogName (Get-PhaseLogName "predecessor-install")
  $predecessorIdentity = Assert-InstalledIdentity `
    -ExpectedManifest $predecessorManifest `
    -ExpectedCommit $ExpectedPredecessorCommit `
    -ExpectedProductCode $expectedPredecessorProductCode `
    -Label "predecessor"

  Write-StateFixture
  $stateFixtureSnapshot = Get-StateFixtureSnapshot

  Invoke-Bundle -ExePath $resolvedPredecessor -Action "/uninstall" -LogName (Get-PhaseLogName "predecessor-uninstall")
  Assert-UninstalledPayload
  $installedBundle = $null
  Assert-StateFixture -Expected $stateFixtureSnapshot -Phase "predecessor uninstall"

  $candidatePhaseError = $null
  $candidateInstallAttempted = $false
  try {
    $candidateInstallPath = $resolvedCandidate
    if ($InjectCandidateInstallFailure) {
      $candidateInstallPath = Join-Path $logRoot "injected-invalid-candidate.exe"
      [System.IO.File]::WriteAllBytes($candidateInstallPath, [System.Text.Encoding]::ASCII.GetBytes("not-a-valid-windows-executable"))
    }
    $candidateInstallAttempted = $true
    $installedBundle = "candidate"
    Invoke-Bundle -ExePath $candidateInstallPath -Action "/install" -LogName (Get-PhaseLogName "candidate-install")
    if ($InjectCandidateInstallFailure) {
      throw "Injected candidate installation failure unexpectedly succeeded"
    }
    $candidateIdentity = Assert-InstalledIdentity `
      -ExpectedManifest $candidateManifest `
      -ExpectedCommit $ExpectedCandidateCommit `
      -ExpectedProductCode $expectedCandidateProductCode `
      -Label "candidate"
    if ($candidateIdentity.productCode -ieq $predecessorIdentity.productCode -or $candidateIdentity.bundleId -ieq $predecessorIdentity.bundleId) {
      throw "Candidate MSI and Burn registrations must be distinct from the predecessor"
    }
    Assert-StateFixture -Expected $stateFixtureSnapshot -Phase "candidate install"
    Assert-StateUsable -Phase "candidate install"
  } catch {
    $candidatePhaseError = $_.Exception.Message
  } finally {
    if ($InjectCandidateInstallFailure -and (Test-Path -LiteralPath $candidateInstallPath -PathType Leaf)) {
      Remove-Item -LiteralPath $candidateInstallPath -Force
    }
  }

  if ($null -ne $candidatePhaseError) {
    $recoveryError = $null
    try {
      if ($candidateInstallAttempted) {
        try {
          Invoke-Bundle -ExePath $resolvedCandidate -Action "/uninstall" -LogName (Get-PhaseLogName "candidate-failure-cleanup")
        } catch {
          Write-Warning "Candidate failure cleanup did not complete: $($_.Exception.Message)"
        }
      }
      Assert-UninstalledPayload
      $installedBundle = $null
      Assert-StateFixture -Expected $stateFixtureSnapshot -Phase "candidate install failure"

      $installedBundle = "predecessor"
      Invoke-Bundle -ExePath $resolvedPredecessor -Action "/install" -LogName (Get-PhaseLogName "predecessor-recovery-install")
      $recoveredIdentity = Assert-InstalledIdentity `
        -ExpectedManifest $predecessorManifest `
        -ExpectedCommit $ExpectedPredecessorCommit `
        -ExpectedProductCode $expectedPredecessorProductCode `
        -Label "predecessor"
      if ($recoveredIdentity.productCode -ine $predecessorIdentity.productCode -or $recoveredIdentity.bundleId -ine $predecessorIdentity.bundleId) {
        throw "Failure recovery did not restore the exact predecessor MSI and Burn identities"
      }
      Assert-StateFixture -Expected $stateFixtureSnapshot -Phase "predecessor failure recovery"
      Assert-StateUsable -Phase "predecessor failure recovery"
    } catch {
      $recoveryError = $_.Exception.Message
    }

    if ($null -ne $recoveryError) {
      throw "Candidate transition failed and predecessor recovery failed. originalError=$candidatePhaseError recoveryError=$recoveryError"
    }
    if (-not $InjectCandidateInstallFailure) {
      throw "Candidate transition failed; exact predecessor recovery succeeded. originalError=$candidatePhaseError"
    }
    Write-Host "EXE_SAME_VERSION_FAILURE_RECOVERY_PASS version=$ProductVersion predecessorCommit=$ExpectedPredecessorCommit candidateCommit=$ExpectedCandidateCommit automaticRollback=false explicitRecovery=true originalError=$candidatePhaseError"
    return
  }

  Invoke-Bundle -ExePath $resolvedCandidate -Action "/uninstall" -LogName (Get-PhaseLogName "candidate-uninstall")
  Assert-UninstalledPayload
  $installedBundle = $null
  Assert-StateFixture -Expected $stateFixtureSnapshot -Phase "candidate uninstall"

  $installedBundle = "predecessor"
  Invoke-Bundle -ExePath $resolvedPredecessor -Action "/install" -LogName (Get-PhaseLogName "predecessor-recovery-drill-install")
  $recoveryIdentity = Assert-InstalledIdentity `
    -ExpectedManifest $predecessorManifest `
    -ExpectedCommit $ExpectedPredecessorCommit `
    -ExpectedProductCode $expectedPredecessorProductCode `
    -Label "predecessor"
  if ($recoveryIdentity.productCode -ine $predecessorIdentity.productCode -or $recoveryIdentity.bundleId -ine $predecessorIdentity.bundleId) {
    throw "Recovery drill did not restore the exact predecessor MSI and Burn identities"
  }
  Assert-StateFixture -Expected $stateFixtureSnapshot -Phase "predecessor recovery drill"
  Assert-StateUsable -Phase "predecessor recovery drill"

  Invoke-Bundle -ExePath $resolvedPredecessor -Action "/uninstall" -LogName (Get-PhaseLogName "predecessor-recovery-drill-uninstall")
  Assert-UninstalledPayload
  $installedBundle = $null
  Assert-StateFixture -Expected $stateFixtureSnapshot -Phase "recovery drill uninstall"

  Write-Host "EXE_SAME_VERSION_RECOVERY_DRILL_PASS version=$ProductVersion from=$ExpectedPredecessorCommit to=$ExpectedCandidateCommit mode=explicit-uninstall-install-recovery predecessorProductCode=$($predecessorIdentity.productCode) predecessorBundleId=$($predecessorIdentity.bundleId) candidateProductCode=$($candidateIdentity.productCode) candidateBundleId=$($candidateIdentity.bundleId) automaticRollback=false stateRetained=true"
} finally {
  try {
    Export-SanitizedStateEvidence -Phase "before-final-cleanup"
  } catch {
    Write-Warning "Sanitized state evidence export failed: $($_.Exception.Message)"
  }
  if ($installedBundle -eq "candidate") {
    try {
      Invoke-Bundle -ExePath $resolvedCandidate -Action "/uninstall" -LogName (Get-PhaseLogName "cleanup-candidate")
    } catch {
      Write-Warning "Candidate cleanup failed: $($_.Exception.Message)"
    }
  } elseif ($installedBundle -eq "predecessor") {
    try {
      Invoke-Bundle -ExePath $resolvedPredecessor -Action "/uninstall" -LogName (Get-PhaseLogName "cleanup-predecessor")
    } catch {
      Write-Warning "Predecessor cleanup failed: $($_.Exception.Message)"
    }
  }
  if ($ownsFixtureState) {
    foreach ($fixturePath in @($configPath, $lastKnownGoodPath, $tokenPath, $databasePath, $scanFixturePath)) {
      if (Test-Path -LiteralPath $fixturePath -PathType Leaf) {
        Remove-Item -LiteralPath $fixturePath -Force
      }
    }
    if ((Test-Path -LiteralPath $scanRoot -PathType Container) -and @(Get-ChildItem -LiteralPath $scanRoot -Force).Count -eq 0) {
      Remove-Item -LiteralPath $scanRoot -Force
    }
  }
}
