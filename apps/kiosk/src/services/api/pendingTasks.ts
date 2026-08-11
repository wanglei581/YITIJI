import type { OrderPayStatus, PrintPriceLine } from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'

export type PendingPrintStatus = 'pending' | 'claimed' | 'printing'

export type PendingTaskResume =
  | {
      kind: 'payment'
      orderId: string
      orderNo: string
      amountCents: number
      priceLines: PrintPriceLine[]
      paymentSessionToken: string
    }
  | {
      kind: 'print-progress'
      orderId?: string
      orderNo?: string
      amountCents?: number
      paymentSessionToken?: string
    }

export interface PendingTask {
  id: string
  type: 'print'
  status: PendingPrintStatus
  payStatus: OrderPayStatus | null
  fileName: string | null
  updatedAt: string
  resume: PendingTaskResume
}

interface Envelope<T> {
  success: boolean
  data: T
}

export async function getPendingTasks(token: string | null | undefined): Promise<PendingTask[]> {
  if (API_MODE !== 'http' || !token) return []
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/me/pending-tasks`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
  } catch {
    throw new Error('网络连接失败，请稍后重试')
  }
  if (!response.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${response.status}）`
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      // 保留安全兜底文案。
    }
    if (isMemberSessionInvalidError(response.status, code, true)) notifyMemberSessionExpired(token)
    throw new Error(message)
  }
  const body = (await response.json()) as Envelope<PendingTask[]>
  return Array.isArray(body.data) ? body.data : []
}
