import { randomBytes } from 'node:crypto'
import { fstatSync, fsyncSync, lstatSync, realpathSync, statfsSync, writeSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ERROR_CODES, fail, GovernanceError, parseInvokeInput, parseReserveInput,
} from './governance-contract.mjs'
import {
  assertNoSymlinkComponents as gitAssertNoSymlinkComponents,
  assertCloneSnapshotUnchanged as gitAssertCloneSnapshotUnchanged,
  canonicalFutureTarget as gitCanonicalFutureTarget,
  captureCloneSnapshot as gitCaptureCloneSnapshot,
  GIT_QUERIES,
  runGit,
} from './governance-git.mjs'
import {
  assertSeparatedRoots as storeAssertSeparatedRoots,
  ensureLayout as storeEnsureLayout,
  isApprovedLocalFilesystem,
  loadGovernanceState as storeLoadGovernanceRecords,
  validateGovernanceRoot as storeValidateGovernanceRoot,
  writeExclusiveJson as storeWriteExclusiveJson,
} from './governance-store.mjs'
import {
  loadReservationState as reservationLoadReservationState,
  reserveExecution as reservationReserveExecution,
} from './governance-reservation.mjs'
import { invokeExecution as invocationInvokeExecution } from './governance-invocation.mjs'

function writeAll(fd, value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
  let offset = 0
  while (offset < buffer.length) {
    const written = writeSync(fd, buffer, offset, buffer.length - offset)
    if (!Number.isInteger(written) || written <= 0) fail(ERROR_CODES.WRITE)
    offset += written
  }
  return buffer.length
}

function syncDirectory(fd) {
  if (!fstatSync(fd, { bigint: true }).isDirectory()) fail(ERROR_CODES.WRITE)
  fsyncSync(fd)
}

function currentModuleCloneRoot() {
  try {
    const entryPath = process.argv[1]
    const modulePath = fileURLToPath(import.meta.url)
    if (typeof entryPath !== 'string' || !isAbsolute(entryPath) || resolve(entryPath) !== entryPath ||
      resolve(modulePath) !== modulePath) fail(ERROR_CODES.GIT_IDENTITY)
    const entryDirectory = gitAssertNoSymlinkComponents(dirname(entryPath), runtimeAdapters)
    const moduleDirectory = gitAssertNoSymlinkComponents(dirname(modulePath), runtimeAdapters)
    const entryStat = lstatSync(entryPath, { bigint: true })
    const moduleStat = lstatSync(modulePath, { bigint: true })
    const expectedUid = BigInt(process.geteuid())
    if (entryStat.isSymbolicLink() || !entryStat.isFile() || entryStat.nlink !== 1n ||
      entryStat.uid !== expectedUid || moduleStat.isSymbolicLink() || !moduleStat.isFile() ||
      moduleStat.nlink !== 1n || moduleStat.uid !== expectedUid ||
      entryStat.dev !== moduleStat.dev || entryStat.ino !== moduleStat.ino ||
      realpathSync(entryPath) !== modulePath || realpathSync(modulePath) !== modulePath) {
      fail(ERROR_CODES.GIT_IDENTITY)
    }
    const entryClone = gitAssertNoSymlinkComponents(
      runGit(entryDirectory, GIT_QUERIES.top, {}, runtimeAdapters), runtimeAdapters,
    )
    const moduleClone = gitAssertNoSymlinkComponents(
      runGit(moduleDirectory, GIT_QUERIES.top, {}, runtimeAdapters), runtimeAdapters,
    )
    if (entryClone !== moduleClone) fail(ERROR_CODES.GIT_IDENTITY)
    return moduleClone
  } catch (error) {
    if (error instanceof GovernanceError) throw error
    fail(ERROR_CODES.GIT_IDENTITY)
  }
}

export const runtimeAdapters = Object.freeze({
  effectiveUid: () => process.geteuid(),
  filesystemKind: (path) => statfsSync(path).type,
  moduleCloneRoot: currentModuleCloneRoot,
  randomId: () => randomBytes(16).toString('hex'),
  monotonicTime: () => process.hrtime.bigint(),
  now: () => new Date(),
  writeContext: writeAll,
  syncDirectory,
  fault: () => {},
})

function activeAdapters(overrides, errorCode) {
  try {
    return Object.freeze({ ...runtimeAdapters, ...(overrides ?? {}) })
  } catch (error) {
    if (error instanceof GovernanceError && error.code === errorCode) throw error
    fail(errorCode)
  }
}

