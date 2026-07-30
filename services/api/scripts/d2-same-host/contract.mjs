import { isAbsolute } from 'node:path'

const LEGACY_ENDPOINT = '127.0.0.1:3010'
const MANAGED_ENDPOINT = '127.0.0.1:3011'
const MANAGED_HEALTH_URL = 'http://127.0.0.1:3011/api/v1/health'
const DRILL_LIMITS = Object.freeze({
  memoryMaxBytes: 268_435_456,
  cpuQuotaPerSecUSec: 250_000,
  tasksMax: 64,
  limitNOFILE: 256,
})
const SHA256 = /^[0-9a-f]{64}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const DATA_SAFETY_KEYS = [
  'productionCredentialsPresent', 'migrationExecuted', 'ddlExecuted', 'seedExecuted',
  'secondWorkerStarted', 'cronOrSchedulerStarted', 'queueConsumerStarted',
]
const TOP_LEVEL_KEYS = [
  'schemaVersion', 'plane', 'verdict', 'productionF1', 'topology', 'controlIsolation',
  'healthContract', 'nginx', 'releaseChain', 'resourceIsolation', 'dataSafety', 'recordedAt',
]
const TOPOLOGY_KEYS = [
  'legacyEndpoint', 'managedEndpoint', 'legacyNetNamespaceInode', 'managedNetNamespaceInode',
  'nginxNetNamespaceInode', 'sameNetworkNamespace',
]
const CONTROL_KEYS = [
  'legacyPm2HomeId', 'managedPm2HomeId', 'legacyDaemonId', 'managedDaemonId',
  'legacyNameId', 'managedNameId', 'legacyReleasePathsId', 'managedReleasePathsId',
  'legacyLogPathsId', 'managedLogPathsId', 'homesDistinct', 'daemonPidsDistinct',
  'namesDistinct', 'releasePathsDistinct', 'logPathsDistinct',
]
const HEALTH_KEYS = ['managedHealthUrl', 'legacyHealthProbeCountByReleaseTools']
const NGINX_KEYS = [
  'binaryVersion', 'invalidCandidateTestExitCode', 'invalidCandidateReloadAttempted',
  'observedTargetsAfterInvalidCandidate', 'targetAfterInvalidCandidate',
  'validCandidateTestExitCode', 'observedTargetsAfterValidReload', 'targetAfterReload',
  'allOrNoneObserved',
]
const RELEASE_KEYS = [
  'genesisStatus', 'activatedReleaseId', 'failedReleaseError', 'currentAfterRollback',
  'rollbackTarget', 'legacyFallbackAttempted',
]
const RESOURCE_KEYS = [
  'cgroupVersion', 'engine', 'managedControlGroupId', 'managedDaemonControlGroupId',
  'managedAppControlGroupId', 'effectiveMemoryMaxBytes', 'effectiveCpuQuotaPerSecUSec',
  'effectiveTasksMax', 'effectiveLimitNOFILE', 'nrThrottledBefore', 'nrThrottledAfter',
  'memoryMaxApplied', 'cpuQuotaApplied', 'tasksMaxApplied', 'nofileLimitApplied',
  'pm2MemoryLimitOnlyRejected', 'cpuThrottlingObserved', 'legacyProbeFailuresUnderLoad',
]

function fail(kind = 'CONTRACT') {
  throw new Error(`D2_PRIME_${kind}_INVALID`)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function assertSafePath(value) {
  if (
    typeof value !== 'string' || !isAbsolute(value) || Buffer.byteLength(value, 'utf8') > 1024 ||
    /[\u0000-\u001f\u007f"'`;{}#$\\]/u.test(value) || value.split('/').includes('..')
  ) fail()
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function isInode(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value)
}

function isSha(value) {
  return typeof value === 'string' && SHA256.test(value)
}

function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value)
}

function isTargetList(value, target) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => item === target)
}

function isObservedTargetList(value) {
  return Array.isArray(value) && value.length <= 1_000 &&
    value.every((item) => item === 'legacy' || item === 'managed')
}

