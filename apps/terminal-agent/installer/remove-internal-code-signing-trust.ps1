[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern("^[0-9A-Fa-f]{40}$")][string]$RootThumbprint,
  [Parameter(Mandatory)][ValidatePattern("^[0-9A-Fa-f]{40}$")][string]$SignerThumbprint,
  [ValidateSet("CurrentUser", "LocalMachine")][string]$StoreScope = "CurrentUser",
  [switch]$RemovePrivateCertificates,
  [switch]$AcknowledgeEphemeralNonProductionHost
)

$ErrorActionPreference = "Stop"
if ($StoreScope -eq "LocalMachine" -and -not $AcknowledgeEphemeralNonProductionHost) {
  throw "INTERNAL_SIGNING_TRUST_REMOVE_FAILED: LocalMachine cleanup requires -AcknowledgeEphemeralNonProductionHost."
}

$targets = @(
  [pscustomobject]@{ Store = "Cert:\$StoreScope\Root"; Thumbprint = $RootThumbprint.ToUpperInvariant(); DeleteKey = $false },
  [pscustomobject]@{ Store = "Cert:\$StoreScope\TrustedPublisher"; Thumbprint = $SignerThumbprint.ToUpperInvariant(); DeleteKey = $false }
)
if ($RemovePrivateCertificates) {
  $targets += @(
    [pscustomobject]@{ Store = "Cert:\$StoreScope\My"; Thumbprint = $RootThumbprint.ToUpperInvariant(); DeleteKey = $true },
    [pscustomobject]@{ Store = "Cert:\$StoreScope\My"; Thumbprint = $SignerThumbprint.ToUpperInvariant(); DeleteKey = $true }
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

Write-Host "INTERNAL_SIGNING_TRUST_REMOVED scope=$StoreScope privateCertificatesRemoved=$($RemovePrivateCertificates.IsPresent)"
