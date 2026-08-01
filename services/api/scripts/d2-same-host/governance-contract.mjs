import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
export { verifyRunScriptWiring } from './governance-wiring-contract.mjs'

export const ERROR_CODES = Object.freeze({
  GOVERNANCE_STATE: 'D2_PRIME_NO_GO_GOVERNANCE_STATE',
  INPUT: 'D2_PRIME_NO_GO_INPUT',
  GIT_IDENTITY: 'D2_PRIME_NO_GO_GIT_IDENTITY',
  ALREADY_RESERVED: 'D2_PRIME_NO_GO_ALREADY_RESERVED',
  ARCHIVE_EXISTS: 'D2_PRIME_NO_GO_ARCHIVE_EXISTS',
  MANIFEST: 'D2_PRIME_NO_GO_MANIFEST',
  WRITE: 'D2_PRIME_NO_GO_WRITE',
  ALREADY_INVOKED: 'D2_PRIME_NO_GO_ALREADY_INVOKED',
  LEDGER: 'D2_PRIME_NO_GO_LEDGER',
})

const ERROR_CODE_VALUES = new Set(Object.values(ERROR_CODES))
const RESERVE_KEYS = Object.freeze([
  'stateRoot',
  'taskId',
  'branch',
  'baselineOid',
  'cloneRoot',
  'evidenceOut',
  'archiveOut',
])
const INVOKE_KEYS = Object.freeze(['stateRoot', 'reservationId', 'contextFd'])
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const TASK_ID = /^[a-z0-9][a-z0-9-]{0,95}$/
const BRANCH = /^[A-Za-z0-9._/-]{1,160}$/
const RESERVATION_ID = /^[0-9a-f]{32}$/
const SHA256 = /^[0-9a-f]{64}$/
const DECIMAL = /^(?:0|[1-9][0-9]*)$/
const RFC3339_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const MANIFEST_KEYS = Object.freeze([
  'schemaVersion', 'reservationId', 'taskId', 'branch', 'baselineOid', 'clone',
  'evidenceOut', 'archiveOut', 'identityHashes', 'createdAt',
])
const CLONE_KEYS = Object.freeze(['realpath', 'dev', 'ino', 'branch', 'headOid', 'treeOid', 'clean'])
const IDENTITY_KEYS = Object.freeze(['task', 'branch', 'baseline', 'clone', 'evidence', 'archive'])
const MAX_CANONICAL_DEPTH = 64
const MAX_CANONICAL_NODES = 10_000

export class GovernanceError extends Error {
  constructor(code) {
    const safeCode = ERROR_CODE_VALUES.has(code) ? code : ERROR_CODES.GOVERNANCE_STATE
    super(safeCode)
    this.name = 'GovernanceError'
    this.code = safeCode
  }
}

export function fail(code = ERROR_CODES.GOVERNANCE_STATE) {
  throw new GovernanceError(code)
}

function sameExactKeys(actual, expected) {
  if (actual.some((key) => typeof key !== 'string')) return false
  const sorted = [...actual].sort()
  const wanted = [...expected].sort()
  return sorted.length === wanted.length && sorted.every((key, index) => key === wanted[index])
}

function isEnumerableDataProperty(descriptor) {
  return descriptor?.enumerable === true &&
    Object.prototype.hasOwnProperty.call(descriptor, 'value')
}

function reflectShape(value) {
  try {
    return {
      prototype: Object.getPrototypeOf(value),
      keys: Reflect.ownKeys(value),
      descriptors: Object.getOwnPropertyDescriptors(value),
    }
  } catch {
    fail(ERROR_CODES.INPUT)
  }
}

