[CmdletBinding()]
param(
  [string]$MsiPath,
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($MsiPath)) {
  $msiDirectory = Join-Path $PSScriptRoot "artifacts\msi"
  $msiCandidates = @(Get-ChildItem -LiteralPath $msiDirectory -Filter "*.msi" -File -ErrorAction SilentlyContinue)
  if ($msiCandidates.Count -ne 1) {
    throw "Expected exactly one MSI input in $msiDirectory, found $($msiCandidates.Count)"
  }
  $MsiPath = $msiCandidates[0].FullName
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $PSScriptRoot "artifacts\exe"
}
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw "dotnet SDK is required to build the WiX Burn bundle"
}

$resolvedMsi = (Resolve-Path -LiteralPath $MsiPath).Path
$inputs = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot "inputs.json") | ConvertFrom-Json
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$project = Join-Path $PSScriptRoot "AIJobPrintTerminalSetup.wixproj"
& dotnet build $project `
  --configuration Release `
  --output $OutputDirectory `
  -p:MsiPath=$resolvedMsi `
  -p:ProductVersion=$($inputs.productVersion)
if ($LASTEXITCODE -ne 0) { throw "WiX Burn EXE build failed" }

$bundles = @(Get-ChildItem -LiteralPath $OutputDirectory -Filter "*.exe" -File)
if ($bundles.Count -ne 1) {
  throw "Expected exactly one EXE output, found $($bundles.Count)"
}
if ($bundles[0].Name -cne "AIJobPrintTerminalSetup.exe") {
  throw "Unexpected bundle name: $($bundles[0].Name)"
}

$hash = (Get-FileHash -LiteralPath $bundles[0].FullName -Algorithm SHA256).Hash
Write-Host "EXE_READY path=$($bundles[0].FullName) sha256=$hash"
Write-Warning "This EXE is an unsigned CI candidate. Production release requires controlled Authenticode signing and verification."
