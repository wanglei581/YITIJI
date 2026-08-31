[CmdletBinding()]
param(
  [string]$MsiPath,
  [string]$OutputDirectory,
  [string]$ProductVersion
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
if ([string]::IsNullOrWhiteSpace($ProductVersion)) {
  $ProductVersion = [string]$inputs.productVersion
}
if ($ProductVersion -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
  throw "ProductVersion must be a three-part numeric bundle version: $ProductVersion"
}
$versionParts = @($ProductVersion.Split('.') | ForEach-Object { [int]$_ })
if ($versionParts[0] -gt 255 -or $versionParts[1] -gt 255 -or $versionParts[2] -gt 65535) {
  throw "ProductVersion exceeds Windows Installer bounds: $ProductVersion"
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$resolvedOutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path

$project = Join-Path $PSScriptRoot "AIJobPrintTerminalSetup.wixproj"
& dotnet build $project `
  --configuration Release `
  --output $resolvedOutputDirectory `
  -p:MsiPath=$resolvedMsi `
  -p:ProductVersion=$ProductVersion
if ($LASTEXITCODE -ne 0) { throw "WiX Burn EXE build failed" }

$bundles = @(Get-ChildItem -LiteralPath $resolvedOutputDirectory -Filter "*.exe" -File)
if ($bundles.Count -ne 1) {
  throw "Expected exactly one EXE output, found $($bundles.Count)"
}
if ($bundles[0].Name -cne "AIJobPrintTerminalSetup.exe") {
  throw "Unexpected bundle name: $($bundles[0].Name)"
}

$hash = (Get-FileHash -LiteralPath $bundles[0].FullName -Algorithm SHA256).Hash
Write-Host "EXE_READY path=$($bundles[0].FullName) version=$ProductVersion sha256=$hash"
Write-Warning "This EXE is an unsigned CI candidate. Production release requires controlled Authenticode signing and verification."
