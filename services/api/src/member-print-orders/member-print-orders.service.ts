import { Injectable } from '@nestjs/common'
import type {
  MemberPendingPrintStatus,
  MemberPendingTaskItem,
  MemberPrintOrderItem,
} from './member-print-orders.types'
import { PrismaService } from '../prisma/prisma.service'
import { buildMemberPage, memberPageArgs, type MemberPageQuery } from '../common/utils/member-page'
import { assessInvoiceEligibility } from '../invoices/invoice-eligibility'
import {
  pickLatestInvoiceRequestByOrder,
  toInvoiceOpenStatus,
  type MemberInvoiceStatus,
} from '../invoices/invoice-request-summary'
import { isPaidUnfulfilledRefundRequired } from '../payment/pending-refund-signal'
import {
  arrivalViewsForOrders,
  EMPTY_ARRIVAL_REPRINT,
  type ArrivalReprintFields,
} from '../print-jobs/self-service-reprint'
import type { OrderPayStatus, PaymentSource, PrintPriceLine } from '../payment/payment.types'
import { createPaymentSessionToken } from '../payment/payment-session-token'
import type { BillingPageSource } from '../print-jobs/print-page-count.types'

// ============================================================
// 会员「我的打印订单」服务（Phase C-2C 后续小步，只读）。
//
// 唯一过滤维度是传入的 endUserId（来自 EndUserAuthGuard 注入的 req.endUser）：
// 只返回**本人**的打印任务。匿名 / 跨用户在 controller 层（guard）就已拒绝；
// service 永远拿到已认证的 endUserId，绝不接受任意 id 参数 → 天然杜绝越权。
//
// 合规（CLAUDE.md §10/§11/§12）：
// - 只回安全元数据。绝不返回 fileUrl(签名链接) / fileMd5(SHA-256) / paramsJson 原文 /
//   errorCode / errorMessage(可能含内部细节) 等敏感字段。
// - 不返回 pages / deviceName / amount / paidStatus —— 这些列在 PrintTask 中**不存在**，
//   不编造、不接支付逻辑。
// - 空列表返回 []，不伪造订单数量。
// ============================================================

/**
 * 失败行可给手机看的失败码白名单（2026-09-30 小程序交付单）。只给码、不给 errorMessage：
 * 那几句是写给一体机现场的（例如「请联系工作人员补纸后重试」），用户事后在手机上看会误解；
 * 小程序按码自己配说法。白名单外的内部码（下载校验、本地状态等）一律给 null。
 */
const MEMBER_VISIBLE_FAILURE_CODES = new Set([
  'PAPER_EMPTY',
  'PRINTER_ERROR',
  'PRINTER_OFFLINE',
  'PRINT_JOB_UNCONFIRMED',
  'PARTIAL_OUTPUT',
])

type DuplexMode = 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'

type ParsedParams = {
  fileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  duplex: DuplexMode | null
  paperSize: string | null
  pageRange: string | null
}

/** 与 shared 的 `DuplexMode` 逐字一致；改这里必须同改 packages/shared/src/types/print.ts。 */
const DUPLEX_MODES: readonly DuplexMode[] = ['simplex', 'duplex_long_edge', 'duplex_short_edge']

const EMPTY_PARAMS: ParsedParams = { fileName: null, copies: null, colorMode: null, duplex: null, paperSize: null, pageRange: null }
const ACTIVE_PRINT_STATUSES = ['pending', 'claimed', 'printing'] as const
const RESUMABLE_PAYMENT_STATUSES = new Set<OrderPayStatus>(['unpaid', 'paying'])
const NON_RESUMABLE_PAYMENT_STATUSES: OrderPayStatus[] = [
  'refunding', 'partial_refunded', 'refunded', 'failed', 'closed',
]

/**
 * 从 PrintTask.paramsJson（写入时由强校验 DTO 产生，但读时仍按不可信处理）安全提取
 * 白名单元数据。任何缺失 / 类型不符 / JSON 损坏 → 该字段返回 null，绝不抛错、绝不透传未知字段。
 * 跨端订单时间线（member-order-timeline.service.ts）也用这一份，口径不另起。
 */
export function parseSafeParams(paramsJson: string): ParsedParams {
  let raw: unknown
  try {
    raw = JSON.parse(paramsJson)
  } catch {
    return EMPTY_PARAMS
  }
  return sanitizePrintParams(raw)
}

