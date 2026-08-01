#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  rmdirSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ERROR_CODES = Object.freeze({
  PATH: 'D2_PRIME_NO_GO_GOVERNANCE_PATH',
  INPUT: 'D2_PRIME_NO_GO_INVOCATION_INPUT',
  BUSY: 'D2_PRIME_NO_GO_INVOCATION_BUSY',
  RESERVED: 'D2_PRIME_NO_GO_INVOCATION_RESERVED',
  NOT_RESERVED: 'D2_PRIME_NO_GO_INVOCATION_NOT_RESERVED',
  ARCHIVE_EXISTS: 'D2_PRIME_NO_GO_ARCHIVE_EXISTS',
  LEDGER: 'D2_PRIME_NO_GO_INVOCATION_LEDGER',
})

const FIXED_ERROR_CODES = new Set(Object.values(ERROR_CODES))
const HASH = /^[0-9a-f]{64}$/
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const TASK_ID = /^[a-z0-9][a-z0-9-]{0,95}$/
const BASELINE_SHA = /^[0-9a-f]{40}$/
const FACET_KEYS = Object.freeze([
  'taskId',
  'baselineId',
  'branchId',
  'cloneId',
  'evidenceId',
  'archiveId',
])
const RECORD_KEYS = Object.freeze(['v', ...FACET_KEYS])
const LEDGER_KEYS = Object.freeze(['v', 'event', 'recordedAt', ...FACET_KEYS])
const MAX_PATH_BYTES = 4096
const MAX_BRANCH_BYTES = 1024
const MAX_LEDGER_LINE_BYTES = 4096
const MAX_LEDGER_BYTES = 64 * 1024 * 1024
const MAX_RECORD_BYTES = 4096
const NOFOLLOW = constants.O_NOFOLLOW ?? 0
const NONBLOCK = constants.O_NONBLOCK ?? 0
const DIRECTORY = constants.O_DIRECTORY ?? 0
const MODULE_PATH = fileURLToPath(import.meta.url)

function fail(code) {
  throw new Error(code)
}

function fixedError(error, fallback = ERROR_CODES.LEDGER) {
  if (error instanceof Error && FIXED_ERROR_CODES.has(error.message)) return error
  return new Error(fallback)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function ownUid() {
  if (typeof process.getuid !== 'function') fail(ERROR_CODES.PATH)
  return process.getuid()
}

function modeOf(stat) {
  return stat.mode & 0o777
}

function isContainedBy(parent, candidate) {
  const pathFromParent = relative(parent, candidate)
  return pathFromParent === '' || (
    pathFromParent !== '..' &&
    !pathFromParent.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(pathFromParent)
  )
}

function containingRepository(path) {
  let current = path
  while (true) {
    try {
      lstatSync(join(current, '.git'))
      return realpathSync(current)
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') fail(ERROR_CODES.PATH)
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function assertPlainObject(value, code = ERROR_CODES.INPUT) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail(code)
}

function assertString(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(ERROR_CODES.INPUT)
}

function validBranchName(branchName) {
  if (
    typeof branchName !== 'string' ||
    branchName.length === 0 ||
    Buffer.byteLength(branchName) > MAX_BRANCH_BYTES ||
    branchName === '@' ||
    branchName.startsWith('-') ||
    branchName.startsWith('/') ||
    branchName.endsWith('/') ||
    branchName.startsWith('.') ||
    branchName.endsWith('.') ||
    branchName.includes('//') ||
    branchName.includes('..') ||
    branchName.includes('@{') ||
    /[\x00-\x20\x7f~^:?*[\]\\]/.test(branchName)
  ) {
    return false
  }
  return branchName.split('/').every((component) => (
    component.length > 0 &&
    !component.startsWith('.') &&
    !component.endsWith('.') &&
    !component.endsWith('.lock')
  ))
}

function validatePathText(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value) > MAX_PATH_BYTES ||
    value.includes('\0') ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    basename(value) === '.' ||
    basename(value) === '..'
  ) {
    fail(ERROR_CODES.PATH)
  }
  return value
}

function canonicalTargetPath(value) {
  const path = validatePathText(value)
  try {
    const parent = realpathSync(dirname(path))
    const parentStat = lstatSync(parent)
    if (
      !parentStat.isDirectory() ||
      parentStat.isSymbolicLink() ||
      parentStat.uid !== ownUid() ||
      (modeOf(parentStat) & 0o022) !== 0
    ) {
      fail(ERROR_CODES.PATH)
    }
    return join(parent, basename(path))
  } catch (error) {
    throw fixedError(error, ERROR_CODES.PATH)
  }
}

function pathEntry(path, fallback = ERROR_CODES.PATH) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw fixedError(error, fallback)
  }
}

