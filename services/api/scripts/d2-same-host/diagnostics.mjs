import assert from 'node:assert/strict'

export const DRILL_PHASES = Object.freeze({
  SETUP: 'SETUP',
  CUTOVER: 'CUTOVER',
  ROLLBACK: 'ROLLBACK',
  MEASURE: 'MEASURE',
  EVIDENCE: 'EVIDENCE',
  CLEANUP: 'CLEANUP',
})

export const MEASURE_STEPS = Object.freeze({
  NONE: 'NONE',
  MANAGED_PID: 'MANAGED_PID',
  NGINX_VERSION: 'NGINX_VERSION',
  TOPOLOGY: 'TOPOLOGY',
  CONTROL_ISOLATION: 'CONTROL_ISOLATION',
  RESOURCE_ISOLATION: 'RESOURCE_ISOLATION',
  CGROUP_CONSISTENCY: 'CGROUP_CONSISTENCY',
})

export const DRILL_ERROR_CLASSES = Object.freeze({
  NAMED: 'NAMED',
  ASSERTION: 'ASSERTION',
  SYSTEM: 'SYSTEM',
  SYNTAX: 'SYNTAX',
  TYPE: 'TYPE',
  ERROR: 'ERROR',
  UNKNOWN: 'UNKNOWN',
})

export const FAILURE_EVIDENCE_CODE = 'D2_PRIME_FAILURE_EVIDENCE_WRITE_FAILED'

