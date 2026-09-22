import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Package scripts run with apps/terminal-agent as cwd; the Windows workflow runs this file from the repository root.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const packageJson = JSON.parse(read('apps/terminal-agent/package.json'))
const workflow = read('.github/workflows/windows-agent-installer.yml')
const certificateSetup = read(
  'apps/terminal-agent/installer/new-internal-code-signing-certificates.ps1',
)
const certificateCleanup = read(
  'apps/terminal-agent/installer/remove-internal-code-signing-trust.ps1',
)
const signingTools = read('apps/terminal-agent/installer/signing-tools.ps1')
const pipelineTest = read('apps/terminal-agent/installer/test-internal-signing-pipeline.ps1')
const trustInstall = read(
  'apps/terminal-agent/installer/install-internal-code-signing-trust.ps1',
).replaceAll('\r\n', '\n')

assert.equal(
  packageJson.scripts['verify:signing-workflow-contract'],
  'node installer/verify-signing-workflow-contract.mjs',
)
assert.match(workflow, /^  internal-signing-validation:\s*$/m)
const signingJob = workflow.split(/^  internal-signing-validation:\s*$/m)[1]
assert.ok(signingJob, 'internal signing validation job must exist')
assert.match(signingJob, /needs: unsigned-exe-upgrade/)
assert.match(
  signingJob,
  /name: terminal-agent-unsigned-candidate-\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
)
assert.match(signingJob, /test-internal-signing-pipeline\.ps1/)
assert.match(signingJob, /-ExerciseLifecycle/)
assert.match(signingJob, /NOT-FOR-DEPLOYMENT/)
assert.match(signingJob, /remove-internal-code-signing-trust\.ps1/)
assert.match(
  signingJob,
  /name: Ensure internal test trust and private certificates are removed\s*\n\s*if: always\(\)/,
)
assert.doesNotMatch(signingJob, /secrets\./, 'internal validation must not consume production signing secrets')
assert.doesNotMatch(
  signingJob,
  /signed-release-NOT-FOR-DEPLOYMENT\/(?:AIJobPrintAgent\.msi|AIJobPrintTerminalSetup\.exe)/,
  'internal signed binaries must not be uploaded as workflow artifacts',
)

function workflowJob(haystack, name) {
  const marker = `  ${name}:`
  const start = haystack.indexOf(`${marker}\n`)
  assert.ok(start >= 0, `missing workflow job: ${name}`)
  const remainder = haystack.slice(start + marker.length)
  const nextJob = /^  [A-Za-z0-9_-]+:\s*$/m.exec(remainder)
  const end = nextJob ? start + marker.length + nextJob.index : haystack.length
  return haystack.slice(start, end)
}

