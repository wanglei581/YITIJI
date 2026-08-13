[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string[]]$Paths,
  [Parameter(Mandatory = $true)][string]$CertificatePath,
  [Parameter(Mandatory = $true)][string]$CertificatePassword,
  [Parameter(Mandatory = $true)][string]$ExpectedPublisher,
  [Parameter(Mandatory = $true)][string]$ExpectedThumbprint,
  [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"
$signtool = (Get-Command signtool.exe -ErrorAction Stop).Source
$resolvedCertificate = (Resolve-Path -LiteralPath $CertificatePath).Path
$thumbprint = $ExpectedThumbprint.Replace(" ", "").ToUpperInvariant()
if ([string]::IsNullOrWhiteSpace($ExpectedPublisher) -or $ExpectedPublisher.Length -gt 512 -or $ExpectedPublisher -match "[`r`n]" -or $thumbprint -notmatch "^(?:[A-F0-9]{40}|[A-F0-9]{64})$") { throw "Expected signing identity is invalid" }

function Sign-And-Verify([string]$Path) {
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  & $signtool sign /fd SHA256 /f $resolvedCertificate /p $CertificatePassword /tr $TimestampUrl /td SHA256 $resolved
  if ($LASTEXITCODE -ne 0) { throw "signtool sign failed: $resolved" }
  & $signtool verify /pa /tw /v $resolved
  if ($LASTEXITCODE -ne 0) { throw "signtool verify failed: $resolved" }
  $signature = Get-AuthenticodeSignature -LiteralPath $resolved
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.SignerCertificate) { throw "Authenticode signature is invalid: $resolved" }
  if ($signature.SignerCertificate.Thumbprint.Replace(" ", "").ToUpperInvariant() -ne $thumbprint) { throw "Authenticode thumbprint mismatch: $resolved" }
  if (-not [string]::Equals($signature.SignerCertificate.Subject, $ExpectedPublisher, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Authenticode publisher mismatch: $resolved" }
  Write-Host "WINDOWS_RELEASE_SIGNED path=$resolved sha256=$((Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash)"
}

foreach ($path in $Paths) { Sign-And-Verify $path }
$CertificatePassword = $null