const FALLBACK_CODE = 'D2_PRIME_DRILL_FAILED'
const NAMED_CODE = /^(?:D2_PRIME|RELEASE_PROVENANCE)_[A-Z0-9_]{1,80}$/
const TRUSTED_D2_CODES = new Set([
  'D2_PRIME_BOUNDED_LOAD_FAILED',
  'D2_PRIME_CGROUP_INVALID',
  'D2_PRIME_COMMAND_FAILED',
  'D2_PRIME_COMMAND_INVALID',
  'D2_PRIME_CONTRACT_INVALID',
  'D2_PRIME_CPU_STAT_INVALID',
  'D2_PRIME_ENV_INVALID',
  'D2_PRIME_EVIDENCE_INVALID',
  'D2_PRIME_EVIDENCE_NO_GO',
  'D2_PRIME_EVIDENCE_PATH_INVALID',
  'D2_PRIME_FAILURE_EVIDENCE_INVALID',
  'D2_PRIME_LEGACY_FALLBACK_DETECTED',
  'D2_PRIME_MANAGED_APP_PID_STALE',
  'D2_PRIME_MANAGED_READY_INVALID',
  'D2_PRIME_MANAGED_READY_TIMEOUT',
  'D2_PRIME_MARKER_PATH_INVALID',
  'D2_PRIME_NGINX_INITIAL_CONFIG_INVALID',
  'D2_PRIME_NGINX_INVALID_CANDIDATE_ACCEPTED',
  'D2_PRIME_NGINX_INVALID_CANDIDATE_SWITCHED',
  'D2_PRIME_NGINX_LEGACY_TARGET_INVALID',
  'D2_PRIME_NGINX_MANAGED_CANDIDATE_INVALID',
  'D2_PRIME_NGINX_MIXED_TARGETS',
  'D2_PRIME_NGINX_PORT_INVALID',
  'D2_PRIME_NGINX_RELOAD_UNCONFIRMED',
  'D2_PRIME_NGINX_TARGET_INVALID',
  'D2_PRIME_NGINX_VERSION_INVALID',
  'D2_PRIME_PATH_INVALID',
  'D2_PRIME_PID_INVALID',
  'D2_PRIME_PM2_APP_PID_INVALID',
  'D2_PRIME_PM2_CONTROL_ROOT_INVALID',
  'D2_PRIME_PM2_SOCKET_PATH_INVALID',
  'D2_PRIME_PM2_SPAWN_STATE_INVALID',
  'D2_PRIME_R3_UNEXPECTEDLY_ACTIVATED',
  'D2_PRIME_ROLLBACK_LEFT_MANAGED',
  'D2_PRIME_SYSTEMCTL_INVALID',
  'D2_PRIME_SYSTEMD_LIMIT_INVALID',
])
const TRUSTED_RELEASE_PROVENANCE_CODES = new Set([
  'RELEASE_PROVENANCE_ACTIVATION_ARGUMENT_INVALID',
  'RELEASE_PROVENANCE_ACTIVATION_FAILED',
  'RELEASE_PROVENANCE_ACTIVATION_LOCKED',
  'RELEASE_PROVENANCE_ACTIVATION_LOCK_RELEASE_FAILED',
  'RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK',
  'RELEASE_PROVENANCE_ARTIFACT_MANIFEST_MISMATCH',
  'RELEASE_PROVENANCE_ARTIFACT_MANIFEST_MISSING',
  'RELEASE_PROVENANCE_ARTIFACT_RELEASE_EXISTS',
  'RELEASE_PROVENANCE_ARTIFACT_RELEASE_INVALID',
  'RELEASE_PROVENANCE_ARTIFACT_ROOT_INVALID',
  'RELEASE_PROVENANCE_ARTIFACT_RUNTIME_TREE_MISMATCH',
  'RELEASE_PROVENANCE_ARTIFACT_RUNTIME_TREE_MISSING',
  'RELEASE_PROVENANCE_CANDIDATE_IS_CURRENT',
  'RELEASE_PROVENANCE_CREATED_AT_INVALID',
  'RELEASE_PROVENANCE_CURRENT_LINK_INVALID',
  'RELEASE_PROVENANCE_CURRENT_LINK_MISMATCH',
  'RELEASE_PROVENANCE_ENTRYPOINT_MISMATCH',
  'RELEASE_PROVENANCE_ENTRYPOINT_MISSING',
  'RELEASE_PROVENANCE_GENESIS_ALREADY_INITIALIZED',
  'RELEASE_PROVENANCE_GENESIS_CLEANUP_UNVERIFIED',
  'RELEASE_PROVENANCE_GENESIS_CONTROL_ROOT_INVALID',
  'RELEASE_PROVENANCE_GENESIS_CONTROL_STATE_INVALID',
  'RELEASE_PROVENANCE_GENESIS_CURRENT_CREATE_FAILED',
  'RELEASE_PROVENANCE_GENESIS_FAILED',
  'RELEASE_PROVENANCE_GENESIS_HEALTH_FAILED',
  'RELEASE_PROVENANCE_GENESIS_LOCKED',
  'RELEASE_PROVENANCE_GENESIS_LOCK_RELEASE_FAILED',
  'RELEASE_PROVENANCE_GENESIS_MANAGED_CURRENT_EXISTS',
  'RELEASE_PROVENANCE_GENESIS_PM2_EXISTS',
  'RELEASE_PROVENANCE_GIT_COMMIT_INVALID',
  'RELEASE_PROVENANCE_HEALTH_URL_INVALID',
  'RELEASE_PROVENANCE_LAUNCHER_INVALID',
  'RELEASE_PROVENANCE_LINK_SWITCH_FAILED',
  'RELEASE_PROVENANCE_MANIFEST_INVALID',
  'RELEASE_PROVENANCE_MANIFEST_INVALID_JSON',
  'RELEASE_PROVENANCE_MANIFEST_MISSING',
  'RELEASE_PROVENANCE_MANIFEST_NOT_CANONICAL',
  'RELEASE_PROVENANCE_MANIFEST_SIDECAR_MISMATCH',
  'RELEASE_PROVENANCE_MANIFEST_SIDECAR_MISSING',
  'RELEASE_PROVENANCE_NODE_VERSION_INVALID',
  'RELEASE_PROVENANCE_PM2_COMMAND_FAILED',
  'RELEASE_PROVENANCE_PM2_INSPECT_INVALID',
  'RELEASE_PROVENANCE_PM2_NAME_INVALID',
  'RELEASE_PROVENANCE_PM2_PATH_MISMATCH',
  'RELEASE_PROVENANCE_PNPM_VERSION_INVALID',
  'RELEASE_PROVENANCE_POST_SWITCH_HEALTH_FAILED',
  'RELEASE_PROVENANCE_RELEASE_ID_INVALID',
  'RELEASE_PROVENANCE_RELEASE_ROOT_INVALID',
  'RELEASE_PROVENANCE_ROLLBACK_UNVERIFIED',
  'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID',
  'RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_MISMATCH',
  'RELEASE_PROVENANCE_RUNTIME_ENV_VALUE_MISSING',
  'RELEASE_PROVENANCE_RUNTIME_FILE_TYPE_UNSUPPORTED',
  'RELEASE_PROVENANCE_RUNTIME_PATH_INVALID',
  'RELEASE_PROVENANCE_RUNTIME_ROOT_INVALID',
  'RELEASE_PROVENANCE_RUNTIME_ROOT_MISSING',
  'RELEASE_PROVENANCE_RUNTIME_TREE_DUPLICATE',
  'RELEASE_PROVENANCE_RUNTIME_TREE_MISMATCH',
  'RELEASE_PROVENANCE_RUNTIME_TREE_MISSING',
  'RELEASE_PROVENANCE_SCHEMA_UNSUPPORTED',
  'RELEASE_PROVENANCE_SOURCE_ARCHIVE_INVALID',
  'RELEASE_PROVENANCE_SOURCE_ARCHIVE_MISMATCH',
  'RELEASE_PROVENANCE_SOURCE_ARCHIVE_MISSING',
  'RELEASE_PROVENANCE_SYMLINK_CYCLE',
  'RELEASE_PROVENANCE_SYMLINK_ESCAPES_ROOT',
  'RELEASE_PROVENANCE_SYMLINK_TARGET_UNCONTROLLED',
  'RELEASE_PROVENANCE_SYMLINK_UNRESOLVED',
])
const TRUSTED_NAMED_CODES = new Set([
  ...TRUSTED_D2_CODES,
  ...TRUSTED_RELEASE_PROVENANCE_CODES,
])
const SYSTEM_CODES = new Set([
  'EACCES', 'EEXIST', 'EIO', 'EISDIR', 'EMFILE', 'ENFILE', 'ENOENT', 'ENOSPC',
  'ENOTDIR', 'EPERM', 'EROFS',
])
const DIAGNOSTIC_KEYS = Object.freeze([
  'phase', 'errorClass', 'code', 'measureStep', 'failureEvidenceCode',
])
const DIAGNOSTIC = Symbol('d2-prime-diagnostic')

