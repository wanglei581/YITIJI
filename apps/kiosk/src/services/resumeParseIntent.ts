// 首次 POST /resume/parse 之前的本机意图。
// 只使用 Web Crypto getRandomValues 生成两段 32 字节；没有 Math.random 或其他弱随机后备。
// 写进 sessionStorage 后必须回读一致，否则调用方不得发请求。

import type {
  ResumeParseRequest,
  ResumeScoringDimensionKey,
  ResumeTargetContext,
} from '@ai-job-print/shared'

export const RESUME_PARSE_INTENT_STORAGE_KEY = 'ai-job-print:kiosk-resume-parse-intent'
export const RESUME_PARSE_INTENT_HEADER = 'x-resume-parse-intent'
export const RESUME_PARSE_PROOF_HEADER = 'x-resume-parse-proof'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export interface ResumeParseIntentHeaders {
  intent: string
  proof: string
}

export interface CanonicalResumeTarget {
  industry: string | null
  targetJob: string | null
  experience: string | null
  scene: string | null
  major: string | null
  degree: string | null
  skipped: boolean | null
}

export interface CanonicalResumeParsePayload {
  fileId: string
  fileName: string
  fileFormat: string
  source: 'upload' | 'scan' | 'manual'
  selectedDimensions: ResumeScoringDimensionKey[]
  targetContext: CanonicalResumeTarget | null
}

interface IntentRecord {
  ownerId: string | null
  payload: CanonicalResumeParsePayload
  intent: string
  proof: string
  ts: number
}

export class ResumeParseIntentClientError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'ResumeParseIntentClientError'
    this.code = code
  }
}

let tail: Promise<unknown> = Promise.resolve()
let epoch = 0

function fail(code: string): ResumeParseIntentClientError {
  return new ResumeParseIntentClientError(code)
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work, work)
  tail = run.then(() => undefined, () => undefined)
  return run
}

function encodeBase64Url(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  while (i + 3 <= bytes.length) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63]
    i += 3
  }
  if (i < bytes.length) {
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const n = (bytes[i] << 16) | (b1 << 8)
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63]
    if (i + 1 < bytes.length) out += B64[(n >>> 6) & 63]
  }
  return out
}

function decodeCanonical(text: string): Uint8Array | null {
  if (text.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(text)) return null
  const out = new Uint8Array(32)
  let o = 0
  for (let i = 0; i < 40; i += 4) {
    const a = B64.indexOf(text[i])
    const b = B64.indexOf(text[i + 1])
    const c = B64.indexOf(text[i + 2])
    const d = B64.indexOf(text[i + 3])
    if (a < 0 || b < 0 || c < 0 || d < 0) return null
    const n = (a << 18) | (b << 12) | (c << 6) | d
    out[o] = (n >>> 16) & 255
    out[o + 1] = (n >>> 8) & 255
    out[o + 2] = n & 255
    o += 3
  }
  const a = B64.indexOf(text[40])
  const b = B64.indexOf(text[41])
  const c = B64.indexOf(text[42])
  if (a < 0 || b < 0 || c < 0) return null
  const n = (a << 18) | (b << 12) | (c << 6)
  out[30] = (n >>> 16) & 255
  out[31] = (n >>> 8) & 255
  return encodeBase64Url(out) === text ? out : null
}

export function isResumeParseIntentHeader(value: unknown): value is string {
  return typeof value === 'string' && decodeCanonical(value) !== null
}

function randomToken(): string {
  const webCrypto = globalThis.crypto
  if (!webCrypto || typeof webCrypto.getRandomValues !== 'function') throw fail('RANDOM_UNAVAILABLE')
  const bytes = new Uint8Array(32)
  webCrypto.getRandomValues(bytes)
  if (bytes.length !== 32) throw fail('RANDOM_FAILED')
  const encoded = encodeBase64Url(bytes)
  if (!decodeCanonical(encoded)) throw fail('RANDOM_FAILED')
  return encoded
}

