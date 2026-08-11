import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { resolve } from 'node:path'
import type { ScanInputCandidateSnapshot, ScanInputHealth } from '../types'

const PROTOCOL_MAGIC = Buffer.from('AJPSR002', 'ascii')
const RESPONSE_MAGIC = Buffer.from('AJPSO002', 'ascii')
const OP_INSPECT = 1
const OP_READ = 2
const OP_FINALIZE_DELETE = 3
const OP_FINALIZE_QUARANTINE = 4
const OP_SWEEP_INSPECT = 5
const OP_SWEEP_DELETE = 6
const RESPONSE_HEADER_BYTES = 68
const MAX_SCAN_BYTES = 20 * 1024 * 1024
const MAX_HELPER_STDERR_BYTES = 1024
const HELPER_TIMEOUT_MS = 15_000

export interface WindowsFileIdentity {
  volume: number
  fileId: bigint
}

export interface TrustedWindowsCandidate {
  bytes: Buffer
  rootIdentity: WindowsFileIdentity
  candidateIdentity: WindowsFileIdentity
  size: number
  mtimeMs: number
}

export interface TrustedWindowsUnclaimedCandidate extends Omit<TrustedWindowsCandidate, 'bytes'> {
  filename: string
  unclaimedIdentity: WindowsFileIdentity
}

function packagedHelperPath(): string {
  return resolve(__dirname, '../../../native/secure-scan-reader.exe')
}

function writeIdentity(buffer: Buffer, offset: number, identity?: WindowsFileIdentity): number {
  buffer.writeUInt32LE(identity?.volume ?? 0, offset)
  buffer.writeBigUInt64LE(identity?.fileId ?? 0n, offset + 4)
  return offset + 12
}

function encodeRequest(
  operation: number,
  root: string,
  filename = '',
  expectedSize = 0,
  expectedMtimeMs = 0,
  identities: Partial<
    Pick<
      TrustedWindowsUnclaimedCandidate,
      'rootIdentity' | 'candidateIdentity' | 'unclaimedIdentity'
    >
  > = {}
): Buffer {
  const rootBytes = Buffer.from(root, 'utf8')
  const filenameBytes = Buffer.from(filename, 'utf8')
  const fixed = Buffer.alloc(8 + 4 + 4 + 4 + 8 + 8 + 36)
  PROTOCOL_MAGIC.copy(fixed, 0)
  fixed.writeUInt32LE(operation, 8)
  fixed.writeUInt32LE(rootBytes.length, 12)
  const filenameOffset = 16 + rootBytes.length
  const suffix = Buffer.alloc(4 + filenameBytes.length + 8 + 8 + 36)
  suffix.writeUInt32LE(filenameBytes.length, 0)
  filenameBytes.copy(suffix, 4)
  let cursor = 4 + filenameBytes.length
  suffix.writeBigUInt64LE(BigInt(expectedSize), cursor)
  cursor += 8
  suffix.writeBigInt64LE(BigInt(Math.trunc(expectedMtimeMs)), cursor)
  cursor += 8
  cursor = writeIdentity(suffix, cursor, identities.rootIdentity)
  cursor = writeIdentity(suffix, cursor, identities.candidateIdentity)
  writeIdentity(suffix, cursor, identities.unclaimedIdentity)
  return Buffer.concat([fixed.subarray(0, 16), rootBytes, suffix], filenameOffset + suffix.length)
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
  maximumLength: number
): boolean {
  return (
    result.error === undefined &&
    result.signal === null &&
    result.status === 0 &&
    Buffer.isBuffer(result.stdout) &&
    Buffer.isBuffer(result.stderr) &&
    result.stderr.length === 0 &&
    result.stdout.length === maximumLength
  )
}

function parseIdentity(buffer: Buffer, offset: number): WindowsFileIdentity {
  return { volume: buffer.readUInt32LE(offset), fileId: buffer.readBigUInt64LE(offset + 4) }
}

