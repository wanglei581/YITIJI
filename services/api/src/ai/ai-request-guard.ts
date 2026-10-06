import type { AiPublicQuotaService, AiPublicQuotaTicket } from './ai-public-quota.service'
import { llmRequestAbort } from './llm/llm-http'

interface AbortableRes {
  on?: (event: string, listener: () => void) => void
  writableFinished?: boolean
}

interface AbortableReq {
  on?: (event: string, listener: () => void) => void
  aborted?: boolean
  /** Express 把 ServerResponse 挂在 IncomingMessage.res 上。 */
  res?: AbortableRes
}

/** 客户端断开连接时 abort，供 LLM fetch 取消上游调用。 */
export function httpAbortSignal(req: AbortableReq): AbortSignal {
  const ac = new AbortController()
  const abort = () => {
    if (!ac.signal.aborted) ac.abort()
  }
  // 请求体未收完时客户端断开：Node 仍发 IncomingMessage 'aborted'。
  req.on?.('aborted', abort)
  // 请求体已收完后再断开：Node 17+ 不再发 'aborted'，改看响应 close。
  const res = req.res
  res?.on?.('close', () => {
    if (!res.writableFinished) abort()
  })
  return ac.signal
}

/**
 * 公网 AI 配额：下游抛错、客户端 abort，或结果标明是我们这边的失败时，退回本次次数。
 * abort 后若工作已成功完成，仍然回滚——调用方没拿到响应，不该扣当日额度。
 * `refundResult` 用于 200-failed：模型账户、模型名、上游 5xx、连不上要退；
 * 用户文件本身的问题不退。与 abort 共用 rolled，不会减两次。
 */
export async function runWithPublicQuota<T>(
  quota: AiPublicQuotaService,
  ticket: AiPublicQuotaTicket | null,
  req: AbortableReq,
  work: () => Promise<T>,
  refundResult?: (result: T) => boolean,
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
    if (signal.aborted || req.aborted || refundResult?.(result)) await rollback()
    return result
  } catch (error) {
    await rollback()
    throw error
  }
}