function normalizeOwner(ownerId: string | null): string | null {
  if (ownerId === null) return null
  if (typeof ownerId === 'string' && ownerId.length > 0) return ownerId
  throw fail('OWNER_INVALID')
}

function textOrNull(value: unknown): string | null | undefined {
  if (value == null) return null
  return typeof value === 'string' ? value : undefined
}

export function canonicalResumeParsePayload(input: {
  fileId?: unknown
  fileName?: unknown
  fileFormat?: unknown
  source?: unknown
  selectedDimensions?: unknown
  targetContext?: unknown
}): CanonicalResumeParsePayload | null {
  if (typeof input.fileId !== 'string' || !input.fileId) return null
  if (typeof input.fileName !== 'string' || !input.fileName) return null
  if (typeof input.fileFormat !== 'string' || !input.fileFormat) return null
  if (input.source !== 'upload' && input.source !== 'scan' && input.source !== 'manual') return null
  const dims: ResumeScoringDimensionKey[] = []
  if (input.selectedDimensions != null) {
    if (!Array.isArray(input.selectedDimensions)) return null
    for (const item of input.selectedDimensions) {
      if (typeof item !== 'string') return null
      dims.push(item as ResumeScoringDimensionKey)
    }
    dims.sort()
  }
  let targetContext: CanonicalResumeTarget | null = null
  if (input.targetContext != null) {
    if (typeof input.targetContext !== 'object' || Array.isArray(input.targetContext)) return null
    const raw = input.targetContext as ResumeTargetContext
    const industry = textOrNull(raw.industry)
    const targetJob = textOrNull(raw.targetJob)
    const experience = textOrNull(raw.experience)
    const scene = textOrNull(raw.scene)
    const major = textOrNull(raw.major)
    const degree = textOrNull(raw.degree)
    if (
      industry === undefined
      || targetJob === undefined
      || experience === undefined
      || scene === undefined
      || major === undefined
      || degree === undefined
    ) return null
    if (raw.skipped != null && typeof raw.skipped !== 'boolean') return null
    targetContext = {
      industry,
      targetJob,
      experience,
      scene,
      major,
      degree,
      skipped: typeof raw.skipped === 'boolean' ? raw.skipped : null,
    }
  }
  return {
    fileId: input.fileId,
    fileName: input.fileName,
    fileFormat: input.fileFormat,
    source: input.source,
    selectedDimensions: dims,
    targetContext,
  }
}

function definedStrings(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 线上 DTO 不需要显式 null。指纹由服务端按同一白名单再规范化。 */
export function resumeParseWireBody(payload: CanonicalResumeParsePayload): ResumeParseRequest {
  const target = payload.targetContext
  return {
    fileId: payload.fileId,
    fileName: payload.fileName,
    fileFormat: payload.fileFormat,
    source: payload.source,
    ...(payload.selectedDimensions.length > 0 ? { selectedDimensions: payload.selectedDimensions } : {}),
    ...(target
      ? {
          targetContext: {
            ...(definedStrings(target.industry) ? { industry: target.industry ?? undefined } : {}),
            ...(definedStrings(target.targetJob) ? { targetJob: target.targetJob ?? undefined } : {}),
            ...(definedStrings(target.experience) ? { experience: target.experience as ResumeTargetContext['experience'] } : {}),
            ...(definedStrings(target.scene) ? { scene: target.scene as ResumeTargetContext['scene'] } : {}),
            ...(definedStrings(target.major) ? { major: target.major ?? undefined } : {}),
            ...(definedStrings(target.degree) ? { degree: target.degree ?? undefined } : {}),
            ...(typeof target.skipped === 'boolean' ? { skipped: target.skipped } : {}),
          },
        }
      : {}),
  }
}

function samePayload(a: CanonicalResumeParsePayload, b: CanonicalResumeParsePayload): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function validRecord(row: unknown): row is IntentRecord {
  if (!row || typeof row !== 'object') return false
  const record = row as IntentRecord
  const payload = canonicalResumeParsePayload(record.payload)
  return (record.ownerId === null || (typeof record.ownerId === 'string' && record.ownerId.length > 0))
    && !!payload
    && samePayload(payload, record.payload)
    && isResumeParseIntentHeader(record.intent)
    && isResumeParseIntentHeader(record.proof)
    && record.intent !== record.proof
    && typeof record.ts === 'number'
    && Number.isFinite(record.ts)
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null
    return window.sessionStorage
  } catch {
    return null
  }
}

