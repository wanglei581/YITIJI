[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })][string]$UnsignedCandidateRoot,
  [Parameter(Mandatory)][ValidatePattern("^[0-9A-Fa-f]{40}$")][string]$SourceCommit,
  [Parameter(Mandatory)][ValidatePattern("^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")][string]$ProductVersion,
  [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$CertificateThumbprint,
  [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$OutputDirectory,
  [ValidateSet("InternalTest", "Release")][string]$SigningMode = "Release",
  [ValidateSet("CurrentUser", "LocalMachine")][string]$CertificateStoreScope = "CurrentUser",
  [string]$TimestampUrl,
  [string]$SignToolPath,
  [string]$WixToolPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "signing-tools.ps1")

if ($SigningMode -eq "Release" -and [string]::IsNullOrWhiteSpace($TimestampUrl)) {
  Fail-SigningTool "Release mode requires an approved RFC3161 HTTPS timestamp URL."
}
if (-not [string]::IsNullOrWhiteSpace($TimestampUrl) -and $TimestampUrl -notmatch "^https://") {
  Fail-SigningTool "Timestamp URL must use HTTPS."
}

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if ($null -eq $gitCommand) {
  Fail-SigningTool "git is required to bind the signed bundle recipe to the frozen source commit."
}
$actualHead = (& $gitCommand.Source -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actualHead -ine $SourceCommit) {
  Fail-SigningTool "Signing checkout HEAD must equal SourceCommit. Expected $SourceCommit, got $actualHead."
}
$gitStatus = @(& $gitCommand.Source -C $repositoryRoot status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) {
  Fail-SigningTool "Unable to verify signing checkout cleanliness."
}
if ($gitStatus.Count -gt 0) {
  Fail-SigningTool "Signing checkout must be clean so bundle source and scripts match SourceCommit."
}

$resolvedCandidateRoot = (Resolve-Path -LiteralPath $UnsignedCandidateRoot).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
Assert-DirectoryOutside -CandidatePath $resolvedOutput -ProtectedDirectory $resolvedCandidateRoot -Description "Signed output directory"
Assert-DirectoryOutside -CandidatePath $resolvedOutput -ProtectedDirectory $repositoryRoot -Description "Signed output directory"
if (Test-Path -LiteralPath $resolvedOutput) {
  $existing = @(Get-ChildItem -LiteralPath $resolvedOutput -Force)
  if ($existing.Count -gt 0) {
    Fail-SigningTool "Signed output directory must be absent or empty: '$resolvedOutput'."
  }
}
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$incompleteMarker = Join-Path $resolvedOutput "SIGNING-INCOMPLETE.txt"
[System.IO.File]::WriteAllText(
  $incompleteMarker,
  "Signing has not completed. Do not install or publish files from this directory.`n",
  [System.Text.UTF8Encoding]::new($false)
)

$unsignedMsi = Join-Path $resolvedCandidateRoot "AIJobPrintAgent.msi"
$unsignedExe = Join-Path $resolvedCandidateRoot "AIJobPrintTerminalSetup.exe"
$stagingManifest = Join-Path $resolvedCandidateRoot "staging-manifest.json"
$candidateIdentity = Join-Path $resolvedCandidateRoot "candidate-identity.json"
foreach ($path in @($unsignedMsi, $unsignedExe, $stagingManifest, $candidateIdentity)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    Fail-SigningTool "Frozen unsigned candidate file is missing: '$path'."
  }
}

& (Join-Path $PSScriptRoot "candidate-identity.ps1") `
  -Mode Verify `
  -CandidateRoot $resolvedCandidateRoot `
  -SourceCommit $SourceCommit `
  -ProductVersion $ProductVersion

Assert-UnsignedAuthenticode $unsignedMsi
Assert-UnsignedAuthenticode $unsignedExe

$signTool = Resolve-SignTool $SignToolPath
$wixTool = Resolve-WixTool $WixToolPath
$signToolVersion = (Get-Item -LiteralPath $signTool).VersionInfo.ProductVersion
$wixVersionLines = @(& $wixTool --version)
if ($LASTEXITCODE -ne 0 -or $wixVersionLines.Count -eq 0) {
  Fail-SigningTool "Unable to read the WiX CLI version."
}
$wixVersion = ($wixVersionLines -join " ").Trim()
$certificate = Get-ValidatedSigningCertificate -Thumbprint $CertificateThumbprint -StoreScope $CertificateStoreScope
$requireTimestamp = $SigningMode -eq "Release" -or -not [string]::IsNullOrWhiteSpace($TimestampUrl)