/** {@link parseSafeParams} 的白名单本体；材料包行（OrderItem 列）不经 JSON 也走这里。 */
export function sanitizePrintParams(raw: unknown): ParsedParams {
  if (typeof raw !== 'object' || raw === null) return EMPTY_PARAMS
  const p = raw as Record<string, unknown>

  const fileName = typeof p['fileName'] === 'string' && p['fileName'].length > 0 ? p['fileName'] : null
  const copies =
    typeof p['copies'] === 'number' && Number.isInteger(p['copies']) && p['copies'] >= 1 && p['copies'] <= 99
      ? p['copies']
      : null
  const colorMode =
    p['colorMode'] === 'black_white' || p['colorMode'] === 'color' ? p['colorMode'] : null
  // duplex 是 2026-09-02 才补进对外契约的：下单侧一直写，读取侧一直没往外带。
  // 本字段补充之前建的 PrintTask，paramsJson 里根本没有 duplex 键 —— 缺失/非法一律 null
  // （= 未记录），绝不回落成 'simplex'：那会把「不知道」讲成「就是单面」。
  const duplex = DUPLEX_MODES.includes(p['duplex'] as DuplexMode) ? (p['duplex'] as DuplexMode) : null
  const paperSize = typeof p['paperSize'] === 'string' && p['paperSize'].length > 0 ? p['paperSize'] : null
  const rawRange = typeof p['pageRange'] === 'string' ? p['pageRange'].trim() : ''
  const pageRange = rawRange.length > 0 ? rawRange : null

  return { fileName, copies, colorMode, duplex, paperSize, pageRange }
}

function parseSafePriceLines(itemsJson: string): PrintPriceLine[] {
  let raw: unknown
  try {
    raw = JSON.parse(itemsJson)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw.flatMap((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) return []
    const line = candidate as Record<string, unknown>
    if (
      typeof line['serviceKey'] !== 'string' ||
      !Number.isInteger(line['unitCents']) ||
      !Number.isInteger(line['quantity']) ||
      !Number.isInteger(line['subtotalCents']) ||
      (line['unitCents'] as number) < 0 ||
      (line['quantity'] as number) < 0 ||
      (line['subtotalCents'] as number) < 0
    ) return []
    return [{
      serviceKey: line['serviceKey'],
      unitCents: line['unitCents'] as number,
      quantity: line['quantity'] as number,
      subtotalCents: line['subtotalCents'] as number,
      ...(typeof line['description'] === 'string' ? { description: line['description'] } : {}),
    }]
  })
}

/** 映射支付/退款/取件凭证字段所需的 Order 列（select 必须包含这些）。 */
export type MemberOrderPaymentSource = {
  amountCents: number
  payStatus: string
  paymentSource: string | null
  billablePages: number | null
  billingPageSource: string | null
  /** 没有哈希的是现场单。视图不得把认领不了的明文下发出去。 */
  pickupCodeHash: string | null
  taskStatus: string
  refundedAt: Date | null
  refundedAmountCents: number
  discountCents: number
  refundReason: string | null
}

/**
 * 「我的打印订单」支付字段的唯一口径：历史无 Order 一律 null，不编造。
 * pickupCode 只可能是到机码或 null，由调用方传入的 arrival 决定，不读明文列。
 * `/me/print-orders` 与跨端时间线共用，不许在别处另写一套。
 */
export function memberOrderPaymentFields(
  order: MemberOrderPaymentSource | null,
  arrival?: ArrivalReprintFields | null,
) {
  const view = order ? (arrival ?? EMPTY_ARRIVAL_REPRINT) : EMPTY_ARRIVAL_REPRINT
  const pickupCode = view.pickupCode
  return {
    // 支付字段：历史无 Order 一律 null，不编造。paymentSource 只会是 offline/free/manual_confirmed/null。
    amountCents: order ? order.amountCents : null,
    payStatus: order ? (order.payStatus as OrderPayStatus) : null,
    paymentSource: order ? (order.paymentSource as PaymentSource | null) : null,
    billablePages: order ? order.billablePages : null,
    billingPageSource: order ? (order.billingPageSource as BillingPageSource | null) : null,
    pickupCode,
    // C5-4 只读：已退金额 / 券抵扣额（历史无 Order 为 null）。券=平台 credit 非资金。
    refundedAmountCents: order ? order.refundedAmountCents : null,
    discountCents: order ? order.discountCents : null,
    refundRequired: order
      ? isPaidUnfulfilledRefundRequired({
          payStatus: order.payStatus,
          refundReason: order.refundReason,
        })
      : null,
    reprintAllowed: view.reprintAllowed,
    reprintRemaining: view.reprintRemaining,
    reprintNotice: view.reprintNotice,
  }
}

