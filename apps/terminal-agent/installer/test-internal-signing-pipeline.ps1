[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })][string]$UnsignedCandidateRoot,
  [Parameter(Mandatory)][ValidatePattern("^[0-9A-Fa-f]{40}$")][string]$SourceCommit,
  [Parameter(Mandatory)][ValidatePattern("^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")][string]$ProductVersion,
  [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$EvidenceRoot,
  [switch]$ExerciseLifecycle,
  [switch]$UseEphemeralGitHubHostedLocalMachineTrust,
  [string]$SignToolPath,
  [string]$WixToolPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "signing-tools.ps1")

function Expect-Failure([string]$Name, [scriptblock]$Action, [string]$MessagePattern) {
  $failed = $false
  try {
    & $Action
  } catch {
    if (-not [string]::IsNullOrWhiteSpace($MessagePattern) -and $_.Exception.Message -notmatch $MessagePattern) {
      throw "INTERNAL_SIGNING_PIPELINE_TEST_FAILED: '$Name' failed for the wrong reason: $($_.Exception.Message)"
    }
    $failed = $true
    Write-Host "EXPECTED_FAILURE_PASS name=$Name message=$($_.Exception.Message)"
  }
  if (-not $failed) {
    throw "INTERNAL_SIGNING_PIPELINE_TEST_FAILED: Expected failure did not occur: $Name"
  }
}

