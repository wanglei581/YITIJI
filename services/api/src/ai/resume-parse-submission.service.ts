import { timingSafeEqual } from 'node:crypto'
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  resumeParseAccessTokenHash,
  resumeParseAnonymousAccessToken,
  resumeParseIntentId,
  resumeParsePayloadFingerprint,
  resumeParseProofHash,
  type ResumeParseFingerprintInput,
} from './resume-parse-intent'

/** DB phase only. Redis quota is not charged, rolled back, or refunded here. */
export const RESUME_PARSE_INTENT_KIND = 'parse_intent'
/** Floor matching the planned Redis quota marker. Result TTL can only raise this. */
export const RESUME_PARSE_INTENT_TTL_MS = 48 * 60 * 60 * 1000
export const RESUME_PARSE_PROVIDER_LEASE_MS = 120_000

const PARSE_KIND = 'parse'
const PHASES = ['quota_pending', 'admitted', 'provider_started', 'completed', 'unknown', 'revoked'] as const
const TERMINAL = new Set<ResumeParseIntentPhase>(['completed', 'unknown', 'revoked'])

export type ResumeParseIntentPhase = (typeof PHASES)[number]

export interface ResumeParseSubmissionInput {
  intentKey: string
  proof: string
  endUserId: string | null
  fingerprint: ResumeParseFingerprintInput
  now?: Date
}

export interface ResumeParseSubmission {
  intentId: string
  phase: ResumeParseIntentPhase
  endUserId: string | null
  payloadFingerprint: string
  expiresAt: Date
  updatedAt: Date
}

export interface ResumeParseAdvance {
  advanced: boolean
  submission: ResumeParseSubmission
}

export type ResumeParseObservation =
  | { outcome: 'replay'; submission: ResumeParseSubmission; result: Record<string, unknown> }
  | { outcome: 'processing'; submission: ResumeParseSubmission }
  | { outcome: 'unknown'; submission: ResumeParseSubmission }
  | { outcome: 'revoked'; submission: ResumeParseSubmission }
  | { outcome: 'not_ready'; submission: ResumeParseSubmission }
  | { outcome: 'unavailable'; reason: 'expired' | 'missing'; submission: ResumeParseSubmission }

interface IntentMeta {
  payloadFingerprint: string
  proofHash: string
}

interface IntentRecord {
  taskId: string
  status: string
  payloadJson: string
  endUserId: string | null
  expiresAt: Date | null
  updatedAt: Date
}

interface Bound {
  intentId: string
  proofHash: string
  payloadFingerprint: string
  now: Date
}

interface LoadedIntent {
  row: IntentRecord
  meta: IntentMeta
  phase: ResumeParseIntentPhase
  bound: Bound
}

type ParseLookup =
  | { state: 'live'; result: Record<string, unknown>; expiresAt: Date }
  | { state: 'expired' }
  | { state: 'missing' }

/** Intent must outlive both the 48h marker and the configured parse-result TTL. */
export function resumeParseIntentTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const hours = Number(env['AI_RESUME_RESULT_TTL_HOURS'])
  const resultMs = Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  return Math.max(RESUME_PARSE_INTENT_TTL_MS, resultMs)
}

