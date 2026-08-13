[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$StagingRoot)

$ErrorActionPreference = "Stop"
$fixtureRoot = Join-Path $env:TEMP ("AIJobPrintUpdateVerify-" + [Guid]::NewGuid().ToString("N"))
$helperSource = Join-Path $StagingRoot "provision\terminal-update-helper.ps1"
$manifest = Join-Path $fixtureRoot "manifest.json"
$package = Join-Path $fixtureRoot "AIJobPrintTerminalSetup.exe"
$rollbackPackage = Join-Path $fixtureRoot "AIJobPrintTerminalSetup-rollback.exe"
$privateKey = Join-Path $fixtureRoot "private.xml"
$publicKey = Join-Path $fixtureRoot "public.xml"
$result = Join-Path $fixtureRoot "result.json"
$manifestBuilder = Join-Path $PSScriptRoot "create-update-manifest.ps1"
$thumbprint = "0123456789ABCDEF0123456789ABCDEF01234567"
$previousCi = $env:CI

try {
  New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
  $helper = $helperSource
  [System.IO.File]::WriteAllBytes($package, [System.Text.Encoding]::UTF8.GetBytes("signed-package-fixture"))
  [System.IO.File]::WriteAllBytes($rollbackPackage, [System.Text.Encoding]::UTF8.GetBytes("signed-rollback-fixture"))
  # Windows PowerShell 5.1 can return an RSA implementation whose KeySize
  # property is read-only. Construct the CI fixture with an explicit size so
  # the same test works on the supported Windows runtime.
  $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider -ArgumentList 2048
  try {
    [System.IO.File]::WriteAllText($privateKey, $rsa.ToXmlString($true), [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($publicKey, $rsa.ToXmlString($false), [System.Text.UTF8Encoding]::new($false))
  } finally { $rsa.Dispose() }

  & $manifestBuilder `
    -PackagePath $package `
    -PackageUrl "https://zyidai.cn/downloads/terminal-agent/0.4.9/AIJobPrintTerminalSetup.exe" `
    -Version "0.4.9" `
    -MinimumVersion "0.4.8" `
    -Publisher "AI Job Print Verify" `
    -PackageCertificateThumbprint $thumbprint `
    -ReleaseNotes "verify" `
    -RollbackVersion "0.4.8" `
    -RollbackPackagePath $rollbackPackage `
    -RollbackUrl "https://zyidai.cn/downloads/terminal-agent/0.4.8/AIJobPrintTerminalSetup.exe" `
    -RollbackCertificateThumbprint $thumbprint `
    -SigningPrivateKeyPath $privateKey `
    -OutputPath $manifest

  $env:CI = "true"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper `
    -Action Check `
    -ManifestUri "https://zyidai.cn/downloads/terminal-agent/stable/manifest.json" `
    -ExpectedPublisher "AI Job Print Verify" `
    -CurrentVersion "0.4.8" `
    -TestManifestSignerPublicKeyPath $publicKey `
    -TestManifestPath $manifest `
    -ResultPath $result
  if ($LASTEXITCODE -ne 0) { throw "Signed manifest check failed" }
  $checked = Get-Content -Raw -Encoding UTF8 -LiteralPath $result | ConvertFrom-Json
  if ($checked.status -ne "available" -or $checked.candidateVersion -ne "0.4.9" -or [string]$checked.manifestApprovalId -notmatch "^[A-F0-9]{64}$") { throw "Signed manifest result is invalid" }
  $checkedApprovalId = [string]$checked.manifestApprovalId

  $tampered = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifest | ConvertFrom-Json
  $tampered.releaseNotes = "tampered"
  [System.IO.File]::WriteAllText($manifest, (($tampered | ConvertTo-Json -Depth 8) + "`n"), [System.Text.UTF8Encoding]::new($false))
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper `
    -Action Check `
    -ManifestUri "https://zyidai.cn/downloads/terminal-agent/stable/manifest.json" `
    -ExpectedPublisher "AI Job Print Verify" `
    -CurrentVersion "0.4.8" `
    -TestManifestSignerPublicKeyPath $publicKey `
    -TestManifestPath $manifest `
    -ResultPath $result
  if ($LASTEXITCODE -eq 0) { throw "Tampered manifest must fail closed" }
  $failed = Get-Content -Raw -Encoding UTF8 -LiteralPath $result | ConvertFrom-Json
  if ($failed.code -ne "UPDATE_MANIFEST_SIGNATURE_INVALID") { throw "Tampered manifest failed with unexpected code" }

  & $manifestBuilder `
    -PackagePath $package `
    -PackageUrl "https://zyidai.cn/downloads/terminal-agent/0.4.9/AIJobPrintTerminalSetup.exe" `
    -Version "0.4.9" `
    -MinimumVersion "0.4.8" `
    -Publisher "AI Job Print Verify" `
    -PackageCertificateThumbprint $thumbprint `
    -ReleaseNotes "verify-republished" `
    -RollbackVersion "0.4.8" `
    -RollbackPackagePath $rollbackPackage `
    -RollbackUrl "https://zyidai.cn/downloads/terminal-agent/0.4.8/AIJobPrintTerminalSetup.exe" `
    -RollbackCertificateThumbprint $thumbprint `
    -SigningPrivateKeyPath $privateKey `
    -OutputPath $manifest

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper `
    -Action Install `
    -ManifestUri "https://zyidai.cn/downloads/terminal-agent/stable/manifest.json" `
    -ExpectedPublisher "AI Job Print Verify" `
    -CurrentVersion "0.4.8" `
    -ExpectedCandidateVersion "0.4.9" `
    -ExpectedManifestApprovalId $checkedApprovalId `
    -TestManifestSignerPublicKeyPath $publicKey `
    -TestManifestPath $manifest `
    -ResultPath $result
  if ($LASTEXITCODE -eq 0) { throw "A republished signed manifest must require fresh user confirmation" }
  $changedManifestFailure = Get-Content -Raw -Encoding UTF8 -LiteralPath $result | ConvertFrom-Json
  if ($changedManifestFailure.code -ne "UPDATE_MANIFEST_CHANGED") { throw "Changed signed manifest failed with unexpected code" }

  & $manifestBuilder `
    -PackagePath $package `
    -PackageUrl "https://zyidai.cn/downloads/terminal-agent/0.4.8/AIJobPrintTerminalSetup.exe" `
    -Version "0.4.8" `
    -MinimumVersion "0.4.8" `
    -Publisher "AI Job Print Verify" `
    -PackageCertificateThumbprint $thumbprint `
    -ReleaseNotes "channel moved while confirmation dialog was open" `
    -RollbackVersion "0.4.7" `
    -RollbackPackagePath $rollbackPackage `
    -RollbackUrl "https://zyidai.cn/downloads/terminal-agent/0.4.7/AIJobPrintTerminalSetup.exe" `
    -RollbackCertificateThumbprint $thumbprint `
    -SigningPrivateKeyPath $privateKey `
    -OutputPath $manifest

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper `
    -Action Install `
    -ManifestUri "https://zyidai.cn/downloads/terminal-agent/stable/manifest.json" `
    -ExpectedPublisher "AI Job Print Verify" `
    -CurrentVersion "0.4.8" `
    -ExpectedCandidateVersion "0.4.9" `
    -ExpectedManifestApprovalId $checkedApprovalId `
    -TestManifestSignerPublicKeyPath $publicKey `
    -TestManifestPath $manifest `
    -ResultPath $result
  if ($LASTEXITCODE -eq 0) { throw "A channel move to the current version must not be reported as a successful install" }
  $changedCandidateFailure = Get-Content -Raw -Encoding UTF8 -LiteralPath $result | ConvertFrom-Json
  if ($changedCandidateFailure.code -ne "UPDATE_CANDIDATE_CHANGED") { throw "Changed candidate failed with unexpected code" }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper `
    -Action Install `
    -ManifestUri "https://zyidai.cn/downloads/terminal-agent/stable/manifest.json" `
    -ExpectedPublisher "AI Job Print Verify" `
    -CurrentVersion "0.4.8" `
    -ExpectedCandidateVersion "0.4.8" `
    -ExpectedManifestApprovalId (("0" * 64) -join "") `
    -TestManifestSignerPublicKeyPath $publicKey `
    -TestManifestPath $manifest `
    -ResultPath $result
  if ($LASTEXITCODE -eq 0) { throw "An install with a stale approval must fail before reporting up-to-date" }
  $staleApprovalFailure = Get-Content -Raw -Encoding UTF8 -LiteralPath $result | ConvertFrom-Json
  if ($staleApprovalFailure.code -ne "UPDATE_MANIFEST_CHANGED") { throw "Stale approval failed with unexpected code" }

  $env:CI = "false"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper `
    -Action Check `
    -ManifestUri "https://zyidai.cn/downloads/terminal-agent/stable/manifest.json" `
    -ExpectedPublisher "AI Job Print Verify" `
    -CurrentVersion "0.4.8" `
    -TestManifestSignerPublicKeyPath $publicKey `
    -TestManifestPath $manifest `
    -ResultPath $result
  if ($LASTEXITCODE -eq 0) { throw "Test hooks must fail outside CI" }
  $testHookFailure = Get-Content -Raw -Encoding UTF8 -LiteralPath $result | ConvertFrom-Json
  if ($testHookFailure.code -ne "UPDATE_TEST_HOOK_FORBIDDEN") { throw "Test hook guard failed with unexpected code" }

  Write-Host "UPDATE_HELPER_VERIFY_PASS signedManifest=true tamperRejected=true confirmationBound=true candidateChangeRejected=true staleApprovalRejected=true testHooksGuarded=true"
} finally {
  $env:CI = $previousCi
  Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}