function validateRawInput(rawInput) {
  assertPlainObject(rawInput)
  const requiredKeys = [
    'governanceRoot',
    'taskId',
    'baselineSha',
    'branchName',
    'clonePath',
    'evidenceOut',
    'archivePath',
  ]
  if (!exactKeys(rawInput, requiredKeys)) fail(ERROR_CODES.INPUT)
  assertString(rawInput.taskId, TASK_ID)
  assertString(rawInput.baselineSha, BASELINE_SHA)
  if (!validBranchName(rawInput.branchName)) fail(ERROR_CODES.INPUT)

  const input = Object.freeze({
    governanceRoot: validatePathText(rawInput.governanceRoot),
    taskId: rawInput.taskId,
    baselineSha: rawInput.baselineSha,
    branchName: rawInput.branchName,
    clonePath: validatePathText(rawInput.clonePath),
    evidenceOut: validatePathText(rawInput.evidenceOut),
    archivePath: validatePathText(rawInput.archivePath),
  })
  return input
}

function validateGovernanceRoot(input) {
  const root = input.governanceRoot
  let rootStat
  let physicalRoot
  try {
    rootStat = lstatSync(root)
    physicalRoot = realpathSync(root)
  } catch (error) {
    throw fixedError(error, ERROR_CODES.PATH)
  }
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    rootStat.uid !== ownUid() ||
    modeOf(rootStat) !== 0o700
  ) {
    fail(ERROR_CODES.PATH)
  }

  const targets = [
    canonicalTargetPath(input.clonePath),
    canonicalTargetPath(input.evidenceOut),
    canonicalTargetPath(input.archivePath),
  ]
  if (new Set(targets).size !== targets.length) fail(ERROR_CODES.PATH)
  for (const target of targets) {
    if (isContainedBy(physicalRoot, target) || isContainedBy(target, physicalRoot)) {
      fail(ERROR_CODES.PATH)
    }
  }
  const moduleRepository = containingRepository(dirname(MODULE_PATH))
  if (moduleRepository && (
    isContainedBy(moduleRepository, physicalRoot) ||
    isContainedBy(physicalRoot, moduleRepository)
  )) {
    fail(ERROR_CODES.PATH)
  }
  if (containingRepository(physicalRoot)) fail(ERROR_CODES.PATH)
  return Object.freeze({ root: physicalRoot, targets })
}

function fsyncDirectory(path) {
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | DIRECTORY | NOFOLLOW)
    const stat = fstatSync(fd)
    if (!stat.isDirectory()) fail(ERROR_CODES.LEDGER)
    fsyncSync(fd)
  } catch (error) {
    throw fixedError(error)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function validateOwnedDirectory(path, expectedMode = 0o700) {
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    throw fixedError(error)
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== ownUid() ||
    modeOf(stat) !== expectedMode
  ) {
    fail(ERROR_CODES.LEDGER)
  }
}