function loadRecords(): { records: IntentRecord[] } | { error: 'STORAGE_UNREADABLE' | 'STORAGE_CORRUPT' } {
  const store = storage()
  if (!store) return { error: 'STORAGE_UNREADABLE' }
  let raw: string | null
  try {
    raw = store.getItem(RESUME_PARSE_INTENT_STORAGE_KEY)
  } catch {
    return { error: 'STORAGE_UNREADABLE' }
  }
  if (raw == null) return { records: [] }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length > 1 || parsed.some((row) => !validRecord(row))) {
      return { error: 'STORAGE_CORRUPT' }
    }
    return { records: parsed }
  } catch {
    return { error: 'STORAGE_CORRUPT' }
  }
}

function writeRecords(records: IntentRecord[], seenEpoch: number): boolean {
  if (seenEpoch !== epoch) return false
  const store = storage()
  if (!store) return false
  const encoded = JSON.stringify(records)
  try {
    store.setItem(RESUME_PARSE_INTENT_STORAGE_KEY, encoded)
    if (seenEpoch !== epoch) {
      store.removeItem(RESUME_PARSE_INTENT_STORAGE_KEY)
      return false
    }
    const back = store.getItem(RESUME_PARSE_INTENT_STORAGE_KEY)
    return back === encoded && seenEpoch === epoch
  } catch {
    return false
  }
}

function headersOf(row: IntentRecord): { payload: CanonicalResumeParsePayload; headers: ResumeParseIntentHeaders } {
  return { payload: row.payload, headers: { intent: row.intent, proof: row.proof } }
}

async function prepareBody(
  payload: CanonicalResumeParsePayload,
  ownerIdentity: string | null,
  reuseOnly: boolean,
): Promise<{ payload: CanonicalResumeParsePayload; headers: ResumeParseIntentHeaders }> {
  const seenEpoch = epoch
  const loaded = loadRecords()
  if ('error' in loaded) throw fail(loaded.error)
  const ownerId = normalizeOwner(ownerIdentity)
  const canonical = canonicalResumeParsePayload(payload)
  if (!canonical || !samePayload(canonical, payload)) throw fail('PAYLOAD_INVALID')
  const match = loaded.records.find((row) => row.ownerId === ownerId && samePayload(row.payload, canonical))
  if (match) return headersOf(match)
  if (loaded.records.length > 0) throw fail('INTENT_CONFLICT')
  if (reuseOnly) throw fail('INTENT_ABSENT')
  const intent = randomToken()
  const proof = randomToken()
  if (intent === proof) throw fail('RANDOM_NOT_INDEPENDENT')
  if (seenEpoch !== epoch) throw fail('STORAGE_CLEARED')
  const row: IntentRecord = { ownerId, payload: canonical, intent, proof, ts: Date.now() }
  if (!writeRecords(loaded.records.concat([row]), seenEpoch)) throw fail('STORAGE_WRITE_FAILED')
  return headersOf(row)
}

export function prepareResumeParseIntent(
  payload: CanonicalResumeParsePayload,
  ownerIdentity: string | null,
  options?: { reuseOnly?: boolean },
): Promise<{ payload: CanonicalResumeParsePayload; headers: ResumeParseIntentHeaders }> {
  return enqueue(() => prepareBody(payload, ownerIdentity, options?.reuseOnly === true))
}