export { isApprovedLocalFilesystem }
export function validateGovernanceRoot(root, adapters = runtimeAdapters) {
  return storeValidateGovernanceRoot(root, activeAdapters(adapters, ERROR_CODES.GOVERNANCE_STATE))
}
export function ensureLayout(root, adapters = runtimeAdapters) {
  return storeEnsureLayout(root, activeAdapters(adapters, ERROR_CODES.GOVERNANCE_STATE))
}
export function writeExclusiveJson(path, value, adapters = runtimeAdapters) {
  return storeWriteExclusiveJson(path, value, activeAdapters(adapters, ERROR_CODES.WRITE))
}
export function loadGovernanceState(root, adapters = runtimeAdapters) {
  const active = activeAdapters(adapters, ERROR_CODES.LEDGER)
  return reservationLoadReservationState(storeLoadGovernanceRecords(root, active))
}
export function loadReservationState(root, adapters = runtimeAdapters) {
  return loadGovernanceState(root, adapters)
}
export function loadGovernanceRecords(root, adapters = runtimeAdapters) {
  return storeLoadGovernanceRecords(root, activeAdapters(adapters, ERROR_CODES.LEDGER))
}
export function assertSeparatedRoots(root, clone, evidence, archive, cleanupRoots = []) {
  return storeAssertSeparatedRoots(root, clone, evidence, archive, cleanupRoots)
}
export function captureCloneSnapshot(cloneRoot, expectedBranch, expectedOid, adapters = runtimeAdapters) {
  return gitCaptureCloneSnapshot(cloneRoot, expectedBranch, expectedOid,
    activeAdapters(adapters, ERROR_CODES.GIT_IDENTITY))
}
export function assertCloneSnapshotUnchanged(snapshot, adapters = runtimeAdapters) {
  return gitAssertCloneSnapshotUnchanged(snapshot, activeAdapters(adapters, ERROR_CODES.GIT_IDENTITY))
}
export function canonicalFutureTarget(path, conflictCode, adapters = runtimeAdapters) {
  return gitCanonicalFutureTarget(path, conflictCode, activeAdapters(adapters, conflictCode))
}
export function reserveExecution(raw, adapters = runtimeAdapters) {
  return reservationReserveExecution(raw, activeAdapters(adapters, ERROR_CODES.GOVERNANCE_STATE))
}

const RESERVE_CLI = Object.freeze({
  '--state-root': 'stateRoot', '--task-id': 'taskId', '--branch': 'branch',
  '--baseline': 'baselineOid', '--clone': 'cloneRoot', '--evidence': 'evidenceOut',
  '--archive': 'archiveOut',
})
const INVOKE_CLI = Object.freeze({
  '--state-root': 'stateRoot', '--reservation-id': 'reservationId', '--context-fd': 'contextFd',
})

function parseCli(argv, table, parseInput, numericKey) {
  if (!Array.isArray(argv) || argv.length !== Object.keys(table).length * 2) fail(ERROR_CODES.INPUT)
  const raw = {}
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]; const value = argv[index + 1]; const key = table[option]
    if (!key || Object.hasOwn(raw, key) || typeof value !== 'string' || value.startsWith('--')) {
      fail(ERROR_CODES.INPUT)
    }
    raw[key] = value
  }
  if (numericKey) {
    const value = raw[numericKey]; const number = Number(value)
    if (!Number.isInteger(number) || String(number) !== value) fail(ERROR_CODES.INPUT)
    raw[numericKey] = number
  }
  return parseInput(raw)
}

export function parseReserveCli(argv) {
  return parseCli(argv, RESERVE_CLI, parseReserveInput)
}

export function parseInvokeCli(argv) {
  return parseCli(argv, INVOKE_CLI, parseInvokeInput, 'contextFd')
}

export function invokeExecution(raw, adapters = runtimeAdapters) {
  return invocationInvokeExecution(raw, activeAdapters(adapters, ERROR_CODES.GOVERNANCE_STATE))
}

export function runCli(argv, io = {}) {
  const reserve = io.reserve ?? reserveExecution
  const invoke = io.invoke ?? invokeExecution
  const stdout = io.stdout ?? ((value) => process.stdout.write(value))
  const stderr = io.stderr ?? ((value) => process.stderr.write(value))
  try {
    const [command, ...args] = argv
    if (command === 'reserve') {
      const result = reserve(parseReserveCli(args))
      stdout(`D2_PRIME_GOVERNANCE_RESERVED ${result.reservationId}\n`)
    } else if (command === 'invoke') {
      const result = invoke(parseInvokeCli(args))
      stdout(`D2_PRIME_GOVERNANCE_INVOKED ${result.reservationId}\n`)
    } else {
      fail(ERROR_CODES.INPUT)
    }
    return 0
  } catch (error) {
    const code = error instanceof GovernanceError ? error.code : ERROR_CODES.GOVERNANCE_STATE
    stderr(`${code}\n`)
    return 2
  }
}

function isDirectExecution() {
  try {
    return typeof process.argv[1] === 'string' &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch { return false }
}

if (isDirectExecution()) {
  process.exitCode = runCli(process.argv.slice(2))
}
