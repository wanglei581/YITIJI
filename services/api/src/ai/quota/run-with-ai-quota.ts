import { AiContentBlockedError } from '../llm/llm-guard'
import type { ReleaseReason } from './ai-quota.policy'
import type { QuotaReceipt, ReserveQuotaParams } from './ai-quota.service'

interface AiQuotaPort {
  reserve(params: ReserveQuotaParams): Promise<QuotaReceipt>
  release(reservationId: string, reason: ReleaseReason): Promise<void>
}

/**
 * 会员次数预占。内容拦截按 content_rejected 归还，其它失败按 provider_error 归还。
 * 现网控制器还没接到 reserve，这条先给归还口径和门禁用，不另做一套扣次。
 */
export async function runWithAiQuota<T>(
  quota: AiQuotaPort,
  params: ReserveQuotaParams,
  work: (receipt: QuotaReceipt) => Promise<T>,
): Promise<T> {
  const receipt = await quota.reserve(params)
  try {
    return await work(receipt)
  } catch (error) {
    const reason: ReleaseReason = error instanceof AiContentBlockedError ? 'content_rejected' : 'provider_error'
    await quota.release(receipt.reservationId, reason)
    throw error
  }
}
