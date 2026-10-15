import { randomBytes } from 'node:crypto'
import type { AiProviderName, AiUsageReport, GenerateResumeOutput, OptimizeResumeOutput, ParseResumeInput, ParseResumeOutput, ResumeGenerateInput } from '../interfaces/ai-provider.interface'
import { MAX_DIAGNOSIS_INPUT_CHARS } from '../resume/llm-resume.service'
import type { ResumeExtractionResult } from '../resume/resume-extraction.types'
import type { LlmConfigService } from '../llm/llm-config.service'
import { quotaHttpCode, runWithAiQuota, type QuotaAbortRequest, type ReleaseReason } from './ai-quota-run'
import type { AiQuotaService } from './ai-quota.service'

/** 诊断 / 优化 / 生成 / 排版共用的一次简历计次。从 AiService 拆出，避免服务文件继续加长。 */
export interface ResumeChargeRunInput<T> {
  endUserId?: string | null
  operationKey: string
  loadStored?: () => Promise<T | null>
  failureOf?: (value: T) => ReleaseReason | null
  persistFailure?: boolean
  req?: QuotaAbortRequest
  work: () => Promise<T>
  saveResult: (value: T) => Promise<string>
}

export interface ResumeChargeRequester {
  endUserId: string | null
  accessToken: string | null
}

export interface ResumeParseIntentRef {
  intentId: string
  accessToken: string | null
}

export interface ResumeChargeLog {
  parse(value: ParseResumeOutput, startedAt: number, endUserId: string | null, errorCode?: string): void
  parseThrown(startedAt: number, endUserId: string | null, error: unknown): void
  optimize(value: OptimizeResumeOutput, taskId: string, startedAt: number): void
  optimizeThrown(taskId: string, startedAt: number, error: unknown): void
  layout(taskId: string, startedAt: number, report: AiUsageReport): void
  layoutThrown(taskId: string, startedAt: number, report: AiUsageReport, error: unknown): void
  generate(value: GenerateResumeOutput, startedAt: number): void
  generateThrown(startedAt: number, error: unknown): void
}

export interface ResumeChargeBindings {
  providerName: AiProviderName
  charging(endUserId: string | null | undefined): boolean
  extract(fileId: string, endUserId: string | null): Promise<ResumeExtractionResult>
  parseResume(input: ParseResumeInput): Promise<ParseResumeOutput>
  optimizeResume(
    taskId: string,
    report: NonNullable<ParseResumeOutput['report']>,
    extractedText: string | undefined,
    targetContext: ParseResumeOutput['targetContext'],
  ): Promise<OptimizeResumeOutput>
  generateResume?: (input: ResumeGenerateInput) => Promise<GenerateResumeOutput>
  llmConfig: LlmConfigService
  load<T>(taskId: string, kind: string, requester: ResumeChargeRequester): Promise<T | null>
  persistResult(
    taskId: string,
    kind: 'parse' | 'optimize' | 'generate',
    status: string,
    payload: ParseResumeOutput | OptimizeResumeOutput | GenerateResumeOutput,
    endUserId: string | null,
    accessTokenHash: string | null,
  ): Promise<void>
  persistPayload(
    taskId: string,
    kind: string,
    status: string,
    payload: unknown,
    endUserId: string | null,
    accessTokenHash: string | null,
  ): Promise<void>
  parseOwner(taskId: string): Promise<{ endUserId: string | null; accessTokenHash: string | null } | null>
  hashAccessToken(token: string): string
  sourceUnavailable(): never
  log: ResumeChargeLog
}

type RunWithAiQuota = typeof runWithAiQuota

/**
 * 没有账本或没有登录身份时不预占，仍执行并保存。
 * 有身份时交给 runWithAiQuota：先存结果再结算，确认的服务端失败才归还。
 */
export function executeResumeCharge<T>(
  quota: AiQuotaService | undefined,
  input: ResumeChargeRunInput<T>,
  gate: { bucket: 'ai_resume'; runWithAiQuota: RunWithAiQuota },
): Promise<T> {
  if (!quota || !input.endUserId) {
    return input.work().then(async (value) => {
      await input.saveResult(value)
      return value
    })
  }
  return gate.runWithAiQuota({
    quota,
    bucket: gate.bucket,
    operationKey: input.operationKey,
    endUserId: input.endUserId,
    req: input.req,
    loadStored: input.loadStored,
    failureOf: input.failureOf,
    persistFailure: input.persistFailure,
  }, input.work, input.saveResult)
}

export function rethrowQuota(error: unknown): void {
  if (quotaHttpCode(error)?.startsWith('AI_QUOTA_')) throw error
}