function isRecordedAt(value) {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function derive(evidence) {
  const topology = evidence.topology
  const control = evidence.controlIsolation
  const nginx = evidence.nginx
  const resource = evidence.resourceIsolation
  const sameNetworkNamespace =
    topology.legacyNetNamespaceInode === topology.managedNetNamespaceInode &&
    topology.managedNetNamespaceInode === topology.nginxNetNamespaceInode
  const homesDistinct = control.legacyPm2HomeId !== control.managedPm2HomeId
  const daemonPidsDistinct = control.legacyDaemonId !== control.managedDaemonId
  const namesDistinct = control.legacyNameId !== control.managedNameId
  const releasePathsDistinct = control.legacyReleasePathsId !== control.managedReleasePathsId
  const logPathsDistinct = control.legacyLogPathsId !== control.managedLogPathsId
  const allOrNoneObserved =
    isTargetList(nginx.observedTargetsAfterInvalidCandidate, 'legacy') &&
    isTargetList(nginx.observedTargetsAfterValidReload, 'managed')
  const managedMembership =
    resource.managedControlGroupId === resource.managedDaemonControlGroupId &&
    resource.managedDaemonControlGroupId === resource.managedAppControlGroupId
  const memoryMaxApplied = resource.effectiveMemoryMaxBytes === DRILL_LIMITS.memoryMaxBytes
  const cpuQuotaApplied = resource.effectiveCpuQuotaPerSecUSec === DRILL_LIMITS.cpuQuotaPerSecUSec
  const tasksMaxApplied = resource.effectiveTasksMax === DRILL_LIMITS.tasksMax
  const nofileLimitApplied = resource.effectiveLimitNOFILE === DRILL_LIMITS.limitNOFILE
  const pm2MemoryLimitOnlyRejected =
    resource.cgroupVersion === 'v2' && resource.engine === 'systemd' && managedMembership
  const cpuThrottlingObserved = resource.nrThrottledAfter > resource.nrThrottledBefore
  return {
    sameNetworkNamespace, homesDistinct, daemonPidsDistinct, namesDistinct,
    releasePathsDistinct, logPathsDistinct, allOrNoneObserved, managedMembership,
    memoryMaxApplied, cpuQuotaApplied, tasksMaxApplied, nofileLimitApplied,
    pm2MemoryLimitOnlyRejected, cpuThrottlingObserved,
  }
}

function isHardPass(evidence, derived) {
  return (
    evidence.topology.legacyEndpoint === LEGACY_ENDPOINT &&
    evidence.topology.managedEndpoint === MANAGED_ENDPOINT && derived.sameNetworkNamespace &&
    derived.homesDistinct && derived.daemonPidsDistinct && derived.namesDistinct &&
    derived.releasePathsDistinct && derived.logPathsDistinct &&
    evidence.healthContract.managedHealthUrl === MANAGED_HEALTH_URL &&
    evidence.healthContract.legacyHealthProbeCountByReleaseTools === 0 &&
    /^nginx\/[0-9]/.test(evidence.nginx.binaryVersion) &&
    evidence.nginx.invalidCandidateTestExitCode !== 0 &&
    evidence.nginx.invalidCandidateReloadAttempted === false &&
    evidence.nginx.targetAfterInvalidCandidate === 'legacy' &&
    evidence.nginx.validCandidateTestExitCode === 0 &&
    evidence.nginx.targetAfterReload === 'managed' && derived.allOrNoneObserved &&
    evidence.releaseChain.genesisStatus === 'PARALLEL_SERVING_R1' &&
    evidence.releaseChain.failedReleaseError === 'RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK' &&
    evidence.releaseChain.currentAfterRollback === evidence.releaseChain.activatedReleaseId &&
    evidence.releaseChain.rollbackTarget === 'managed-previous-only' &&
    evidence.releaseChain.legacyFallbackAttempted === false &&
    evidence.resourceIsolation.cgroupVersion === 'v2' &&
    evidence.resourceIsolation.engine === 'systemd' && derived.managedMembership &&
    derived.memoryMaxApplied && derived.cpuQuotaApplied && derived.tasksMaxApplied &&
    derived.nofileLimitApplied && derived.pm2MemoryLimitOnlyRejected &&
    derived.cpuThrottlingObserved && evidence.resourceIsolation.legacyProbeFailuresUnderLoad === 0 &&
    DATA_SAFETY_KEYS.every((key) => evidence.dataSafety[key] === false)
  )
}

export function renderNginxConfig({ target, listenPort, pidPath, accessLogPath, errorLogPath }) {
  if (target !== 'legacy' && target !== 'managed') fail()
  if (!Number.isInteger(listenPort) || listenPort < 1024 || listenPort > 65535) fail()
  for (const path of [pidPath, accessLogPath, errorLogPath]) assertSafePath(path)
  const endpoint = target === 'legacy' ? LEGACY_ENDPOINT : MANAGED_ENDPOINT
  return [
    'worker_processes 1;',
    `pid "${pidPath}";`,
    `error_log "${errorLogPath}" notice;`,
    'events { worker_connections 64; }',
    'http {',
    `  access_log "${accessLogPath}";`,
    '  server {',
    `    listen 127.0.0.1:${listenPort};`,
    '    location / {',
    '      proxy_http_version 1.1;',
    '      proxy_set_header Connection "";',
    `      proxy_pass http://${endpoint};`,
    '    }',
    '  }',
    '}',
    '',
  ].join('\n')
}

const TRANSITIONS = Object.freeze({
  LEGACY_ACTIVE: Object.freeze({ candidate_validated: 'MANAGED_CANDIDATE_VALIDATED' }),
  MANAGED_CANDIDATE_VALIDATED: Object.freeze({
    validation_failed: 'LEGACY_ACTIVE', reload_failed: 'LEGACY_ACTIVE',
    reload_succeeded: 'MANAGED_RELOADED_UNCONFIRMED',
  }),
  MANAGED_RELOADED_UNCONFIRMED: Object.freeze({
    external_check_failed: 'LEGACY_ACTIVE', confirm: 'CUTOVER_CONFIRMED',
  }),
  CUTOVER_CONFIRMED: Object.freeze({ bad_managed_release: 'MANAGED_PREVIOUS_ONLY' }),
  MANAGED_PREVIOUS_ONLY: Object.freeze({}),
})

export function transitionCutover(state, event) {
  const next = TRANSITIONS[state]?.[event]
  if (!next) fail()
  return next
}

export function createFailureMeasurements(recordedAt) {
  if (!isRecordedAt(recordedAt)) fail('EVIDENCE')
  const zero = '0'.repeat(64)
  return {
    recordedAt,
    topology: { legacyNetNamespaceInode: '1', managedNetNamespaceInode: '2', nginxNetNamespaceInode: '3' },
    controlIsolation: {
      legacyPm2HomeId: zero, managedPm2HomeId: zero, legacyDaemonId: 'unknown-daemon', managedDaemonId: 'unknown-daemon',
      legacyNameId: 'unknown-name', managedNameId: 'unknown-name', legacyReleasePathsId: zero, managedReleasePathsId: zero,
      legacyLogPathsId: zero, managedLogPathsId: zero,
    },
    healthContract: { managedHealthUrl: MANAGED_HEALTH_URL, legacyHealthProbeCountByReleaseTools: 0 },
    nginx: {
      binaryVersion: 'nginx/unknown', invalidCandidateTestExitCode: 0, invalidCandidateReloadAttempted: false,
      observedTargetsAfterInvalidCandidate: ['legacy'], targetAfterInvalidCandidate: 'legacy', validCandidateTestExitCode: 1,
      observedTargetsAfterValidReload: ['legacy'], targetAfterReload: 'managed',
    },
    releaseChain: {
      genesisStatus: 'PARALLEL_SERVING_R1', activatedReleaseId: 'unknown-r2',
      failedReleaseError: 'RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK', currentAfterRollback: 'unknown-r1',
      rollbackTarget: 'managed-previous-only', legacyFallbackAttempted: false,
    },
    resourceIsolation: {
      cgroupVersion: 'v2', engine: 'systemd', managedControlGroupId: zero, managedDaemonControlGroupId: zero,
      managedAppControlGroupId: zero, effectiveMemoryMaxBytes: 1, effectiveCpuQuotaPerSecUSec: 1,
      effectiveTasksMax: 1, effectiveLimitNOFILE: 1, nrThrottledBefore: 0, nrThrottledAfter: 0,
      legacyProbeFailuresUnderLoad: 1,
    },
    dataSafety: Object.fromEntries(DATA_SAFETY_KEYS.map((key) => [key, false])),
  }
}

export function buildEvidence(input) {
  if (!isRecord(input)) fail('EVIDENCE')
  const base = {
    schemaVersion: 1,
    plane: 'd2-prime-same-host-dual-port',
    verdict: 'D2_PRIME_NO_GO',
    productionF1: 'NO-GO',
    topology: {
      legacyEndpoint: LEGACY_ENDPOINT,
      managedEndpoint: MANAGED_ENDPOINT,
      legacyNetNamespaceInode: input.topology?.legacyNetNamespaceInode,
      managedNetNamespaceInode: input.topology?.managedNetNamespaceInode,
      nginxNetNamespaceInode: input.topology?.nginxNetNamespaceInode,
      sameNetworkNamespace: false,
    },
    controlIsolation: {
      legacyPm2HomeId: input.controlIsolation?.legacyPm2HomeId,
      managedPm2HomeId: input.controlIsolation?.managedPm2HomeId,
      legacyDaemonId: input.controlIsolation?.legacyDaemonId,
      managedDaemonId: input.controlIsolation?.managedDaemonId,
      legacyNameId: input.controlIsolation?.legacyNameId,
      managedNameId: input.controlIsolation?.managedNameId,
      legacyReleasePathsId: input.controlIsolation?.legacyReleasePathsId,
      managedReleasePathsId: input.controlIsolation?.managedReleasePathsId,
      legacyLogPathsId: input.controlIsolation?.legacyLogPathsId,
      managedLogPathsId: input.controlIsolation?.managedLogPathsId,
      homesDistinct: false, daemonPidsDistinct: false, namesDistinct: false,
      releasePathsDistinct: false, logPathsDistinct: false,
    },
    healthContract: {
      managedHealthUrl: input.healthContract?.managedHealthUrl,
      legacyHealthProbeCountByReleaseTools: input.healthContract?.legacyHealthProbeCountByReleaseTools,
    },
    nginx: {
      binaryVersion: input.nginx?.binaryVersion,
      invalidCandidateTestExitCode: input.nginx?.invalidCandidateTestExitCode,
      invalidCandidateReloadAttempted: input.nginx?.invalidCandidateReloadAttempted,
      observedTargetsAfterInvalidCandidate: input.nginx?.observedTargetsAfterInvalidCandidate,
      targetAfterInvalidCandidate: input.nginx?.targetAfterInvalidCandidate,
      validCandidateTestExitCode: input.nginx?.validCandidateTestExitCode,
      observedTargetsAfterValidReload: input.nginx?.observedTargetsAfterValidReload,
      targetAfterReload: input.nginx?.targetAfterReload,
      allOrNoneObserved: false,
    },
    releaseChain: Object.fromEntries(RELEASE_KEYS.map((key) => [key, input.releaseChain?.[key]])),
    resourceIsolation: {
      cgroupVersion: input.resourceIsolation?.cgroupVersion,
      engine: input.resourceIsolation?.engine,
      managedControlGroupId: input.resourceIsolation?.managedControlGroupId,
      managedDaemonControlGroupId: input.resourceIsolation?.managedDaemonControlGroupId,
      managedAppControlGroupId: input.resourceIsolation?.managedAppControlGroupId,
      effectiveMemoryMaxBytes: input.resourceIsolation?.effectiveMemoryMaxBytes,
      effectiveCpuQuotaPerSecUSec: input.resourceIsolation?.effectiveCpuQuotaPerSecUSec,
      effectiveTasksMax: input.resourceIsolation?.effectiveTasksMax,
      effectiveLimitNOFILE: input.resourceIsolation?.effectiveLimitNOFILE,
      nrThrottledBefore: input.resourceIsolation?.nrThrottledBefore,
      nrThrottledAfter: input.resourceIsolation?.nrThrottledAfter,
      memoryMaxApplied: false, cpuQuotaApplied: false, tasksMaxApplied: false,
      nofileLimitApplied: false, pm2MemoryLimitOnlyRejected: false,
      cpuThrottlingObserved: false,
      legacyProbeFailuresUnderLoad: input.resourceIsolation?.legacyProbeFailuresUnderLoad,
    },
    dataSafety: Object.fromEntries(DATA_SAFETY_KEYS.map((key) => [key, input.dataSafety?.[key]])),
    recordedAt: input.recordedAt,
  }
  const derived = derive(base)
  const evidence = {
    ...base,
    topology: { ...base.topology, sameNetworkNamespace: derived.sameNetworkNamespace },
    controlIsolation: {
      ...base.controlIsolation,
      homesDistinct: derived.homesDistinct,
      daemonPidsDistinct: derived.daemonPidsDistinct,
      namesDistinct: derived.namesDistinct,
      releasePathsDistinct: derived.releasePathsDistinct,
      logPathsDistinct: derived.logPathsDistinct,
    },
    nginx: { ...base.nginx, allOrNoneObserved: derived.allOrNoneObserved },
    resourceIsolation: {
      ...base.resourceIsolation,
      memoryMaxApplied: derived.memoryMaxApplied,
      cpuQuotaApplied: derived.cpuQuotaApplied,
      tasksMaxApplied: derived.tasksMaxApplied,
      nofileLimitApplied: derived.nofileLimitApplied,
      pm2MemoryLimitOnlyRejected: derived.pm2MemoryLimitOnlyRejected,
      cpuThrottlingObserved: derived.cpuThrottlingObserved,
    },
    verdict: isHardPass(base, derived) ? 'D2_PRIME_PASS' : 'D2_PRIME_NO_GO',
  }
  return validateEvidence(evidence)
}

export function validateEvidence(evidence) {
  if (!hasExactKeys(evidence, TOP_LEVEL_KEYS)) fail('EVIDENCE')
  if (evidence.schemaVersion !== 1 || evidence.plane !== 'd2-prime-same-host-dual-port') fail('EVIDENCE')
  if (evidence.productionF1 !== 'NO-GO') fail('EVIDENCE')
  if (!['D2_PRIME_PASS', 'D2_PRIME_NO_GO'].includes(evidence.verdict)) fail('EVIDENCE')
  if (!hasExactKeys(evidence.topology, TOPOLOGY_KEYS)) fail('EVIDENCE')
  if (!hasExactKeys(evidence.controlIsolation, CONTROL_KEYS)) fail('EVIDENCE')
  if (!hasExactKeys(evidence.healthContract, HEALTH_KEYS)) fail('EVIDENCE')
  if (!hasExactKeys(evidence.nginx, NGINX_KEYS)) fail('EVIDENCE')
  if (!hasExactKeys(evidence.releaseChain, RELEASE_KEYS)) fail('EVIDENCE')
  if (!hasExactKeys(evidence.resourceIsolation, RESOURCE_KEYS)) fail('EVIDENCE')
  if (!hasExactKeys(evidence.dataSafety, DATA_SAFETY_KEYS)) fail('EVIDENCE')
  if (evidence.topology.legacyEndpoint !== LEGACY_ENDPOINT || evidence.topology.managedEndpoint !== MANAGED_ENDPOINT) fail('EVIDENCE')
  if (![evidence.topology.legacyNetNamespaceInode, evidence.topology.managedNetNamespaceInode, evidence.topology.nginxNetNamespaceInode].every(isInode)) fail('EVIDENCE')
  for (const key of ['legacyPm2HomeId', 'managedPm2HomeId', 'legacyReleasePathsId', 'managedReleasePathsId', 'legacyLogPathsId', 'managedLogPathsId']) {
    if (!isSha(evidence.controlIsolation[key])) fail('EVIDENCE')
  }
  for (const key of ['legacyDaemonId', 'managedDaemonId', 'legacyNameId', 'managedNameId']) {
    if (!isSafeId(evidence.controlIsolation[key])) fail('EVIDENCE')
  }
  if (evidence.healthContract.managedHealthUrl !== MANAGED_HEALTH_URL || !isNonNegativeInteger(evidence.healthContract.legacyHealthProbeCountByReleaseTools)) fail('EVIDENCE')
  if (typeof evidence.nginx.binaryVersion !== 'string' || !/^nginx\/[A-Za-z0-9._-]{1,32}$/.test(evidence.nginx.binaryVersion) || !isNonNegativeInteger(evidence.nginx.invalidCandidateTestExitCode) || !isNonNegativeInteger(evidence.nginx.validCandidateTestExitCode)) fail('EVIDENCE')
  if (typeof evidence.nginx.invalidCandidateReloadAttempted !== 'boolean' || evidence.nginx.targetAfterInvalidCandidate !== 'legacy' || evidence.nginx.targetAfterReload !== 'managed') fail('EVIDENCE')
  if (!isObservedTargetList(evidence.nginx.observedTargetsAfterInvalidCandidate) || !isObservedTargetList(evidence.nginx.observedTargetsAfterValidReload)) fail('EVIDENCE')
  if (evidence.releaseChain.genesisStatus !== 'PARALLEL_SERVING_R1' || !isSafeId(evidence.releaseChain.activatedReleaseId) || !isSafeId(evidence.releaseChain.currentAfterRollback)) fail('EVIDENCE')
  if (evidence.releaseChain.failedReleaseError !== 'RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK' || evidence.releaseChain.rollbackTarget !== 'managed-previous-only' || typeof evidence.releaseChain.legacyFallbackAttempted !== 'boolean') fail('EVIDENCE')
  for (const key of ['managedControlGroupId', 'managedDaemonControlGroupId', 'managedAppControlGroupId']) {
    if (!isSha(evidence.resourceIsolation[key])) fail('EVIDENCE')
  }
  for (const key of ['effectiveMemoryMaxBytes', 'effectiveCpuQuotaPerSecUSec', 'effectiveTasksMax', 'effectiveLimitNOFILE']) {
    if (!isPositiveInteger(evidence.resourceIsolation[key])) fail('EVIDENCE')
  }
  for (const key of ['nrThrottledBefore', 'nrThrottledAfter', 'legacyProbeFailuresUnderLoad']) {
    if (!isNonNegativeInteger(evidence.resourceIsolation[key])) fail('EVIDENCE')
  }
  for (const key of ['memoryMaxApplied', 'cpuQuotaApplied', 'tasksMaxApplied', 'nofileLimitApplied', 'pm2MemoryLimitOnlyRejected', 'cpuThrottlingObserved']) {
    if (typeof evidence.resourceIsolation[key] !== 'boolean') fail('EVIDENCE')
  }
  if (typeof evidence.resourceIsolation.cgroupVersion !== 'string' || typeof evidence.resourceIsolation.engine !== 'string') fail('EVIDENCE')
  if (!DATA_SAFETY_KEYS.every((key) => typeof evidence.dataSafety[key] === 'boolean')) fail('EVIDENCE')
  if (!isRecordedAt(evidence.recordedAt)) fail('EVIDENCE')

  const derived = derive(evidence)
  const booleansMatch =
    evidence.topology.sameNetworkNamespace === derived.sameNetworkNamespace &&
    evidence.controlIsolation.homesDistinct === derived.homesDistinct &&
    evidence.controlIsolation.daemonPidsDistinct === derived.daemonPidsDistinct &&
    evidence.controlIsolation.namesDistinct === derived.namesDistinct &&
    evidence.controlIsolation.releasePathsDistinct === derived.releasePathsDistinct &&
    evidence.controlIsolation.logPathsDistinct === derived.logPathsDistinct &&
    evidence.nginx.allOrNoneObserved === derived.allOrNoneObserved &&
    evidence.resourceIsolation.memoryMaxApplied === derived.memoryMaxApplied &&
    evidence.resourceIsolation.cpuQuotaApplied === derived.cpuQuotaApplied &&
    evidence.resourceIsolation.tasksMaxApplied === derived.tasksMaxApplied &&
    evidence.resourceIsolation.nofileLimitApplied === derived.nofileLimitApplied &&
    evidence.resourceIsolation.pm2MemoryLimitOnlyRejected === derived.pm2MemoryLimitOnlyRejected &&
    evidence.resourceIsolation.cpuThrottlingObserved === derived.cpuThrottlingObserved
  if (!booleansMatch) fail('EVIDENCE')
  const expectedVerdict = isHardPass(evidence, derived) ? 'D2_PRIME_PASS' : 'D2_PRIME_NO_GO'
  if (evidence.verdict !== expectedVerdict) fail('EVIDENCE')
  return evidence
}
