[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Create", "Verify")]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$CandidateRoot,

  [Parameter(Mandatory = $true)]
  [string]$SourceCommit,

  [Parameter(Mandatory = $true)]
  [string]$ProductVersion
)

$ErrorActionPreference = "Stop"
$expectedFiles = @(
  "AIJobPrintTerminalSetup.exe",
  "AIJobPrintAgent.msi",
  "staging-manifest.json"
)
$resolvedRoot = (Resolve-Path -LiteralPath $CandidateRoot).Path
$identityPath = Join-Path $resolvedRoot "candidate-identity.json"

function Get-CandidateFileRecord {
  param([Parameter(Mandatory = $true)][string]$RelativePath)

  $fullPath = Join-Path $resolvedRoot $RelativePath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Candidate file is missing: $RelativePath"
  }
  $file = Get-Item -LiteralPath $fullPath
  return [ordered]@{
    path = $RelativePath
    bytes = [long]$file.Length
    sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToUpperInvariant()
  }
}

function Assert-StagingManifest {
  $manifestPath = Join-Path $resolvedRoot "staging-manifest.json"
  $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
  if ([string]$manifest.gitCommit -ine $SourceCommit) {
    throw "Staging manifest source commit mismatch: expected $SourceCommit, got $($manifest.gitCommit)"
  }
  if ([string]$manifest.productVersion -ne $ProductVersion) {
    throw "Staging manifest product version mismatch: expected $ProductVersion, got $($manifest.productVersion)"
  }
}

Assert-StagingManifest

if ($Mode -eq "Create") {
  $identity = [ordered]@{
    schemaVersion = 1
    sourceCommit = $SourceCommit.ToLowerInvariant()
    productVersion = $ProductVersion
    files = @($expectedFiles | ForEach-Object { Get-CandidateFileRecord -RelativePath $_ })
  }
  $json = $identity | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText(
    $identityPath,
    $json,
    (New-Object System.Text.UTF8Encoding($false))
  )
  Write-Host "CANDIDATE_IDENTITY_CREATED path=$identityPath sourceCommit=$($identity.sourceCommit) productVersion=$ProductVersion"
}

if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) {
  throw "Candidate identity is missing: $identityPath"
}
$recorded = Get-Content -Raw -Encoding UTF8 -LiteralPath $identityPath | ConvertFrom-Json
if ([int]$recorded.schemaVersion -ne 1) {
  throw "Unsupported candidate identity schema: $($recorded.schemaVersion)"
}
if ([string]$recorded.sourceCommit -ine $SourceCommit) {
  throw "Candidate identity source commit mismatch: expected $SourceCommit, got $($recorded.sourceCommit)"
}
if ([string]$recorded.productVersion -ne $ProductVersion) {
  throw "Candidate identity product version mismatch: expected $ProductVersion, got $($recorded.productVersion)"
}

$recordedFiles = @($recorded.files)
if ($recordedFiles.Count -ne $expectedFiles.Count) {
  throw "Candidate identity must contain exactly $($expectedFiles.Count) files, found $($recordedFiles.Count)"
}
foreach ($relativePath in $expectedFiles) {
  $matches = @($recordedFiles | Where-Object { [string]$_.path -ceq $relativePath })
  if ($matches.Count -ne 1) {
    throw "Candidate identity must contain exactly one record for $relativePath"
  }
  $actual = Get-CandidateFileRecord -RelativePath $relativePath
  if ([long]$matches[0].bytes -ne $actual.bytes) {
    throw "Candidate file size mismatch for ${relativePath}: expected $($matches[0].bytes), got $($actual.bytes)"
  }
  if ([string]$matches[0].sha256 -ine $actual.sha256) {
    throw "Candidate SHA256 mismatch for ${relativePath}: expected $($matches[0].sha256), got $($actual.sha256)"
  }
}

Write-Host "CANDIDATE_IDENTITY_PASS sourceCommit=$($recorded.sourceCommit) productVersion=$ProductVersion"
