import { randomBytes } from 'node:crypto'
import type { AiQuotaBucket } from '../../member-benefits/member-benefits.types'
import type { AiQuotaService } from './ai-quota.service'
import { exhausted, type ReleaseReason } from './ai-quota.policy'

export type { ReleaseReason }

/**
 * 客户端断开。结算不看它：成功照常落记录并结算（断开不归还，结果可按记录号重开），
 * 服务端确认的失败照常归还。保留这个字段是为了调用方签名不变，以后要按断开做别的处理时有入口。
 */
export interface QuotaAbortRequest {
  aborted?: boolean
}

export interface RunWithAiQuotaInput<T> {
  quota: AiQuotaService
  bucket: AiQuotaBucket
  operationKey: string
  endUserId?: string | null
  terminalId?: string | null
  req?: QuotaAbortRequest
  /** 金额封顶。必须在预占之前调用；拒绝时不写预占。 */
  budget?: { assertWithinBudget(): Promise<unknown> }
  /** 已结算结果。命中则直接返回，不再调模型。 */
  loadStored?: () => Promise<T | null>
  /** 调用返回了失败状态、但没有抛错。返回归还原因则不结算。 */
  failureOf?: (value: T) => ReleaseReason | null
  /** 失败状态仍写入本人记录（解析失败报告），然后归还，不结算。 */
  persistFailure?: boolean
}

const PROVIDER_CODES = new Set([
  'AI_PROVIDER_ERROR',
  'AI_PROVIDER_UNREACHABLE',
  'AI_PROVIDER_REQUEST_ERROR',
  'AI_EMPTY_RESPONSE',
  'AI_RATE_LIMITED',
  'AI_BUSY',
  'AI_PROVIDER_NOT_CONFIGURED',
  'AI_PROVIDER_INVALID',
  // 模型账户不可用、密钥失效、模型名停用。码的定义在 llm-failure.ts，这里只认字符串。
  'AI_PROVIDER_ACCOUNT_UNAVAILABLE',
  'AI_PROVIDER_MODEL_INVALID',
  'AI_ENDPOINT_NOT_ALLOWED',
  'AI_OPTIMIZE_INVALID_OUTPUT',
  'AI_LAYOUT_ADJUST_INVALID_OUTPUT',
])

/**
 * 简历类入口共用的一次预占。顺序：金额封顶 → 读已存结果 → 预占 → 干活 → 先保存再结算。
 * 只在确认的服务端失败时归还。对不上的错误不归还。不写用户原文。
 */
export async function runWithAiQuota<T>(
  input: RunWithAiQuotaInput<T>,
  work: () => Promise<T>,
  saveResult: (value: T) => Promise<string>,
): Promise<T> {
  if (input.budget) await input.budget.assertWithinBudget()
  if (input.loadStored) {
    const stored = await input.loadStored()
    if (stored !== null && stored !== undefined) return stored
  }
  const receipt = await reserveAttempt(input)
  // 客户端断开只影响成功路径：结果照常落进本人记录并结算，之后按记录号重开，不再扣
  // （断开不归还，否则断连就能刷）。失败时没有结果可重开，服务端确认的失败不论是否
  // 断开都归还——「失败不扣、成功只扣一次」（总指挥 10/4）。中止本身（AbortError 之类）
  // 不是服务端确认的失败，quotaReleaseReason 认不出，照旧不归还。
  try {
    const value = await work()
    const reason = input.failureOf?.(value) ?? null
    if (reason) {
      if (input.persistFailure) await saveResult(value)
      await input.quota.release(receipt.reservationId, reason)
      return value
    }
    const resultRef = await saveResult(value)
    await input.quota.commit(receipt.reservationId, { resultRef })
    return value
  } catch (error) {
    const reason = quotaReleaseReason(error)
    if (reason) await input.quota.release(receipt.reservationId, reason)
    throw error
  }
}

/** 语音转写不预占。会员当日简历次数已经用完时才拒绝。 */
export async function assertMemberResumeRemaining(
  quota: AiQuotaService | undefined,
  endUserId: string | null | undefined,
): Promise<void> {
  if (!quota || !endUserId) return
  const rows = await quota.remaining({ endUserId })
  const resume = rows.find((row) => row.bucket === 'ai_resume')
  if (!resume || resume.dailyRemaining + resume.extraRemaining <= 0) exhausted('ai_resume', new Date())
}

/** 小青语音转写不预占。会员当日小青次数已经用完时才拒绝。 */
export async function assertMemberAssistantRemaining(
  quota: AiQuotaService | undefined,
  endUserId: string | null | undefined,
): Promise<void> {
  if (!quota || !endUserId) return
  const rows = await quota.remaining({ endUserId })
  const assistant = rows.find((row) => row.bucket === 'ai_assistant')
  if (!assistant || assistant.dailyRemaining + assistant.extraRemaining <= 0) exhausted('ai_assistant', new Date())
}

export function quotaSequence(): string {
  return randomBytes(8).toString('hex')
}

/** 归还只认这三类。认不出的返回 null，调用方不得归还。 */
export function quotaReleaseReason(error: unknown): ReleaseReason | null {
  const code = quotaHttpCode(error)
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : ''
  if (code === 'AI_CONTENT_BLOCKED' || name === 'AiContentBlockedError') return 'content_rejected'
  if (name === 'LlmTimeoutError' || message.startsWith('LLM_TIMEOUT_') || isTimeoutCode(code) || isTimeoutCode(message)) {
    return 'server_timeout'
  }
  if (PROVIDER_CODES.has(code ?? '') || name === 'LlmBusyError' || message.startsWith('LLM_BUSY_')) return 'provider_error'
  if (code?.startsWith('CONTRACT_PROVIDER_') && !code.includes('INPUT')) return 'provider_error'
  return null
}

export function quotaHttpCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const direct = (error as { code?: unknown }).code
  if (typeof direct === 'string' && direct.startsWith('AI_')) return direct
  const getResponse = (error as { getResponse?: () => unknown }).getResponse
  if (typeof getResponse !== 'function') return typeof direct === 'string' ? direct : null
  let body: unknown
  try {
    body = getResponse.call(error)
  } catch {
    return typeof direct === 'string' ? direct : null
  }
  if (typeof body === 'string') return body
  if (!body || typeof body !== 'object') return null
  const nested = (body as { error?: { code?: unknown } }).error
  if (nested && typeof nested === 'object' && typeof nested.code === 'string') return nested.code
  const message = (body as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

async function reserveAttempt<T>(input: RunWithAiQuotaInput<T>) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await input.quota.reserve({
        bucket: input.bucket,
        operationKey: attemptKey(input.operationKey, attempt),
        endUserId: input.endUserId,
        terminalId: input.terminalId,
      })
    } catch (error) {
      if (quotaHttpCode(error) !== 'AI_QUOTA_OPERATION_SETTLED') throw error
      lastError = error
    }
  }
  throw lastError
}

function attemptKey(base: string, attempt: number): string {
  if (attempt === 1) return base
  const suffix = `:${attempt}`
  return `${base.slice(0, 200 - suffix.length)}${suffix}`
}

function isTimeoutCode(value: string | null): boolean {
  if (!value) return false
  return value.includes('TIMEOUT') || value === 'AI_ADVISOR_TIMEOUT'
}