function Rewrite-ReleaseIdentityForBundle([string]$Root, $Certificate, [string]$EnginePath) {
  $identityPath = Join-Path $Root "signed-release-identity.json"
  $signaturePath = Join-Path $Root "signed-release-identity.p7s"
  $exePath = Join-Path $Root "AIJobPrintTerminalSetup.exe"
  $identity = Get-Content -Raw -Encoding UTF8 -LiteralPath $identityPath | ConvertFrom-Json
  $exeRecord = @($identity.outputs | Where-Object { [string]$_.name -ceq "AIJobPrintTerminalSetup.exe" })
  if ($exeRecord.Count -ne 1) {
    throw "INTERNAL_SIGNING_PIPELINE_TEST_FAILED: Release identity has no unique EXE output record."
  }
  $actual = Get-FileRecord -Path $exePath -Name "AIJobPrintTerminalSetup.exe"
  $exeRecord[0].bytes = $actual.bytes
  $exeRecord[0].sha256 = $actual.sha256
  if (-not [string]::IsNullOrWhiteSpace($EnginePath)) {
    $identity.embeddedEngine.sha256 = (Get-FileHash -LiteralPath $EnginePath -Algorithm SHA256).Hash.ToUpperInvariant()
    $identity.embeddedEngine.signerThumbprint = $Certificate.Thumbprint
  }
  [System.IO.File]::WriteAllText(
    $identityPath,
    (($identity | ConvertTo-Json -Depth 9) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
  Write-DetachedCmsSignature -ContentPath $identityPath -SignaturePath $signaturePath -Certificate $Certificate
}

$resolvedEvidence = [System.IO.Path]::GetFullPath($EvidenceRoot)
if (Test-Path -LiteralPath $resolvedEvidence) {
  $existing = @(Get-ChildItem -LiteralPath $resolvedEvidence -Force)
  if ($existing.Count -gt 0) {
    throw "INTERNAL_SIGNING_PIPELINE_TEST_FAILED: EvidenceRoot must be absent or empty."
  }
}
New-Item -ItemType Directory -Path $resolvedEvidence -Force | Out-Null

$certificateRoot = Join-Path $resolvedEvidence "certificates"
$releaseRoot = Join-Path $resolvedEvidence "signed-release-NOT-FOR-DEPLOYMENT"
$tamperedArtifactRoot = Join-Path $resolvedEvidence "tampered-artifact"
$tamperedIdentityRoot = Join-Path $resolvedEvidence "tampered-identity"
$semanticIdentityRoot = Join-Path $resolvedEvidence "semantically-invalid-signed-identity"
$unsignedEmbeddedMsiRoot = Join-Path $resolvedEvidence "outer-signed-unsigned-embedded-msi"
$unsignedEngineRoot = Join-Path $resolvedEvidence "outer-signed-unsigned-engine"
$missingTimestampRoot = Join-Path $resolvedEvidence "release-mode-missing-timestamp"
$rootThumbprint = $null
$signerThumbprint = $null
$pipelineFailure = $null
$ownershipMarkerPath = Join-Path $resolvedEvidence "run-ownership.marker"

try {
  & (Join-Path $PSScriptRoot "new-internal-code-signing-certificates.ps1") `
    -PublicOutputDirectory $certificateRoot
  $certificateMetadataPath = Join-Path $certificateRoot "internal-signing-certificate.json"
  $certificateMetadata = Get-Content -Raw -Encoding UTF8 -LiteralPath $certificateMetadataPath | ConvertFrom-Json
  $rootThumbprint = [string]$certificateMetadata.root.thumbprint
  $signerThumbprint = [string]$certificateMetadata.signer.thumbprint
  $resolvedSignTool = Resolve-SignTool $SignToolPath
  $resolvedWixTool = Resolve-WixTool $WixToolPath

  Expect-Failure "local-machine-trust-requires-acknowledgement" {
    & (Join-Path $PSScriptRoot "install-internal-code-signing-trust.ps1") `
      -RootCertificatePath (Join-Path $certificateRoot $certificateMetadata.root.certificateFile) `
      -SignerCertificatePath (Join-Path $certificateRoot $certificateMetadata.signer.certificateFile) `
      -StoreScope LocalMachine
  } "LocalMachine trust requires"

  Expect-Failure "local-machine-trust-requires-github-hosted-runner" {
    $savedRunnerEnvironment = @{
      GITHUB_ACTIONS = $env:GITHUB_ACTIONS
      RUNNER_OS = $env:RUNNER_OS
      RUNNER_ENVIRONMENT = $env:RUNNER_ENVIRONMENT
    }
    try {
      foreach ($name in @("GITHUB_ACTIONS", "RUNNER_OS", "RUNNER_ENVIRONMENT")) {
        Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
      }
      & (Join-Path $PSScriptRoot "install-internal-code-signing-trust.ps1") `
        -RootCertificatePath (Join-Path $certificateRoot $certificateMetadata.root.certificateFile) `
        -SignerCertificatePath (Join-Path $certificateRoot $certificateMetadata.signer.certificateFile) `
        -StoreScope LocalMachine `
        -AcknowledgeEphemeralNonProductionHost `
        -CertificateMetadataPath $certificateMetadataPath `
        -RunOwnershipMarkerPath $ownershipMarkerPath
    } finally {
      foreach ($name in @("GITHUB_ACTIONS", "RUNNER_OS", "RUNNER_ENVIRONMENT")) {
        if ($null -eq $savedRunnerEnvironment[$name]) {
          Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
        } else {
          Set-Item -Path "Env:$name" -Value $savedRunnerEnvironment[$name]
        }
      }
    }
  } "github-hosted Windows Actions runner"
  foreach ($storeName in @("Root", "TrustedPublisher")) {
    foreach ($thumbprint in @($rootThumbprint, $signerThumbprint)) {
      if (Test-Path -LiteralPath "Cert:\LocalMachine\$storeName\$thumbprint") {
        throw "INTERNAL_SIGNING_PIPELINE_TEST_FAILED: LocalMachine trust entry exists after a refused install."
      }
    }
  }
  if (Test-Path -LiteralPath $ownershipMarkerPath) {
    throw "INTERNAL_SIGNING_PIPELINE_TEST_FAILED: Run ownership marker exists after a refused install."
  }

  if ($UseEphemeralGitHubHostedLocalMachineTrust) {
    & (Join-Path $PSScriptRoot "install-internal-code-signing-trust.ps1") `
      -RootCertificatePath (Join-Path $certificateRoot $certificateMetadata.root.certificateFile) `
      -SignerCertificatePath (Join-Path $certificateRoot $certificateMetadata.signer.certificateFile) `
      -StoreScope LocalMachine `
      -AcknowledgeEphemeralNonProductionHost `
      -CertificateMetadataPath $certificateMetadataPath `
      -RunOwnershipMarkerPath $ownershipMarkerPath
  } else {
    & (Join-Path $PSScriptRoot "install-internal-code-signing-trust.ps1") `
      -RootCertificatePath (Join-Path $certificateRoot $certificateMetadata.root.certificateFile) `
      -SignerCertificatePath (Join-Path $certificateRoot $certificateMetadata.signer.certificateFile)
  }

  Expect-Failure "release-mode-requires-timestamp" {
    & (Join-Path $PSScriptRoot "sign-windows-installer-release.ps1") `
      -UnsignedCandidateRoot $UnsignedCandidateRoot `
      -SourceCommit $SourceCommit `
      -ProductVersion $ProductVersion `
      -CertificateThumbprint $signerThumbprint `
      -OutputDirectory $missingTimestampRoot `
      -SigningMode Release `
      -SignToolPath $SignToolPath `
      -WixToolPath $WixToolPath
  } "Release mode requires an approved RFC3161 HTTPS timestamp URL"
  if (Test-Path -LiteralPath $missingTimestampRoot) {
    throw "INTERNAL_SIGNING_PIPELINE_TEST_FAILED: Release mode created output before rejecting a missing timestamp."
  }

  & (Join-Path $PSScriptRoot "sign-windows-installer-release.ps1") `
    -UnsignedCandidateRoot $UnsignedCandidateRoot `
    -SourceCommit $SourceCommit `
    -ProductVersion $ProductVersion `
    -CertificateThumbprint $signerThumbprint `
    -OutputDirectory $releaseRoot `
    -SigningMode InternalTest `
    -SignToolPath $SignToolPath `
    -WixToolPath $WixToolPath

  & (Join-Path $PSScriptRoot "verify-windows-installer-release.ps1") `
    -ReleaseRoot $releaseRoot `
    -ExpectedSourceCommit $SourceCommit `
    -ExpectedProductVersion $ProductVersion `
    -ExpectedSignerThumbprint $signerThumbprint `
    -ExpectedSigningMode InternalTest `
    -SignToolPath $SignToolPath `
    -WixToolPath $WixToolPath

  Copy-Item -LiteralPath $releaseRoot -Destination $tamperedArtifactRoot -Recurse
  [System.IO.File]::AppendAllText((Join-Path $tamperedArtifactRoot "AIJobPrintAgent.msi"), "tamper")
  Expect-Failure "tampered-signed-msi" {
    & (Join-Path $PSScriptRoot "verify-windows-installer-release.ps1") `
      -ReleaseRoot $tamperedArtifactRoot `
      -ExpectedSourceCommit $SourceCommit `
      -ExpectedProductVersion $ProductVersion `
      -ExpectedSignerThumbprint $signerThumbprint `
      -ExpectedSigningMode InternalTest `
      -SignToolPath $SignToolPath `
      -WixToolPath $WixToolPath
  } "Signed release output hash or size mismatch for 'AIJobPrintAgent\.msi'"

  Copy-Item -LiteralPath $releaseRoot -Destination $tamperedIdentityRoot -Recurse
  $tamperedIdentityPath = Join-Path $tamperedIdentityRoot "signed-release-identity.json"
  $tamperedIdentity = Get-Content -Raw -Encoding UTF8 -LiteralPath $tamperedIdentityPath
  $recordedIdentity = $tamperedIdentity | ConvertFrom-Json
  $tamperedIdentity = $tamperedIdentity.Replace([string]$recordedIdentity.signedAt, "2000-01-01T00:00:00.0000000Z")
  [System.IO.File]::WriteAllText($tamperedIdentityPath, $tamperedIdentity, [System.Text.UTF8Encoding]::new($false))
  Expect-Failure "tampered-signed-release-identity" {
    & (Join-Path $PSScriptRoot "verify-windows-installer-release.ps1") `
      -ReleaseRoot $tamperedIdentityRoot `
      -ExpectedSourceCommit $SourceCommit `
      -ExpectedProductVersion $ProductVersion `
      -ExpectedSignerThumbprint $signerThumbprint `
      -ExpectedSigningMode InternalTest `
      -SignToolPath $SignToolPath `
      -WixToolPath $WixToolPath
  } "Detached signed-release identity signature is invalid"

  Copy-Item -LiteralPath $releaseRoot -Destination $semanticIdentityRoot -Recurse
  $semanticIdentityPath = Join-Path $semanticIdentityRoot "signed-release-identity.json"
  $semanticIdentity = Get-Content -Raw -Encoding UTF8 -LiteralPath $semanticIdentityPath | ConvertFrom-Json
  $semanticIdentity.deploymentEligibility = "production-ready"
  [System.IO.File]::WriteAllText(
    $semanticIdentityPath,
    (($semanticIdentity | ConvertTo-Json -Depth 9) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
  $signingCertificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$signerThumbprint"
  Write-DetachedCmsSignature `
    -ContentPath $semanticIdentityPath `
    -SignaturePath (Join-Path $semanticIdentityRoot "signed-release-identity.p7s") `
    -Certificate $signingCertificate
  Expect-Failure "semantically-invalid-signed-identity" {
    & (Join-Path $PSScriptRoot "verify-windows-installer-release.ps1") `
      -ReleaseRoot $semanticIdentityRoot `
      -ExpectedSourceCommit $SourceCommit `
      -ExpectedProductVersion $ProductVersion `
      -ExpectedSignerThumbprint $signerThumbprint `
      -ExpectedSigningMode InternalTest `
      -SignToolPath $SignToolPath `
      -WixToolPath $WixToolPath
  } "Signed release deployment eligibility is invalid"

  Copy-Item -LiteralPath $releaseRoot -Destination $unsignedEmbeddedMsiRoot -Recurse
  $unsignedEmbeddedMsiBuildRoot = Join-Path $resolvedEvidence "unsigned-embedded-msi-build"
  $unsignedEmbeddedMsiIntermediate = Join-Path $unsignedEmbeddedMsiBuildRoot "wix-intermediate"
  $unsignedEmbeddedMsiEngine = Join-Path $unsignedEmbeddedMsiBuildRoot "signed-engine.exe"
  $unsignedEmbeddedMsiBundle = Join-Path $unsignedEmbeddedMsiBuildRoot "reattached-bundle.exe"
  New-Item -ItemType Directory -Path $unsignedEmbeddedMsiIntermediate -Force | Out-Null
  Invoke-CheckedCommand -FilePath $resolvedWixTool -Arguments @(
    "burn", "detach", (Join-Path $UnsignedCandidateRoot "AIJobPrintTerminalSetup.exe"),
    "-engine", $unsignedEmbeddedMsiEngine, "-intermediateFolder", $unsignedEmbeddedMsiIntermediate
  ) -FailureMessage "WiX failed to detach the engine for the unsigned embedded MSI fixture."
  Assert-UnsignedAuthenticode $unsignedEmbeddedMsiEngine
  Invoke-SignAuthenticode `
    -SignToolPath $resolvedSignTool `
    -Path $unsignedEmbeddedMsiEngine `
    -Certificate $signingCertificate `
    -StoreScope CurrentUser
  Assert-ValidAuthenticode `
    -SignToolPath $resolvedSignTool `
    -Path $unsignedEmbeddedMsiEngine `
    -ExpectedThumbprint $signerThumbprint | Out-Null
  Invoke-CheckedCommand -FilePath $resolvedWixTool -Arguments @(
    "burn", "reattach", (Join-Path $UnsignedCandidateRoot "AIJobPrintTerminalSetup.exe"),
    "-engine", $unsignedEmbeddedMsiEngine, "-o", $unsignedEmbeddedMsiBundle,
    "-intermediateFolder", $unsignedEmbeddedMsiIntermediate
  ) -FailureMessage "WiX failed to reattach the signed engine for the unsigned embedded MSI fixture."
  Assert-UnsignedAuthenticode $unsignedEmbeddedMsiBundle
  Move-Item `
    -LiteralPath $unsignedEmbeddedMsiBundle `
    -Destination (Join-Path $unsignedEmbeddedMsiRoot "AIJobPrintTerminalSetup.exe") `
    -Force
  Invoke-SignAuthenticode `
    -SignToolPath $resolvedSignTool `
    -Path (Join-Path $unsignedEmbeddedMsiRoot "AIJobPrintTerminalSetup.exe") `
    -Certificate $signingCertificate `
    -StoreScope CurrentUser
  Rewrite-ReleaseIdentityForBundle `
    -Root $unsignedEmbeddedMsiRoot `
    -Certificate $signingCertificate `
    -EnginePath $unsignedEmbeddedMsiEngine
  Expect-Failure "outer-signed-bundle-with-unsigned-embedded-msi" {
    & (Join-Path $PSScriptRoot "verify-windows-installer-release.ps1") `
      -ReleaseRoot $unsignedEmbeddedMsiRoot `
      -ExpectedSourceCommit $SourceCommit `
      -ExpectedProductVersion $ProductVersion `
      -ExpectedSignerThumbprint $signerThumbprint `
      -ExpectedSigningMode InternalTest `
      -SignToolPath $resolvedSignTool `
      -WixToolPath $resolvedWixTool
  } "final bundle does not contain the signed MSI byte-for-byte"

  Copy-Item -LiteralPath $releaseRoot -Destination $unsignedEngineRoot -Recurse
  $unsignedEngineBuildRoot = Join-Path $resolvedEvidence "unsigned-engine-build"
  & (Join-Path $PSScriptRoot "build-exe.ps1") `
    -MsiPath (Join-Path $releaseRoot "AIJobPrintAgent.msi") `
    -OutputDirectory $unsignedEngineBuildRoot `
    -ProductVersion $ProductVersion
  $unsignedEngineIntermediate = Join-Path $unsignedEngineBuildRoot "wix-intermediate"
  $unsignedEnginePath = Join-Path $unsignedEngineBuildRoot "unsigned-engine.exe"
  New-Item -ItemType Directory -Path $unsignedEngineIntermediate -Force | Out-Null
  Invoke-CheckedCommand -FilePath $resolvedWixTool -Arguments @(
    "burn", "detach", (Join-Path $unsignedEngineBuildRoot "AIJobPrintTerminalSetup.exe"),
    "-engine", $unsignedEnginePath, "-intermediateFolder", $unsignedEngineIntermediate
  ) -FailureMessage "WiX failed to detach the unsigned engine fixture."
  Assert-UnsignedAuthenticode $unsignedEnginePath
  Copy-Item `
    -LiteralPath (Join-Path $unsignedEngineBuildRoot "AIJobPrintTerminalSetup.exe") `
    -Destination (Join-Path $unsignedEngineRoot "AIJobPrintTerminalSetup.exe") `
    -Force
  Invoke-SignAuthenticode `
    -SignToolPath $resolvedSignTool `
    -Path (Join-Path $unsignedEngineRoot "AIJobPrintTerminalSetup.exe") `
    -Certificate $signingCertificate `
    -StoreScope CurrentUser
  Rewrite-ReleaseIdentityForBundle `
    -Root $unsignedEngineRoot `
    -Certificate $signingCertificate `
    -EnginePath $unsignedEnginePath
  Expect-Failure "outer-signed-bundle-with-unsigned-engine" {
    & (Join-Path $PSScriptRoot "verify-windows-installer-release.ps1") `
      -ReleaseRoot $unsignedEngineRoot `
      -ExpectedSourceCommit $SourceCommit `
      -ExpectedProductVersion $ProductVersion `
      -ExpectedSignerThumbprint $signerThumbprint `
      -ExpectedSigningMode InternalTest `
      -SignToolPath $resolvedSignTool `
      -WixToolPath $resolvedWixTool
  } "Authenticode validation failed for '.*bundle-engine\.exe': NotSigned"

  Expect-Failure "wrong-expected-signer" {
    & (Join-Path $PSScriptRoot "verify-windows-installer-release.ps1") `
      -ReleaseRoot $releaseRoot `
      -ExpectedSourceCommit $SourceCommit `
      -ExpectedProductVersion $ProductVersion `
      -ExpectedSignerThumbprint "0000000000000000000000000000000000000000" `
      -ExpectedSigningMode InternalTest `
      -SignToolPath $SignToolPath `
      -WixToolPath $WixToolPath
  } "Signed release signer thumbprint mismatch"

  if ($ExerciseLifecycle) {
    & (Join-Path $PSScriptRoot "test-exe-lifecycle.ps1") `
      -ExePath (Join-Path $releaseRoot "AIJobPrintTerminalSetup.exe")
    $exeLogs = Join-Path $releaseRoot "lifecycle-logs"
    if (-not (Test-Path -LiteralPath $exeLogs -PathType Container)) {
      throw "INTERNAL_SIGNING_PIPELINE_TEST_FAILED: Signed EXE lifecycle evidence was not created."
    }
    Move-Item -LiteralPath $exeLogs -Destination (Join-Path $resolvedEvidence "signed-exe-lifecycle-logs")

    & (Join-Path $PSScriptRoot "test-msi-lifecycle.ps1") `
      -MsiPath (Join-Path $releaseRoot "AIJobPrintAgent.msi")
    $msiLogs = Join-Path $releaseRoot "lifecycle-logs"
    if (-not (Test-Path -LiteralPath $msiLogs -PathType Container)) {
      throw "INTERNAL_SIGNING_PIPELINE_TEST_FAILED: Signed MSI lifecycle evidence was not created."
    }
    Move-Item -LiteralPath $msiLogs -Destination (Join-Path $resolvedEvidence "signed-msi-lifecycle-logs")

    & (Join-Path $PSScriptRoot "verify-windows-installer-release.ps1") `
      -ReleaseRoot $releaseRoot `
      -ExpectedSourceCommit $SourceCommit `
      -ExpectedProductVersion $ProductVersion `
      -ExpectedSignerThumbprint $signerThumbprint `
      -ExpectedSigningMode InternalTest `
      -SignToolPath $SignToolPath `
      -WixToolPath $WixToolPath
  }

  $requiredEvidence = @(
    (Join-Path $certificateRoot "internal-signing-certificate.json"),
    (Join-Path $releaseRoot "signed-release-identity.json"),
    (Join-Path $releaseRoot "signed-release-identity.p7s")
  )
  if ($ExerciseLifecycle) {
    $requiredEvidence += @(
      (Join-Path $resolvedEvidence "signed-exe-lifecycle-logs"),
      (Join-Path $resolvedEvidence "signed-msi-lifecycle-logs")
    )
  }
  foreach ($path in $requiredEvidence) {
    if (-not (Test-Path -LiteralPath $path)) {
      throw "INTERNAL_SIGNING_PIPELINE_TEST_FAILED: Required evidence is missing: '$path'."
    }
  }

  Write-Host "INTERNAL_SIGNING_PIPELINE_PASS releaseRoot=$releaseRoot signer=$signerThumbprint"
} catch {
  $pipelineFailure = $_
} finally {
  $cleanupFailure = $null
  $cleanupStatus = "passed"
  try {
    if (-not [string]::IsNullOrWhiteSpace($rootThumbprint) -and -not [string]::IsNullOrWhiteSpace($signerThumbprint)) {
      if ($UseEphemeralGitHubHostedLocalMachineTrust) {
        if (-not (Test-Path -LiteralPath $ownershipMarkerPath -PathType Leaf)) {
          if ($null -eq $pipelineFailure) {
            throw "INTERNAL_SIGNING_TRUST_REMOVE_FAILED: LocalMachine cleanup requires an existing run ownership marker."
          }
          $cleanupStatus = "skipped-no-ownership"
        } else {
          & (Join-Path $PSScriptRoot "remove-internal-code-signing-trust.ps1") `
            -RootThumbprint $rootThumbprint `
            -SignerThumbprint $signerThumbprint `
            -StoreScope LocalMachine `
            -PrivateKeyStoreScope CurrentUser `
            -RemovePrivateCertificates `
            -AcknowledgeEphemeralNonProductionHost `
            -RunOwnershipMarkerPath $ownershipMarkerPath
        }
      } else {
        & (Join-Path $PSScriptRoot "remove-internal-code-signing-trust.ps1") `
          -RootThumbprint $rootThumbprint `
          -SignerThumbprint $signerThumbprint `
          -RemovePrivateCertificates
      }
    }
  } catch {
    $cleanupFailure = $_
    $cleanupStatus = "failed"
  }
}
$originalStatus = "passed"
if ($null -ne $pipelineFailure) {
  $originalStatus = "failed"
}
Write-Host "INTERNAL_SIGNING_PIPELINE_RESULT original=$originalStatus cleanup=$cleanupStatus"
if ($null -ne $cleanupFailure -and $null -ne $pipelineFailure) {
  Write-Host "INTERNAL_SIGNING_PIPELINE_ORIGINAL_FAILURE"
  Write-Host $pipelineFailure.Exception.Message
  throw "INTERNAL_SIGNING_PIPELINE_TEST_FAILED: original pipeline failure followed by cleanup failure."
}
if ($null -ne $cleanupFailure) {
  throw "INTERNAL_SIGNING_PIPELINE_TEST_FAILED: cleanup failed after the pipeline body returned."
}
if ($null -ne $pipelineFailure) {
  throw $pipelineFailure
}
