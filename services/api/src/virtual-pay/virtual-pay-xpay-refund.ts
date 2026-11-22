import { randomBytes } from 'node:crypto'
import { ConflictException, type Logger } from '@nestjs/common'
import type { AuditService } from '../audit/audit.service'
import type { PrismaService } from '../prisma/prisma.service'
import { sendVirtualPayOpsAlert, type VirtualPayAlertRedis } from './virtual-pay-alert'
import { calcPaySig } from './virtual-pay-sign'
import { VIRTUAL_PAY_HTTP_TIMEOUT_MS } from './virtual-pay-xpay-client'
import {
  VIRTUAL_PAY_REFUND_REASONS,
  VIRTUAL_PAY_REFUND_WINDOW_MS,
  type VirtualPayRefundReasonCode,
} from './virtual-pay.contract'

export const VIRTUAL_PAY_REFUND_URI = '/xpay/refund_order'
/** 官方错误码：禁止对核销状态的单进行退款（核对表 3.19、5.7）。 */
export const VIRTUAL_PAY_REFUND_ERRCODE_CONSUMED = 268490013
/** 官方错误码：退款进行中，稍后可使用相同参数重试（核对表 3.19、5.7）。 */
export const VIRTUAL_PAY_REFUND_ERRCODE_IN_PROGRESS = 268490014
/** 官方错误码：left_fee 与微信侧实际剩余可退不符（核对表 3.12、3.19）。 */
export const VIRTUAL_PAY_REFUND_ERRCODE_LEFT_FEE_MISMATCH = 268490016

export const VIRTUAL_PAY_REFUND_INITIATED_AUDIT_ACTION = 'virtual_pay.refund_initiated'
export const VIRTUAL_PAY_REFUND_SUCCEEDED_AUDIT_ACTION = 'virtual_pay.refund_succeeded'
export const VIRTUAL_PAY_REFUND_FAILED_AUDIT_ACTION = 'virtual_pay.refund_failed'
export const VIRTUAL_PAY_ADMIN_SYNC_AUDIT_ACTION = 'virtual_pay.admin_sync'

/** 商户退款单号：vpr + 24 位十六进制 = 27 位，满足 [8,32] 且 [A-Za-z0-9_-]（核对表 3.11）。 */
export function newVirtualPayRefundOrderId(): string {
  return `vpr${randomBytes(12).toString('hex')}`
}

/** 首次退款落库时把 refund_reason 枚举码一并冻结在 VirtualPayOrder.refundReason，确保同单重试逐字节一致。 */
export function formatFrozenRefundReason(code: VirtualPayRefundReasonCode, text: string): string {
  const clean = text.replace(/^\[[0-5]\]\s*/, '').trim().slice(0, 190) || '管理员原路退款'
  return `[${code}] ${clean}`
}

export function parseFrozenRefundReasonCode(stored: string | null | undefined): VirtualPayRefundReasonCode | null {
  if (!stored) return null
  const match = stored.match(/^\[([0-5])\]/)
  return match ? (match[1] as VirtualPayRefundReasonCode) : null
}

const RETRYABLE_INDETERMINATE_PREFIXES = [
  'refund_in_progress_268490014',
  'refund_request_timeout_unknown',
] as const

export function extractRetryableRefundPrefix(reason: string | null | undefined): string | null {
  if (!reason) return null
  for (const prefix of RETRYABLE_INDETERMINATE_PREFIXES) {
    if (reason === prefix || reason.startsWith(`${prefix}|`)) return prefix
  }
  return null
}

/** 查单/同步写入诊断时保留既有可重试前缀，绝不因查到旧态 2/3/4 抹掉合法同参重试资格。 */
export function preserveRetryableDiagnostic(
  existingReason: string | null | undefined,
  nextReason: string,
): string {
  const prefix = extractRetryableRefundPrefix(existingReason)
  if (!prefix) return nextReason
  return `${prefix}|${nextReason}`
}

export function mapWechatEnvType(envType: number | undefined): 0 | 1 | null {
  if (envType === 1) return 0
  if (envType === 2) return 1
  return null
}

export function resolveRefundReasonCode(code?: string): VirtualPayRefundReasonCode {
  if (code && (VIRTUAL_PAY_REFUND_REASONS as readonly string[]).includes(code)) {
    return code as VirtualPayRefundReasonCode
  }
  return '0'
}