function makeOwnedDirectory(path, parent, onCreated = () => {}) {
  try {
    mkdirSync(path, { mode: 0o700 })
    onCreated()
    const stat = lstatSync(path)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== ownUid()) {
      fail(ERROR_CODES.LEDGER)
    }
    if (modeOf(stat) !== 0o700) {
      const fd = openSync(path, constants.O_RDONLY | DIRECTORY | NOFOLLOW)
      try {
        fchmodSync(fd, 0o700)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
    }
    fsyncDirectory(parent)
    validateOwnedDirectory(path)
  } catch (error) {
    throw fixedError(error)
  }
}

function removeLock(lockPath, root) {
  try {
    rmdirSync(lockPath)
    fsyncDirectory(root)
  } catch (error) {
    throw fixedError(error)
  }
}

function restoreTombstone(lockPath, root) {
  try {
    mkdirSync(lockPath, { mode: 0o700 })
    fsyncDirectory(root)
  } catch {
    // A best-effort replacement is only needed if lock removal itself partly failed.
  }
}

function withGovernanceLock(root, action) {
  const lockPath = join(root, 'reservation.lock')
  try {
    mkdirSync(lockPath, { mode: 0o700 })
  } catch (error) {
    if (error?.code === 'EEXIST') fail(ERROR_CODES.BUSY)
    fail(ERROR_CODES.LEDGER)
  }

  let durableMutation = false
  try {
    validateOwnedDirectory(lockPath)
    fsyncDirectory(root)
    const result = action(() => { durableMutation = true })
    removeLock(lockPath, root)
    return result
  } catch (error) {
    const normalized = fixedError(error)
    if (!durableMutation) {
      try {
        removeLock(lockPath, root)
      } catch {
        throw new Error(ERROR_CODES.LEDGER)
      }
    } else {
      try {
        lstatSync(lockPath)
      } catch (lockError) {
        if (lockError?.code === 'ENOENT') restoreTombstone(lockPath, root)
      }
    }
    throw normalized
  }
}

function facetIds(input, targets) {
  return Object.freeze({
    taskId: sha256(input.taskId),
    baselineId: sha256(input.baselineSha),
    branchId: sha256(input.branchName),
    cloneId: sha256(targets[0]),
    evidenceId: sha256(targets[1]),
    archiveId: sha256(targets[2]),
  })
}

function exactKeys(value, expectedKeys) {
  return Object.keys(value).sort().join('\0') === [...expectedKeys].sort().join('\0')
}

function validFacets(value) {
  return FACET_KEYS.every((key) => typeof value[key] === 'string' && HASH.test(value[key]))
}

function validLedgerRecord(record) {
  if (
    record === null ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    !exactKeys(record, LEDGER_KEYS) ||
    record.v !== 1 ||
    !['RESERVED', 'INVOKED'].includes(record.event) ||
    typeof record.recordedAt !== 'string' ||
    !RFC3339.test(record.recordedAt) ||
    !validFacets(record)
  ) {
    return false
  }
  const timestamp = Date.parse(record.recordedAt)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === record.recordedAt
}

