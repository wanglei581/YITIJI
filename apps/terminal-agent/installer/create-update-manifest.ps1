[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PackagePath,
  [Parameter(Mandatory = $true)][string]$PackageUrl,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$MinimumVersion,
  [Parameter(Mandatory = $true)][string]$Publisher,
  [Parameter(Mandatory = $true)][string]$PackageCertificateThumbprint,
  [Parameter(Mandatory = $true)][string]$ReleaseNotes,
  [Parameter(Mandatory = $true)][string]$RollbackVersion,
  [Parameter(Mandatory = $true)][string]$RollbackPackagePath,
  [Parameter(Mandatory = $true)][string]$RollbackUrl,
  [Parameter(Mandatory = $true)][string]$RollbackCertificateThumbprint,
  [Parameter(Mandatory = $true)][string]$SigningPrivateKeyPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
$resolvedRollbackPackage = (Resolve-Path -LiteralPath $RollbackPackagePath).Path
$resolvedPrivateKey = (Resolve-Path -LiteralPath $SigningPrivateKeyPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$maxPackageBytes = 1024 * 1024 * 1024
if (
  [string]::Equals($resolvedPackage, $resolvedRollbackPackage, [System.StringComparison]::OrdinalIgnoreCase) -or
  [string]::Equals($resolvedPackage, $resolvedOutput, [System.StringComparison]::OrdinalIgnoreCase) -or
  [string]::Equals($resolvedRollbackPackage, $resolvedOutput, [System.StringComparison]::OrdinalIgnoreCase)
) {
  throw "Package, rollback package, and output paths must be distinct"
}
$thumbprint = $PackageCertificateThumbprint.Replace(" ", "").ToUpperInvariant()
$rollbackThumbprint = $RollbackCertificateThumbprint.Replace(" ", "").ToUpperInvariant()
if ($thumbprint -notmatch "^(?:[A-F0-9]{40}|[A-F0-9]{64})$") { throw "CertificateThumbprint is invalid" }
if ($rollbackThumbprint -notmatch "^(?:[A-F0-9]{40}|[A-F0-9]{64})$") { throw "RollbackCertificateThumbprint is invalid" }
foreach ($uriValue in @($PackageUrl, $RollbackUrl)) {
  $uri = [System.Uri]$uriValue
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https" -or -not $uri.IsDefaultPort -or $uri.Host -ne "zyidai.cn" -or -not [string]::IsNullOrEmpty($uri.UserInfo) -or -not [string]::IsNullOrEmpty($uri.Query) -or -not [string]::IsNullOrEmpty($uri.Fragment)) {
    throw "Release URLs must use the fixed zyidai.cn HTTPS origin without query or fragment"
  }
}
try {
  $parsedVersion = [version]$Version
  $parsedMinimumVersion = [version]$MinimumVersion
  $parsedRollbackVersion = [version]$RollbackVersion
} catch {
  throw "Version fields must be valid System.Version values"
}
foreach ($versionValue in @($Version, $MinimumVersion, $RollbackVersion)) {
  if ($versionValue -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
    throw "Version fields must be three-part numeric Windows Installer versions"
  }
  try { $parts = @($versionValue.Split('.') | ForEach-Object { [int64]$_ }) } catch { throw "Version fields exceed numeric bounds" }
  if ($parts[0] -gt 255 -or $parts[1] -gt 255 -or $parts[2] -gt 65535) {
    throw "Version fields exceed Windows Installer bounds"
  }
}
if ($parsedMinimumVersion -gt $parsedVersion) { throw "MinimumVersion must not be higher than Version" }
if ($parsedRollbackVersion -ge $parsedVersion) { throw "RollbackVersion must be lower than Version" }
$expectedPackagePath = "/downloads/terminal-agent/$Version/AIJobPrintTerminalSetup.exe"
$expectedRollbackPath = "/downloads/terminal-agent/$RollbackVersion/AIJobPrintTerminalSetup.exe"
if (([System.Uri]$PackageUrl).AbsolutePath -ne $expectedPackagePath -or ([System.Uri]$RollbackUrl).AbsolutePath -ne $expectedRollbackPath) {
  throw "Release URLs must use their exact versioned terminal-agent paths"
}
$packageSize = (Get-Item -LiteralPath $resolvedPackage).Length
$rollbackPackageSize = (Get-Item -LiteralPath $resolvedRollbackPackage).Length
if ($packageSize -le 0 -or $packageSize -gt $maxPackageBytes -or $rollbackPackageSize -le 0 -or $rollbackPackageSize -gt $maxPackageBytes) {
  throw "Release packages must be non-empty and no larger than 1 GiB"
}

$manifest = [ordered]@{
  schemaVersion = 1
  channel = "stable"
  version = $Version
  minimumVersion = $MinimumVersion
  package = [ordered]@{
    url = $PackageUrl
    size = $packageSize
    sha256 = (Get-FileHash -LiteralPath $resolvedPackage -Algorithm SHA256).Hash.ToUpperInvariant()
  }
  signer = [ordered]@{
    publisher = $Publisher
    thumbprint = $thumbprint
  }
  releaseNotes = $ReleaseNotes
  publishedAt = [DateTime]::UtcNow.ToString("o")
  rollback = [ordered]@{
    version = $RollbackVersion
    url = $RollbackUrl
    size = $rollbackPackageSize
    sha256 = (Get-FileHash -LiteralPath $resolvedRollbackPackage -Algorithm SHA256).Hash.ToUpperInvariant()
    thumbprint = $rollbackThumbprint
  }
}

foreach ($value in @($Version, $MinimumVersion, $PackageUrl, $Publisher, $thumbprint, $ReleaseNotes, $RollbackVersion, $RollbackUrl, $rollbackThumbprint)) {
  if ([string]::IsNullOrWhiteSpace($value) -or $value -match "[`r`n]") {
    throw "Manifest canonical fields must be non-empty single-line values"
  }
}
if ($Publisher.Length -gt 512 -or $ReleaseNotes.Length -gt 1000) { throw "Publisher or release notes exceed manifest limits" }

function Get-CanonicalManifestPayload([object]$Manifest) {
  return (@(
    "schemaVersion=$([int]$Manifest.schemaVersion)",
    "channel=$([string]$Manifest.channel)",
    "version=$([string]$Manifest.version)",
    "minimumVersion=$([string]$Manifest.minimumVersion)",
    "packageUrl=$([string]$Manifest.package.url)",
    "packageSize=$([int64]$Manifest.package.size)",
    "packageSha256=$(([string]$Manifest.package.sha256).ToUpperInvariant())",
    "publisher=$([string]$Manifest.signer.publisher)",
    "thumbprint=$(([string]$Manifest.signer.thumbprint).Replace(' ', '').ToUpperInvariant())",
    "releaseNotes=$([string]$Manifest.releaseNotes)",
    "publishedAt=$([string]$Manifest.publishedAt)",
    "rollbackVersion=$([string]$Manifest.rollback.version)",
    "rollbackUrl=$([string]$Manifest.rollback.url)",
    "rollbackSize=$([int64]$Manifest.rollback.size)",
    "rollbackSha256=$(([string]$Manifest.rollback.sha256).ToUpperInvariant())",
    "rollbackThumbprint=$(([string]$Manifest.rollback.thumbprint).Replace(' ', '').ToUpperInvariant())"
  ) -join "`n") + "`n"
}

$rsa = [System.Security.Cryptography.RSA]::Create()
try {
  $privateKeyXml = Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedPrivateKey
  $rsa.FromXmlString($privateKeyXml)
  if ($rsa.KeySize -lt 2048) { throw "Manifest signing RSA key must be at least 2048 bits" }
  $payload = [System.Text.Encoding]::UTF8.GetBytes((Get-CanonicalManifestPayload $manifest))
  $signature = $rsa.SignData($payload, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $manifest["manifestSignature"] = [Convert]::ToBase64String($signature)
} finally { $rsa.Dispose() }

New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedOutput) -Force | Out-Null
[System.IO.File]::WriteAllText(
  $resolvedOutput,
  (($manifest | ConvertTo-Json -Depth 8) + "`n"),
  [System.Text.UTF8Encoding]::new($false)
)
Write-Host "UPDATE_MANIFEST_CREATED version=$Version path=$resolvedOutput"
