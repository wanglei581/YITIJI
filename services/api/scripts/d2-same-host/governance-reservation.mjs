import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, realpathSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  ERROR_CODES, GovernanceError, canonicalJson, fail, parseManifestPayload, parseReserveInput,
  sha256,
} from './governance-contract.mjs'
import {
  canonicalFutureTarget, captureCloneSnapshot,
} from './governance-git.mjs'
import {
  assertSeparatedRoots, ensureLayout, loadGovernanceState as loadGovernanceRecords,
  validateGovernanceRoot,
  writeExclusiveJson,
} from './governance-store.mjs'
import {
  FACET_ORDER, loadGovernanceState as parseGovernanceState,
} from './governance-state.mjs'

const RESERVATION_ID = /^[0-9a-f]{32}$/u
export { FACET_ORDER }
function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.valueOf())) fail(ERROR_CODES.WRITE)
  return date.toISOString()
}
function identityHash(facet, value) {
  return sha256(canonicalJson({ schemaVersion: 1, facet, value }))
}

export function createManifestPayload(input, snapshot, evidence, archive, reservationId, createdAt) {
  const identityHashes = Object.freeze(Object.fromEntries(FACET_ORDER.map((facet) => [
    facet,
    identityHash(facet, facet === 'task' ? input.taskId
      : facet === 'branch' ? input.branch
        : facet === 'baseline' ? input.baselineOid
          : facet === 'clone' ? snapshot
            : facet === 'evidence' ? evidence : archive),
  ])))
  return parseManifestPayload({
    schemaVersion: 1, reservationId, taskId: input.taskId, branch: input.branch,
    baselineOid: input.baselineOid, clone: snapshot, evidenceOut: evidence,
    archiveOut: archive, identityHashes, createdAt,
  })
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}
function sameFileSnapshot(left, right) {
  return sameIdentity(left, right) && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
}
function privateDirectorySnapshot(path, adapters) {
  const stat = lstatSync(path, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
    stat.uid !== BigInt(adapters.effectiveUid()) || (stat.mode & 0o7777n) !== 0o700n ||
    realpathSync(path) !== path) fail(ERROR_CODES.WRITE)
  return stat
}
function immutableFile(stat, adapters, size) {
  return stat.isFile() && stat.uid === BigInt(adapters.effectiveUid()) &&
    (stat.mode & 0o7777n) === 0o600n && stat.nlink === 1n && stat.size === size
}
function readExact(fd, size) {
  const buffer = Buffer.alloc(size)
  let offset = 0
  while (offset < size) {
    const count = readSync(fd, buffer, offset, size - offset, null)
    if (!Number.isInteger(count) || count <= 0) fail(ERROR_CODES.WRITE)
    offset += count
  }
  if (readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0) fail(ERROR_CODES.WRITE)
  return buffer
}

export function loadReservationState(state) {
  return parseGovernanceState(state)
}

