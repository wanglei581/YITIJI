#!/usr/bin/env node
import assert from 'node:assert/strict'
import {
  buildEvidence,
  renderNginxConfig,
  transitionCutover,
  validateEvidence,
} from './contract.mjs'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)
const SHA_D = 'd'.repeat(64)

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function expectContractFailure(action) {
  assert.throws(
    action,
    (error) => error instanceof Error && /^D2_PRIME_(?:CONTRACT|EVIDENCE)_INVALID$/.test(error.message),
  )
}

function measurements() {
  return {
    recordedAt: '2026-07-30T08:00:00.000Z',
    topology: {
      legacyNetNamespaceInode: '4026531840',
      managedNetNamespaceInode: '4026531840',
      nginxNetNamespaceInode: '4026531840',
    },
    controlIsolation: {
      legacyPm2HomeId: SHA_A,
      managedPm2HomeId: SHA_B,
      legacyDaemonId: 'daemon-legacy-101',
      managedDaemonId: 'daemon-managed-202',
      legacyNameId: 'name-legacy-api',
      managedNameId: 'name-managed-api',
      legacyReleasePathsId: SHA_C,
      managedReleasePathsId: SHA_D,
      legacyLogPathsId: '1'.repeat(64),
      managedLogPathsId: '2'.repeat(64),
    },
    healthContract: {
      managedHealthUrl: 'http://127.0.0.1:3011/api/v1/health',
      legacyHealthProbeCountByReleaseTools: 0,
    },
    nginx: {
      binaryVersion: 'nginx/1.26.3',
      invalidCandidateTestExitCode: 1,
      invalidCandidateReloadAttempted: false,
      observedTargetsAfterInvalidCandidate: ['legacy'],
      targetAfterInvalidCandidate: 'legacy',
      validCandidateTestExitCode: 0,
      observedTargetsAfterValidReload: ['managed'],
      targetAfterReload: 'managed',
    },
    releaseChain: {
      genesisStatus: 'PARALLEL_SERVING_R1',
      activatedReleaseId: 'release-d2-prime-r2',
      failedReleaseError: 'RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK',
      currentAfterRollback: 'release-d2-prime-r2',
      rollbackTarget: 'managed-previous-only',
      legacyFallbackAttempted: false,
    },
    resourceIsolation: {
      cgroupVersion: 'v2',
      engine: 'systemd',
      managedControlGroupId: SHA_A,
      managedDaemonControlGroupId: SHA_A,
      managedAppControlGroupId: SHA_A,
      effectiveMemoryMaxBytes: 67_108_864,
      effectiveCpuQuotaPerSecUSec: 250_000,
      effectiveTasksMax: 16,
      effectiveLimitNOFILE: 256,
      nrThrottledBefore: 10,
      nrThrottledAfter: 11,
      legacyProbeFailuresUnderLoad: 0,
    },
    dataSafety: {
      productionCredentialsPresent: false,
      migrationExecuted: false,
      ddlExecuted: false,
      seedExecuted: false,
      secondWorkerStarted: false,
      cronOrSchedulerStarted: false,
      queueConsumerStarted: false,
    },
  }
}

function verifyNginxRenderer() {
  const common = {
    listenPort: 18_080,
    pidPath: '/tmp/d2-prime/nginx.pid',
    accessLogPath: '/tmp/d2-prime/access.log',
    errorLogPath: '/tmp/d2-prime/error.log',
  }
  const legacy = renderNginxConfig({ ...common, target: 'legacy' })
  assert.equal((legacy.match(/127\.0\.0\.1:3010/g) ?? []).length, 1)
  assert.equal(legacy.includes('127.0.0.1:3011'), false)
  assert.equal((legacy.match(/proxy_pass/g) ?? []).length, 1)
  assert.match(legacy, /listen 127\.0\.0\.1:18080;/)

  const managed = renderNginxConfig({ ...common, target: 'managed' })
  assert.equal((managed.match(/127\.0\.0\.1:3011/g) ?? []).length, 1)
  assert.equal(managed.includes('127.0.0.1:3010'), false)
  assert.equal((managed.match(/proxy_pass/g) ?? []).length, 1)
  assert.equal(/weight=|backup;|split_clients|upstream\s+\w+\s*\{[^}]*server[^}]*server/s.test(managed), false)

  for (const target of ['', 'mixed', '127.0.0.1:3011']) {
    expectContractFailure(() => renderNginxConfig({ ...common, target }))
  }
  expectContractFailure(() => renderNginxConfig({ ...common, target: 'legacy', listenPort: 80 }))
  expectContractFailure(() => renderNginxConfig({ ...common, target: 'legacy', pidPath: 'relative.pid' }))
  expectContractFailure(() => renderNginxConfig({ ...common, target: 'legacy', errorLogPath: '/tmp/x\nuser root;' }))
  console.log('  PASS Nginx renderer emits one loopback target and rejects mixed/unsafe inputs')
}