$signedMsi = Join-Path $resolvedOutput "AIJobPrintAgent.msi"
$signedExe = Join-Path $resolvedOutput "AIJobPrintTerminalSetup.exe"
$copiedStagingManifest = Join-Path $resolvedOutput "staging-manifest.json"
$copiedUnsignedIdentity = Join-Path $resolvedOutput "unsigned-candidate-identity.json"
$releaseIdentityPath = Join-Path $resolvedOutput "signed-release-identity.json"
$releaseIdentitySignaturePath = Join-Path $resolvedOutput "signed-release-identity.p7s"
foreach ($path in @($signedMsi, $signedExe, $copiedStagingManifest, $copiedUnsignedIdentity, $releaseIdentityPath, $releaseIdentitySignaturePath)) {
  if (Test-Path -LiteralPath $path) {
    Fail-SigningTool "Refusing to overwrite release output '$path'."
  }
}

Copy-Item -LiteralPath $unsignedMsi -Destination $signedMsi
Copy-Item -LiteralPath $stagingManifest -Destination $copiedStagingManifest
Copy-Item -LiteralPath $candidateIdentity -Destination $copiedUnsignedIdentity
Invoke-SignAuthenticode -SignToolPath $signTool -Path $signedMsi -Certificate $certificate -StoreScope $CertificateStoreScope -TimestampUrl $TimestampUrl
$msiSignature = Assert-ValidAuthenticode -SignToolPath $signTool -Path $signedMsi -ExpectedThumbprint $certificate.Thumbprint -RequireTimestamp:$requireTimestamp

$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-job-print-signing-" + [guid]::NewGuid().ToString("N"))
$bundleBuild = Join-Path $workRoot "bundle-build"
$extractRoot = Join-Path $workRoot "bundle-extract"
$baExtractRoot = Join-Path $workRoot "bundle-ba-extract"
$enginePath = Join-Path $workRoot "bundle-engine.exe"
$reattachedBundle = Join-Path $workRoot "bundle-reattached.exe"
$intermediateRoot = Join-Path $workRoot "wix-intermediate"

