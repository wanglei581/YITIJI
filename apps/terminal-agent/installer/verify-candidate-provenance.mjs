import assert from 'node:assert/strict'

const assertOrdered = (haystack, before, after, message) => {
  const beforeIndex = haystack.indexOf(before)
  const afterIndex = haystack.indexOf(after)
  assert.ok(beforeIndex >= 0, `missing workflow marker: ${before}`)
  assert.ok(afterIndex >= 0, `missing workflow marker: ${after}`)
  assert.ok(beforeIndex < afterIndex, message)
}

const workflowStep = (haystack, name) => {
  const marker = `      - name: ${name}`
  const start = haystack.indexOf(marker)
  assert.ok(start >= 0, `missing workflow step: ${name}`)
  const next = haystack.indexOf('\n      - name:', start + marker.length)
  return haystack.slice(start, next >= 0 ? next : haystack.length)
}

export function verifyCandidateProvenance({ workflow, candidateIdentity, productVersion }) {
  const freshJobStart = workflow.indexOf('  unsigned-msi-candidate:')
  const upgradeJobStart = workflow.indexOf('  unsigned-exe-upgrade:')
  assert.ok(freshJobStart >= 0, 'missing unsigned-msi-candidate job')
  assert.ok(upgradeJobStart > freshJobStart, 'missing or misordered unsigned-exe-upgrade job')
  const freshJob = workflow.slice(freshJobStart, upgradeJobStart)
  const upgradeJob = workflow.slice(upgradeJobStart)

  assert.doesNotMatch(freshJob, /test-exe-upgrade-lifecycle\.ps1/)
  assert.doesNotMatch(freshJob, /predecessor-0\.4\.10/)
  assert.match(upgradeJob, /test-exe-upgrade-lifecycle\.ps1/)
  assert.match(upgradeJob, /ref: 75e0711561f74eed0e76ed956e4b1b5fcd2c54d4/)
  assert.doesNotMatch(upgradeJob, /test-exe-lifecycle\.ps1/)
  assert.doesNotMatch(upgradeJob, /test-msi-lifecycle\.ps1/)
  assertOrdered(
    freshJob,
    'Exercise EXE install, repair, and uninstall',
    'Exercise MSI install, repair, and uninstall',
    'fresh EXE lifecycle must run before fresh MSI lifecycle',
  )

  assert.match(candidateIdentity, /ValidateSet\("Create", "Verify"\)/)
  assert.match(candidateIdentity, /AIJobPrintTerminalSetup\.exe/)
  assert.match(candidateIdentity, /AIJobPrintAgent\.msi/)
  assert.match(candidateIdentity, /staging-manifest\.json/)
  assert.match(candidateIdentity, /Get-FileHash -LiteralPath \$fullPath -Algorithm SHA256/)
  assert.match(candidateIdentity, /Staging manifest source commit mismatch/)
  assert.match(candidateIdentity, /Staging manifest product version mismatch/)
  assert.match(candidateIdentity, /Candidate identity source commit mismatch/)
  assert.match(candidateIdentity, /Candidate identity product version mismatch/)
  assert.match(candidateIdentity, /Candidate file size mismatch/)
  assert.match(candidateIdentity, /Candidate SHA256 mismatch/)
  assert.match(candidateIdentity, /CANDIDATE_IDENTITY_PASS/)

  const candidateBuildCalls = [
    'apps/terminal-agent/installer/build-staging.ps1',
    'apps/terminal-agent/installer/build-msi.ps1',
    'apps/terminal-agent/installer/build-exe.ps1',
  ]
  for (const buildCall of candidateBuildCalls) {
    const pattern = new RegExp(buildCall.replaceAll('/', '\\/').replaceAll('.', '\\.'))
    assert.doesNotMatch(freshJob, pattern)
    assert.match(upgradeJob, pattern)
  }
  assert.equal((upgradeJob.match(/& apps\/terminal-agent\/installer\/build-staging\.ps1/g) ?? []).length, 1)
  assert.equal((upgradeJob.match(/& apps\/terminal-agent\/installer\/build-msi\.ps1/g) ?? []).length, 1)
  assert.equal((upgradeJob.match(/& apps\/terminal-agent\/installer\/build-exe\.ps1/g) ?? []).length, 1)
  assert.equal((upgradeJob.match(/& predecessor-0\.4\.10\/apps\/terminal-agent\/installer\/build-staging\.ps1/g) ?? []).length, 1)
  assert.equal((upgradeJob.match(/& predecessor-0\.4\.10\/apps\/terminal-agent\/installer\/build-msi\.ps1/g) ?? []).length, 1)
  assert.equal((upgradeJob.match(/& predecessor-0\.4\.10\/apps\/terminal-agent\/installer\/build-exe\.ps1/g) ?? []).length, 1)

  const transferName = /name: terminal-agent-unsigned-candidate-\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/
  assert.match(freshJob, /actions\/download-artifact@v4/)
  assert.match(freshJob, transferName)
  assert.match(upgradeJob, /actions\/upload-artifact@v4/)
  assert.match(upgradeJob, transferName)
  assert.match(upgradeJob, /-Mode Create[\s\S]*?-SourceCommit "\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}"/)
  assert.match(upgradeJob, /-CandidateExePath apps\/terminal-agent\/installer\/artifacts\/candidate\/AIJobPrintTerminalSetup\.exe/)
  assert.match(freshJob, /-ExePath apps\/terminal-agent\/installer\/artifacts\/candidate\/AIJobPrintTerminalSetup\.exe/)
  assert.match(freshJob, /-MsiPath apps\/terminal-agent\/installer\/artifacts\/candidate\/AIJobPrintAgent\.msi/)
  assert.equal((upgradeJob.match(/-Mode Verify/g) ?? []).length, 1)
  assert.equal((freshJob.match(/-Mode Verify/g) ?? []).length, 2)

  assert.match(workflowStep(upgradeJob, 'Freeze candidate identity'), /-Mode Create/)
  assert.match(workflowStep(upgradeJob, 'Verify candidate identity after upgrade lifecycle'), /-Mode Verify/)
  assert.match(workflowStep(freshJob, 'Verify downloaded candidate identity before install'), /-Mode Verify/)
  assert.match(workflowStep(freshJob, 'Verify candidate identity after fresh lifecycles'), /-Mode Verify/)
  const freshExeEvidence = workflowStep(freshJob, 'Collect fresh EXE lifecycle evidence')
  const freshMsiEvidence = workflowStep(freshJob, 'Collect fresh MSI lifecycle evidence')
  const upgradeEvidence = workflowStep(upgradeJob, 'Collect upgrade lifecycle evidence')
  for (const evidenceStep of [freshExeEvidence, freshMsiEvidence, upgradeEvidence]) {
    assert.match(evidenceStep, /if: always\(\)/)
    assert.match(evidenceStep, /\$source = "apps\/terminal-agent\/installer\/artifacts\/candidate\/lifecycle-logs"/)
  }
  assert.match(freshExeEvidence, /fresh-exe-lifecycle-logs/)
  assert.match(freshMsiEvidence, /fresh-msi-lifecycle-logs/)
  assert.match(upgradeEvidence, /upgrade-lifecycle-logs/)

  assert.match(freshJob, /Upload exact tested unsigned candidate[\s\S]*?name: terminal-agent-unsigned-installer-candidates/)
  assert.doesNotMatch(
    workflowStep(freshJob, 'Upload exact tested unsigned candidate'),
    /if:\s*(always|failure)\(\)/,
    'the downloadable candidate must not be published after a failed lifecycle',
  )
  assert.match(freshJob, /Upload fresh lifecycle evidence on failure\s*\n\s*if: failure\(\)/)
  assert.doesNotMatch(upgradeJob, /terminal-agent-unsigned-installer-candidates/)
  assert.equal((workflow.match(new RegExp(`-ProductVersion "${productVersion.replaceAll('.', '\\.')}"`, 'g')) ?? []).length, 4)

  assertOrdered(
    freshJob,
    'Verify downloaded candidate identity before install',
    'Exercise EXE install, repair, and uninstall',
    'the downloaded candidate identity must be verified before any install',
  )
  assertOrdered(
    freshJob,
    'Exercise EXE install, repair, and uninstall',
    'Collect fresh EXE lifecycle evidence',
    'fresh EXE evidence must be collected immediately after its lifecycle',
  )
  assertOrdered(
    freshJob,
    'Collect fresh EXE lifecycle evidence',
    'Exercise MSI install, repair, and uninstall',
    'fresh EXE evidence must be isolated before the MSI lifecycle starts',
  )
  assertOrdered(
    freshJob,
    'Exercise MSI install, repair, and uninstall',
    'Collect fresh MSI lifecycle evidence',
    'fresh MSI evidence must be collected after its lifecycle',
  )
  assertOrdered(
    freshJob,
    'Collect fresh MSI lifecycle evidence',
    'Verify candidate identity after fresh lifecycles',
    'fresh lifecycle evidence must be isolated before final identity verification',
  )
  assertOrdered(
    freshJob,
    'Verify candidate identity after fresh lifecycles',
    'Upload exact tested unsigned candidate',
    'candidate identity must be verified again before publication',
  )
  assertOrdered(
    upgradeJob,
    'Build candidate upgrade fixture',
    'Freeze candidate identity',
    'the candidate must be built before its identity is frozen',
  )
  assertOrdered(
    upgradeJob,
    'Freeze candidate identity',
    'Exercise EXE predecessor-to-candidate upgrade',
    'the candidate must be frozen before the upgrade lifecycle',
  )
  assertOrdered(
    upgradeJob,
    'Exercise EXE predecessor-to-candidate upgrade',
    'Collect upgrade lifecycle evidence',
    'upgrade evidence must be collected after the upgrade lifecycle',
  )
  assertOrdered(
    upgradeJob,
    'Collect upgrade lifecycle evidence',
    'Verify candidate identity after upgrade lifecycle',
    'upgrade evidence must be isolated before final identity verification',
  )
  assertOrdered(
    upgradeJob,
    'Verify candidate identity after upgrade lifecycle',
    'Transfer exact upgrade-tested candidate',
    'candidate identity must be verified again before cross-job transfer',
  )
}
