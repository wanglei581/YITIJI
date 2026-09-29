[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$PublicOutputDirectory,
  [ValidateNotNullOrEmpty()][string]$RootCommonName = "AI Job Print Internal Root CA",
  [ValidateNotNullOrEmpty()][string]$SigningCommonName = "AI Job Print Internal Code Signing",
  [ValidateSet("CurrentUser", "LocalMachine")][string]$StoreScope = "CurrentUser",
  [ValidateRange(2, 90)][int]$RootValidityDays = 30,
  [ValidateRange(1, 30)][int]$SigningValidityDays = 7,
  [switch]$AcknowledgeEphemeralNonProductionHost
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  throw "INTERNAL_SIGNING_CERTIFICATE_SETUP_FAILED: $Message"
}

if ($StoreScope -eq "LocalMachine" -and -not $AcknowledgeEphemeralNonProductionHost) {
  Fail "LocalMachine certificate creation requires -AcknowledgeEphemeralNonProductionHost. Never create this internal root on a production kiosk."
}

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($PublicOutputDirectory)
$repositoryPrefix = $repositoryRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
if ($resolvedOutput -eq $repositoryRoot -or $resolvedOutput.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  Fail "Public certificate output must be outside the repository."
}

$rootSubject = "CN=$RootCommonName"
$signingSubject = "CN=$SigningCommonName"
$storePath = "Cert:\$StoreScope\My"
foreach ($subject in @($rootSubject, $signingSubject)) {
  $matches = @(Get-ChildItem -Path $storePath | Where-Object { $_.Subject -eq $subject })
  if ($matches.Count -gt 0) {
    Fail "Certificate subject '$subject' already exists in $storePath. Reuse or remove it deliberately."
  }
}

New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$rootPath = Join-Path $resolvedOutput "AIJobPrint-InternalRootCA.cer"
$signerPath = Join-Path $resolvedOutput "AIJobPrint-InternalCodeSigning.cer"
$metadataPath = Join-Path $resolvedOutput "internal-signing-certificate.json"
foreach ($path in @($rootPath, $signerPath, $metadataPath)) {
  if (Test-Path -LiteralPath $path) {
    Fail "Refusing to overwrite existing output '$path'."
  }
}

$now = Get-Date
$rootExpiry = $now.AddDays($RootValidityDays)
$signingExpiry = $now.AddDays($SigningValidityDays)
if ($signingExpiry -ge $rootExpiry) {
  Fail "Signing certificate validity must end before root certificate validity."
}

$root = $null
$signer = $null
try {
  $root = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $rootSubject `
    -FriendlyName "AI Job Print Internal Root CA" `
    -CertStoreLocation $storePath `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -KeyExportPolicy NonExportable `
    -KeyUsage CertSign, CRLSign `
    -HashAlgorithm SHA256 `
    -NotBefore $now.AddMinutes(-5) `
    -NotAfter $rootExpiry `
    -TextExtension @("2.5.29.19={critical}{text}ca=1&pathlength=0")

  $signer = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $signingSubject `
    -FriendlyName "AI Job Print Internal Code Signing" `
    -Signer $root `
    -CertStoreLocation $storePath `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -KeyExportPolicy NonExportable `
    -KeyUsage DigitalSignature `
    -HashAlgorithm SHA256 `
    -NotBefore $now.AddMinutes(-5) `
    -NotAfter $signingExpiry `
    -TextExtension @(
      "2.5.29.19={critical}{text}ca=0",
      "2.5.29.37={critical}{text}1.3.6.1.5.5.7.3.3"
    )

  if (-not $root.HasPrivateKey -or -not $signer.HasPrivateKey) {
    Fail "Internal certificates were created without non-exported private keys in the selected store."
  }

  Export-Certificate -Cert $root -FilePath $rootPath -Type CERT | Out-Null
  Export-Certificate -Cert $signer -FilePath $signerPath -Type CERT | Out-Null

  $metadata = [ordered]@{
    schemaVersion = 1
    signingScope = "internal-test-only"
    deploymentEligibility = "not-for-production-or-fleet-deployment"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    storeScope = $StoreScope
    root = [ordered]@{
      subject = $root.Subject
      thumbprint = $root.Thumbprint
      notBefore = $root.NotBefore.ToUniversalTime().ToString("o")
      notAfter = $root.NotAfter.ToUniversalTime().ToString("o")
      certificateFile = [System.IO.Path]::GetFileName($rootPath)
      sha256 = (Get-FileHash -LiteralPath $rootPath -Algorithm SHA256).Hash.ToUpperInvariant()
    }
    signer = [ordered]@{
      subject = $signer.Subject
      issuer = $signer.Issuer
      thumbprint = $signer.Thumbprint
      notBefore = $signer.NotBefore.ToUniversalTime().ToString("o")
      notAfter = $signer.NotAfter.ToUniversalTime().ToString("o")
      certificateFile = [System.IO.Path]::GetFileName($signerPath)
      sha256 = (Get-FileHash -LiteralPath $signerPath -Algorithm SHA256).Hash.ToUpperInvariant()
      eku = "1.3.6.1.5.5.7.3.3"
    }
    privateKey = "non-exportable; retained only in the selected ephemeral Windows certificate store"
  }
  [System.IO.File]::WriteAllText(
    $metadataPath,
    (($metadata | ConvertTo-Json -Depth 5) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
} catch {
  foreach ($path in @($metadataPath, $signerPath, $rootPath)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      Remove-Item -LiteralPath $path -Force
    }
  }
  foreach ($certificate in @($signer, $root)) {
    if ($null -ne $certificate -and -not [string]::IsNullOrWhiteSpace($certificate.Thumbprint)) {
      $certificatePath = Join-Path $storePath $certificate.Thumbprint
      if (Test-Path -LiteralPath $certificatePath) {
        Remove-Item -LiteralPath $certificatePath -DeleteKey -Force
      }
    }
  }
  throw
}

Write-Host "INTERNAL_SIGNING_CERTIFICATES_READY"
Write-Host "ROOT_THUMBPRINT=$($root.Thumbprint)"
Write-Host "SIGNER_THUMBPRINT=$($signer.Thumbprint)"
Write-Host "PUBLIC_OUTPUT=$resolvedOutput"
Write-Warning "Internal self-signed certificates are test-only. They do not provide public Authenticode trust or SmartScreen reputation."
