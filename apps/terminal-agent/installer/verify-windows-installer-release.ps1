[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })][string]$ReleaseRoot,
  [Parameter(Mandatory)][ValidatePattern("^[0-9A-Fa-f]{40}$")][string]$ExpectedSourceCommit,
  [Parameter(Mandatory)][ValidatePattern("^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")][string]$ExpectedProductVersion,
  [Parameter(Mandatory)][ValidatePattern("^[0-9A-Fa-f]{40}$")][string]$ExpectedSignerThumbprint,
  [Parameter(Mandatory)][ValidateSet("InternalTest", "Release")][string]$ExpectedSigningMode,
  [switch]$RequireTimestamp,
  [switch]$AllowIncompleteMarker,
  [string]$SignToolPath,
  [string]$WixToolPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "signing-tools.ps1")

$resolvedRoot = (Resolve-Path -LiteralPath $ReleaseRoot).Path
$incompleteMarker = Join-Path $resolvedRoot "SIGNING-INCOMPLETE.txt"
if (-not $AllowIncompleteMarker -and (Test-Path -LiteralPath $incompleteMarker -PathType Leaf)) {
  Fail-SigningTool "Signed release directory is marked incomplete."
}
$signedMsi = Join-Path $resolvedRoot "AIJobPrintAgent.msi"
$signedExe = Join-Path $resolvedRoot "AIJobPrintTerminalSetup.exe"
$stagingManifest = Join-Path $resolvedRoot "staging-manifest.json"
$unsignedIdentityPath = Join-Path $resolvedRoot "unsigned-candidate-identity.json"
$releaseIdentityPath = Join-Path $resolvedRoot "signed-release-identity.json"
$releaseIdentitySignaturePath = Join-Path $resolvedRoot "signed-release-identity.p7s"
foreach ($path in @($signedMsi, $signedExe, $stagingManifest, $unsignedIdentityPath, $releaseIdentityPath, $releaseIdentitySignaturePath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    Fail-SigningTool "Signed release file is missing: '$path'."
  }
}

$normalizedSigner = $ExpectedSignerThumbprint.ToUpperInvariant()
$identity = Get-Content -Raw -Encoding UTF8 -LiteralPath $releaseIdentityPath | ConvertFrom-Json
if ([int]$identity.schemaVersion -ne 1) {
  Fail-SigningTool "Unsupported signed release identity schema '$($identity.schemaVersion)'."
}
if ([string]$identity.sourceCommit -ine $ExpectedSourceCommit) {
  Fail-SigningTool "Signed release source commit mismatch."
}
if ([string]$identity.productVersion -ne $ExpectedProductVersion) {
  Fail-SigningTool "Signed release product version mismatch."
}
if ([string]$identity.signingMode -notin @("InternalTest", "Release")) {
  Fail-SigningTool "Signed release contains an unsupported signing mode '$($identity.signingMode)'."
}
if (-not [string]::IsNullOrWhiteSpace($ExpectedSigningMode) -and [string]$identity.signingMode -ne $ExpectedSigningMode) {
  Fail-SigningTool "Signed release mode mismatch: expected $ExpectedSigningMode, got $($identity.signingMode)."
}
if ([string]$identity.signer.thumbprint -ine $normalizedSigner) {
  Fail-SigningTool "Signed release signer thumbprint mismatch."
}