function readOwnedFile(path, { allowMissing = false, maxBytes = MAX_RECORD_BYTES } = {}) {
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | NONBLOCK | NOFOLLOW)
    const stat = fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.uid !== ownUid() ||
      modeOf(stat) !== 0o600 ||
      stat.nlink !== 1 ||
      !Number.isSafeInteger(stat.size) ||
      stat.size < 0 ||
      stat.size > maxBytes
    ) {
      fail(ERROR_CODES.LEDGER)
    }
    const buffer = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < buffer.length) {
      const bytesRead = readSync(fd, buffer, offset, buffer.length - offset, offset)
      if (bytesRead <= 0) fail(ERROR_CODES.LEDGER)
      offset += bytesRead
    }
    const retainedStat = fstatSync(fd)
    if (
      !retainedStat.isFile() ||
      retainedStat.uid !== ownUid() ||
      modeOf(retainedStat) !== 0o600 ||
      retainedStat.nlink !== 1 ||
      retainedStat.size !== stat.size
    ) {
      fail(ERROR_CODES.LEDGER)
    }
    return { source: buffer.toString('utf8'), size: stat.size }
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return null
    throw fixedError(error)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function readLedger(root) {
  const ledgerPath = join(root, 'invocations.jsonl')
  const file = readOwnedFile(ledgerPath, {
    allowMissing: true,
    maxBytes: MAX_LEDGER_BYTES,
  })
  if (!file) return []
  if (file.size > MAX_LEDGER_BYTES) fail(ERROR_CODES.LEDGER)
  if (file.source.length === 0) return []
  if (!file.source.endsWith('\n')) fail(ERROR_CODES.LEDGER)
  const lines = file.source.slice(0, -1).split('\n')
  const records = []
  for (const line of lines) {
    if (line.length === 0 || Buffer.byteLength(`${line}\n`) > MAX_LEDGER_LINE_BYTES) {
      fail(ERROR_CODES.LEDGER)
    }
    let record
    try {
      record = JSON.parse(line)
    } catch {
      fail(ERROR_CODES.LEDGER)
    }
    if (!validLedgerRecord(record)) fail(ERROR_CODES.LEDGER)
    records.push(record)
  }
  return records
}

function writeAll(fd, buffer) {
  let offset = 0
  while (offset < buffer.length) {
    const written = writeSync(fd, buffer, offset, buffer.length - offset)
    if (written <= 0) fail(ERROR_CODES.LEDGER)
    offset += written
  }
}

function writeExclusiveJson(path, value, parent, onCreated = () => {}) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
  let fd
  try {
    fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
      0o600,
    )
    onCreated()
    fchmodSync(fd, 0o600)
    writeAll(fd, body)
    fsyncSync(fd)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.uid !== ownUid() || modeOf(stat) !== 0o600) {
      fail(ERROR_CODES.LEDGER)
    }
  } catch (error) {
    throw fixedError(error)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
  fsyncDirectory(parent)
}

function timestampFrom(options) {
  try {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      fail(ERROR_CODES.LEDGER)
    }
    const now = options.now ?? Date.now
    if (typeof now !== 'function') fail(ERROR_CODES.LEDGER)
    const timestamp = new Date(now()).toISOString()
    if (!RFC3339.test(timestamp)) fail(ERROR_CODES.LEDGER)
    return timestamp
  } catch (error) {
    throw fixedError(error)
  }
}

function invokeInternalHook(options, hookName) {
  try {
    const hooks = options?.internalHooks
    if (hooks === undefined) return
    assertPlainObject(hooks, ERROR_CODES.LEDGER)
    const hook = hooks[hookName]
    if (hook === undefined) return
    if (typeof hook !== 'function') fail(ERROR_CODES.LEDGER)
    hook()
  } catch (error) {
    throw fixedError(error)
  }
}

function revalidateCanonicalTargets(input, expectedTargets) {
  const currentTargets = [
    canonicalTargetPath(input.clonePath),
    canonicalTargetPath(input.evidenceOut),
    canonicalTargetPath(input.archivePath),
  ]
  if (currentTargets.some((target, index) => target !== expectedTargets[index])) {
    fail(ERROR_CODES.PATH)
  }
}

