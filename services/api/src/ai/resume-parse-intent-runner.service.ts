import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { FilesService } from '../files/files.service'
import { AiPublicQuotaService, type AiPublicQuotaContext } from './ai-public-quota.service'
import { AiService, type ResumeParseIntentBinding } from './ai.service'
import type { ParseResumeInput, ParseResumeOutput } from './interfaces/ai-provider.interface'
import { resumeParseAnonymousAccessToken } from './resume-parse-intent'
import {
  ResumeParseSubmissionService,
  type ResumeParseObservation,
  type ResumeParseSubmissionInput,
} from './resume-parse-submission.service'

/**
 * Orchestrates one keyed resume parse.
 * Owner, proof, and payload checks happen before any file probe. A readable
 * file is required before quota and before the provider. Only the startProvider
 * CAS winner calls the provider. Failures are not refunded and are not retried here.
 * A file that disappears after this check can still be charged; that window is not closed here.
 */
@Injectable()
export class ResumeParseIntentRunner {
  constructor(
    private readonly submission: ResumeParseSubmissionService,
    private readonly quota: AiPublicQuotaService,
    private readonly ai: AiService,
    private readonly files: FilesService,
  ) {}

  async submit(
    dto: ParseResumeInput,
    endUserId: string | null,
    quotaContext: AiPublicQuotaContext,
    intentKey: string,
    proof: string,
  ): Promise<ParseResumeOutput> {
    const request = this.request(dto, endUserId, intentKey, proof)
    await this.submission.create(request)
    const seen = await this.submission.observe(request)
    const early = await this.fromObservation(seen, endUserId, intentKey, proof)
    if (early) return early
    if (seen.outcome !== 'not_ready') {
      throw closed('RESUME_PARSE_OUTCOME_UNKNOWN', '这次解析是否已经完成无法确认，系统不会自动再次调用')
    }
    await this.files.assertContentAccessibleForEndUser(dto.fileId, endUserId)
    const intentId = seen.submission.intentId
    if (seen.submission.phase === 'quota_pending') {
      await this.quota.consumeOnce({
        intentId,
        markerTtlSeconds: markerTtlSeconds(seen.submission.expiresAt),
        context: quotaContext,
      })
      await this.submission.admit(request)
    }
    const binding = this.binding(intentId, endUserId, intentKey, proof)
    const started = await this.submission.startProvider(request)
    if (!started.advanced) {
      const again = await this.submission.observe(request)
      const followed = await this.fromObservation(again, endUserId, intentKey, proof)
      if (followed) return followed
      return this.processing(started.submission.intentId, endUserId, intentKey, proof)
    }
    await this.ai.submitResumeParse(this.whitelist(dto), endUserId, {
      intentId: started.submission.intentId,
      accessToken: binding.accessToken,
    })
    const completed = await this.submission.complete(request)
    if (!completed.advanced) {
      // Member deletion keeps a revoked intent tombstone. Never return the
      // provider's in-memory result after that committed deletion.
      const again = await this.submission.observe(request)
      const followed = await this.fromObservation(again, endUserId, intentKey, proof)
      if (followed) return followed
      throw closed('RESUME_PARSE_OUTCOME_UNKNOWN', '这次解析是否已经完成无法确认，系统不会自动再次调用')
    }
    // Read the committed row for the first response too. A deletion between
    // complete() and this read must not be bypassed by a stale in-memory copy.
    return this.replay(started.submission.intentId, endUserId, intentKey, proof)
  }

  private async fromObservation(
    seen: ResumeParseObservation,
    endUserId: string | null,
    intentKey: string,
    proof: string,
  ): Promise<ParseResumeOutput | null> {
    switch (seen.outcome) {
      case 'replay':
        return this.replay(seen.submission.intentId, endUserId, intentKey, proof)
      case 'processing':
        return this.processing(seen.submission.intentId, endUserId, intentKey, proof)
      case 'revoked':
        throw closed('RESUME_PARSE_INTENT_REVOKED', '这次解析已撤销，不能恢复结果')
      case 'unknown':
        throw closed('RESUME_PARSE_OUTCOME_UNKNOWN', '这次解析是否已经完成无法确认，系统不会自动再次调用')
      case 'unavailable':
        throw new NotFoundException({
          error: {
            code: seen.reason === 'expired' ? 'RESUME_PARSE_RESULT_EXPIRED' : 'RESUME_PARSE_RESULT_MISSING',
            message: '解析结果不可用',
          },
        })
      case 'not_ready':
        return null
    }
  }

  private async replay(
    intentId: string,
    endUserId: string | null,
    intentKey: string,
    proof: string,
  ): Promise<ParseResumeOutput> {
    const binding = this.binding(intentId, endUserId, intentKey, proof)
    const record = await this.ai.getResumeRecord(intentId, {
      endUserId,
      accessToken: binding.accessToken,
    })
    return this.present(record, intentId, binding.accessToken, endUserId)
  }

  /** Anonymous polling needs the same proof-derived token the final response uses. It is not stored. */
  private processing(intentId: string, endUserId: string | null, intentKey: string, proof: string): ParseResumeOutput {
    if (endUserId) return { taskId: intentId, status: 'processing' }
    const accessToken = this.binding(intentId, null, intentKey, proof).accessToken
    return { taskId: intentId, status: 'processing', accessToken: accessToken ?? undefined }
  }

  /** Members store no token. Anonymous callers must carry the deterministic HMAC token. */
  private binding(intentId: string, endUserId: string | null, intentKey: string, proof: string): ResumeParseIntentBinding {
    if (endUserId) return { intentId, accessToken: null }
    const accessToken = resumeParseAnonymousAccessToken(intentKey, proof)
    if (!accessToken) throw closed('RESUME_PARSE_INTENT_MALFORMED', '匿名解析缺少访问令牌')
    return { intentId, accessToken }
  }

  private present(
    result: ParseResumeOutput,
    intentId: string,
    accessToken: string | null,
    endUserId: string | null,
  ): ParseResumeOutput {
    const rest = { ...result }
    delete rest.accessToken
    if (endUserId) return { ...rest, taskId: intentId }
    return { ...rest, taskId: intentId, accessToken: accessToken ?? undefined }
  }

  private request(
    dto: ParseResumeInput,
    endUserId: string | null,
    intentKey: string,
    proof: string,
  ): ResumeParseSubmissionInput {
    return { intentKey, proof, endUserId, fingerprint: this.whitelist(dto) }
  }

  private whitelist(dto: ParseResumeInput): ParseResumeInput {
    return {
      fileId: dto.fileId,
      fileName: dto.fileName,
      fileFormat: dto.fileFormat,
      source: dto.source,
      ...(dto.selectedDimensions ? { selectedDimensions: [...dto.selectedDimensions] } : {}),
      ...(dto.targetContext ? { targetContext: { ...dto.targetContext } } : {}),
    }
  }
}

function markerTtlSeconds(expiresAt: Date, now = new Date()): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000))
}

function closed(code: string, message: string): ConflictException {
  return new ConflictException({ error: { code, message } })
}
