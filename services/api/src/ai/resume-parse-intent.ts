import { createHash, createHmac } from 'node:crypto'

/**
 * Durable identity for POST /resume/parse.
 *
 * The client creates a 32-byte intent key and a 32-byte proof before the first
 * POST and sends them only as headers. This module never reads a URL or query.
 * The server stores the domain-separated intent id, proof hash, and payload
 * fingerprint — not the key, the proof, or the resume.
 *
 * The anonymous result token is HMAC(proof, context || intent id). Replay
 * recomputes it from the same headers. The database stores only sha256(token).
 */

export const RESUME_PARSE_INTENT_HEADER = 'x-resume-parse-intent'
export const RESUME_PARSE_PROOF_HEADER = 'x-resume-parse-proof'

/** 32 random bytes, unpadded base64url (43 characters, no `=`). */
export const RESUME_PARSE_INTENT_TOKEN_BYTES = 32
const TOKEN_CHARS = 43

const INTENT_ID_DOMAIN = 'resume-parse-intent-id:v1'
const PROOF_HASH_DOMAIN = 'resume-parse-intent-proof:v1'
const PAYLOAD_DOMAIN = 'resume-parse-payload:v1'
const ACCESS_TOKEN_CONTEXT = 'resume-parse-anon-access:v1'

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export class ResumeParseIntentError extends Error {
  readonly code = 'RESUME_PARSE_INTENT_MALFORMED' as const

  constructor() {
    super('RESUME_PARSE_INTENT_MALFORMED')
    this.name = 'ResumeParseIntentError'
  }
}

export type ResumeParseIntentHeaderResult =
  | { status: 'absent' }
  | { status: 'rejected'; reason: 'partial' | 'malformed' }
  | { status: 'present'; intentKey: string; proof: string }

export interface ResumeParseTargetContext {
  industry?: string | null
  targetJob?: string | null
  experience?: string | null
  scene?: string | null
  major?: string | null
  degree?: string | null
  skipped?: boolean | null
}

/** Whitelist only. Resume text, file bytes, and unknown fields are not inputs. */
export interface ResumeParseFingerprintInput {
  fileId: string
  fileName: string
  fileFormat: string
  source: string
  selectedDimensions?: readonly string[] | null
  targetContext?: ResumeParseTargetContext | null
}

type HeaderBag = Readonly<Record<string, string | readonly string[] | undefined>>

export function readResumeParseIntentHeaders(headers: HeaderBag): ResumeParseIntentHeaderResult {
  const intent = readHeader(headers, RESUME_PARSE_INTENT_HEADER)
  const proof = readHeader(headers, RESUME_PARSE_PROOF_HEADER)
  if (intent.kind === 'missing' && proof.kind === 'missing') return { status: 'absent' }
  if (intent.kind === 'missing' || proof.kind === 'missing') {
    return { status: 'rejected', reason: 'partial' }
  }
  if (intent.kind !== 'value' || proof.kind !== 'value') {
    return { status: 'rejected', reason: 'malformed' }
  }
  if (!decodeCanonicalToken(intent.value) || !decodeCanonicalToken(proof.value)) {
    return { status: 'rejected', reason: 'malformed' }
  }
  if (intent.value === proof.value) return { status: 'rejected', reason: 'malformed' }
  return { status: 'present', intentKey: intent.value, proof: proof.value }
}

/** Domain-separated sha256 of the intent key. Hex, 64 chars. */
export function resumeParseIntentId(intentKey: string): string {
  return domainHash(INTENT_ID_DOMAIN, requireToken(intentKey))
}

/** Domain-separated sha256 of the proof. Hex, 64 chars. Not comparable to the intent id. */
export function resumeParseProofHash(proof: string): string {
  return domainHash(PROOF_HASH_DOMAIN, requireToken(proof))
}

