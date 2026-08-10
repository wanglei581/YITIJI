[CmdletBinding()]
param(
  [string]$StagingRoot,
  [string]$OutputDirectory,
  [string]$ProductVersion
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($StagingRoot)) {
  $StagingRoot = Join-Path $PSScriptRoot "artifacts\staging"
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $PSScriptRoot "artifacts\msi"
}
$inputs = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot "inputs.json") | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($ProductVersion)) {
  $ProductVersion = [string]$inputs.productVersion
}
if ($ProductVersion -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
  throw "ProductVersion must be a three-part numeric MSI version: $ProductVersion"
}
$versionParts = @($ProductVersion.Split('.') | ForEach-Object { [int]$_ })
if ($versionParts[0] -gt 255 -or $versionParts[1] -gt 255 -or $versionParts[2] -gt 65535) {
  throw "ProductVersion exceeds Windows Installer bounds: $ProductVersion"
}
$resolvedStaging = (Resolve-Path -LiteralPath $StagingRoot).Path
$manifest = Join-Path $resolvedStaging "manifest.json"
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
  throw "Staging manifest is missing: $manifest"
}
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw "dotnet SDK is required to build the WiX MSI"
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$resolvedOutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$fragment = Join-Path $resolvedOutputDirectory "GeneratedPayload.wxs"
& (Join-Path $PSScriptRoot "generate-wix-fragment.ps1") -StagingRoot $resolvedStaging -OutputPath $fragment
if (-not (Test-Path -LiteralPath $fragment -PathType Leaf)) { throw "WiX fragment generation failed" }

$project = Join-Path $PSScriptRoot "AIJobPrintAgent.wixproj"
& dotnet build $project `
  --configuration Release `
  --output $resolvedOutputDirectory `
  -p:StagingRoot=$resolvedStaging `
  -p:GeneratedFragment=$fragment `
  -p:ProductVersion=$ProductVersion
if ($LASTEXITCODE -ne 0) { throw "WiX MSI build failed" }

$packages = @(Get-ChildItem -LiteralPath $resolvedOutputDirectory -Filter "*.msi" -File)
if ($packages.Count -ne 1) {
  throw "Expected exactly one MSI output, found $($packages.Count)"
}
$hash = (Get-FileHash -LiteralPath $packages[0].FullName -Algorithm SHA256).Hash
Write-Host "MSI_READY path=$($packages[0].FullName) version=$ProductVersion sha256=$hash"
Write-Warning "This MSI is an unsigned CI candidate. Production release requires controlled Authenticode signing and verification."
