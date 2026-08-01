import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readSync, readdirSync, realpathSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ERROR_CODES, GovernanceError, canonicalJson, fail } from './governance-contract.mjs'

const APPROVED_FILESYSTEMS = new Set([0xef53n, 0x58465342n, 0x9123683en, 0x1an])
const RESERVATION_INDEXES = Object.freeze([
  'by-reservation', 'by-task', 'by-branch', 'by-baseline', 'by-clone', 'by-evidence',
  'by-archive',
])
const TOP_LEVEL_DIRECTORIES = Object.freeze(['reservations', 'invocations', 'manifests', 'events'])
const LEAF_DIRECTORIES = Object.freeze([
  ...RESERVATION_INDEXES.map((name) => join('reservations', name)),
  'invocations', 'manifests', 'events',
])
const ALL_DIRECTORIES = Object.freeze(['reservations', ...LEAF_DIRECTORIES])
const MAX_LEAF_BYTES = 64 * 1024

function throwFixed(code) { fail(code) }
function adapterValue(adapter, path) {
  return typeof adapter === 'function' ? adapter(path) : adapter
}
function expectedUid(adapters, path) {
  const uid = adapterValue(adapters.effectiveUid, path)
  if (!Number.isInteger(uid) || uid < 0) throw new Error('invalid effective uid')
  return uid
}
function hasUnsafePathCharacters(path) { return /[\u0000\r\n]/u.test(path) }
function sameIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino }
function sameDirectorySnapshot(left, right) {
  return sameIdentity(left, right) && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
}
function sameSnapshot(left, right) {
  return sameIdentity(left, right) && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
}
function isImmutableFile(stat, uid, size) {
  return stat.isFile() && stat.uid === uid && (stat.mode & 0o7777n) === 0o600n &&
    stat.nlink === 1n && stat.size === size
}
function assertPrivateDirectory(path, adapters, code, expected) {
  try {
    const stat = lstatSync(path, { bigint: true })
    if (stat.isSymbolicLink() || !stat.isDirectory() ||
      stat.uid !== BigInt(expectedUid(adapters, path)) ||
      (stat.mode & 0o7777n) !== 0o700n || realpathSync(path) !== path ||
      (expected && !sameIdentity(stat, expected))) throwFixed(code)
    return Object.freeze({
      path, dev: stat.dev, ino: stat.ino, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs,
    })
  } catch (error) {
    if (error instanceof GovernanceError && error.code === code) throw error
    throwFixed(code)
  }
}