function removeMatching(intent: string, ownerIdentity: string | null, seenEpoch: number): { ok: true } | { ok: false; code: string } {
  const loaded = loadRecords()
  if ('error' in loaded) return { ok: false, code: loaded.error }
  let ownerId: string | null
  try {
    ownerId = normalizeOwner(ownerIdentity)
  } catch (err) {
    return { ok: false, code: err instanceof ResumeParseIntentClientError ? err.code : 'OWNER_INVALID' }
  }
  if (!isResumeParseIntentHeader(intent)) return { ok: false, code: 'INTENT_NOT_FOUND' }
  const next = loaded.records.filter((row) => !(row.intent === intent && row.ownerId === ownerId))
  if (next.length === loaded.records.length) return { ok: false, code: 'INTENT_NOT_FOUND' }
  if (!writeRecords(next, seenEpoch)) return { ok: false, code: 'STORAGE_WRITE_FAILED' }
  return { ok: true }
}

export function clearResumeParseIntent(
  intent: string,
  ownerIdentity: string | null,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const seenEpoch = epoch
  return enqueue(() => Promise.resolve(removeMatching(intent, ownerIdentity, seenEpoch)))
}

function releaseBody(ownerIdentity: string | null, seenEpoch: number): { ok: true } | { ok: false; code: string } {
  const loaded = loadRecords()
  if ('error' in loaded) return { ok: false, code: loaded.error }
  let ownerId: string | null
  try {
    ownerId = normalizeOwner(ownerIdentity)
  } catch (err) {
    return { ok: false, code: err instanceof ResumeParseIntentClientError ? err.code : 'OWNER_INVALID' }
  }
  if (loaded.records.length === 0) return { ok: true }
  if (loaded.records[0].ownerId !== ownerId) return { ok: false, code: 'OWNER_MISMATCH' }
  if (!writeRecords([], seenEpoch)) return { ok: false, code: 'STORAGE_WRITE_FAILED' }
  return { ok: true }
}

/** 用户已二次确认要新的一次。只释放同一 owner 的那一条；读不清或别人的记录保持不动。 */
export function releaseResumeParseIntent(
  ownerIdentity: string | null,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const seenEpoch = epoch
  return enqueue(() => Promise.resolve(releaseBody(ownerIdentity, seenEpoch)))
}

export function clearAllResumeParseIntents(): void {
  epoch += 1
  const store = storage()
  if (!store) return
  try {
    store.removeItem(RESUME_PARSE_INTENT_STORAGE_KEY)
  } catch {
    // 删不掉就留着。hasKioskSensitiveSession 仍能看见这个键。
  }
}

export function resumeParseIntentHold(expected: {
  intent: string
  ownerId: string | null
  payload: CanonicalResumeParsePayload | null
}): 'held' | 'absent' | 'unreadable' {
  if (!expected.payload || !isResumeParseIntentHeader(expected.intent)) return 'absent'
  const loaded = loadRecords()
  if ('error' in loaded) return 'unreadable'
  if (loaded.records.length !== 1) return 'absent'
  const row = loaded.records[0]
  if (row.intent !== expected.intent || row.ownerId !== expected.ownerId) return 'absent'
  if (!samePayload(row.payload, expected.payload)) return 'absent'
  return 'held'
}

export function resumeParseIntentBlockMessage(code: string): string {
  switch (code) {
    case 'INTENT_CONFLICT':
    case 'OWNER_MISMATCH':
      return '本机还有另一次尚未完成的解析，不能换材料或换账号继续。没有开始新的一次。'
    case 'INTENT_ABSENT':
      return '本机没有这次解析的原标识，没有另起一次解析。'
    case 'STORAGE_WRITE_FAILED':
    case 'STORAGE_CLEARED':
      return '本机没能安全保存这次解析标识，为避免重复调用已中止。'
    case 'STORAGE_CORRUPT':
    case 'STORAGE_UNREADABLE':
      return '本机解析标识无法核对，没有提交。'
    case 'RANDOM_UNAVAILABLE':
    case 'RANDOM_FAILED':
    case 'RANDOM_NOT_INDEPENDENT':
      return '本机无法生成安全的解析标识，没有提交。'
    default:
      return '本机没能安全准备这次解析，为避免重复调用已中止。'
  }
}

export function resumeParseIntentCode(err: unknown): string {
  return err instanceof ResumeParseIntentClientError ? err.code : ''
}