@Injectable()
export class ResumeParseSubmissionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Insert quota_pending, or return the existing row after a unique race. Never resets phase. */
  async create(input: ResumeParseSubmissionInput): Promise<ResumeParseSubmission> {
    const bound = this.bind(input)
    try {
      const row = await this.prisma.aiResumeResult.create({
        data: {
          taskId: bound.intentId,
          kind: RESUME_PARSE_INTENT_KIND,
          status: 'quota_pending',
          payloadJson: encodeMeta({
            payloadFingerprint: bound.payloadFingerprint,
            proofHash: bound.proofHash,
          }),
          provider: 'intent',
          endUserId: input.endUserId,
          expiresAt: new Date(bound.now.getTime() + resumeParseIntentTtlMs()),
        },
      })
      return this.snapshot(row)
    } catch (error) {
      if (!isUniqueConflict(error)) throw error
      return this.find(input)
    }
  }

  async find(input: ResumeParseSubmissionInput): Promise<ResumeParseSubmission> {
    return this.snapshot((await this.authorize(input)).row)
  }

  admit(input: ResumeParseSubmissionInput): Promise<ResumeParseAdvance> {
    return this.transition(input, 'quota_pending', 'admitted')
  }

  /** One CAS winner may call the provider. Terminal phases and a lost CAS do not. */
  startProvider(input: ResumeParseSubmissionInput): Promise<ResumeParseAdvance> {
    return this.transition(input, 'admitted', 'provider_started')
  }

  /** Records the phase only. The parse row is already stored at taskId = intentId. */
  complete(input: ResumeParseSubmissionInput): Promise<ResumeParseAdvance> {
    return this.transition(input, 'provider_started', 'completed')
  }

  /**
   * After owner, proof, and fingerprint match, a live parse row at taskId = intentId
   * is returned even if this process died before complete(), or the lease already
   * became unknown. Healing the phase does not call the provider or refund quota.
   * A revoked intent never replays, promotes, or extends its expiry.
   */
  async observe(input: ResumeParseSubmissionInput): Promise<ResumeParseObservation> {
    let loaded = await this.loadAuthorized(input)
    if (loaded.phase === 'revoked') {
      return { outcome: 'revoked', submission: this.snapshot(loaded.row) }
    }
    const replay = await this.finishReplay(input, loaded)
    if (replay) return replay
    if (this.intentExpired(loaded.row, loaded.bound.now)) maskedNotFound()
    if (loaded.phase === 'provider_started' && this.leaseEnded(loaded.row, loaded.bound.now)) {
      await this.prisma.aiResumeResult.updateMany({
        where: {
          taskId: loaded.bound.intentId,
          kind: RESUME_PARSE_INTENT_KIND,
          status: 'provider_started',
          updatedAt: { lte: new Date(loaded.bound.now.getTime() - RESUME_PARSE_PROVIDER_LEASE_MS) },
        },
        data: { status: 'unknown' },
      })
      loaded = await this.loadAuthorized(input)
      const landed = await this.finishReplay(input, loaded)
      if (landed) return landed
      return { outcome: 'unknown', submission: this.snapshot(loaded.row) }
    }
    const submission = this.snapshot(loaded.row)
    if (submission.phase === 'provider_started') return { outcome: 'processing', submission }
    if (submission.phase === 'unknown') return { outcome: 'unknown', submission }
    if (submission.phase === 'revoked') return { outcome: 'revoked', submission }
    if (submission.phase !== 'completed') return { outcome: 'not_ready', submission }
    const parse = await this.readParse(input, loaded)
    if (parse.state === 'expired') return { outcome: 'unavailable', reason: 'expired', submission }
    return { outcome: 'unavailable', reason: 'missing', submission }
  }

  private async finishReplay(input: ResumeParseSubmissionInput, loaded: LoadedIntent): Promise<ResumeParseObservation | null> {
    if (loaded.phase === 'revoked') return null
    const parse = await this.readParse(input, loaded)
    if (parse.state !== 'live') return null
    await this.keepResult(loaded, parse.expiresAt)
    const after = await this.loadAuthorized(input)
    return { outcome: 'replay', submission: this.snapshot(after.row), result: parse.result }
  }

  /** Keeps a committed parse readable. Never moves the row back to provider_started. */
  private async keepResult(loaded: LoadedIntent, parseExpiresAt: Date): Promise<void> {
    if (loaded.phase === 'revoked') return
    const current = loaded.row.expiresAt?.getTime() ?? 0
    const expiresAt = new Date(Math.max(current, parseExpiresAt.getTime()))
    const promote = loaded.phase !== 'completed'
    await this.prisma.aiResumeResult.updateMany({
      where: { taskId: loaded.row.taskId, kind: RESUME_PARSE_INTENT_KIND, status: loaded.phase },
      data: {
        ...(promote ? { status: 'completed' } : {}),
        expiresAt,
      },
    })
  }

  private async transition(
    input: ResumeParseSubmissionInput,
    from: ResumeParseIntentPhase,
    to: ResumeParseIntentPhase,
  ): Promise<ResumeParseAdvance> {
    const loaded = await this.authorize(input)
    if (loaded.row.status !== from || TERMINAL.has(loaded.phase)) {
      return { advanced: false, submission: this.snapshot(loaded.row) }
    }
    const updated = await this.prisma.aiResumeResult.updateMany({
      where: { taskId: loaded.bound.intentId, kind: RESUME_PARSE_INTENT_KIND, status: from },
      data: { status: to },
    })
    const after = await this.authorize(input)
    return {
      advanced: updated.count === 1 && after.row.status === to,
      submission: this.snapshot(after.row),
    }
  }

  private async authorize(input: ResumeParseSubmissionInput): Promise<LoadedIntent> {
    const loaded = await this.loadAuthorized(input)
    if (this.intentExpired(loaded.row, loaded.bound.now)) maskedNotFound()
    return loaded
  }

  private async loadAuthorized(input: ResumeParseSubmissionInput): Promise<LoadedIntent> {
    const bound = this.bind(input)
    const row = await this.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId: bound.intentId, kind: RESUME_PARSE_INTENT_KIND } },
    })
    if (!row) maskedNotFound()
    const meta = parseMeta(row.payloadJson)
    const phase = asPhase(row.status)
    if (!meta || !phase) maskedNotFound()
    const ownerOk = (row.endUserId ?? null) === input.endUserId
    const proofOk = sameHash(meta.proofHash, bound.proofHash)
    if (!ownerOk || !proofOk) maskedNotFound()
    if (meta.payloadFingerprint !== bound.payloadFingerprint) payloadConflict()
    return {
      bound,
      phase,
      meta,
      row: {
        taskId: row.taskId,
        status: row.status,
        payloadJson: row.payloadJson,
        endUserId: row.endUserId ?? null,
        expiresAt: row.expiresAt,
        updatedAt: row.updatedAt,
      },
    }
  }

  private async readParse(input: ResumeParseSubmissionInput, loaded: LoadedIntent): Promise<ParseLookup> {
    const parse = await this.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId: loaded.row.taskId, kind: PARSE_KIND } },
    })
    if (!parse || (parse.endUserId ?? null) !== loaded.row.endUserId) return { state: 'missing' }
    if (loaded.row.endUserId === null) {
      const expected = resumeParseAccessTokenHash(resumeParseAnonymousAccessToken(input.intentKey, input.proof))
      if (!parse.accessTokenHash || !sameHash(parse.accessTokenHash, expected)) return { state: 'missing' }
    }
    if (!parse.expiresAt || parse.expiresAt.getTime() <= loaded.bound.now.getTime()) return { state: 'expired' }
    try {
      const result = JSON.parse(parse.payloadJson) as unknown
      if (!result || typeof result !== 'object' || Array.isArray(result)) return { state: 'missing' }
      return { state: 'live', result: result as Record<string, unknown>, expiresAt: parse.expiresAt }
    } catch {
      return { state: 'missing' }
    }
  }

  private intentExpired(row: IntentRecord, now: Date): boolean {
    return !row.expiresAt || row.expiresAt.getTime() <= now.getTime()
  }

  private leaseEnded(row: IntentRecord, now: Date): boolean {
    return row.updatedAt.getTime() + RESUME_PARSE_PROVIDER_LEASE_MS <= now.getTime()
  }

  private snapshot(row: IntentRecord): ResumeParseSubmission {
    const meta = parseMeta(row.payloadJson)
    const phase = asPhase(row.status)
    if (!meta || !phase || !row.expiresAt) maskedNotFound()
    return {
      intentId: row.taskId,
      phase,
      endUserId: row.endUserId,
      payloadFingerprint: meta.payloadFingerprint,
      expiresAt: row.expiresAt,
      updatedAt: row.updatedAt,
    }
  }

  private bind(input: ResumeParseSubmissionInput): Bound {
    return {
      intentId: resumeParseIntentId(input.intentKey),
      proofHash: resumeParseProofHash(input.proof),
      payloadFingerprint: resumeParsePayloadFingerprint(input.fingerprint),
      now: input.now ?? new Date(),
    }
  }
}

