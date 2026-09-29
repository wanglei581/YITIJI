[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$RootCertificatePath,
  [Parameter(Mandatory)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$SignerCertificatePath,
  [ValidateSet("CurrentUser", "LocalMachine")][string]$StoreScope = "CurrentUser",
  [switch]$AcknowledgeEphemeralNonProductionHost,
  [string]$CertificateMetadataPath,
  [string]$RunOwnershipMarkerPath
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  throw "INTERNAL_SIGNING_TRUST_INSTALL_FAILED: $Message"
}

# status=pass means that candidate returned. It is not trust installation success.
function Write-TrustInstallPhase([string]$Phase, [string]$Status) {
  [Console]::Out.WriteLine("INTERNAL_SIGNING_TRUST_PHASE phase=$Phase scope=$($script:StoreScope) status=$Status")
  [Console]::Out.Flush()
}

function Assert-LocalMachineCertificateBinding {
  try {
    if ([string]::IsNullOrWhiteSpace($script:CertificateMetadataPath) -or -not (Test-Path -LiteralPath $script:CertificateMetadataPath -PathType Leaf)) {
      throw "binding"
    }
    $metadata = Get-Content -Raw -Encoding UTF8 -LiteralPath $script:CertificateMetadataPath | ConvertFrom-Json
    if ([int]$metadata.schemaVersion -ne 1) { throw "binding" }
    if ([string]$metadata.signingScope -ne "internal-test-only") { throw "binding" }
    if ([string]$metadata.deploymentEligibility -ne "not-for-production-or-fleet-deployment") { throw "binding" }
    if ([string]$metadata.storeScope -ne "CurrentUser") { throw "binding" }
    $rootFileName = [string]$metadata.root.certificateFile
    $signerFileName = [string]$metadata.signer.certificateFile
    if ($rootFileName -notmatch '^[A-Za-z0-9._-]+\.cer$' -or $signerFileName -notmatch '^[A-Za-z0-9._-]+\.cer$') {
      throw "binding"
    }
    $suppliedRootName = [System.IO.Path]::GetFileName($script:RootCertificatePath)
    $suppliedSignerName = [System.IO.Path]::GetFileName($script:SignerCertificatePath)
    if (-not $suppliedRootName.Equals($rootFileName, [System.StringComparison]::OrdinalIgnoreCase)) { throw "binding" }
    if (-not $suppliedSignerName.Equals($signerFileName, [System.StringComparison]::OrdinalIgnoreCase)) { throw "binding" }
    $metadataDirectory = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($script:CertificateMetadataPath))
    $boundRoot = [System.IO.Path]::GetFullPath((Join-Path $metadataDirectory $rootFileName))
    $boundSigner = [System.IO.Path]::GetFullPath((Join-Path $metadataDirectory $signerFileName))
    $fullRoot = [System.IO.Path]::GetFullPath($script:RootCertificatePath)
    $fullSigner = [System.IO.Path]::GetFullPath($script:SignerCertificatePath)
    if (-not $fullRoot.Equals($boundRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw "binding" }
    if (-not $fullSigner.Equals($boundSigner, [System.StringComparison]::OrdinalIgnoreCase)) { throw "binding" }
    $rootHash = (Get-FileHash -LiteralPath $script:RootCertificatePath -Algorithm SHA256).Hash
    $signerHash = (Get-FileHash -LiteralPath $script:SignerCertificatePath -Algorithm SHA256).Hash
    if (-not $rootHash.Equals([string]$metadata.root.sha256, [System.StringComparison]::OrdinalIgnoreCase)) { throw "binding" }
    if (-not $signerHash.Equals([string]$metadata.signer.sha256, [System.StringComparison]::OrdinalIgnoreCase)) { throw "binding" }
    if (-not $script:root.Thumbprint.Equals([string]$metadata.root.thumbprint, [System.StringComparison]::OrdinalIgnoreCase)) { throw "binding" }
    if (-not $script:signer.Thumbprint.Equals([string]$metadata.signer.thumbprint, [System.StringComparison]::OrdinalIgnoreCase)) { throw "binding" }
  } catch {
    Fail "LocalMachine trust certificate binding failed."
  }
}

if ($StoreScope -eq "LocalMachine" -and -not $AcknowledgeEphemeralNonProductionHost) {
  Fail "LocalMachine trust requires -AcknowledgeEphemeralNonProductionHost. Never install this root on a production kiosk."
}
# GITHUB_ACTIONS + RUNNER_OS + RUNNER_ENVIRONMENT is spoofable accident protection, not attestation.
if ($StoreScope -eq "LocalMachine") {
  if ($env:GITHUB_ACTIONS -ne "true" -or $env:RUNNER_OS -ne "Windows" -or $env:RUNNER_ENVIRONMENT -ne "github-hosted") {
    Fail "LocalMachine trust requires a github-hosted Windows Actions runner."
  }
  Write-TrustInstallPhase -Phase "runner-guard" -Status "pass"
}
foreach ($path in @($RootCertificatePath, $SignerCertificatePath)) {
  if ([System.IO.Path]::GetExtension($path) -ine ".cer") {
    Fail "Only public .cer files are accepted. PFX files and private keys are forbidden."
  }
}

$root = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($RootCertificatePath)
$signer = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($SignerCertificatePath)
$now = Get-Date
if ($now -lt $root.NotBefore -or $now -ge $root.NotAfter -or $now -lt $signer.NotBefore -or $now -ge $signer.NotAfter) {
  Fail "Root and signer certificates must both be within their validity periods."
}
if ($root.Subject -ne $root.Issuer) {
  Fail "The root certificate must be self-issued."
}
if ($signer.Issuer -ne $root.Subject) {
  Fail "The signer issuer does not match the supplied root subject."
}

$rootBasicConstraints = @($root.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.19" })
$signerBasicConstraints = @($signer.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.19" })
if ($rootBasicConstraints.Count -ne 1 -or $signerBasicConstraints.Count -ne 1) {
  Fail "Root and signer must each contain exactly one Basic Constraints extension."
}
$rootBasic = [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($rootBasicConstraints[0], $false)
$signerBasic = [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($signerBasicConstraints[0], $false)
if (-not $rootBasic.CertificateAuthority -or $signerBasic.CertificateAuthority) {
  Fail "The supplied certificates do not have the required root-CA and leaf-signer constraints."
}

$rootKeyUsageExtensions = @($root.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.15" })
$signerKeyUsageExtensions = @($signer.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.15" })
if ($rootKeyUsageExtensions.Count -ne 1 -or $signerKeyUsageExtensions.Count -ne 1) {
  Fail "Root and signer must each contain exactly one Key Usage extension."
}
$rootKeyUsage = [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($rootKeyUsageExtensions[0], $false)
$signerKeyUsage = [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($signerKeyUsageExtensions[0], $false)
if (($rootKeyUsage.KeyUsages -band [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign) -eq 0) {
  Fail "The root certificate cannot sign certificates."
}
if (($signerKeyUsage.KeyUsages -band [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature) -eq 0) {
  Fail "The signer certificate cannot create digital signatures."
}

$chain = [System.Security.Cryptography.X509Certificates.X509Chain]::new()
$chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
$chain.ChainPolicy.VerificationFlags = [System.Security.Cryptography.X509Certificates.X509VerificationFlags]::AllowUnknownCertificateAuthority
$chain.ChainPolicy.ExtraStore.Add($root) | Out-Null
Write-TrustInstallPhase -Phase "chain-validation" -Status "start"
$chainBuilt = $chain.Build($signer)
Write-TrustInstallPhase -Phase "chain-validation" -Status "pass"
if (-not $chainBuilt) {
  Fail "The signer certificate chain failed cryptographic validation."
}
$unexpectedChainStatus = @($chain.ChainStatus | Where-Object {
  $_.Status -notin @(
    [System.Security.Cryptography.X509Certificates.X509ChainStatusFlags]::NoError,
    [System.Security.Cryptography.X509Certificates.X509ChainStatusFlags]::UntrustedRoot
  )
})
if ($unexpectedChainStatus.Count -gt 0) {
  Fail "The signer certificate chain contains an unexpected validation status: $($unexpectedChainStatus[0].Status)."
}
if ($chain.ChainElements.Count -lt 2 -or $chain.ChainElements[$chain.ChainElements.Count - 1].Certificate.Thumbprint -ne $root.Thumbprint) {
  Fail "The signer does not cryptographically chain to the supplied root."
}

$ekuExtensions = @($signer.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.37" })
$ekuValues = @($ekuExtensions | ForEach-Object {
  $eku = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($_, $false)
  $eku.EnhancedKeyUsages | ForEach-Object { $_.Value }
})
if ($ekuValues -notcontains "1.3.6.1.5.5.7.3.3") {
  Fail "The signer certificate is missing the Code Signing EKU."
}

$rootStore = "Cert:\$StoreScope\Root"
$publisherStore = "Cert:\$StoreScope\TrustedPublisher"
$rootTarget = Join-Path $rootStore $root.Thumbprint
$publisherTarget = Join-Path $publisherStore $signer.Thumbprint
if ($StoreScope -eq "LocalMachine") {
  Assert-LocalMachineCertificateBinding
}
foreach ($target in @($rootTarget, $publisherTarget)) {
  if (Test-Path -LiteralPath $target) {
    Fail "Refusing to overwrite existing trust entry '$target'. Remove or reuse it deliberately."
  }
}
if ($StoreScope -eq "LocalMachine") {
  if ([string]::IsNullOrWhiteSpace($RunOwnershipMarkerPath)) {
    Fail "LocalMachine trust requires a run ownership marker path."
  }
  $markerDirectory = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($RunOwnershipMarkerPath))
  if ([string]::IsNullOrWhiteSpace($markerDirectory) -or -not (Test-Path -LiteralPath $markerDirectory -PathType Container)) {
    Fail "LocalMachine trust requires a run ownership marker directory."
  }
  # Zero-byte marker, only after both preexisting thumbprint checks have passed.
  $ownershipStream = $null
  try {
    $ownershipStream = [System.IO.File]::Open(
      $RunOwnershipMarkerPath,
      [System.IO.FileMode]::CreateNew,
      [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::None)
  } catch {
    Fail "LocalMachine trust could not create a new run ownership marker."
  } finally {
    if ($null -ne $ownershipStream) {
      $ownershipStream.Dispose()
    }
  }
}
try {
  Write-TrustInstallPhase -Phase "root-import" -Status "start"
  Import-Certificate -FilePath $RootCertificatePath -CertStoreLocation $rootStore | Out-Null
  Write-TrustInstallPhase -Phase "root-import" -Status "pass"
  Write-TrustInstallPhase -Phase "trusted-publisher-import" -Status "start"
  Import-Certificate -FilePath $SignerCertificatePath -CertStoreLocation $publisherStore | Out-Null
  Write-TrustInstallPhase -Phase "trusted-publisher-import" -Status "pass"
} catch {
  foreach ($target in @($publisherTarget, $rootTarget)) {
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Force
    }
  }
  throw
}
if (-not (Test-Path -LiteralPath $rootTarget) -or -not (Test-Path -LiteralPath $publisherTarget)) {
  foreach ($target in @($publisherTarget, $rootTarget)) {
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Force
    }
  }
  Fail "Trust import did not create both expected thumbprint entries."
}

Write-Host "INTERNAL_SIGNING_TRUST_INSTALLED"
Write-Host "ROOT_STORE=$rootStore"
Write-Host "ROOT_THUMBPRINT=$($root.Thumbprint)"
Write-Host "PUBLISHER_STORE=$publisherStore"
Write-Host "SIGNER_THUMBPRINT=$($signer.Thumbprint)"
Write-Warning "This trust is internal-test-only and must be removed after validation."