const PRINT_ORDER_LIST_SELECT = {
  id: true,
  orderNo: true,
  endUserId: true,
  // 任务上没记终端时用订单上的终端兜底显示网点名。
  terminalId: true,
  amountCents: true,
  payStatus: true,
  paymentSource: true,
  billablePages: true,
  billingPageSource: true,
  pickupCodeHash: true,
  pickupCodeEnc: true,
  pickupStatus: true,
  pickupCodeExpiresAt: true,
  pickupClaimedAt: true,
  paidAt: true,
  printTaskId: true,
  taskStatus: true,
  refundedAt: true,
  // C5-4 只读退款/核销字段（会员只读展示；无任何操作入口）。
  refundedAmountCents: true,
  discountCents: true,
  // API-20：只用来派生 refundRequired，不回传内部原因码。
  refundReason: true,
  // 自助开票二期：仅用于同源调用 assessInvoiceEligibility，不外露退款详情。
  refunds: { select: { status: true } },
} as const

@Injectable()
export class MemberPrintOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** 我的打印订单（本人），游标分页（C-2D，不做无界查询）。无任何订单返回空 items。 */
  async list(
    endUserId: string,
    page: MemberPageQuery,
  ): Promise<{ items: MemberPrintOrderItem[]; nextCursor: string | null; total: number }> {
    const where = { endUserId, order: { isNot: { type: 'copy' } } }
    const total = await this.prisma.printTask.count({ where })
    // select 显式收口：只取安全列，连 fileUrl / fileMd5 都不从 DB 读出，杜绝误透传。
    const rows = await this.prisma.printTask.findMany({
      where,
      // 只取安全列 + 关联 Order 的支付安全字段（绝不取 fileUrl / fileMd5）。
      select: {
        id: true,
        status: true,
        paramsJson: true,
        createdAt: true,
        completedAt: true,
        orderId: true,
        // 只用来派生 failureCode（白名单内的码），不原样回传。
        errorCode: true,
        // 出纸 / 领取的那台机器：小程序对账要显示网点名（2026-09-29 契约，只加不改）。
        terminal: { select: { id: true, displayName: true, locationLabel: true } },
        order: { select: PRINT_ORDER_LIST_SELECT },
      },
      ...memberPageArgs(page),
    })
    // 材料包多任务共享同一 Order：Order.printTaskId 只指向当前任务，子任务仅在 PrintTask.orderId 挂钩；
    // 按 endUserId 批量补查关联订单，确保同包全部任务的收费与开票态口径一致且不越权。
    const linkedOrderIds = [...new Set(rows.flatMap((r) => (!r.order && r.orderId ? [r.orderId] : [])))]
    const linkedOrders = linkedOrderIds.length > 0
      ? new Map((await this.prisma.order.findMany({
          where: { id: { in: linkedOrderIds }, endUserId, type: { not: 'copy' } },
          select: PRINT_ORDER_LIST_SELECT,
        })).map((o) => [o.id, o]))
      : new Map<string, NonNullable<(typeof rows)[number]['order']>>()
    const resolvedOrderOf = (r: (typeof rows)[number]) => r.order ?? (r.orderId ? linkedOrders.get(r.orderId) ?? null : null)
    const uniqueResolvedOrders = [...new Map(
      rows.flatMap((r) => {
        const order = resolvedOrderOf(r)
        return order ? [[order.id, order] as const] : []
      }),
    ).values()]
    const fallbackTerminalIds = [...new Set(rows
      .map((r) => (!r.terminal ? resolvedOrderOf(r)?.terminalId ?? null : null))
      .filter((terminalId): terminalId is string => Boolean(terminalId)))]
    const fallbackTerminals = fallbackTerminalIds.length
      ? new Map((await this.prisma.terminal.findMany({
          where: { id: { in: fallbackTerminalIds } },
          select: { id: true, displayName: true, locationLabel: true },
        })).map((t) => [t.id, t]))
      : new Map<string, { id: string; displayName: string | null; locationLabel: string | null }>()
    const arrivalViews = await arrivalViewsForOrders(this.prisma, uniqueResolvedOrders)
    const chargedOrderIds = uniqueResolvedOrders.filter((o) => o.amountCents > 0).map((o) => o.id)
    const invoiceByOrder = chargedOrderIds.length > 0
      ? pickLatestInvoiceRequestByOrder(
          await this.prisma.invoiceRequest.findMany({
            where: { endUserId, orderKind: 'print', orderId: { in: chargedOrderIds } },
            select: { id: true, orderId: true, status: true, createdAt: true },
          }),
        )
      : new Map()
    return buildMemberPage(rows, page, total, (r) => {
      const order = resolvedOrderOf(r)
      const terminal = r.terminal ?? (order?.terminalId ? fallbackTerminals.get(order.terminalId) ?? null : null)
      const params = parseSafeParams(r.paramsJson)
      const invoiceFields = order && order.amountCents > 0
        ? (() => {
            const picked = invoiceByOrder.get(order.id)
            const decision = assessInvoiceEligibility(
              {
                kind: 'print',
                id: order.id,
                endUserId: order.endUserId,
                payStatus: order.payStatus,
                amountCents: order.amountCents,
                discountCents: order.discountCents,
                refundedAmountCents: order.refundedAmountCents,
                refundStatuses: order.refunds.map((refund) => refund.status),
                openInvoiceStatus: toInvoiceOpenStatus(picked),
              },
              endUserId,
            )
            const invoiceStatus: MemberInvoiceStatus = picked?.status ?? 'none'
            return {
              payableAmountCents: decision.amountCents,
              canInvoice: decision.ok,
              invoiceStatus,
              invoiceRequestId: invoiceStatus === 'none' ? null : (picked?.id ?? null),
            }
          })()
        : null
      return {
        id: r.id,
        status: r.status,
        fileName: params.fileName,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        copies: params.copies,
        colorMode: params.colorMode,
        duplex: params.duplex,
        paperSize: params.paperSize,
        pageRange: params.pageRange,
        // 只返回已经归属核验的本人订单标识；绝不回退透传未经归属校验的 r.orderId。
        orderId: order?.id ?? null,
        orderNo: order?.orderNo ?? null,
        terminal: terminal ? { id: terminal.id, displayName: terminal.displayName ?? null, locationLabel: terminal.locationLabel ?? null } : null,
        failureCode: r.status === 'failed' && r.errorCode && MEMBER_VISIBLE_FAILURE_CODES.has(r.errorCode) ? r.errorCode : null,
        ...memberOrderPaymentFields(order, order ? arrivalViews.get(order.id) : null),
        ...(invoiceFields ?? {}),
      }
    })
  }

  /**
   * 当前会员可续办任务。只读本人 active PrintTask，最多返回最近 20 条：
   * - pending + unpaid/paying：恢复收银；必须能为本人真实 Order 重签 payment session。
   * - pending + paid、claimed、printing：恢复真实打印进度。
   * - 支付 closed/failed/refund*、任务终态、匿名/他人任务全部排除。
   */
  async listPending(endUserId: string): Promise<MemberPendingTaskItem[]> {
    const rows = await this.prisma.printTask.findMany({
      where: {
        endUserId,
        status: { in: [...ACTIVE_PRINT_STATUSES] },
        order: { isNot: { type: 'copy' } },
        OR: [
          { order: { is: null } },
          { order: { is: { payStatus: { notIn: NON_RESUMABLE_PAYMENT_STATUSES } } } },
        ],
      },
      select: {
        id: true,
        status: true,
        terminalId: true,
        paramsJson: true,
        updatedAt: true,
        order: {
          select: {
            id: true,
            orderNo: true,
            terminalId: true,
            amountCents: true,
            payStatus: true,
            itemsJson: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 20,
    })

    return rows.flatMap((row): MemberPendingTaskItem[] => {
      const status = row.status as MemberPendingPrintStatus
      const order = row.order
      const payStatus = order ? (order.payStatus as OrderPayStatus) : null
      const terminalId = order?.terminalId ?? row.terminalId
      const fileName = parseSafeParams(row.paramsJson).fileName

      if (status === 'pending' && order && RESUMABLE_PAYMENT_STATUSES.has(payStatus!)) {
        if (order.amountCents <= 0 || !terminalId) return []
        return [{
          id: row.id,
          type: 'print',
          status,
          payStatus,
          fileName,
          updatedAt: row.updatedAt.toISOString(),
          resume: {
            kind: 'payment',
            orderId: order.id,
            orderNo: order.orderNo,
            amountCents: order.amountCents,
            priceLines: parseSafePriceLines(order.itemsJson),
            paymentSessionToken: createPaymentSessionToken({
              orderId: order.id,
              orderNo: order.orderNo,
              terminalId,
              amountCents: order.amountCents,
              printTaskId: row.id,
            }),
          },
        }]
      }

      if (status === 'pending' && order && payStatus !== 'paid') return []

      let paymentSessionToken: string | undefined
      if (order && terminalId && payStatus === 'paid') {
        paymentSessionToken = createPaymentSessionToken({
          orderId: order.id,
          orderNo: order.orderNo,
          terminalId,
          amountCents: order.amountCents,
          printTaskId: row.id,
        })
      }
      return [{
        id: row.id,
        type: 'print',
        status,
        payStatus,
        fileName,
        updatedAt: row.updatedAt.toISOString(),
        resume: {
          kind: 'print-progress',
          ...(order ? {
            orderId: order.id,
            orderNo: order.orderNo,
            amountCents: order.amountCents,
          } : {}),
          ...(paymentSessionToken ? { paymentSessionToken } : {}),
        },
      }]
    })
  }
}
