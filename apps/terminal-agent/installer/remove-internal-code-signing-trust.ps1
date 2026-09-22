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
# Callers skip this script when the marker is absent. Reaching the deletes requires the marker.
if ($StoreScope -eq "LocalMachine") {
  if ([string]::IsNullOrWhiteSpace($RunOwnershipMarkerPath) -or -not (Test-Path -LiteralPath $RunOwnershipMarkerPath -PathType Leaf)) {
    throw "INTERNAL_SIGNING_TRUST_REMOVE_FAILED: LocalMachine cleanup requires an existing run ownership marker."
  }
}

$targets = @(
  [pscustomobject]@{ Store = "Cert:\$StoreScope\Root"; Thumbprint = $RootThumbprint.ToUpperInvariant(); DeleteKey = $false },
  [pscustomobject]@{ Store = "Cert:\$StoreScope\TrustedPublisher"; Thumbprint = $SignerThumbprint.ToUpperInvariant(); DeleteKey = $false }
)
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

if ($StoreScope -eq "LocalMachine") {
  Remove-Item -LiteralPath $RunOwnershipMarkerPath -Force
  if (Test-Path -LiteralPath $RunOwnershipMarkerPath) {
    throw "INTERNAL_SIGNING_TRUST_REMOVE_FAILED: run ownership marker remains."
  }
}

Write-Host "INTERNAL_SIGNING_TRUST_REMOVED scope=$StoreScope privateKeyScope=$privateScope privateCertificatesRemoved=$($RemovePrivateCertificates.IsPresent)"