function snapshotExactInput(raw, expected) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail(ERROR_CODES.INPUT)
  const { prototype, keys, descriptors } = reflectShape(raw)
  if (
    prototype !== Object.prototype || !sameExactKeys(keys, expected) ||
    !sameExactKeys(Reflect.ownKeys(descriptors), expected)
  ) fail(ERROR_CODES.INPUT)

  const snapshot = {}
  for (const key of expected) {
    const descriptor = descriptors[key]
    if (!isEnumerableDataProperty(descriptor)) fail(ERROR_CODES.INPUT)
    snapshot[key] = descriptor.value
  }
  return Object.freeze(snapshot)
}

function assertAbsolutePath(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\u0000\r\n]/u.test(value)) {
    fail(ERROR_CODES.INPUT)
  }
}

function assertCanonicalAbsolutePath(value) {
  assertAbsolutePath(value)
  if (resolve(value) !== value) fail(ERROR_CODES.INPUT)
}

export function parseReserveInput(raw) {
  const input = snapshotExactInput(raw, RESERVE_KEYS)
  for (const path of [input.stateRoot, input.cloneRoot, input.evidenceOut, input.archiveOut]) {
    assertAbsolutePath(path)
  }
  if (typeof input.taskId !== 'string' || !TASK_ID.test(input.taskId)) fail(ERROR_CODES.INPUT)
  if (typeof input.branch !== 'string' || !BRANCH.test(input.branch)) fail(ERROR_CODES.INPUT)
  if (typeof input.baselineOid !== 'string' || !GIT_OID.test(input.baselineOid)) {
    fail(ERROR_CODES.INPUT)
  }
  return Object.freeze({
    stateRoot: input.stateRoot,
    taskId: input.taskId,
    branch: input.branch,
    baselineOid: input.baselineOid,
    cloneRoot: input.cloneRoot,
    evidenceOut: input.evidenceOut,
    archiveOut: input.archiveOut,
  })
}

export function parseInvokeInput(raw) {
  const input = snapshotExactInput(raw, INVOKE_KEYS)
  assertAbsolutePath(input.stateRoot)
  if (typeof input.reservationId !== 'string' || !RESERVATION_ID.test(input.reservationId)) {
    fail(ERROR_CODES.INPUT)
  }
  if (!Number.isInteger(input.contextFd) || input.contextFd !== 3) fail(ERROR_CODES.INPUT)
  return Object.freeze({
    stateRoot: input.stateRoot,
    reservationId: input.reservationId,
    contextFd: input.contextFd,
  })
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !RFC3339_MILLIS.test(value)) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}

export function parseManifestPayload(raw) {
  const payload = snapshotExactInput(raw, MANIFEST_KEYS)
  const clone = snapshotExactInput(payload.clone, CLONE_KEYS)
  const identityHashes = snapshotExactInput(payload.identityHashes, IDENTITY_KEYS)
  if (payload.schemaVersion !== 1 || typeof payload.reservationId !== 'string' ||
    !RESERVATION_ID.test(payload.reservationId) || typeof payload.taskId !== 'string' ||
    !TASK_ID.test(payload.taskId) || typeof payload.branch !== 'string' ||
    !BRANCH.test(payload.branch) || typeof payload.baselineOid !== 'string' ||
    !GIT_OID.test(payload.baselineOid) || !validTimestamp(payload.createdAt)) fail(ERROR_CODES.INPUT)
  for (const path of [clone.realpath, payload.evidenceOut, payload.archiveOut]) {
    assertCanonicalAbsolutePath(path)
  }
  if (typeof clone.dev !== 'string' || !DECIMAL.test(clone.dev) ||
    typeof clone.ino !== 'string' || !DECIMAL.test(clone.ino) || clone.clean !== true ||
    typeof clone.branch !== 'string' || !BRANCH.test(clone.branch) ||
    typeof clone.headOid !== 'string' || !GIT_OID.test(clone.headOid) ||
    typeof clone.treeOid !== 'string' || !GIT_OID.test(clone.treeOid) ||
    clone.branch !== payload.branch || clone.headOid !== payload.baselineOid ||
    clone.headOid.length !== clone.treeOid.length ||
    IDENTITY_KEYS.some((key) => typeof identityHashes[key] !== 'string' ||
      !SHA256.test(identityHashes[key]))) fail(ERROR_CODES.INPUT)
  const identityValues = {
    task: payload.taskId, branch: payload.branch, baseline: payload.baselineOid,
    clone, evidence: payload.evidenceOut, archive: payload.archiveOut,
  }
  if (IDENTITY_KEYS.some((facet) => identityHashes[facet] !== sha256(canonicalJson({
    schemaVersion: 1, facet, value: identityValues[facet],
  })))) fail(ERROR_CODES.INPUT)
  return Object.freeze({
    schemaVersion: 1,
    reservationId: payload.reservationId,
    taskId: payload.taskId,
    branch: payload.branch,
    baselineOid: payload.baselineOid,
    clone: Object.freeze({ ...clone }),
    evidenceOut: payload.evidenceOut,
    archiveOut: payload.archiveOut,
    identityHashes: Object.freeze({ ...identityHashes }),
    createdAt: payload.createdAt,
  })
}

