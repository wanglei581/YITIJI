[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$RootCertificatePath,
  [Parameter(Mandatory)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$SignerCertificatePath,
  [ValidateSet("CurrentUser", "LocalMachine")][string]$StoreScope = "CurrentUser",
  [switch]$AcknowledgeEphemeralNonProductionHost
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

if ($StoreScope -eq "LocalMachine" -and -not $AcknowledgeEphemeralNonProductionHost) {
  Fail "LocalMachine trust requires -AcknowledgeEphemeralNonProductionHost. Never install this root on a production kiosk."
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
foreach ($target in @($rootTarget, $publisherTarget)) {
  if (Test-Path -LiteralPath $target) {
    Fail "Refusing to overwrite existing trust entry '$target'. Remove or reuse it deliberately."
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