function writeIdentityTombstone(root, facet, identityHashValue, reservationId,
  manifestDigest, createdAt, adapters) {
  const path = join(root, 'reservations', `by-${facet}`, `${identityHashValue}.json`)
  const bytes = Buffer.from(`${canonicalJson({
    schemaVersion: 1, kind: 'IDENTITY', facet, identityHash: identityHashValue,
    reservationId, manifestDigest, createdAt,
  })}\n`, 'utf8')
  let fd; let parentFd; let readFd; let pending; let targetCreateConflict = false
  let parentBefore; let parentOpened
  try {
    const parent = dirname(path)
    parentBefore = privateDirectorySnapshot(parent, adapters)
    parentFd = openSync(parent, constants.O_RDONLY | constants.O_NOFOLLOW)
    parentOpened = fstatSync(parentFd, { bigint: true })
    if (!parentOpened.isDirectory() || !sameIdentity(parentBefore, parentOpened)) {
      fail(ERROR_CODES.WRITE)
    }
    try {
      fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY |
        constants.O_NOFOLLOW, 0o600)
    } catch (error) {
      if (error?.code === 'EEXIST') targetCreateConflict = true
      throw error
    }
    const opened = fstatSync(fd, { bigint: true })
    if (!immutableFile(opened, adapters, 0n)) fail(ERROR_CODES.WRITE)
    adapters.writeContext(fd, bytes)
    if (fstatSync(fd, { bigint: true }).size !== BigInt(bytes.length)) fail(ERROR_CODES.WRITE)
    fsyncSync(fd)
    const approved = fstatSync(fd, { bigint: true })
    if (!immutableFile(approved, adapters, BigInt(bytes.length)) ||
      !sameIdentity(opened, approved)) fail(ERROR_CODES.WRITE)
    adapters.fault('after-identity-file-sync', path)
    adapters.syncDirectory(parentFd, parent)
    const parentAfterSync = privateDirectorySnapshot(parent, adapters)
    const parentFdAfterSync = fstatSync(parentFd, { bigint: true })
    if (!sameIdentity(parentBefore, parentAfterSync) ||
      !sameIdentity(parentOpened, parentFdAfterSync)) fail(ERROR_CODES.WRITE)
    readFd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const reopened = fstatSync(readFd, { bigint: true })
    if (!immutableFile(reopened, adapters, BigInt(bytes.length)) ||
      !sameFileSnapshot(approved, reopened) || !readExact(readFd, bytes.length).equals(bytes)) {
      fail(ERROR_CODES.WRITE)
    }
    const verified = fstatSync(readFd, { bigint: true })
    if (!sameFileSnapshot(reopened, verified)) fail(ERROR_CODES.WRITE)
    adapters.fault('after-identity-readback', path)
    const final = lstatSync(path, { bigint: true })
    const finalWriteFd = fstatSync(fd, { bigint: true })
    const finalReadFd = fstatSync(readFd, { bigint: true })
    const parentFinal = privateDirectorySnapshot(parent, adapters)
    if (!immutableFile(final, adapters, BigInt(bytes.length)) ||
      !sameFileSnapshot(approved, final) || !sameFileSnapshot(approved, finalWriteFd) ||
      !sameFileSnapshot(approved, finalReadFd) || !sameIdentity(parentBefore, parentFinal)) {
      fail(ERROR_CODES.WRITE)
    }
  } catch (error) {
    let verifiedTargetConflict = false
    if (targetCreateConflict && parentBefore && parentOpened && parentFd !== undefined) {
      try {
        verifiedTargetConflict = sameIdentity(parentBefore, privateDirectorySnapshot(dirname(path), adapters)) &&
          sameIdentity(parentOpened, fstatSync(parentFd, { bigint: true }))
      } catch { verifiedTargetConflict = false }
    }
    pending = new GovernanceError(
      verifiedTargetConflict ? ERROR_CODES.ALREADY_RESERVED : ERROR_CODES.WRITE,
    )
  } finally {
    try { if (readFd !== undefined) closeSync(readFd) } catch { pending = new GovernanceError(ERROR_CODES.WRITE) }
    try { if (fd !== undefined) closeSync(fd) } catch { pending = new GovernanceError(ERROR_CODES.WRITE) }
    try { if (parentFd !== undefined) closeSync(parentFd) } catch { pending = new GovernanceError(ERROR_CODES.WRITE) }
  }
  if (pending) throw pending
}
function createEventId(adapters) {
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
function writeEvent(root, kind, reservationId, identityHashes, createdAt, adapters) {
  const eventId = createEventId(adapters)
  writeExclusiveJson(join(root, 'events', `${eventId}.json`), {
    schemaVersion: 1, eventId, kind, outcome: 'RECORDED', reservationId,
    identityHashes, createdAt,
  }, adapters)
}

export function reserveExecution(raw, adapters) {
  try {
    const input = parseReserveInput(raw)
    const root = validateGovernanceRoot(input.stateRoot, adapters)
    const rawClone = resolve(input.cloneRoot)
    assertSeparatedRoots(root, rawClone, resolve(input.evidenceOut), resolve(input.archiveOut), [
      join(rawClone, 'services/api/scripts/d2-same-host/.work'),
    ])
    ensureLayout(root, adapters)
    loadReservationState(loadGovernanceRecords(root, adapters))
    const snapshot = captureCloneSnapshot(input.cloneRoot, input.branch, input.baselineOid, adapters)
    const evidence = canonicalFutureTarget(input.evidenceOut, ERROR_CODES.ALREADY_RESERVED, adapters)
    const archive = canonicalFutureTarget(input.archiveOut, ERROR_CODES.ARCHIVE_EXISTS, adapters)
    assertSeparatedRoots(root, snapshot.realpath, evidence, archive, [
      join(snapshot.realpath, 'services/api/scripts/d2-same-host/.work'),
    ])
    const reservationId = adapters.randomId()
    const createdAt = timestamp(adapters.now())
    const payload = createManifestPayload(
      input, snapshot, evidence, archive, reservationId, createdAt,
    )
    const manifestDigest = sha256(canonicalJson(payload))
    writeExclusiveJson(join(root, 'reservations', 'by-reservation', `${reservationId}.json`), {
      schemaVersion: 1, kind: 'RESERVATION_INTENT', reservationId, manifestDigest, createdAt,
    }, adapters)
    adapters.fault('after-reservation-intent')
    writeEvent(root, 'RESERVE_INTENT', reservationId, payload.identityHashes, createdAt, adapters)
    for (const facet of FACET_ORDER) {
      writeIdentityTombstone(
        root, facet, payload.identityHashes[facet], reservationId, manifestDigest, createdAt, adapters,
      )
      adapters.fault(`after-facet:${facet}`)
    }
    writeExclusiveJson(join(root, 'manifests', `${reservationId}.json`), payload, adapters)
    adapters.fault('after-manifest')
    writeEvent(root, 'RESERVED', reservationId, payload.identityHashes, createdAt, adapters)
    adapters.fault('after-event:RESERVED')
    return Object.freeze({ reservationId })
  } catch (error) {
    if (error instanceof GovernanceError) throw error
    fail(ERROR_CODES.GOVERNANCE_STATE)
  }
}
