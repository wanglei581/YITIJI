/**
 * 取件页列出本人在这台机器上还没取的手机单，并按订单领取。
 * 时间线要会员令牌，也要终端身份，否则 claimableHere 一直是 false。
 * claim-here 的响应不包信封，和 claim-pickup 同形。
 */
import type { PrintJobParams } from '@ai-job-print/shared'
import { ApiHttpError } from './httpAdapter'
import { API_BASE_URL, API_MODE } from './client'
import { getTerminalId } from './screensaver'
import { terminalProtectedFetch } from '../terminalAuth'

export interface ClaimHereReceipt {
  released: boolean
  taskId?: string
  orderId: string
  orderNo: string
  terminalId: string | null
  taskStatus: string
  printTaskStatus: string
  amountCents?: number
  priceLines?: unknown[]
  billablePages?: number | null
  params?: Partial<PrintJobParams>
  fileName?: string | null
  paymentSessionToken: string
  mayHavePrinted?: boolean
  partialOutput?: boolean
}

/** 服务端先分页再由本页按本机过滤，所以最多再跟 3 页，避免待取单落在第 50 条之后就消失。 */
export const PICKUP_HERE_PAGE_SIZE = 50
export const PICKUP_HERE_MAX_PAGES = 4

export interface PickupHereListItem {
  kind: string
  orderId: string | null
  title: string | null
  itemCount: number
  claimableHere: boolean
  createdAt: string | null
  billablePages: number | null
}

function asSource(value: unknown): PickupHereListItem | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  return {
    kind: typeof row.kind === 'string' ? row.kind : '',
    orderId: typeof row.orderId === 'string' ? row.orderId : null,
    title: typeof row.title === 'string' ? row.title : null,
    itemCount: typeof row.itemCount === 'number' ? row.itemCount : 0,
    claimableHere: row.claimableHere === true,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
    billablePages: typeof row.billablePages === 'number' ? row.billablePages : null,
  }
}

/**
 * 待到机和待付款。调用方再丢掉不是本机、不是手机单的行。
 * 跟着 nextCursor 往后读，最多 4 页。任何一页失败都整次抛错，不把读到一半的列表说成全部。
 */
export async function listPickupHereOrders(token: string, staleSignal?: AbortSignal): Promise<PickupHereListItem[]> {
  if (API_MODE !== 'http' || !token) return []
  const terminalId = getTerminalId()
  if (!terminalId) throw new Error('终端身份尚未就绪')
  const items: PickupHereListItem[] = []
  let cursor: string | null = null
  for (let page = 0; page < PICKUP_HERE_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ status: 'waiting', pageSize: String(PICKUP_HERE_PAGE_SIZE) })
    if (cursor) params.set('cursor', cursor)
    const res = await terminalProtectedFetch(
      `${API_BASE_URL}/me/print-orders/timeline?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'x-terminal-id': terminalId,
        },
        staleSignal,
      },
    )
    if (staleSignal?.aborted) throw new DOMException('请求已取消', 'AbortError')
    let body: { success?: unknown; data?: { items?: unknown; nextCursor?: unknown } }
    try {
      body = (await res.json()) as typeof body
    } catch {
      throw new Error('订单列表读不到')
    }
    if (!res.ok || body?.success !== true || !Array.isArray(body.data?.items)) {
      throw new Error('订单列表读不到')
    }
    for (const raw of body.data.items) {
      const item = asSource(raw)
      if (item) items.push(item)
    }
    const next = body.data.nextCursor
    if (typeof next !== 'string' || next.length === 0) return items
    cursor = next
  }
  return items
}

/** 会员在这台机器上领取自己的单。文件名留给调用方打码后再上屏。 */
export async function claimHereOrder(orderId: string, token: string, staleSignal?: AbortSignal): Promise<ClaimHereReceipt> {
  const terminalId = getTerminalId()
  if (!terminalId) throw new Error('终端身份尚未就绪，请稍后重试')
  const res = await terminalProtectedFetch(
    `${API_BASE_URL}/me/print-orders/${encodeURIComponent(orderId)}/claim-here`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'x-terminal-id': terminalId,
      },
      staleSignal,
    },
  )
  let body: {
    taskId?: string
    orderId?: string
    orderNo?: string
    terminalId?: string | null
    released?: boolean
    paymentSessionToken?: string
    taskStatus?: string
    printTaskStatus?: string
    mayHavePrinted?: unknown
    partialOutput?: unknown
    fileName?: string | null
    amountCents?: number
    priceLines?: unknown[]
    billablePages?: number | null
    params?: Partial<PrintJobParams>
    error?: { code?: string; message?: string; details?: unknown }
    message?: string | string[]
  }
  try {
    body = (await res.json()) as typeof body
  } catch {
    throw new ApiHttpError('CLAIM_RECEIPT_UNKNOWN', '本次领取结果尚未确认', res.status)
  }
  if (!body || typeof body !== 'object') {
    throw new ApiHttpError('CLAIM_RECEIPT_UNKNOWN', '本次领取结果尚未确认', res.status)
  }
  if (!res.ok) {
    const errCode = body.error?.code ?? 'CLAIM_FAILED'
    const errMsg =
      body.error?.message ??
      (Array.isArray(body.message) ? body.message.join('; ') : (body.message as string | undefined)) ??
      '这次没能领到'
    throw Object.assign(new ApiHttpError(errCode, errMsg, res.status), { details: body.error?.details })
  }
  if (
    typeof body.released !== 'boolean' ||
    !body.orderId || !body.orderNo ||
    (body.released && !body.taskId) ||
    (!body.released && !body.paymentSessionToken)
  ) {
    throw new ApiHttpError('CLAIM_RECEIPT_UNKNOWN', '本次领取结果尚未确认', res.status)
  }
  return {
    ...(body as ClaimHereReceipt),
    mayHavePrinted: body.mayHavePrinted === true,
    partialOutput: body.partialOutput === true,
  }
}