function appendEvent(root, event, facets, recordedAt) {
  const record = { v: 1, event, recordedAt, ...facets }
  const line = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')
  if (line.length > MAX_LEDGER_LINE_BYTES) fail(ERROR_CODES.LEDGER)
  const ledgerPath = join(root, 'invocations.jsonl')
  const existed = pathEntry(ledgerPath, ERROR_CODES.LEDGER) !== null
  let fd
  try {
    fd = openSync(
      ledgerPath,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NONBLOCK | NOFOLLOW,
      0o600,
    )
    const stat = fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.uid !== ownUid() ||
      modeOf(stat) !== 0o600 ||
      stat.nlink !== 1 ||
      !Number.isSafeInteger(stat.size) ||
      stat.size < 0 ||
      stat.size > MAX_LEDGER_BYTES - line.length
    ) {
      fail(ERROR_CODES.LEDGER)
    }
    writeAll(fd, line)
    fsyncSync(fd)
    const retainedStat = fstatSync(fd)
    if (
      !retainedStat.isFile() ||
      retainedStat.uid !== ownUid() ||
      modeOf(retainedStat) !== 0o600 ||
      retainedStat.nlink !== 1 ||
      retainedStat.size > MAX_LEDGER_BYTES
    ) {
      fail(ERROR_CODES.LEDGER)
    }
  } catch (error) {
    throw fixedError(error)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
  if (!existed) fsyncDirectory(root)
}

function assertReserveTargetsAbsent(targets) {
  if (pathEntry(targets[2])) fail(ERROR_CODES.ARCHIVE_EXISTS)
  if (pathEntry(targets[0]) || pathEntry(targets[1])) fail(ERROR_CODES.PATH)
}

function assertConsumeTargets(targets) {
  if (pathEntry(targets[2])) fail(ERROR_CODES.ARCHIVE_EXISTS)
  const clone = pathEntry(targets[0])
  if (!clone || !clone.isDirectory() || clone.isSymbolicLink()) fail(ERROR_CODES.PATH)
  if (pathEntry(targets[1])) fail(ERROR_CODES.PATH)
}

function facetsOverlap(left, right) {
  return FACET_KEYS.some((key) => left[key] === right[key])
}

function ensureReservationsRoot(root, onCreated) {
  const reservationsRoot = join(root, 'reservations')
  const existing = pathEntry(reservationsRoot, ERROR_CODES.LEDGER)
  if (!existing) makeOwnedDirectory(reservationsRoot, root, onCreated)
  else validateOwnedDirectory(reservationsRoot)
  return reservationsRoot
}

function readJsonRecord(path, { allowMissing = false } = {}) {
  const file = readOwnedFile(path, { allowMissing })
  if (!file) return null
  let record
  try {
    record = JSON.parse(file.source)
  } catch {
    fail(ERROR_CODES.LEDGER)
  }
  if (
    record === null ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    !exactKeys(record, RECORD_KEYS) ||
    record.v !== 1 ||
    !validFacets(record)
  ) {
    fail(ERROR_CODES.LEDGER)
  }
  return record
}

function sameRecord(record, facets) {
  return record.v === 1 && FACET_KEYS.every((key) => record[key] === facets[key])
}

function reservationDirectory(root, facets, { allowMissing = false } = {}) {
  const reservationsRoot = join(root, 'reservations')
  const rootEntry = pathEntry(reservationsRoot, ERROR_CODES.LEDGER)
  if (!rootEntry) {
    if (allowMissing) return null
    fail(ERROR_CODES.LEDGER)
  }
  validateOwnedDirectory(reservationsRoot)
  const reservationDir = join(reservationsRoot, facets.taskId)
  const entry = pathEntry(reservationDir, ERROR_CODES.LEDGER)
  if (!entry) {
    if (allowMissing) return null
    fail(ERROR_CODES.LEDGER)
  }
  validateOwnedDirectory(reservationDir)
  return reservationDir
}

