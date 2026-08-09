import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { resolve } from 'node:path'
import type { ScanInputCandidateSnapshot, ScanInputHealth } from '../types'

const PROTOCOL_MAGIC = Buffer.from('AJPSR001', 'ascii')
const OP_INSPECT = 1
const OP_READ = 2
const MAX_SCAN_BYTES = 20 * 1024 * 1024
const MAX_HELPER_STDERR_BYTES = 1024
const HELPER_TIMEOUT_MS = 15_000
const READY_RESPONSE = Buffer.from('READY\n', 'ascii')

function packagedHelperPath(): string {
  return resolve(__dirname, '../../../native/secure-scan-reader.exe')
}

function encodeRequest(
  operation: number,
  root: string,
  filename: string,
  expectedSize: number,
  expectedMtimeMs: number,
): Buffer {
  const rootBytes = Buffer.from(root, 'utf8')
  const filenameBytes = Buffer.from(filename, 'utf8')
  const header = Buffer.alloc(PROTOCOL_MAGIC.length + 4 + 4)
  PROTOCOL_MAGIC.copy(header, 0)
  header.writeUInt32LE(operation, PROTOCOL_MAGIC.length)
  header.writeUInt32LE(rootBytes.length, PROTOCOL_MAGIC.length + 4)
  const filenameLength = Buffer.alloc(4)
  filenameLength.writeUInt32LE(filenameBytes.length)
  const metadata = Buffer.alloc(16)
  metadata.writeBigUInt64LE(BigInt(expectedSize), 0)
  metadata.writeBigInt64LE(BigInt(expectedMtimeMs), 8)
  return Buffer.concat([header, rootBytes, filenameLength, filenameBytes, metadata])
}

function invokeHelper(input: Buffer, maxOutputBytes: number): SpawnSyncReturns<Buffer> {
  return spawnSync(packagedHelperPath(), [], {
    input,
    encoding: null,
    timeout: HELPER_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: Math.max(maxOutputBytes, MAX_HELPER_STDERR_BYTES),
  })
}

export function isAcceptedTrustedHelperResult(
  result: SpawnSyncReturns<Buffer>,
  expectedLength: number,
  expectedContent?: Buffer,
): boolean {
  return result.error === undefined
    && result.signal === null
    && result.status === 0
    && Buffer.isBuffer(result.stdout)
    && Buffer.isBuffer(result.stderr)
    && result.stderr.length === 0
    && result.stdout.length === expectedLength
    && (expectedContent === undefined || result.stdout.equals(expectedContent))
}

export function inspectTrustedWindowsScanInputFolder(folder: string): ScanInputHealth {
  const result = invokeHelper(encodeRequest(OP_INSPECT, folder, '', 0, 0), READY_RESPONSE.length)
  if (!isAcceptedTrustedHelperResult(result, READY_RESPONSE.length, READY_RESPONSE)) {
    return { status: 'degraded', reason: 'reparse_point_unverifiable' }
  }
  return { status: 'ready', reason: 'ready' }
}

export function readTrustedWindowsCandidate(
  scanWatchFolder: string,
  filename: string,
  expected: ScanInputCandidateSnapshot,
): Buffer {
  const expectedSize = expected.size
  const expectedMtimeMs = Math.trunc(expected.mtimeMs)
  if (!Number.isSafeInteger(expectedSize)
      || expectedSize <= 0
      || expectedSize > MAX_SCAN_BYTES
      || !Number.isSafeInteger(expectedMtimeMs)) {
    throw new Error('SCAN_INPUT_SECURE_READER_REJECTED')
  }
  const result = invokeHelper(
    encodeRequest(OP_READ, scanWatchFolder, filename, expectedSize, expectedMtimeMs),
    expectedSize,
  )
  if (!isAcceptedTrustedHelperResult(result, expectedSize)) {
    throw new Error('SCAN_INPUT_SECURE_READER_REJECTED')
  }
  return result.stdout
}
