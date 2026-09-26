[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern("^[0-9A-Fa-f]{40}$")][string]$RootThumbprint,
  [Parameter(Mandatory)][ValidatePattern("^[0-9A-Fa-f]{40}$")][string]$SignerThumbprint,
  [ValidateSet("CurrentUser", "LocalMachine")][string]$StoreScope = "CurrentUser",
  [ValidateSet("CurrentUser", "LocalMachine")][string]$PrivateKeyStoreScope = "",
  [string]$RunOwnershipMarkerPath,
  [switch]$RemovePrivateCertificates,
  [switch]$AcknowledgeEphemeralNonProductionHost
)

$ErrorActionPreference = "Stop"
if ($StoreScope -eq "LocalMachine" -and -not $AcknowledgeEphemeralNonProductionHost) {
  throw "INTERNAL_SIGNING_TRUST_REMOVE_FAILED: LocalMachine cleanup requires -AcknowledgeEphemeralNonProductionHost."
}

$privateScope = $StoreScope
if (-not [string]::IsNullOrWhiteSpace($PrivateKeyStoreScope)) {
  $privateScope = $PrivateKeyStoreScope
}
if ($StoreScope -eq "LocalMachine" -and $privateScope -eq "LocalMachine") {
  throw "INTERNAL_SIGNING_TRUST_REMOVE_FAILED: LocalMachine trust and private-key scopes together are forbidden."
}
# A missing marker skips LocalMachine Root and TrustedPublisher only. This run's private keys still delete.
$ownsTrustEntries = $StoreScope -ne "LocalMachine"
if ($StoreScope -eq "LocalMachine") {
  $ownsTrustEntries = -not [string]::IsNullOrWhiteSpace($RunOwnershipMarkerPath) -and (Test-Path -LiteralPath $RunOwnershipMarkerPath -PathType Leaf)
}

$targets = @()
if ($ownsTrustEntries) {
  $targets += @(
    [pscustomobject]@{ Store = "Cert:\$StoreScope\Root"; Thumbprint = $RootThumbprint.ToUpperInvariant(); DeleteKey = $false },
    [pscustomobject]@{ Store = "Cert:\$StoreScope\TrustedPublisher"; Thumbprint = $SignerThumbprint.ToUpperInvariant(); DeleteKey = $false }
  )
}
if ($RemovePrivateCertificates) {
  $targets += @(
    [pscustomobject]@{ Store = "Cert:\$privateScope\My"; Thumbprint = $RootThumbprint.ToUpperInvariant(); DeleteKey = $true },
    [pscustomobject]@{ Store = "Cert:\$privateScope\My"; Thumbprint = $SignerThumbprint.ToUpperInvariant(); DeleteKey = $true }
  )
}

foreach ($target in $targets) {
  $path = Join-Path $target.Store $target.Thumbprint
  if (Test-Path -LiteralPath $path) {
    if ($target.DeleteKey) {
      Remove-Item -LiteralPath $path -DeleteKey -Force
    } else {
      Remove-Item -LiteralPath $path -Force
    }
  }
}

foreach ($target in $targets) {
  $path = Join-Path $target.Store $target.Thumbprint
  if (Test-Path -LiteralPath $path) {
    throw "INTERNAL_SIGNING_TRUST_REMOVE_FAILED: Certificate remains at '$path'."
  }
}

if ($ownsTrustEntries -and $StoreScope -eq "LocalMachine") {
  Remove-Item -LiteralPath $RunOwnershipMarkerPath -Force
  if (Test-Path -LiteralPath $RunOwnershipMarkerPath) {
    throw "INTERNAL_SIGNING_TRUST_REMOVE_FAILED: run ownership marker remains."
  }
}

$trustCleanup = "removed"
if (-not $ownsTrustEntries) {
  $trustCleanup = "skipped-no-ownership"
}
Write-Host "INTERNAL_SIGNING_TRUST_REMOVED scope=$StoreScope trustCleanup=$trustCleanup privateKeyScope=$privateScope privateCertificatesRemoved=$($RemovePrivateCertificates.IsPresent)"