function encodeCanonicalArray(descriptors, keys, state, depth) {
  const lengthDescriptor = descriptors.length
  if (
    !lengthDescriptor || lengthDescriptor.enumerable !== false ||
    !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
    !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_CANONICAL_NODES
  ) fail(ERROR_CODES.INPUT)

  const length = lengthDescriptor.value
  const expectedKeys = Array.from({ length }, (_, index) => String(index)).concat('length')
  if (!sameExactKeys(keys, expectedKeys) || !sameExactKeys(Reflect.ownKeys(descriptors), expectedKeys)) {
    fail(ERROR_CODES.INPUT)
  }
  const parts = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)]
    if (!isEnumerableDataProperty(descriptor)) fail(ERROR_CODES.INPUT)
    parts.push(encodeCanonical(descriptor.value, state, depth + 1))
  }
  return `[${parts.join(',')}]`
}

function encodeCanonicalObject(prototype, descriptors, keys, state, depth) {
  if (prototype !== Object.prototype || !sameExactKeys(Reflect.ownKeys(descriptors), keys)) {
    fail(ERROR_CODES.INPUT)
  }
  if (keys.some((key) => typeof key !== 'string')) fail(ERROR_CODES.INPUT)
  const sorted = [...keys].sort()
  const parts = []
  for (const key of sorted) {
    const descriptor = descriptors[key]
    if (!isEnumerableDataProperty(descriptor)) fail(ERROR_CODES.INPUT)
    parts.push(`${JSON.stringify(key)}:${encodeCanonical(descriptor.value, state, depth + 1)}`)
  }
  return `{${parts.join(',')}}`
}

function encodeCanonical(value, state, depth) {
  if (depth > MAX_CANONICAL_DEPTH || state.nodes >= MAX_CANONICAL_NODES) {
    fail(ERROR_CODES.INPUT)
  }
  state.nodes += 1
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(ERROR_CODES.INPUT)
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') fail(ERROR_CODES.INPUT)
  if (state.ancestors.has(value)) fail(ERROR_CODES.INPUT)

  state.ancestors.add(value)
  try {
    const { prototype, keys, descriptors } = reflectShape(value)
    return Array.isArray(value)
      ? encodeCanonicalArray(descriptors, keys, state, depth)
      : encodeCanonicalObject(prototype, descriptors, keys, state, depth)
  } finally {
    state.ancestors.delete(value)
  }
}

export function canonicalJson(value) {
  try {
    return encodeCanonical(value, { ancestors: new Set(), nodes: 0 }, 0)
  } catch (error) {
    if (error instanceof GovernanceError && error.code === ERROR_CODES.INPUT) throw error
    fail(ERROR_CODES.INPUT)
  }
}

export function sha256(value) {
  if (typeof value !== 'string') fail(ERROR_CODES.INPUT)
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