function verifyCutoverStateMachine() {
  assert.equal(transitionCutover('LEGACY_ACTIVE', 'candidate_validated'), 'MANAGED_CANDIDATE_VALIDATED')
  assert.equal(transitionCutover('MANAGED_CANDIDATE_VALIDATED', 'validation_failed'), 'LEGACY_ACTIVE')
  assert.equal(transitionCutover('MANAGED_CANDIDATE_VALIDATED', 'reload_failed'), 'LEGACY_ACTIVE')
  assert.equal(transitionCutover('MANAGED_CANDIDATE_VALIDATED', 'reload_succeeded'), 'MANAGED_RELOADED_UNCONFIRMED')
  assert.equal(transitionCutover('MANAGED_RELOADED_UNCONFIRMED', 'external_check_failed'), 'LEGACY_ACTIVE')
  assert.equal(transitionCutover('MANAGED_RELOADED_UNCONFIRMED', 'confirm'), 'CUTOVER_CONFIRMED')
  assert.equal(transitionCutover('CUTOVER_CONFIRMED', 'bad_managed_release'), 'MANAGED_PREVIOUS_ONLY')
  expectContractFailure(() => transitionCutover('CUTOVER_CONFIRMED', 'external_check_failed'))
  expectContractFailure(() => transitionCutover('CUTOVER_CONFIRMED', 'legacy_fallback'))
  expectContractFailure(() => transitionCutover('UNKNOWN', 'confirm'))
  console.log('  PASS cutover state machine has no post-confirm legacy transition')
}

function expectEvidenceMutationFailure(evidence, mutate) {
  const candidate = clone(evidence)
  mutate(candidate)
  expectContractFailure(() => validateEvidence(candidate))
}