export function reserveInvocation(rawInput, options = {}) {
  const input = validateRawInput(rawInput)
  const { root, targets } = validateGovernanceRoot(input)
  return withGovernanceLock(root, (markDurableMutation) => {
    invokeInternalHook(options, 'afterLockAcquired')
    revalidateCanonicalTargets(input, targets)
    assertReserveTargetsAbsent(targets)
    const facets = facetIds(input, targets)
    const records = readLedger(root)
    if (records.some((record) => facetsOverlap(record, facets))) fail(ERROR_CODES.RESERVED)

    revalidateCanonicalTargets(input, targets)
    assertReserveTargetsAbsent(targets)
    const reservationsRoot = ensureReservationsRoot(root, () => {
      markDurableMutation()
      invokeInternalHook(options, 'afterReservationsRootCreated')
    })
    const reservationDir = join(reservationsRoot, facets.taskId)
    makeOwnedDirectory(reservationDir, reservationsRoot, () => {
      markDurableMutation()
      invokeInternalHook(options, 'afterReservationDirectoryCreated')
    })
    writeExclusiveJson(
      join(reservationDir, 'reservation.json'),
      { v: 1, ...facets },
      reservationDir,
      () => {
        markDurableMutation()
        invokeInternalHook(options, 'afterReservationFileOpened')
      },
    )
    appendEvent(root, 'RESERVED', facets, timestampFrom(options))
    return Object.freeze({ event: 'RESERVED' })
  })
}

export function consumeInvocation(rawInput, options = {}) {
  const input = validateRawInput(rawInput)
  const { root, targets } = validateGovernanceRoot(input)
  return withGovernanceLock(root, (markDurableMutation) => {
    invokeInternalHook(options, 'afterLockAcquired')
    revalidateCanonicalTargets(input, targets)
    assertConsumeTargets(targets)
    const facets = facetIds(input, targets)
    const records = readLedger(root)
    if (records.some((record) => record.event === 'INVOKED' && facetsOverlap(record, facets))) {
      fail(ERROR_CODES.RESERVED)
    }

    const reservationDir = reservationDirectory(root, facets, { allowMissing: true })
    if (!reservationDir) fail(ERROR_CODES.NOT_RESERVED)
    const reservation = readJsonRecord(join(reservationDir, 'reservation.json'), { allowMissing: true })
    if (!reservation || !sameRecord(reservation, facets)) fail(ERROR_CODES.NOT_RESERVED)
    if (!records.some((record) => record.event === 'RESERVED' && sameRecord(record, facets))) {
      fail(ERROR_CODES.LEDGER)
    }

    const invokedPath = join(reservationDir, 'invoked.json')
    const invoked = readJsonRecord(invokedPath, { allowMissing: true })
    if (invoked) {
      if (!sameRecord(invoked, facets)) fail(ERROR_CODES.LEDGER)
      fail(ERROR_CODES.RESERVED)
    }
    revalidateCanonicalTargets(input, targets)
    assertConsumeTargets(targets)
    writeExclusiveJson(invokedPath, { v: 1, ...facets }, reservationDir, () => {
      markDurableMutation()
      invokeInternalHook(options, 'afterInvokedFileOpened')
    })
    appendEvent(root, 'INVOKED', facets, timestampFrom(options))
    return Object.freeze({ event: 'INVOKED' })
  })
}

function inputFromEnvironment(environment) {
  return {
    governanceRoot: environment.D2_GOVERNANCE_ROOT,
    taskId: environment.D2_TASK_ID,
    baselineSha: environment.D2_BASELINE_SHA,
    branchName: environment.D2_BRANCH_NAME,
    clonePath: environment.D2_CLONE_PATH,
    evidenceOut: environment.D2_EVIDENCE_OUT,
    archivePath: environment.D2_ARCHIVE_PATH,
  }
}

function isMain() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === MODULE_PATH
}

if (isMain()) {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 1 || !['--reserve', '--consume'].includes(args[0])) {
      fail(ERROR_CODES.INPUT)
    }
    const input = inputFromEnvironment(process.env)
    if (args[0] === '--reserve') reserveInvocation(input)
    else consumeInvocation(input)
  } catch (error) {
    const code = error instanceof Error && FIXED_ERROR_CODES.has(error.message)
      ? error.message
      : ERROR_CODES.LEDGER
    process.stderr.write(`${code}\n`)
    process.exitCode = 2
  }
}
