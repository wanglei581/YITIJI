[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$HelperPath,
  [Parameter(Mandatory = $true)][string]$ControlCenterPath,
  [Parameter(Mandatory = $true)][string]$ManifestSignerPublicKeyPath,
  [Parameter(Mandatory = $true)][string]$Publisher
)

$ErrorActionPreference = "Stop"
$resolvedHelper = (Resolve-Path -LiteralPath $HelperPath).Path
$resolvedControlCenter = (Resolve-Path -LiteralPath $ControlCenterPath).Path
$resolvedPublicKey = (Resolve-Path -LiteralPath $ManifestSignerPublicKeyPath).Path
$publicKey = (Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedPublicKey).Trim()
if (
  [string]::IsNullOrWhiteSpace($publicKey) -or
  $publicKey.Length -gt 16384 -or
  $publicKey -notmatch "<RSAKeyValue>" -or
  $publicKey -match "<(?:P|Q|DP|DQ|InverseQ|D)>"
) {
  throw "Manifest signer public key must be a public RSA XML key"
}
$rsa = [System.Security.Cryptography.RSA]::Create()
try {
  $rsa.FromXmlString($publicKey)
  if ($rsa.KeySize -lt 2048) { throw "Manifest signer RSA public key must be at least 2048 bits" }
} finally { $rsa.Dispose() }
$encodedPublicKey = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($publicKey))
$source = Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedHelper
$marker = '$pinnedManifestSignerPublicKeyBase64 = ""'
if ([regex]::Matches($source, [regex]::Escape($marker)).Count -ne 1) { throw "Updater policy marker must occur exactly once" }
$updated = $source.Replace($marker, ('$pinnedManifestSignerPublicKeyBase64 = "' + $encodedPublicKey + '"'))
[System.IO.File]::WriteAllText($resolvedHelper, $updated, [System.Text.UTF8Encoding]::new($true))
if ([string]::IsNullOrWhiteSpace($Publisher) -or $Publisher.Length -gt 512 -or $Publisher -match "[`r`n]") { throw "Publisher is invalid" }
$controlCenter = Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedControlCenter
$controlCenterMarker = '$updatePublisherBase64 = ""'
if ([regex]::Matches($controlCenter, [regex]::Escape($controlCenterMarker)).Count -ne 1) { throw "Control center update policy marker must occur exactly once" }
$encodedPublisher = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Publisher))
$controlCenter = $controlCenter.Replace($controlCenterMarker, ('$updatePublisherBase64 = "' + $encodedPublisher + '"'))
[System.IO.File]::WriteAllText($resolvedControlCenter, $controlCenter, [System.Text.UTF8Encoding]::new($true))
Write-Host "UPDATE_POLICY_INJECTED helper=$resolvedHelper controlCenter=$resolvedControlCenter"