export function isApprovedLocalFilesystem(type) {
  try { return APPROVED_FILESYSTEMS.has(BigInt(type)) } catch { return false }
}
export function validateGovernanceRoot(root, adapters) {
  try {
    if (typeof root !== 'string' || !isAbsolute(root) || hasUnsafePathCharacters(root) ||
      resolve(root) !== root || realpathSync(root) !== root) throwFixed(ERROR_CODES.GOVERNANCE_STATE)
    assertPrivateDirectory(root, adapters, ERROR_CODES.GOVERNANCE_STATE)
    if (!isApprovedLocalFilesystem(adapterValue(adapters.filesystemKind, root))) {
      throwFixed(ERROR_CODES.GOVERNANCE_STATE)
    }
    return root
  } catch (error) {
    if (error instanceof GovernanceError && error.code === ERROR_CODES.GOVERNANCE_STATE) throw error
    throwFixed(ERROR_CODES.GOVERNANCE_STATE)
  }
}
function snapshotDirectory(path, adapters, expected) {
  const before = assertPrivateDirectory(path, adapters, ERROR_CODES.LEDGER)
  const entries = readdirSync(path, { withFileTypes: true })
  const allowed = expected && new Set(expected)
  if (entries.some((entry) => hasUnsafePathCharacters(entry.name))) throw new Error('unsafe layout entry')
  if (expected && (entries.length !== expected.length ||
    entries.some((entry) => !allowed.has(entry.name) || !entry.isDirectory()))) {
    throw new Error('invalid layout entry')
  }
  if (!expected && entries.some((entry) => !entry.isFile())) throw new Error('invalid leaf entry')
  const after = assertPrivateDirectory(path, adapters, ERROR_CODES.LEDGER)
  if (!sameDirectorySnapshot(before, after)) throw new Error('directory changed during snapshot')
  const signature = JSON.stringify(entries.map((entry) => [entry.name, entry.isFile() ? 'f' : 'd'])
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
  return Object.freeze({ ...after, signature })
}
function snapshotLayout(root, adapters) {
  return Object.freeze([
    snapshotDirectory(root, adapters, TOP_LEVEL_DIRECTORIES),
    snapshotDirectory(join(root, 'reservations'), adapters, RESERVATION_INDEXES),
    ...LEAF_DIRECTORIES.map((leaf) => snapshotDirectory(join(root, leaf), adapters)),
  ])
}
export function ensureLayout(root, adapters) {
  validateGovernanceRoot(root, adapters)
  try {
    for (const relativePath of ALL_DIRECTORIES) {
      const path = join(root, relativePath)
      try { mkdirSync(path, { mode: 0o700 }) } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
      assertPrivateDirectory(path, adapters, ERROR_CODES.LEDGER)
    }
    return snapshotLayout(root, adapters)
  } catch (error) {
    if (error instanceof GovernanceError && error.code === ERROR_CODES.LEDGER) throw error
    throwFixed(ERROR_CODES.LEDGER)
  }
}
function closeTracked(fd, pending) {
  if (fd === undefined) return pending
  try { closeSync(fd) } catch (error) { return pending ?? error }
  return pending
}
function readBytes(fd, size) {
  const buffer = Buffer.alloc(size)
  let offset = 0
  while (offset < size) {
    const count = readSync(fd, buffer, offset, size - offset, null)
    if (count <= 0) throw new Error('short read')
    offset += count
  }
  if (readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0) throw new Error('file grew')
  return buffer
}
export function writeExclusiveJson(path, value, adapters, conflictCode = ERROR_CODES.WRITE) {
  let payload
  try { payload = Buffer.from(`${canonicalJson(value)}\n`, 'utf8') } catch (error) {
    if (error instanceof GovernanceError) throw error
    throwFixed(ERROR_CODES.WRITE)
  }
  if (payload.length > MAX_LEAF_BYTES) throwFixed(ERROR_CODES.WRITE)
  let fd; let parentFd; let readFd; let pending; let result; let targetCreateConflict = false
  let parentIdentity
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || hasUnsafePathCharacters(path) ||
      resolve(path) !== path) throwFixed(ERROR_CODES.WRITE)
    if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
      throwFixed(ERROR_CODES.WRITE)
    }
    const parent = dirname(path)
    parentIdentity = assertPrivateDirectory(parent, adapters, ERROR_CODES.WRITE)
    parentFd = openSync(parent, constants.O_RDONLY | constants.O_NOFOLLOW)
    const openedParent = fstatSync(parentFd, { bigint: true })
    if (!openedParent.isDirectory() || !sameIdentity(openedParent, parentIdentity)) {
      throwFixed(ERROR_CODES.WRITE)
    }
    try {
      fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY |
        constants.O_NOFOLLOW, 0o600)
    } catch (error) {
      if (error?.code === 'EEXIST') targetCreateConflict = true
      throw error
    }
    const uid = BigInt(expectedUid(adapters, path))
    const stat = fstatSync(fd, { bigint: true })
    if (!isImmutableFile(stat, uid, 0n)) throwFixed(ERROR_CODES.WRITE)
    adapters.writeContext(fd, payload)
    if (fstatSync(fd, { bigint: true }).size !== BigInt(payload.length)) throwFixed(ERROR_CODES.WRITE)
    fsyncSync(fd)
    const approved = fstatSync(fd, { bigint: true })
    adapters.fault('after-file-sync', path)
    adapters.syncDirectory(parentFd, parent)
    assertPrivateDirectory(parent, adapters, ERROR_CODES.WRITE, parentIdentity)
    readFd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const reopened = fstatSync(readFd, { bigint: true })
    if (!isImmutableFile(reopened, uid, BigInt(payload.length)) ||
      !sameSnapshot(approved, reopened) || !readBytes(readFd, payload.length).equals(payload)) {
      throwFixed(ERROR_CODES.WRITE)
    }
    const verified = fstatSync(readFd, { bigint: true })
    const finalPath = lstatSync(path, { bigint: true })
    const finalFd = fstatSync(fd, { bigint: true })
    if (!isImmutableFile(finalPath, uid, BigInt(payload.length)) ||
      !isImmutableFile(finalFd, uid, BigInt(payload.length)) || !sameSnapshot(approved, verified) ||
      !sameSnapshot(approved, finalPath) || !sameSnapshot(approved, finalFd)) throwFixed(ERROR_CODES.WRITE)
    result = path
  } catch (error) { pending = error } finally {
    pending = closeTracked(readFd, pending)
    pending = closeTracked(fd, pending)
    pending = closeTracked(parentFd, pending)
  }
  if (!pending) return result
  if (targetCreateConflict && conflictCode !== ERROR_CODES.WRITE && parentIdentity) {
    try {
      assertPrivateDirectory(dirname(path), adapters, ERROR_CODES.WRITE, parentIdentity)
      throwFixed(conflictCode)
    } catch (error) {
      if (error instanceof GovernanceError && error.code === conflictCode) throw error
    }
  }
  throwFixed(ERROR_CODES.WRITE)
}
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
function readLeaf(path, relativePath, adapters) {
  let fd; let pending
  try {
    if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
      throw new Error('O_NOFOLLOW unavailable')
    }
    const before = lstatSync(path, { bigint: true })
    if (!isImmutableFile(before, BigInt(expectedUid(adapters, path)), before.size) ||
      before.size < 1n || before.size > BigInt(MAX_LEAF_BYTES)) throw new Error('invalid leaf metadata')
    adapters.fault('after-leaf-lstat', path)
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = fstatSync(fd, { bigint: true })
    if (!sameSnapshot(before, opened)) throw new Error('leaf changed before read')
    const buffer = readBytes(fd, Number(opened.size))
    const finalSnapshot = fstatSync(fd, { bigint: true })
    if (!sameSnapshot(opened, finalSnapshot)) throw new Error('leaf changed during read')
    closeSync(fd); fd = undefined
    const text = buffer.toString('utf8')
    if (!Buffer.from(text, 'utf8').equals(buffer) || !text.endsWith('\n') ||
      text.endsWith('\n\n')) throw new Error('invalid leaf terminator')
    const source = text.slice(0, -1)
    const value = JSON.parse(source)
    if (canonicalJson(value) !== source) throw new Error('non-canonical leaf')
    const record = Object.freeze({ path: relativePath, value: deepFreeze(value) })
    return Object.freeze({ record, path, snapshot: finalSnapshot })
  } catch (error) { pending = error } finally { pending = closeTracked(fd, pending) }
  throw pending
}
function sameLayout(left, right) {
  return left.length === right.length && left.every((snapshot, index) =>
    sameDirectorySnapshot(snapshot, right[index]) && snapshot.signature === right[index].signature)
}
export function loadGovernanceState(root, adapters) {
  validateGovernanceRoot(root, adapters)
  try {
    const before = ensureLayout(root, adapters)
    const loaded = []
    for (const leaf of LEAF_DIRECTORIES) {
      const directory = join(root, leaf)
      for (const name of readdirSync(directory).sort()) {
        loaded.push(readLeaf(join(directory, name), join(leaf, name), adapters))
      }
    }
    if (!sameLayout(before, snapshotLayout(root, adapters))) throw new Error('layout changed during load')
    for (const item of loaded) {
      const stat = lstatSync(item.path, { bigint: true })
      if (!isImmutableFile(stat, BigInt(expectedUid(adapters, item.path)), item.snapshot.size) ||
        !sameSnapshot(stat, item.snapshot)) throw new Error('leaf changed after read')
    }
    if (!sameLayout(before, snapshotLayout(root, adapters))) throw new Error('layout changed after load')
    return Object.freeze({
      root, records: Object.freeze(loaded.map(({ record }) => record)),
    })
  } catch { throwFixed(ERROR_CODES.LEDGER) }
}
function canonicalAbsolute(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || hasUnsafePathCharacters(path) ||
    resolve(path) !== path) throw new Error('non-canonical path')
  return path
}
function contains(left, right) {
  const fromLeft = relative(left, right)
  return fromLeft === '' || (fromLeft !== '..' && !fromLeft.startsWith(`..${sep}`) &&
    !isAbsolute(fromLeft))
}
export function assertSeparatedRoots(root, clone, evidence, archive, cleanupRoots = []) {
  try {
    const governanceRoot = canonicalAbsolute(root)
    if (!Array.isArray(cleanupRoots)) throw new Error('invalid cleanup roots')
    const others = [clone, evidence, archive, ...cleanupRoots].map(canonicalAbsolute)
    for (const other of others) {
      if (contains(governanceRoot, other) || contains(other, governanceRoot)) {
        throw new Error('overlapping roots')
      }
    }
    return governanceRoot
  } catch { throwFixed(ERROR_CODES.GOVERNANCE_STATE) }
}