function hasExactKeys(value, keys) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const actual = Object.keys(value).sort()
    const expected = [...keys].sort()
    return actual.length === expected.length && actual.every((key, index) => key === expected[index])
  } catch {
    return false
  }
}

function isKnownValue(record, value) {
  return Object.values(record).includes(value)
}

function safeInstanceOf(value, constructor) {
  try {
    return value instanceof constructor
  } catch {
    return false
  }
}

function ownDataValue(value, key) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function validateDiagnostic(diagnostic) {
  const phase = ownDataValue(diagnostic, 'phase')
  const errorClass = ownDataValue(diagnostic, 'errorClass')
  const code = ownDataValue(diagnostic, 'code')
  const measureStep = ownDataValue(diagnostic, 'measureStep')
  const failureEvidenceCode = ownDataValue(diagnostic, 'failureEvidenceCode')
  const trustedNamedCode = TRUSTED_NAMED_CODES.has(code)
  if (
    !hasExactKeys(diagnostic, DIAGNOSTIC_KEYS) ||
    !isKnownValue(DRILL_PHASES, phase) ||
    !isKnownValue(DRILL_ERROR_CLASSES, errorClass) ||
    !(code === FALLBACK_CODE || (trustedNamedCode && NAMED_CODE.test(code))) ||
    !isKnownValue(MEASURE_STEPS, measureStep) ||
    (phase === DRILL_PHASES.MEASURE) !== (measureStep !== MEASURE_STEPS.NONE) ||
    ![null, FAILURE_EVIDENCE_CODE].includes(failureEvidenceCode)
  ) throw new Error('D2_PRIME_DIAGNOSTIC_CONTRACT_INVALID')
  if (
    (errorClass === DRILL_ERROR_CLASSES.NAMED && !(trustedNamedCode && NAMED_CODE.test(code))) ||
    (errorClass !== DRILL_ERROR_CLASSES.NAMED && code !== FALLBACK_CODE)
  ) {
    throw new Error('D2_PRIME_DIAGNOSTIC_CONTRACT_INVALID')
  }
  return Object.freeze({ phase, errorClass, code, measureStep, failureEvidenceCode })
}