function verifyEvidenceContract() {
  const input = measurements()
  const evidence = buildEvidence({ ...input, ignoredSecret: 'must-not-survive' })
  assert.equal(Object.hasOwn(evidence, 'ignoredSecret'), false)
  assert.equal(evidence.verdict, 'D2_PRIME_PASS')
  assert.equal(evidence.productionF1, 'NO-GO')
  assert.equal(evidence.topology.sameNetworkNamespace, true)
  assert.equal(evidence.controlIsolation.homesDistinct, true)
  assert.equal(evidence.controlIsolation.daemonPidsDistinct, true)
  assert.equal(evidence.controlIsolation.namesDistinct, true)
  assert.equal(evidence.controlIsolation.releasePathsDistinct, true)
  assert.equal(evidence.controlIsolation.logPathsDistinct, true)
  assert.equal(evidence.nginx.allOrNoneObserved, true)
  assert.equal(evidence.resourceIsolation.cpuThrottlingObserved, true)
  assert.equal(validateEvidence(evidence).verdict, 'D2_PRIME_PASS')

  const noGo = buildEvidence({
    ...measurements(),
    topology: { ...measurements().topology, managedNetNamespaceInode: '4026531999' },
  })
  assert.equal(noGo.verdict, 'D2_PRIME_NO_GO')
  assert.equal(noGo.topology.sameNetworkNamespace, false)
  assert.equal(validateEvidence(noGo).verdict, 'D2_PRIME_NO_GO')

  expectEvidenceMutationFailure(evidence, (value) => { value.topology.managedEndpoint = '127.0.0.1:3010' })
  expectEvidenceMutationFailure(evidence, (value) => { value.topology.managedNetNamespaceInode = '4026531999' })
  expectEvidenceMutationFailure(evidence, (value) => { value.controlIsolation.managedPm2HomeId = value.controlIsolation.legacyPm2HomeId })
  expectEvidenceMutationFailure(evidence, (value) => { value.controlIsolation.managedDaemonId = value.controlIsolation.legacyDaemonId })
  expectEvidenceMutationFailure(evidence, (value) => { value.controlIsolation.managedNameId = value.controlIsolation.legacyNameId })
  expectEvidenceMutationFailure(evidence, (value) => { value.controlIsolation.managedReleasePathsId = value.controlIsolation.legacyReleasePathsId })
  expectEvidenceMutationFailure(evidence, (value) => { value.controlIsolation.managedLogPathsId = value.controlIsolation.legacyLogPathsId })
  expectEvidenceMutationFailure(evidence, (value) => { value.healthContract.legacyHealthProbeCountByReleaseTools = 1 })
  expectEvidenceMutationFailure(evidence, (value) => { value.nginx.binaryVersion = 'fake-nginx' })
  expectEvidenceMutationFailure(evidence, (value) => { value.nginx.invalidCandidateReloadAttempted = true })
  expectEvidenceMutationFailure(evidence, (value) => { value.nginx.observedTargetsAfterValidReload = ['legacy', 'managed'] })
  expectEvidenceMutationFailure(evidence, (value) => { value.releaseChain.rollbackTarget = 'legacy' })
  expectEvidenceMutationFailure(evidence, (value) => { value.releaseChain.legacyFallbackAttempted = true })
  expectEvidenceMutationFailure(evidence, (value) => { value.resourceIsolation.cgroupVersion = 'v1' })
  expectEvidenceMutationFailure(evidence, (value) => { value.resourceIsolation.engine = 'pm2' })
  expectEvidenceMutationFailure(evidence, (value) => { value.resourceIsolation.managedAppControlGroupId = SHA_B })
  expectEvidenceMutationFailure(evidence, (value) => { value.resourceIsolation.effectiveMemoryMaxBytes = 1 })
  expectEvidenceMutationFailure(evidence, (value) => { value.resourceIsolation.nrThrottledAfter = value.resourceIsolation.nrThrottledBefore })
  expectEvidenceMutationFailure(evidence, (value) => { value.resourceIsolation.legacyProbeFailuresUnderLoad = 1 })
  for (const field of Object.keys(evidence.dataSafety)) {
    expectEvidenceMutationFailure(evidence, (value) => { value.dataSafety[field] = true })
  }
  expectEvidenceMutationFailure(evidence, (value) => { value.productionF1 = 'GO' })
  expectEvidenceMutationFailure(evidence, (value) => { value.environment = { DATABASE_URL: 'secret' } })
  expectEvidenceMutationFailure(evidence, (value) => { value.logBody = 'sensitive log' })
  expectEvidenceMutationFailure(evidence, (value) => { value.recordedAt = 'not-an-instant' })
  expectEvidenceMutationFailure(evidence, (value) => {
    value.nginx.observedTargetsAfterInvalidCandidate = ['legacy', { log: 'must-not-survive' }]
    value.nginx.allOrNoneObserved = false
    value.verdict = 'D2_PRIME_NO_GO'
  })
  expectEvidenceMutationFailure(evidence, (value) => {
    value.nginx.binaryVersion = `nginx/${'x'.repeat(500)}`
    value.verdict = 'D2_PRIME_NO_GO'
  })
  expectEvidenceMutationFailure(evidence, (value) => { delete value.healthContract })

  for (const [section, booleanField, rawMutation] of [
    ['topology', 'sameNetworkNamespace', (value) => { value.topology.managedNetNamespaceInode = '99' }],
    ['controlIsolation', 'homesDistinct', (value) => { value.controlIsolation.managedPm2HomeId = value.controlIsolation.legacyPm2HomeId }],
    ['nginx', 'allOrNoneObserved', (value) => { value.nginx.observedTargetsAfterValidReload = ['legacy', 'managed'] }],
    ['resourceIsolation', 'cpuThrottlingObserved', (value) => { value.resourceIsolation.nrThrottledAfter = value.resourceIsolation.nrThrottledBefore }],
  ]) {
    expectEvidenceMutationFailure(evidence, (value) => {
      rawMutation(value)
      value[section][booleanField] = true
    })
  }
  console.log('  PASS evidence schema derives verdict from raw measurements and rejects spoofing')
}

function main() {
  console.log('=== D2 prime offline contract ===')
  verifyNginxRenderer()
  verifyCutoverStateMachine()
  verifyEvidenceContract()
  console.log('D2_PRIME_CONTRACT_ALL_PASS')
}

main()