export interface RefundPreconditionRow {
  status: string
  openId: string | null
  paidAt: Date | null
  refundOrderId: string | null
  wxRefundId: string | null
  lastDiagnosticReason: string | null
  credit: { status: string } | null
}

export function isRetryableIndeterminateOrder(order: Omit<RefundPreconditionRow, 'openId' | 'paidAt'>): boolean {
  return (
    order.status === 'refunding' &&
    Boolean(order.refundOrderId) &&
    !order.wxRefundId &&
    Boolean(extractRetryableRefundPrefix(order.lastDiagnosticReason)) &&
    order.credit?.status === 'refunding'
  )
}

export function assertVirtualPayRefundPreconditions(order: RefundPreconditionRow, now: Date): void {
  if (!isRetryableIndeterminateOrder(order)) {
    if (order.status === 'refunding') {
      throw new ConflictException({
        error: { code: 'VPAY_REFUND_IN_PROGRESS', message: '该订单正在退款处理中，请稍后同步查单确认结果' },
      })
    }
    if (order.status === 'refunded') {
      throw new ConflictException({
        error: { code: 'VPAY_ALREADY_REFUNDED', message: '该订单已退款，请勿重复退款' },
      })
    }
    if (order.status !== 'paid') {
      throw new ConflictException({
        error: { code: 'VPAY_ORDER_NOT_REFUNDABLE', message: '只有已支付订单才允许发起原路退款' },
      })
    }
    if (!order.credit) {
      throw new ConflictException({
        error: { code: 'VPAY_CREDIT_NOT_AVAILABLE', message: '该订单没有可退回的可用权益' },
      })
    }
    if (order.credit.status === 'consumed') {
      throw new ConflictException({
        error: { code: 'VPAY_CREDIT_CONSUMED', message: '该订单对应权益已核销，不允许退款' },
      })
    }
    if (order.credit.status !== 'available') {
      throw new ConflictException({
        error: { code: 'VPAY_CREDIT_NOT_AVAILABLE', message: '该订单对应权益当前不可退' },
      })
    }
  }
  if (!order.openId) {
    throw new ConflictException({
      error: { code: 'VPAY_REFUND_OPENID_MISSING', message: '该会员账号已注销或缺少微信标识，无法发起微信原路退款' },
    })
  }
  if (!order.paidAt || now.getTime() - order.paidAt.getTime() > VIRTUAL_PAY_REFUND_WINDOW_MS) {
    throw new ConflictException({
      error: { code: 'VPAY_REFUND_WINDOW_EXPIRED', message: '支付时间已超过 365 天，无法通过微信虚拟支付发起退款' },
    })
  }
}

export interface WechatRefundOrderInput {
  openId: string
  orderId: string
  refundOrderId: string
  leftFee: number
  refundFee: number
  bizMeta: string
  refundReason: VirtualPayRefundReasonCode
  reqFrom: '1' | '2' | '3'
  env: number
  appKey: string
  token: string
  fetchImpl: typeof fetch
  timeoutMs?: number
}

export interface WechatRefundOrderResponse {
  errcode?: number
  errmsg?: string
  refund_order_id?: string
  refund_wx_order_id?: string
  pay_order_id?: string
  pay_wx_order_id?: string
}

/**
 * 微信虚拟支付官方退款（/xpay/refund_order）。核对表 3.10–3.15、补充规则 10、18。
 * pay_sig 只签实际发出的 body 字节；refund_reason 与 req_from 必须为字符串。
 * 受理成功只代表启动退款任务，最终结果以 xpay_refund_notify 或 query_order 为准。
 */
export async function refundWechatVirtualPayOrder(
  input: WechatRefundOrderInput,
): Promise<WechatRefundOrderResponse> {
  const timeoutMs = input.timeoutMs ?? VIRTUAL_PAY_HTTP_TIMEOUT_MS
  const body = JSON.stringify({
    openid: input.openId,
    order_id: input.orderId,
    refund_order_id: input.refundOrderId,
    left_fee: input.leftFee,
    refund_fee: input.refundFee,
    biz_meta: input.bizMeta,
    refund_reason: String(input.refundReason),
    req_from: String(input.reqFrom),
    env: input.env,
  })
  const paySig = calcPaySig(VIRTUAL_PAY_REFUND_URI, body, input.appKey)
  const url =
    `https://api.weixin.qq.com${VIRTUAL_PAY_REFUND_URI}` +
    `?access_token=${encodeURIComponent(input.token)}` +
    `&pay_sig=${encodeURIComponent(paySig)}`
  const response = await input.fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error('VPAY_REFUND_HTTP')
  return (await response.json()) as WechatRefundOrderResponse
}