async function storeResumeParse(
  bindings: ResumeChargeBindings,
  value: ParseResumeOutput,
  endUserId: string | null | undefined,
  intent: ResumeParseIntentRef | undefined,
  startedAt: number,
  extractionErrorCode?: string,
): Promise<string> {
  const isAnonymous = !endUserId
  const bound = Boolean(intent?.intentId && value.taskId === intent.intentId)
  const accessToken = bound
    ? (isAnonymous && intent?.accessToken ? intent.accessToken : undefined)
    : (isAnonymous ? randomBytes(24).toString('hex') : undefined)
  const accessTokenHash = accessToken ? bindings.hashAccessToken(accessToken) : null
  await bindings.persistResult(value.taskId, 'parse', value.status, value, endUserId ?? null, accessTokenHash)
  bindings.log.parse(value, startedAt, endUserId ?? null, extractionErrorCode)
  if (accessToken) value.accessToken = accessToken
  return value.taskId
}

/** 简历诊断。文本提取失败不预占；会员且已有同一任务结果时直接返回。 */
export async function chargeSubmitResumeParse(
  bindings: ResumeChargeBindings,
  input: ParseResumeInput,
  endUserId: string | null | undefined,
  intent: ResumeParseIntentRef | undefined,
  req: QuotaAbortRequest | undefined,
  runCharge: <T>(input: ResumeChargeRunInput<T>) => Promise<T>,
): Promise<ParseResumeOutput> {
  const t0 = Date.now()
  const boundTaskId = intent ? intent.intentId : undefined
  const charging = bindings.charging(endUserId)
  const serverTaskId = boundTaskId ?? (charging ? randomBytes(16).toString('hex') : undefined)
  const requester = { endUserId: endUserId ?? null, accessToken: null }
  try {
    if (charging && serverTaskId) {
      const stored = await bindings.load<ParseResumeOutput>(serverTaskId, 'parse', requester)
      if (stored) return stored
    }
    let useExtraction = false
    let extractedText: string | undefined
    let extractedPageCount: number | undefined
    let extractionWarnings: string[] | undefined
    let extractionTextSource: string | undefined
    let extractionConfidence: 'high' | 'medium' | 'low' | undefined
    if (bindings.providerName === 'llm') {
      const extraction = await bindings.extract(input.fileId, endUserId ?? null)
      if (!extraction.ok) {
        const failed: ParseResumeOutput = {
          taskId: boundTaskId ?? `extract-fail-${randomBytes(8).toString('hex')}`,
          status: 'failed',
          failReason: extraction.errorMessage ?? '简历文件无法提取文本，请重新上传',
          providerName: bindings.providerName,
          fileId: input.fileId,
        }
        await storeResumeParse(bindings, failed, endUserId, intent, t0, extraction.errorCode)
        return failed
      }
      useExtraction = true
      extractedText = extraction.text
      extractedPageCount = extraction.pageCount
      extractionWarnings = extraction.warnings
      extractionTextSource = extraction.textSource
      extractionConfidence = extraction.confidence === 'high' || extraction.confidence === 'medium' || extraction.confidence === 'low'
        ? extraction.confidence
        : 'low'
    }
    const operationKey = `${serverTaskId ?? `parse-${randomBytes(8).toString('hex')}`}:parse`
    return await runCharge({
      endUserId,
      operationKey,
      loadStored: serverTaskId
        ? () => bindings.load<ParseResumeOutput>(serverTaskId, 'parse', requester)
        : undefined,
      failureOf: (value) => (value.status === 'failed' ? 'provider_error' : null),
      persistFailure: true,
      req,
      work: async () => {
        let result = useExtraction
          ? await bindings.parseResume({ ...input, extractedText, extractedPageCount })
          : await bindings.parseResume(input)
        if (bindings.providerName === 'llm') {
          const warnings = [...(extractionWarnings ?? [])]
          if ((extractedText ?? '').length > MAX_DIAGNOSIS_INPUT_CHARS) {
            warnings.push(`简历内容较长，本次诊断仅分析前 ${MAX_DIAGNOSIS_INPUT_CHARS} 字符，其余部分未纳入评估`)
          }
          const isOcrSource = extractionTextSource === 'image_ocr' || extractionTextSource === 'pdf_ocr'
          if (isOcrSource || warnings.length > 0) {
            result = {
              ...result,
              extractionNotice: {
                textSource: extractionTextSource ?? 'unknown',
                confidence: extractionConfidence ?? 'low',
                warnings,
              },
            }
          }
        }
        if (serverTaskId) result = { ...result, taskId: serverTaskId }
        return {
          ...result,
          providerName: bindings.providerName,
          fileId: input.fileId,
          ...(input.targetContext ? { targetContext: input.targetContext } : {}),
        }
      },
      saveResult: (value) => storeResumeParse(bindings, value, endUserId, intent, t0),
    })
  } catch (err) {
    rethrowQuota(err)
    bindings.log.parseThrown(t0, endUserId ?? null, err)
    throw err
  }
}
