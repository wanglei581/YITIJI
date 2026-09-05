import type { AiPublicQuotaService, AiPublicQuotaTicket } from './ai-public-quota.service'
import { llmRequestAbort } from './llm/llm-http'

interface AbortableReq {
  on?: (event: string, listener: () => void) => void
  aborted?: boolean
}

/** 客户端断开连接时 abort，供 LLM fetch 取消上游调用。 */
export function httpAbortSignal(req: AbortableReq): AbortSignal {
  const ac = new AbortController()
  req.on?.('aborted', () => {
    if (!ac.signal.aborted) ac.abort()
  })
  return ac.signal
}

/**
 * 公网 AI 配额：下游失败或客户端 abort 都回滚。
 * abort 后若工作已成功完成，仍然回滚——调用方没拿到响应，不该扣当日额度。
 */
export async function runWithPublicQuota<T>(
  quota: AiPublicQuotaService,
  ticket: AiPublicQuotaTicket | null,
  req: AbortableReq,
  work: () => Promise<T>,
): Promise<T> {
  const signal = httpAbortSignal(req)
  let rolled = false
  const rollback = async () => {
    if (rolled) return
    rolled = true
    await quota.rollback(ticket)
  }
  try {
    const result = await llmRequestAbort.run(signal, work)
    if (signal.aborted || req.aborted) await rollback()
    return result
  } catch (error) {
    await rollback()
    throw error
  }
}
