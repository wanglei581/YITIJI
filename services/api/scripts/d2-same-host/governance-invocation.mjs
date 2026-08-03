import { dirname, join } from 'node:path'
import {
  ERROR_CODES, GovernanceError, canonicalJson, fail, parseInvokeInput,
} from './governance-contract.mjs'
import {
  assertCloneSnapshotUnchanged, canonicalFutureTarget,
} from './governance-git.mjs'
import {
  loadGovernanceState as loadGovernanceRecords, validateGovernanceRoot, writeExclusiveJson,
} from './governance-store.mjs'
import { loadGovernanceState as parseGovernanceState } from './governance-state.mjs'

const RESERVATION_ID = /^[0-9a-f]{32}$/u

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.valueOf())) fail(ERROR_CODES.WRITE)
  return date.toISOString()
}

function eventId(adapters) {
  try {
    const monotonic = adapters.monotonicTime()
    const random = adapters.randomId()
    if (typeof monotonic !== 'bigint' || monotonic < 0n || monotonic > 0xffffffffffffffffn ||
      typeof random !== 'string' || !RESERVATION_ID.test(random)) fail(ERROR_CODES.WRITE)
    return `${monotonic.toString(16).padStart(16, '0')}-${random}`
  } catch (error) {
    if (error instanceof GovernanceError && error.code === ERROR_CODES.WRITE) throw error
    fail(ERROR_CODES.WRITE)
  }
}

function loadState(root, adapters) {
  return parseGovernanceState(loadGovernanceRecords(root, adapters))
}

function completeManifest(state, reservationId) {
  const manifest = state.completeReservations.get(reservationId)
  if (!manifest) fail(ERROR_CODES.MANIFEST)
  if (state.invocations.has(reservationId)) fail(ERROR_CODES.ALREADY_INVOKED)
  return manifest
}

function assertSameManifest(expected, state, reservationId) {
  const current = completeManifest(state, reservationId)
  if (current.digest !== expected.digest ||
    canonicalJson(current.payload) !== canonicalJson(expected.payload)) fail(ERROR_CODES.MANIFEST)
  return current
}

function assertModuleClone(manifest, adapters) {
  try {
    if (adapters.moduleCloneRoot() !== manifest.payload.clone.realpath) {
      fail(ERROR_CODES.GIT_IDENTITY)
    }
  } catch (error) {
    if (error instanceof GovernanceError && error.code === ERROR_CODES.GIT_IDENTITY) throw error
    fail(ERROR_CODES.GIT_IDENTITY)
  }
}

function assertTargetAbsent(path, code, adapters) {
  if (canonicalFutureTarget(path, code, adapters) !== path) fail(code)
}

function writeInvokedEvent(root, manifest, createdAt, adapters) {
  const id = eventId(adapters)
  writeExclusiveJson(join(root, 'events', `${id}.json`), {
    schemaVersion: 1,
    eventId: id,
    kind: 'INVOKED',
    outcome: 'RECORDED',
    reservationId: manifest.payload.reservationId,
    identityHashes: manifest.payload.identityHashes,
    createdAt,
  }, adapters)
}

function writeFault(adapters, point) {
  try { adapters.fault(point) } catch { fail(ERROR_CODES.WRITE) }
}

function commitInvocation(root, manifest, adapters) {
  writeFault(adapters, 'before-invocation-tombstone')
  const createdAt = timestamp(adapters.now())
  writeExclusiveJson(join(root, 'invocations', `${manifest.payload.reservationId}.json`), {
    schemaVersion: 1,
    kind: 'INVOCATION',
    reservationId: manifest.payload.reservationId,
    manifestDigest: manifest.digest,
    createdAt,
  }, adapters, ERROR_CODES.ALREADY_INVOKED)
  writeFault(adapters, 'after-invocation-tombstone')
  writeFault(adapters, 'before-event:INVOKED')
  try {
    writeInvokedEvent(root, manifest, createdAt, adapters)
  } catch (error) {
    if (error instanceof GovernanceError && error.code === ERROR_CODES.WRITE) throw error
    fail(ERROR_CODES.WRITE)
  }
  writeFault(adapters, 'after-event:INVOKED')
}

function writePrivateContext(fd, evidenceOut, adapters) {
  const value = Buffer.from(`${dirname(evidenceOut)}\n${evidenceOut}\n`, 'utf8')
  try {
    adapters.fault('before-context')
    const written = (adapters.writeInvocationContext ?? adapters.writeContext)(fd, value)
    if (written !== value.length) fail(ERROR_CODES.WRITE)
    adapters.fault('after-context')
  } catch (error) {
    if (error instanceof GovernanceError && error.code === ERROR_CODES.WRITE) throw error
    fail(ERROR_CODES.WRITE)
  }
}

export function invokeExecution(raw, adapters) {
  try {
    const input = parseInvokeInput(raw)
    const root = validateGovernanceRoot(input.stateRoot, adapters)
    const manifest = completeManifest(loadState(root, adapters), input.reservationId)
    assertModuleClone(manifest, adapters)
    assertCloneSnapshotUnchanged(manifest.payload.clone, adapters)
    assertTargetAbsent(manifest.payload.evidenceOut, ERROR_CODES.ALREADY_RESERVED, adapters)
    assertTargetAbsent(manifest.payload.archiveOut, ERROR_CODES.ARCHIVE_EXISTS, adapters)
    assertSameManifest(manifest, loadState(root, adapters), input.reservationId)
    commitInvocation(root, manifest, adapters)
    writePrivateContext(input.contextFd, manifest.payload.evidenceOut, adapters)
    return Object.freeze({ reservationId: input.reservationId })
  } catch (error) {
    if (error instanceof GovernanceError) throw error
    fail(ERROR_CODES.GOVERNANCE_STATE)
  }
}