function classifyError(error) {
  if (safeInstanceOf(error, assert.AssertionError)) return DRILL_ERROR_CLASSES.ASSERTION
  if (safeInstanceOf(error, Error) && SYSTEM_CODES.has(ownDataValue(error, 'code'))) {
    return DRILL_ERROR_CLASSES.SYSTEM
  }
  if (safeInstanceOf(error, SyntaxError)) return DRILL_ERROR_CLASSES.SYNTAX
  if (safeInstanceOf(error, TypeError)) return DRILL_ERROR_CLASSES.TYPE
  if (safeInstanceOf(error, Error)) return DRILL_ERROR_CLASSES.ERROR
  return DRILL_ERROR_CLASSES.UNKNOWN
}

export function classifyDrillFailure(error, phase, measureStep = MEASURE_STEPS.NONE) {
  if (!isKnownValue(DRILL_PHASES, phase)) throw new Error('D2_PRIME_DIAGNOSTIC_CONTRACT_INVALID')
  const message = ownDataValue(error, 'message')
  const namedCode = typeof message === 'string' && TRUSTED_NAMED_CODES.has(message) ? message : null
  const normalizedMeasureStep = phase === DRILL_PHASES.MEASURE ? measureStep : MEASURE_STEPS.NONE
  const diagnostic = {
    phase,
    errorClass: namedCode ? DRILL_ERROR_CLASSES.NAMED : classifyError(error),
    code: namedCode ?? FALLBACK_CODE,
    measureStep: normalizedMeasureStep,
    failureEvidenceCode: null,
  }
  return validateDiagnostic(diagnostic)
}

export function withFailureEvidenceWriteFailure(diagnostic) {
  const canonical = validateDiagnostic(diagnostic)
  return validateDiagnostic({ ...canonical, failureEvidenceCode: FAILURE_EVIDENCE_CODE })
}

export function createDrillDiagnosticError(diagnostic) {
  const canonical = validateDiagnostic(diagnostic)
  const error = new Error(canonical.code)
  Object.defineProperty(error, DIAGNOSTIC, { value: canonical })
  return Object.freeze(error)
}

export function resolveDrillDiagnostic(error, fallbackPhase, fallbackMeasureStep = MEASURE_STEPS.NONE) {
  const diagnostic = ownDataValue(error, DIAGNOSTIC)
  if (diagnostic !== undefined) return validateDiagnostic(diagnostic)
  return classifyDrillFailure(error, fallbackPhase, fallbackMeasureStep)
}

export function formatDrillFailure(diagnostic) {
  const { phase, errorClass, code, measureStep, failureEvidenceCode } = validateDiagnostic(diagnostic)
  const evidence = failureEvidenceCode === null
    ? ''
    : ` evidence=${failureEvidenceCode}`
  return `D2_PRIME_NO_GO phase=${phase} class=${errorClass} code=${code} step=${measureStep}${evidence}`
}