function invokeV2(
  operation: number,
  request: Buffer,
  maximumPayload = 0
): TrustedWindowsCandidate & { unclaimedIdentity: WindowsFileIdentity } {
  const result = invokeHelper(request, RESPONSE_HEADER_BYTES + maximumPayload)
  const helperFailureMatch = Buffer.isBuffer(result.stderr)
    ? /^SCAN_READER_E(\d{3})(?:_W(\d{8}))?\r?\n$/.exec(result.stderr.toString('ascii'))
    : null
  const helperFailureCode = helperFailureMatch
    ? `E${helperFailureMatch[1]}${helperFailureMatch[2] ? `_W${helperFailureMatch[2]}` : ''}`
    : undefined
  if (
    !isAcceptedTrustedHelperResult(result, RESPONSE_HEADER_BYTES + maximumPayload) ||
    result.stdout.length < RESPONSE_HEADER_BYTES ||
    !result.stdout.subarray(0, 8).equals(RESPONSE_MAGIC) ||
    result.stdout.readUInt32LE(8) !== operation
  ) {
    throw new Error(
      helperFailureCode
        ? `SCAN_INPUT_SECURE_READER_REJECTED_${helperFailureCode}`
        : 'SCAN_INPUT_SECURE_READER_REJECTED'
    )
  }
  const payloadLength = result.stdout.readUInt32LE(64)
  if (
    payloadLength !== result.stdout.length - RESPONSE_HEADER_BYTES ||
    payloadLength > maximumPayload
  ) {
    throw new Error('SCAN_INPUT_SECURE_READER_REJECTED')
  }
  const size = Number(result.stdout.readBigUInt64LE(48))
  const mtimeMs = Number(result.stdout.readBigInt64LE(56))
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(mtimeMs))
    throw new Error('SCAN_INPUT_SECURE_READER_REJECTED')
  return {
    bytes: result.stdout.subarray(RESPONSE_HEADER_BYTES),
    rootIdentity: parseIdentity(result.stdout, 12),
    candidateIdentity: parseIdentity(result.stdout, 24),
    unclaimedIdentity: parseIdentity(result.stdout, 36),
    size,
    mtimeMs,
  }
}

export function inspectTrustedWindowsScanInputFolder(folder: string): ScanInputHealth {
  try {
    invokeV2(OP_INSPECT, encodeRequest(OP_INSPECT, folder))
    return { status: 'ready', reason: 'ready' }
  } catch {
    return { status: 'degraded', reason: 'reparse_point_unverifiable' }
  }
}

export function readTrustedWindowsCandidate(
  scanWatchFolder: string,
  filename: string,
  expected: ScanInputCandidateSnapshot
): TrustedWindowsCandidate {
  const expectedSize = expected.size
  const expectedMtimeMs = Math.trunc(expected.mtimeMs)
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    expectedSize > MAX_SCAN_BYTES ||
    !Number.isSafeInteger(expectedMtimeMs)
  ) {
    throw new Error('SCAN_INPUT_SECURE_READER_REJECTED')
  }
  const result = invokeV2(
    OP_READ,
    encodeRequest(OP_READ, scanWatchFolder, filename, expectedSize, expectedMtimeMs),
    expectedSize
  )
  if (
    result.size !== expectedSize ||
    result.mtimeMs !== expectedMtimeMs ||
    result.bytes.length !== expectedSize
  ) {
    throw new Error('SCAN_INPUT_SECURE_READER_REJECTED')
  }
  return result
}

export function finalizeTrustedWindowsCandidate(
  scanWatchFolder: string,
  filename: string,
  candidate: TrustedWindowsCandidate,
  action: 'delete' | 'quarantine'
): void {
  const operation = action === 'delete' ? OP_FINALIZE_DELETE : OP_FINALIZE_QUARANTINE
  invokeV2(
    operation,
    encodeRequest(
      operation,
      scanWatchFolder,
      filename,
      candidate.size,
      candidate.mtimeMs,
      candidate
    )
  )
}

export function inspectTrustedWindowsUnclaimedCandidate(
  scanWatchFolder: string,
  filename: string
): TrustedWindowsUnclaimedCandidate {
  const result = invokeV2(
    OP_SWEEP_INSPECT,
    encodeRequest(OP_SWEEP_INSPECT, scanWatchFolder, filename)
  )
  const { bytes: _bytes, ...candidate } = result
  return { ...candidate, filename }
}

export function sweepTrustedWindowsUnclaimed(
  scanWatchFolder: string,
  candidate: TrustedWindowsUnclaimedCandidate
): void {
  invokeV2(
    OP_SWEEP_DELETE,
    encodeRequest(
      OP_SWEEP_DELETE,
      scanWatchFolder,
      candidate.filename,
      candidate.size,
      candidate.mtimeMs,
      candidate
    )
  )
}