$unsignedIdentityHash = (Get-FileHash -LiteralPath $unsignedIdentityPath -Algorithm SHA256).Hash.ToUpperInvariant()
if ([string]$identity.unsignedCandidate.identitySha256 -ine $unsignedIdentityHash) {
  Fail-SigningTool "Unsigned candidate identity hash does not match the signed release chain."
}
$unsignedIdentity = Get-Content -Raw -Encoding UTF8 -LiteralPath $unsignedIdentityPath | ConvertFrom-Json
if ([string]$unsignedIdentity.sourceCommit -ine $ExpectedSourceCommit -or [string]$unsignedIdentity.productVersion -ne $ExpectedProductVersion) {
  Fail-SigningTool "Unsigned candidate identity does not match the expected source commit and product version."
}
$unsignedFiles = @($unsignedIdentity.files)
$recordedUnsignedFiles = @($identity.unsignedCandidate.files)
if ($unsignedFiles.Count -ne 3 -or $recordedUnsignedFiles.Count -ne $unsignedFiles.Count) {
  Fail-SigningTool "Unsigned candidate provenance must contain exactly three frozen file records."
}
foreach ($unsignedFile in $unsignedFiles) {
  $matches = @($recordedUnsignedFiles | Where-Object { [string]$_.path -ceq [string]$unsignedFile.path })
  if ($matches.Count -ne 1 -or [long]$matches[0].bytes -ne [long]$unsignedFile.bytes -or [string]$matches[0].sha256 -ine [string]$unsignedFile.sha256) {
    Fail-SigningTool "Signed release does not reproduce the frozen unsigned record for '$($unsignedFile.path)'."
  }
}
$unsignedStagingRecord = @($unsignedFiles | Where-Object { [string]$_.path -ceq "staging-manifest.json" })
if ($unsignedStagingRecord.Count -ne 1) {
  Fail-SigningTool "Unsigned candidate identity must contain one staging-manifest.json record."
}
$stagingHash = (Get-FileHash -LiteralPath $stagingManifest -Algorithm SHA256).Hash.ToUpperInvariant()
if ([string]$unsignedStagingRecord[0].sha256 -ine $stagingHash) {
  Fail-SigningTool "Copied staging manifest does not match the frozen unsigned candidate identity."
}

Add-Type -AssemblyName System.Security
$identityBytes = [System.IO.File]::ReadAllBytes($releaseIdentityPath)
$signedCms = [System.Security.Cryptography.Pkcs.SignedCms]::new(
  [System.Security.Cryptography.Pkcs.ContentInfo]::new($identityBytes),
  $true
)
$signedCms.Decode([System.IO.File]::ReadAllBytes($releaseIdentitySignaturePath))
try {
  $signedCms.CheckSignature($true)
} catch {
  Fail-SigningTool "Detached signed-release identity signature is invalid: $($_.Exception.Message)"
}
if ($signedCms.SignerInfos.Count -ne 1) {
  Fail-SigningTool "Signed release identity must have exactly one CMS signer."
}
$cmsCertificate = $signedCms.SignerInfos[0].Certificate
if ($null -eq $cmsCertificate -or $cmsCertificate.Thumbprint -ine $normalizedSigner) {
  Fail-SigningTool "Signed release identity CMS signer mismatch."
}
$expectedEligibility = if ([string]$identity.signingMode -eq "InternalTest") {
  "not-for-production-or-fleet-deployment"
} else {
  "requires-separate-release-approval-public-or-enterprise-trust-and-operational-evidence"
}
if ([string]$identity.deploymentEligibility -cne $expectedEligibility) {
  Fail-SigningTool "Signed release deployment eligibility is invalid for mode '$($identity.signingMode)'."
}
if ([string]$identity.build.checkoutHead -ine $ExpectedSourceCommit -or -not [bool]$identity.build.checkoutClean) {
  Fail-SigningTool "Signed release build provenance is not bound to a clean exact source checkout."
}
if ([string]::IsNullOrWhiteSpace([string]$identity.build.wixCli.version) -or [string]::IsNullOrWhiteSpace([string]$identity.build.signTool.version)) {
  Fail-SigningTool "Signed release build provenance is missing WiX or signtool version evidence."
}
if ([string]$identity.signingMode -eq "Release" -and -not [bool]$identity.timestamp.required) {
  Fail-SigningTool "Release mode provenance must require a trusted timestamp."
}

$outputPaths = @{
  "AIJobPrintAgent.msi" = $signedMsi
  "AIJobPrintTerminalSetup.exe" = $signedExe
  "staging-manifest.json" = $stagingManifest
}
$recordedOutputs = @($identity.outputs)
if ($recordedOutputs.Count -ne $outputPaths.Count) {
  Fail-SigningTool "Signed release identity must contain exactly $($outputPaths.Count) output records."
}
foreach ($name in $outputPaths.Keys) {
  $records = @($recordedOutputs | Where-Object { [string]$_.name -ceq $name })
  if ($records.Count -ne 1) {
    Fail-SigningTool "Signed release identity must contain exactly one output record for '$name'."
  }
  $actual = Get-FileRecord -Path $outputPaths[$name] -Name $name
  if ([long]$records[0].bytes -ne [long]$actual.bytes -or [string]$records[0].sha256 -ine [string]$actual.sha256) {
    Fail-SigningTool "Signed release output hash or size mismatch for '$name'."
  }
}