const nativeExitGuard = 'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
for (const jobName of ['unsigned-msi-candidate', 'unsigned-exe-upgrade']) {
  const job = workflowJob(workflow, jobName)
  assert.ok(
    job.includes(
      `node apps/terminal-agent/installer/verify-installer-inputs.mjs\n          ${nativeExitGuard}\n`,
    ),
    `${jobName} Verify installer source contract must exit when verify-installer-inputs fails`,
  )
  assert.ok(
    job.includes(
      `node apps/terminal-agent/installer/verify-signing-workflow-contract.mjs\n          ${nativeExitGuard}\n`,
    ),
    `${jobName} Verify installer source contract must exit when verify-signing-workflow-contract fails`,
  )
}
assert.match(certificateSetup, /\$RootValidityDays = 30/)
assert.match(certificateSetup, /\$SigningValidityDays = 7/)
assert.doesNotMatch(certificateSetup, /ValidityYears|AddYears/)
assert.match(certificateSetup, /\$rootExpiry = \$now\.AddDays\(\$RootValidityDays\)/)
assert.match(certificateSetup, /\$signingExpiry = \$now\.AddDays\(\$SigningValidityDays\)/)
assert.match(certificateSetup, /if \(\$signingExpiry -ge \$rootExpiry\)/)
assert.match(certificateSetup, /Remove-Item -LiteralPath \$certificatePath -DeleteKey -Force/)
assert.match(certificateCleanup, /Remove-Item -LiteralPath \$path -DeleteKey -Force/)
assert.match(signingTools, /"\/sha1"/)
assert.doesNotMatch(signingTools, /\/dlib/i, 'Azure Trusted Signing adapter is not implemented')
assert.match(pipelineTest, /failed for the wrong reason/)
assert.match(pipelineTest, /unsigned-embedded-msi-build/)
assert.match(pipelineTest, /reattach the signed engine for the unsigned embedded MSI fixture/)
assert.match(pipelineTest, /Assert-UnsignedAuthenticode \$unsignedEnginePath/)
for (const expectedFailure of [
  'local-machine-trust-requires-acknowledgement',
  'release-mode-requires-timestamp',
  'tampered-signed-msi',
  'tampered-signed-release-identity',
  'semantically-invalid-signed-identity',
  'outer-signed-bundle-with-unsigned-embedded-msi',
  'outer-signed-bundle-with-unsigned-engine',
  'wrong-expected-signer',
]) {
  assert.match(
    pipelineTest,
    new RegExp(`Expect-Failure "${expectedFailure}"`),
    `missing signing negative test: ${expectedFailure}`,
  )
}
for (const expectedReason of [
  'Release mode requires an approved RFC3161 HTTPS timestamp URL',
  'Signed release deployment eligibility is invalid',
  'final bundle does not contain the signed MSI byte-for-byte',
  "Authenticode validation failed for '.*bundle-engine\\.exe': NotSigned",
]) {
  assert.match(
    pipelineTest,
    new RegExp(expectedReason.replaceAll('\\', '\\\\')),
    `missing reason-specific signing failure assertion: ${expectedReason}`,
  )
}

// Static source order only. This script does not open a certificate store,
// call Import-Certificate, or show that an interactive trust prompt returned.
const localMachineGuard = [
  'if ($StoreScope -eq "LocalMachine" -and -not $AcknowledgeEphemeralNonProductionHost) {',
  '  Fail "LocalMachine trust requires -AcknowledgeEphemeralNonProductionHost. Never install this root on a production kiosk."',
  '}',
].join('\n')
assert.ok(
  trustInstall.includes(localMachineGuard),
  'LocalMachine trust requires the explicit ephemeral-host acknowledgement guard',
)

const acknowledgementStart = pipelineTest.indexOf(
  'Expect-Failure "local-machine-trust-requires-acknowledgement"',
)
const acknowledgementEnd = pipelineTest.indexOf('} "LocalMachine trust requires"', acknowledgementStart)
assert.ok(acknowledgementStart >= 0 && acknowledgementEnd > acknowledgementStart)
const acknowledgementTest = pipelineTest.slice(acknowledgementStart, acknowledgementEnd)
assert.match(acknowledgementTest, /-StoreScope LocalMachine/)
assert.equal(
  acknowledgementTest.includes('AcknowledgeEphemeralNonProductionHost'),
  false,
  'LocalMachine negative test must invoke install without the acknowledgement switch',
)

function assertImmediateSequence(source, parts, label) {
  let searchFrom = 0
  let previousEnd = -1
  for (const part of parts) {
    const at = source.indexOf(part, searchFrom)
    if (at < 0) {
      const earlier = source.indexOf(part)
      assert.fail(
        earlier >= 0
          ? `${label} is out of order; a required marker was moved after its operation: ${part}`
          : `${label} missing exact marker or operation: ${part}`,
      )
    }
    assert.equal(
      source.indexOf(part, at + part.length),
      -1,
      `${label} duplicate marker or operation: ${part}`,
    )
    if (previousEnd >= 0) {
      const gap = source.slice(previousEnd, at)
      assert.match(
        gap,
        /^\n[ \t]*$/,
        `${label} marker moved away from its operation: ${JSON.stringify(gap)}`,
      )
    }
    previousEnd = at + part.length
    searchFrom = previousEnd
  }
}