export async function settleVirtualPayRefundSucceeded(
  prisma: PrismaService,
  audit: AuditService,
  input: {
    orderId: string
    outTradeNo: string
    refundOrderId?: string | null
    wxRefundId?: string | null
    refundedAt?: Date
    source: 'notify' | 'reconcile' | 'admin_sync' | 'precheck'
  },
): Promise<{ settled: boolean; alreadyRefunded: boolean }> {
  const refundedAt = input.refundedAt ?? new Date()
  return prisma.$transaction(async (tx) => {
    const fresh = await tx.virtualPayOrder.findUnique({
      where: { id: input.orderId },
      include: { credit: true },
    })
    if (!fresh) return { settled: false, alreadyRefunded: false }
    if (fresh.status === 'refunded') {
      if (fresh.credit && fresh.credit.status !== 'refunded') {
        await tx.memberServiceCredit.updateMany({
          where: { sourceOrderId: fresh.id, status: { in: ['available', 'refunding'] } },
          data: { status: 'refunded', refundedAt: fresh.refundedAt ?? refundedAt },
        })
      }
      return { settled: false, alreadyRefunded: true }
    }
    if (fresh.status !== 'paid' && fresh.status !== 'refunding' && fresh.status !== 'refund_failed') {
      return { settled: false, alreadyRefunded: false }
    }
    const updated = await tx.virtualPayOrder.updateMany({
      where: { id: fresh.id, status: fresh.status },
      data: {
        status: 'refunded',
        refundOrderId: fresh.refundOrderId ?? input.refundOrderId ?? null,
        wxRefundId: input.wxRefundId ?? fresh.wxRefundId ?? null,
        refundedAt: fresh.refundedAt ?? refundedAt,
        lastDiagnosticReason: null,
      },
    })
    if (updated.count !== 1) return { settled: false, alreadyRefunded: false }
    await tx.memberServiceCredit.updateMany({
      where: { sourceOrderId: fresh.id, status: { in: ['available', 'refunding'] } },
      data: { status: 'refunded', refundedAt },
    })
    await audit.writeRequired(tx, {
      actorId: null,
      actorRole: 'system',
      action: VIRTUAL_PAY_REFUND_SUCCEEDED_AUDIT_ACTION,
      targetType: 'virtual_pay_order',
      targetId: fresh.outTradeNo,
      payload: {
        source: input.source,
        refundOrderId: fresh.refundOrderId ?? input.refundOrderId ?? null,
        wxRefundId: input.wxRefundId ?? fresh.wxRefundId ?? null,
      },
    })
    return { settled: true, alreadyRefunded: false }
  })
}

export async function markVirtualPayRefundFailed(
  prisma: PrismaService,
  audit: AuditService,
  deps: {
    redis?: VirtualPayAlertRedis | null
    logger?: Pick<Logger, 'warn'>
    fetchImpl?: typeof fetch
  },
  input: {
    orderId: string
    outTradeNo: string
    reason: string
    source: 'initiate' | 'notify' | 'reconcile' | 'admin_sync'
    extra?: Record<string, unknown>
  },
): Promise<boolean> {
  const moved = await prisma.$transaction(async (tx) => {
    const updated = await tx.virtualPayOrder.updateMany({
      where: { id: input.orderId, status: 'refunding' },
      data: { status: 'refund_failed', lastDiagnosticReason: input.reason },
    })
    if (updated.count !== 1) return false
    await audit.writeRequired(tx, {
      actorId: null,
      actorRole: 'system',
      action: VIRTUAL_PAY_REFUND_FAILED_AUDIT_ACTION,
      targetType: 'virtual_pay_order',
      targetId: input.outTradeNo,
      payload: {
        source: input.source,
        reason: input.reason,
        ...(input.extra ?? {}),
      },
    })
    return true
  })
  if (!moved) return false
  await sendVirtualPayOpsAlert({
    redis: deps.redis,
    fetchImpl: deps.fetchImpl,
    outTradeNo: input.outTradeNo,
    episodeToken: input.reason,
    type: 'virtual_pay_refund_failed',
    severity: 'error',
    title: `小程序虚拟支付退款失败 ${input.outTradeNo}（${input.reason}）`,
    logger: deps.logger,
  })
  return true
}