$signTool = Resolve-SignTool $SignToolPath
$wixTool = Resolve-WixTool $WixToolPath
$timestampRequired = $RequireTimestamp.IsPresent -or [string]$identity.signingMode -eq "Release" -or [bool]$identity.timestamp.required
$msiSignature = Assert-ValidAuthenticode -SignToolPath $signTool -Path $signedMsi -ExpectedThumbprint $normalizedSigner -RequireTimestamp:$timestampRequired
$exeSignature = Assert-ValidAuthenticode -SignToolPath $signTool -Path $signedExe -ExpectedThumbprint $normalizedSigner -RequireTimestamp:$timestampRequired

$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-job-print-signing-verify-" + [guid]::NewGuid().ToString("N"))
$extractRoot = Join-Path $workRoot "bundle-extract"
$baExtractRoot = Join-Path $workRoot "bundle-ba-extract"
$enginePath = Join-Path $workRoot "bundle-engine.exe"
$intermediateRoot = Join-Path $workRoot "wix-intermediate"
try {
  New-Item -ItemType Directory -Path $extractRoot, $baExtractRoot, $intermediateRoot -Force | Out-Null
  # WiX 4.0.6 names attached payloads only when this same extract also passes -oba.
  Invoke-CheckedCommand -FilePath $wixTool -Arguments @(
    "burn", "extract", $signedExe, "-o", $extractRoot, "-oba", $baExtractRoot, "-intermediateFolder", $intermediateRoot
  ) -FailureMessage "WiX failed to extract the final signed bundle."
  $embeddedMsiHash = Assert-ExtractedBundleMsiHash -ExtractRoot $extractRoot -SignedMsiPath $signedMsi -BundleKind "final signed bundle"
  if ([string]$identity.embeddedMsi.sha256 -ine $embeddedMsiHash -or -not [bool]$identity.embeddedMsi.matchesSignedMsi) {
    Fail-SigningTool "The final bundle does not contain the signed MSI byte-for-byte."
  }

  Invoke-CheckedCommand -FilePath $wixTool -Arguments @(
    "burn", "detach", $signedExe, "-engine", $enginePath, "-intermediateFolder", $intermediateRoot
  ) -FailureMessage "WiX failed to detach the final bundle engine for verification."
  # Match Burn's CopyEngineWithSignatureFixup. Offset 0 is left unchanged and stays NotSigned.
  Restore-DetachedBurnEngineSignature -Path $enginePath
  $engineSignature = Assert-ValidAuthenticode -SignToolPath $signTool -Path $enginePath -ExpectedThumbprint $normalizedSigner -RequireTimestamp:$timestampRequired
  $engineHash = (Get-FileHash -LiteralPath $enginePath -Algorithm SHA256).Hash.ToUpperInvariant()
  if ([string]$identity.embeddedEngine.sha256 -ine $engineHash -or [string]$identity.embeddedEngine.signerThumbprint -ine $normalizedSigner) {
    Fail-SigningTool "Detached Burn engine does not match signed release provenance."
  }
  if ($timestampRequired) {
    if ([string]$identity.timestamp.url -notmatch "^https://") {
      Fail-SigningTool "Timestamped release identity must contain an HTTPS RFC3161 URL."
    }
    if (
      [string]$identity.timestamp.msiTimeStamperThumbprint -ine $msiSignature.TimeStamperCertificate.Thumbprint -or
      [string]$identity.timestamp.engineTimeStamperThumbprint -ine $engineSignature.TimeStamperCertificate.Thumbprint -or
      [string]$identity.timestamp.bundleTimeStamperThumbprint -ine $exeSignature.TimeStamperCertificate.Thumbprint
    ) {
      Fail-SigningTool "Timestamp certificate evidence does not match the signed files."
    }
  }
} finally {
  if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
  }
}

$eligibility = [string]$identity.deploymentEligibility
Write-Host "WINDOWS_INSTALLER_SIGNING_VERIFY_PASS sourceCommit=$($ExpectedSourceCommit.ToLowerInvariant()) productVersion=$ExpectedProductVersion signingMode=$($identity.signingMode) signer=$normalizedSigner timestampRequired=$timestampRequired"
Write-Host "DEPLOYMENT_ELIGIBILITY=$eligibility"
