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

console.log('SIGNING_WORKFLOW_CONTRACT_PASS')