function encodeMeta(meta: IntentMeta): string {
  return JSON.stringify({
    payloadFingerprint: meta.payloadFingerprint,
    proofHash: meta.proofHash,
  })
}

function parseMeta(payloadJson: string): IntentMeta | null {
  try {
    const value = JSON.parse(payloadJson) as Record<string, unknown>
    if (typeof value.payloadFingerprint !== 'string' || typeof value.proofHash !== 'string') return null
    return { payloadFingerprint: value.payloadFingerprint, proofHash: value.proofHash }
  } catch {
    return null
  }
}

function asPhase(status: string): ResumeParseIntentPhase | null {
  return (PHASES as readonly string[]).includes(status) ? (status as ResumeParseIntentPhase) : null
}

function sameHash(stored: string, presented: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(stored) || !/^[0-9a-f]{64}$/.test(presented)) return false
  return timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(presented, 'hex'))
}

function maskedNotFound(): never {
  throw new NotFoundException({
    error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请重新提交简历' },
  })
}

function payloadConflict(): never {
  throw new ConflictException({
    error: {
      code: 'RESUME_PARSE_INTENT_PAYLOAD_MISMATCH',
      message: '同一解析标识不能改用另一份材料，请更换标识后重试',
    },
  })
}

function isUniqueConflict(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    if ((current as { code?: unknown }).code === 'P2002') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
