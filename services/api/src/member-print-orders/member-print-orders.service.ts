import { Injectable } from '@nestjs/common'
import type {
  MemberPendingPrintStatus,
  MemberPendingTaskItem,
  MemberPrintOrderItem,
} from './member-print-orders.types'
import { PrismaService } from '../prisma/prisma.service'
import { buildMemberPage, memberPageArgs, type MemberPageQuery } from '../common/utils/member-page'
import { pickupCodeVisibleFor } from '../payment/order-status.service'
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
 */
function parseSafeParams(paramsJson: string): ParsedParams {
  let raw: unknown
  try {
    raw = JSON.parse(paramsJson)
  } catch {
    return EMPTY_PARAMS
  }
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

@Injectable()
export class MemberPrintOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** 我的打印订单（本人），游标分页（C-2D，不做无界查询）。无任何订单返回空 items。 */
  async list(
    endUserId: string,
    page: MemberPageQuery,
  ): Promise<{ items: MemberPrintOrderItem[]; nextCursor: string | null; total: number }> {
    const where = { endUserId }
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
        order: {
          select: {
            amountCents: true,
            payStatus: true,
            paymentSource: true,
            billablePages: true,
            billingPageSource: true,
            pickupCode: true,
            taskStatus: true,
            refundedAt: true,
            // C5-4 只读退款/核销字段（会员只读展示；无任何操作入口）。
            refundedAmountCents: true,
            discountCents: true,
          },
        },
      },
      ...memberPageArgs(page),
    })
    return buildMemberPage(rows, page, total, (r) => {
      const params = parseSafeParams(r.paramsJson)
      const order = r.order
      // 取件码门控：仅 paid 且未退款、任务未进入完成/取消/失败终态时返回；其余（unpaid/refunded/终态）一律 null。
      const pickupCode =
        order && pickupCodeVisibleFor({ payStatus: order.payStatus, taskStatus: order.taskStatus, refundedAt: order.refundedAt })
          ? order.pickupCode
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