const markerLiteral =
  'INTERNAL_SIGNING_TRUST_PHASE phase=$Phase scope=$($script:StoreScope) status=$Status'
assert.equal(trustInstall.split(markerLiteral).length, 2, 'phase marker format must be emitted once')
assert.doesNotMatch(
  markerLiteral,
  /Certificate|Thumbprint|FilePath|Password|PFX|Private|Subject|NotAfter/i,
  'phase markers must stay free of certificate material',
)
assertImmediateSequence(
  trustInstall,
  [
    'function Write-TrustInstallPhase([string]$Phase, [string]$Status) {',
    `[Console]::Out.WriteLine("${markerLiteral}")`,
    '[Console]::Out.Flush()',
  ],
  'trust phase marker writer',
)

const phaseBlocks = [
  [
    'Write-TrustInstallPhase -Phase "chain-validation" -Status "start"',
    '$chainBuilt = $chain.Build($signer)',
    'Write-TrustInstallPhase -Phase "chain-validation" -Status "pass"',
  ],
  [
    'Write-TrustInstallPhase -Phase "root-import" -Status "start"',
    'Import-Certificate -FilePath $RootCertificatePath -CertStoreLocation $rootStore | Out-Null',
    'Write-TrustInstallPhase -Phase "root-import" -Status "pass"',
  ],
  [
    'Write-TrustInstallPhase -Phase "trusted-publisher-import" -Status "start"',
    'Import-Certificate -FilePath $SignerCertificatePath -CertStoreLocation $publisherStore | Out-Null',
    'Write-TrustInstallPhase -Phase "trusted-publisher-import" -Status "pass"',
  ],
]

let phaseCursor = trustInstall.indexOf(localMachineGuard)
assert.ok(phaseCursor >= 0)
for (const block of phaseBlocks) {
  const startAt = trustInstall.indexOf(block[0])
  assert.ok(
    startAt > phaseCursor,
    `${block[0]} must follow the LocalMachine guard and the previous phase`,
  )
  assertImmediateSequence(trustInstall, block, block[0])
  phaseCursor = trustInstall.indexOf(block[2])
}
assert.equal(trustInstall.match(/Write-TrustInstallPhase\b/g).length, 7)

const tryAt = trustInstall.indexOf('try {')
const catchAt = trustInstall.indexOf('} catch {')
assert.ok(trustInstall.indexOf(phaseBlocks[0][2]) < tryAt, 'chain validation stays outside import rollback')
assert.ok(tryAt < trustInstall.indexOf(phaseBlocks[1][0]) && phaseCursor < catchAt)
assert.ok(
  trustInstall.includes(
    [
      '} catch {',
      '  foreach ($target in @($publisherTarget, $rootTarget)) {',
      '    if (Test-Path -LiteralPath $target) {',
      '      Remove-Item -LiteralPath $target -Force',
      '    }',
      '  }',
      '  throw',
      '}',
    ].join('\n'),
  ),
  'import failures must keep partial rollback and the original exception',
)

const thumbprintGuardAt = trustInstall.indexOf(
  'Trust import did not create both expected thumbprint entries.',
)
const installedAt = trustInstall.indexOf('INTERNAL_SIGNING_TRUST_INSTALLED')
assert.ok(phaseCursor < thumbprintGuardAt, 'thumbprint verification must stay after both imports return')
assert.ok(thumbprintGuardAt < installedAt, 'install success must stay after thumbprint verification')
assert.equal(trustInstall.split('INTERNAL_SIGNING_TRUST_INSTALLED').length, 2)

console.log(
  'SIGNING_WORKFLOW_CONTRACT_STATIC_ONLY: local source marker order only; no Windows trust runtime; interactive trust is not fixed',
)
console.log('SIGNING_WORKFLOW_CONTRACT_PASS')