/** sha256 of the canonical whitelist. Same logical DTO always hashes the same. */
export function resumeParsePayloadFingerprint(input: ResumeParseFingerprintInput): string {
  const canonical = JSON.stringify({
    fileId: requiredString(input.fileId),
    fileName: requiredString(input.fileName),
    fileFormat: requiredString(input.fileFormat),
    source: requiredString(input.source),
    selectedDimensions: canonicalDimensions(input.selectedDimensions),
    targetContext: canonicalTarget(input.targetContext),
  })
  return createHash('sha256').update(PAYLOAD_DOMAIN, 'utf8').update('\0').update(canonical, 'utf8').digest('hex')
}

/**
 * Anonymous access token for this intent. HMAC-SHA256, proof bytes as the key,
 * message = access context || NUL || intent id. Unpadded base64url. No server secret.
 */
export function resumeParseAnonymousAccessToken(intentKey: string, proof: string): string {
  const proofBytes = requireToken(proof)
  const intentId = resumeParseIntentId(intentKey)
  return createHmac('sha256', proofBytes)
    .update(ACCESS_TOKEN_CONTEXT, 'utf8')
    .update('\0')
    .update(intentId, 'utf8')
    .digest('base64url')
}

/** Plain sha256 hex of the token string, matching AiResumeResult.accessTokenHash. */
export function resumeParseAccessTokenHash(token: string): string {
  if (typeof token !== 'string' || token.length === 0) throw new ResumeParseIntentError()
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

type ReadHeader = { kind: 'missing' } | { kind: 'invalid' } | { kind: 'value'; value: string }

function readHeader(headers: HeaderBag, name: string): ReadHeader {
  let seen = false
  let value: string | readonly string[] | undefined
  for (const [key, candidate] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue
    if (seen) return { kind: 'invalid' }
    seen = true
    value = candidate
  }
  if (!seen || value === undefined) return { kind: 'missing' }
  if (Array.isArray(value)) {
    if (value.length !== 1 || typeof value[0] !== 'string') return { kind: 'invalid' }
    return classifyToken(value[0])
  }
  if (typeof value !== 'string') return { kind: 'invalid' }
  return classifyToken(value)
}

function classifyToken(value: string): ReadHeader {
  if (value.length === 0 || value.length > TOKEN_CHARS || value !== value.trim()) return { kind: 'invalid' }
  return { kind: 'value', value }
}

function decodeCanonicalToken(value: string): Buffer | null {
  if (value.length !== TOKEN_CHARS || !TOKEN_RE.test(value)) return null
  const raw = Buffer.from(value, 'base64url')
  if (raw.length !== RESUME_PARSE_INTENT_TOKEN_BYTES) return null
  if (raw.toString('base64url') !== value) return null
  return raw
}

function requireToken(value: string): Buffer {
  const raw = decodeCanonicalToken(value)
  if (!raw) throw new ResumeParseIntentError()
  return raw
}

function domainHash(domain: string, raw: Buffer): string {
  return createHash('sha256').update(domain, 'utf8').update('\0').update(raw).digest('hex')
}

function requiredString(value: string): string {
  if (typeof value !== 'string') throw new ResumeParseIntentError()
  return value
}

function canonicalDimensions(value: readonly string[] | null | undefined): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new ResumeParseIntentError()
  const copy: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw new ResumeParseIntentError()
    copy.push(item)
  }
  copy.sort()
  return copy
}

function canonicalTarget(value: ResumeParseTargetContext | null | undefined): {
  industry: string | null
  targetJob: string | null
  experience: string | null
  scene: string | null
  major: string | null
  degree: string | null
  skipped: boolean | null
} | null {
  if (value == null) return null
  if (typeof value !== 'object') throw new ResumeParseIntentError()
  return {
    industry: optionalString(value.industry),
    targetJob: optionalString(value.targetJob),
    experience: optionalString(value.experience),
    scene: optionalString(value.scene),
    major: optionalString(value.major),
    degree: optionalString(value.degree),
    skipped: optionalBoolean(value.skipped),
  }
}

function optionalString(value: string | null | undefined): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new ResumeParseIntentError()
  return value
}

function optionalBoolean(value: boolean | null | undefined): boolean | null {
  if (value == null) return null
  if (typeof value !== 'boolean') throw new ResumeParseIntentError()
  return value
}