try {
  New-Item -ItemType Directory -Path $bundleBuild, $extractRoot, $baExtractRoot, $intermediateRoot -Force | Out-Null
  & (Join-Path $PSScriptRoot "build-exe.ps1") `
    -MsiPath $signedMsi `
    -OutputDirectory $bundleBuild `
    -ProductVersion $ProductVersion

  $unsignedRebuiltBundle = Join-Path $bundleBuild "AIJobPrintTerminalSetup.exe"
  if (-not (Test-Path -LiteralPath $unsignedRebuiltBundle -PathType Leaf)) {
    Fail-SigningTool "Rebuilt Burn bundle was not produced."
  }
  Assert-UnsignedAuthenticode $unsignedRebuiltBundle

  # WiX 4.0.6 names attached payloads only when this same extract also passes -oba.
  Invoke-CheckedCommand -FilePath $wixTool -Arguments @(
    "burn", "extract", $unsignedRebuiltBundle, "-o", $extractRoot, "-oba", $baExtractRoot, "-intermediateFolder", $intermediateRoot
  ) -FailureMessage "WiX failed to extract the rebuilt bundle."
  $embeddedMsiHash = Assert-ExtractedBundleMsiHash -ExtractRoot $extractRoot -SignedMsiPath $signedMsi -BundleKind "rebuilt bundle"

  Invoke-CheckedCommand -FilePath $wixTool -Arguments @(
    "burn", "detach", $unsignedRebuiltBundle, "-engine", $enginePath, "-intermediateFolder", $intermediateRoot
  ) -FailureMessage "WiX failed to detach the Burn engine."
  Assert-UnsignedAuthenticode $enginePath
  Invoke-SignAuthenticode -SignToolPath $signTool -Path $enginePath -Certificate $certificate -StoreScope $CertificateStoreScope -TimestampUrl $TimestampUrl
  $engineSignature = Assert-ValidAuthenticode -SignToolPath $signTool -Path $enginePath -ExpectedThumbprint $certificate.Thumbprint -RequireTimestamp:$requireTimestamp

  Invoke-CheckedCommand -FilePath $wixTool -Arguments @(
    "burn", "reattach", $unsignedRebuiltBundle, "-engine", $enginePath, "-o", $reattachedBundle,
    "-intermediateFolder", $intermediateRoot
  ) -FailureMessage "WiX failed to reattach the signed Burn engine."
  Assert-UnsignedAuthenticode $reattachedBundle
  Move-Item -LiteralPath $reattachedBundle -Destination $signedExe
  Invoke-SignAuthenticode -SignToolPath $signTool -Path $signedExe -Certificate $certificate -StoreScope $CertificateStoreScope -TimestampUrl $TimestampUrl
  $exeSignature = Assert-ValidAuthenticode -SignToolPath $signTool -Path $signedExe -ExpectedThumbprint $certificate.Thumbprint -RequireTimestamp:$requireTimestamp

  $unsignedIdentity = Get-Content -Raw -Encoding UTF8 -LiteralPath $candidateIdentity | ConvertFrom-Json
  $unsignedIdentityHash = (Get-FileHash -LiteralPath $candidateIdentity -Algorithm SHA256).Hash.ToUpperInvariant()
  $timestampEvidence = if ($requireTimestamp) {
    [ordered]@{
      required = $true
      url = $TimestampUrl
      msiTimeStamperThumbprint = $msiSignature.TimeStamperCertificate.Thumbprint
      engineTimeStamperThumbprint = $engineSignature.TimeStamperCertificate.Thumbprint
      bundleTimeStamperThumbprint = $exeSignature.TimeStamperCertificate.Thumbprint
    }
  } else {
    [ordered]@{
      required = $false
      url = $null
      omittedReason = "InternalTest mode without timestamp; not eligible for production or fleet deployment."
    }
  }

  $releaseIdentity = [ordered]@{
    schemaVersion = 1
    signingMode = $SigningMode
    deploymentEligibility = if ($SigningMode -eq "InternalTest") {
      "not-for-production-or-fleet-deployment"
    } else {
      "requires-separate-release-approval-public-or-enterprise-trust-and-operational-evidence"
    }
    sourceCommit = $SourceCommit.ToLowerInvariant()
    productVersion = $ProductVersion
    signedAt = (Get-Date).ToUniversalTime().ToString("o")
    unsignedCandidate = [ordered]@{
      identityFile = "unsigned-candidate-identity.json"
      identitySha256 = $unsignedIdentityHash
      files = @($unsignedIdentity.files)
    }
    signer = [ordered]@{
      subject = $certificate.Subject
      issuer = $certificate.Issuer
      thumbprint = $certificate.Thumbprint
      storeScope = $CertificateStoreScope
      notBefore = $certificate.NotBefore.ToUniversalTime().ToString("o")
      notAfter = $certificate.NotAfter.ToUniversalTime().ToString("o")
      codeSigningEku = "1.3.6.1.5.5.7.3.3"
    }
    timestamp = $timestampEvidence
    build = [ordered]@{
      checkoutHead = $actualHead.ToLowerInvariant()
      checkoutClean = $true
      wixCli = [ordered]@{
        file = [System.IO.Path]::GetFileName($wixTool)
        version = $wixVersion
      }
      signTool = [ordered]@{
        file = [System.IO.Path]::GetFileName($signTool)
        version = $signToolVersion
      }
      sequence = @(
        "verify-frozen-unsigned-candidate",
        "sign-msi",
        "rebuild-bundle-from-signed-msi",
        "verify-embedded-msi-hash",
        "detach-burn-engine",
        "sign-burn-engine",
        "reattach-burn-engine",
        "sign-final-bundle"
      )
    }
    outputs = @(
      (Get-FileRecord -Path $signedMsi -Name "AIJobPrintAgent.msi"),
      (Get-FileRecord -Path $signedExe -Name "AIJobPrintTerminalSetup.exe"),
      (Get-FileRecord -Path $copiedStagingManifest -Name "staging-manifest.json")
    )
    embeddedMsi = [ordered]@{
      sha256 = $embeddedMsiHash
      matchesSignedMsi = $true
    }
    embeddedEngine = [ordered]@{
      sha256 = (Get-FileHash -LiteralPath $enginePath -Algorithm SHA256).Hash.ToUpperInvariant()
      signerThumbprint = $certificate.Thumbprint
    }
  }
  [System.IO.File]::WriteAllText(
    $releaseIdentityPath,
    (($releaseIdentity | ConvertTo-Json -Depth 9) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )

  Write-DetachedCmsSignature -ContentPath $releaseIdentityPath -SignaturePath $releaseIdentitySignaturePath -Certificate $certificate
  & (Join-Path $PSScriptRoot "verify-windows-installer-release.ps1") `
    -ReleaseRoot $resolvedOutput `
    -ExpectedSourceCommit $SourceCommit `
    -ExpectedProductVersion $ProductVersion `
    -ExpectedSignerThumbprint $certificate.Thumbprint `
    -ExpectedSigningMode $SigningMode `
    -SignToolPath $signTool `
    -WixToolPath $wixTool `
    -AllowIncompleteMarker
  Remove-Item -LiteralPath $incompleteMarker -Force
} finally {
  if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
  }
}

Write-Host "WINDOWS_INSTALLER_SIGNING_READY"
Write-Host "SIGNING_MODE=$SigningMode"
Write-Host "SIGNED_MSI=$signedMsi"
Write-Host "SIGNED_EXE=$signedExe"
Write-Host "SIGNED_RELEASE_IDENTITY=$releaseIdentityPath"
Write-Host "SIGNED_RELEASE_IDENTITY_SIGNATURE=$releaseIdentitySignaturePath"
if ($SigningMode -eq "InternalTest") {
  Write-Warning "InternalTest output is not eligible for production or fleet deployment."
} else {
  Write-Warning "Successful signing does not prove release approval, SmartScreen reputation, deployment, device acceptance, or commercial readiness."
}
