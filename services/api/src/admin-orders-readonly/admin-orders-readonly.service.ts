import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  channelAcceptedUnconfirmedWhere,
  EMPTY_IDENTIFIER_LOOKBACK_MS,
  isChannelAcceptedUnconfirmedAttempt,
} from '../payment/channel-accepted-signal'
import {
  ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES,
  ONLINE_PAID_PENDING_REFUND_REASON,
  PAID_UNFULFILLED_PENDING_REFUND_REASON,
  payableCents,
} from '../payment/pending-refund-signal'
import { explainPrintRefund } from '../payment/print-return-disposition'
import { staleSuccessUnprintedAttentionWhere } from '../payment/stale-success-unprinted-attention'
import { remainderAmountCents } from '../payment/refund-remainder'
import { orderHasRefundAtChannel } from '../payment/refund-channel-acceptance'
import { CHANNEL_SUCCESS_CONFLICT_AUDIT } from '../payment/refund-channel-answer'
import { channelRegistrationEntry } from '../payment/refund-channel-registration'
import type {
  AdminOrderReadonlyDetail,
  AdminOrderReadonlyItem,
  AdminOrderReadonlyPage,
  AdminOrderStatusLogItem,
} from './admin-orders-readonly.types'
import { deriveAftercare, orderSelect, parseSafePrintSummary, type LabelMaps, type OrderRow } from './admin-orders-readonly.derive'

export interface ListAdminOrdersReadonlyParams {
  type?: string
  payStatus?: string
  taskStatus?: string
  channel?: string
  pickupStatus?: string
  search?: string
  /** true = 只看待退款信号单（已付款未出纸，或渠道已收款未转 paid）。不会自动出款。 */
  refundRequired?: boolean
  /** true = 待退款 ∪ 退款中 ∪ 渠道已受理未确认。只读可见性，不发起退款。 */
  opsAttention?: boolean
  page: number
  pageSize: number
}

@Injectable()
export class AdminOrdersReadonlyService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ListAdminOrdersReadonlyParams): Promise<AdminOrderReadonlyPage> {
    const where: Record<string, unknown> = {}
    if (params.type) where['type'] = params.type
    if (params.payStatus) where['payStatus'] = params.payStatus
    if (params.taskStatus) {
      // 复印的 completed 仅指 handed；Order 的注销终态映射不能用于后台履约筛选。
      const copyStates: Record<string, string[]> = { completed: ['handed'], failed: ['failed'],
        cancelled: ['cancelled'], pending: ['ready', 'scanning', 'scanned', 'confirmed'],
        printing: ['dispatching', 'spooled'] }
      where['AND'] = [{ OR: [
        { type: { not: 'copy' }, taskStatus: params.taskStatus },
        { type: 'copy', copyJob: { is: { state: { in: copyStates[params.taskStatus] ?? [] } } } },
      ] }]
    }
    // channel / pickupStatus：M1/M2。存量 channel 为 null，前端显示「未标注」；
    // 不提供「未标注」筛选值——那等价于 null 查询，语义上是「无法判定」而非一个渠道。
    if (params.channel) where['channel'] = params.channel
    if (params.pickupStatus) where['pickupStatus'] = params.pickupStatus
    if (params.search && params.search.trim()) where['orderNo'] = { contains: params.search.trim() }
    if (params.opsAttention === true) {
      const [unconfirmedIds, conflictIds] = await Promise.all([
        this.unconfirmedAttemptOrderIds(),
        this.successConflictOrderIds(),
      ])
      where['OR'] = [
        {
          payStatus: 'paid',
          refundReason: PAID_UNFULFILLED_PENDING_REFUND_REASON,
        },
        {
          payStatus: { in: [...ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES] },
          refundReason: ONLINE_PAID_PENDING_REFUND_REASON,
        },
        { payStatus: 'refunding' },
        { payStatus: 'partial_refunded' },
        {
          payStatus: 'paid',
          printTask: { is: { printOutcome: 'printed' } },
          refunds: { some: { status: 'failed' } },
        },
        {
          payStatus: 'paid',
          refunds: { some: { status: 'manual_review' } },
        },
        staleSuccessUnprintedAttentionWhere(),
        { type: 'copy', copyJob: { is: { state: 'unconfirmed' } } },
        ...(unconfirmedIds.length > 0 ? [{ id: { in: unconfirmedIds } }] : []),
        ...(conflictIds.length > 0 ? [{ id: { in: conflictIds }, payStatus: { notIn: ['refunded', 'closed'] } }] : []),
      ]
    } else if (params.refundRequired === true) {
      const collected = {
        payStatus: { in: [...ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES] },
        refundReason: ONLINE_PAID_PENDING_REFUND_REASON,
      }
      const paidUnfulfilled = {
        payStatus: 'paid',
        refundReason: PAID_UNFULFILLED_PENDING_REFUND_REASON,
      }
      if (params.payStatus === 'paid') {
        where['refundReason'] = PAID_UNFULFILLED_PENDING_REFUND_REASON
      } else if (
        params.payStatus &&
        (ONLINE_COLLECTED_UNSETTLED_PAY_STATUSES as readonly string[]).includes(params.payStatus)
      ) {
        where['refundReason'] = ONLINE_PAID_PENDING_REFUND_REASON
      } else if (!params.payStatus) {
        where['OR'] = [paidUnfulfilled, collected]
      } else {
        where['id'] = { in: [] }
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: orderSelect(),
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.order.count({ where }),
    ])

    const orderRows = rows as unknown as OrderRow[]
    const labels = await this.lookupLabels(orderRows)
    const unconfirmed = await this.unconfirmedOrderIdSet(orderRows.map((row) => row.id))
    const paperFailed = await this.paperRefundFailedIds(orderRows)
    const manualReview = await this.manualReviewIds(orderRows)
    const stalePaidFailed = await this.staleSuccessUnprintedIds(orderRows)
    return {
      items: orderRows.map((row) => this.toItem(
        row,
        labels,
        unconfirmed.has(row.id),
        paperFailed.has(row.id),
        manualReview.has(row.id) || stalePaidFailed.has(row.id),
      )),
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
      },
    }
  }

  async getById(id: string): Promise<AdminOrderReadonlyDetail> {
    const row = (await this.prisma.order.findUnique({
      where: { id },
      select: orderSelect(),
    })) as unknown as OrderRow | null
    if (!row) {
      throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: `订单 ${id} 不存在` } })
    }

    const labels = await this.lookupLabels([row])
    const unconfirmed = await this.unconfirmedOrderIdSet([row.id])
    const paperFailed = await this.paperRefundFailedIds([row])
    const manualReview = await this.manualReviewIds([row])
    const stalePaidFailed = await this.staleSuccessUnprintedIds([row])
    const printRefund = await explainPrintRefund(this.prisma, row.id)
    const item = this.toItem(
      row,
      labels,
      unconfirmed.has(row.id),
      paperFailed.has(row.id),
      manualReview.has(row.id) || stalePaidFailed.has(row.id),
    )
    const summary = row.type !== 'copy' && row.printTask ? parseSafePrintSummary(row.printTask.paramsJson) : null
    const statusLogs = row.type !== 'copy' && row.printTask
      ? await this.prisma.printTaskStatusLog.findMany({
          where: { taskId: row.printTask.id },
          orderBy: { createdAt: 'asc' },
          select: { fromStatus: true, toStatus: true, errorCode: true, createdAt: true },
        })
      : []

    const remainder = await remainderAmountCents(this.prisma, row)
    const successCoversOrder = printRefund.refundStatus === 'success'
      && (row.payStatus !== 'partial_refunded' || (remainder !== null && remainder <= 0))
    const blocksAnotherRefund = printRefund.refundStatus === 'pending'
      || printRefund.refundStatus === 'failed'
      || printRefund.refundStatus === 'manual_review'
      || successCoversOrder
    return {
      ...item,
      refundEligible: item.refundEligible && !blocksAnotherRefund,
      refundedAt: row.refundedAt ? row.refundedAt.toISOString() : null,
      refundReason: row.refundReason,
      discountCents: row.discountCents,
      payableCents: payableCents(row),
      refundedAmountCents: row.refundedAmountCents,
      printTaskId: row.type === 'copy' ? null : row.printTaskId ?? null,
      print: row.printTask && summary
        ? {
            ...summary,
            status: row.printTask.status,
            createdAt: row.printTask.createdAt.toISOString(),
            completedAt: row.printTask.completedAt ? row.printTask.completedAt.toISOString() : null,
            errorCode: row.printTask.errorCode,
          }
        : null,
      statusLogs: statusLogs.map((log): AdminOrderStatusLogItem => ({
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        errorCode: log.errorCode ?? null,
        createdAt: log.createdAt.toISOString(),
      })),
      autoRefund: printRefund.disposition === 'auto_success' || printRefund.disposition === 'auto_failed',
      refundStatus: printRefund.refundStatus,
      refundFailureReason: printRefund.disposition === 'auto_failed' ? printRefund.reason : null,
      printRefundDisposition: printRefund.disposition,
      printRefundReason: printRefund.reason,
      refundLedgerNo: printRefund.refundNo,
      refundLedgerCents: printRefund.amountCents,
      refundRemainderCents: remainder,
      channelInFlight: await orderHasRefundAtChannel(this.prisma, row.id),
      channelResultRegistration: await channelRegistrationEntry(this.prisma, row.id),
    }
  }

  private async lookupLabels(rows: OrderRow[]): Promise<LabelMaps> {
    const endUserIds = [...new Set(rows.map((row) => row.endUserId).filter((id): id is string => Boolean(id)))]
    const terminalIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.terminalId, row.printTask?.terminalId ?? null])
          .filter((id): id is string => Boolean(id)),
      ),
    ]

    const [users, terminals] = await Promise.all([
      endUserIds.length > 0
        ? this.prisma.endUser.findMany({ where: { id: { in: endUserIds } }, select: { id: true, nickname: true } })
        : Promise.resolve([]),
      terminalIds.length > 0
        ? this.prisma.terminal.findMany({ where: { id: { in: terminalIds } }, select: { id: true, terminalCode: true } })
        : Promise.resolve([]),
    ])

    return {
      userLabels: new Map(users.map((user) => [user.id, user.nickname ?? null])),
      terminalCodes: new Map(terminals.map((terminal) => [terminal.id, terminal.terminalCode])),
    }
  }

  private async paperRefundFailedIds(rows: OrderRow[]): Promise<Set<string>> {
    const candidates = rows
      .filter((row) => row.payStatus === 'paid' && row.printTask?.printOutcome === 'printed')
      .map((row) => row.id)
    if (candidates.length === 0) return new Set()
    const refunds = await this.prisma.refund.findMany({
      where: { orderId: { in: candidates }, status: 'failed' },
      select: { orderId: true },
    })
    return new Set(refunds.map((refund) => refund.orderId))
  }

  private async staleSuccessUnprintedIds(rows: OrderRow[]): Promise<Set<string>> {
    const candidates = rows
      .filter((row) => row.payStatus === 'paid' && row.taskStatus === 'failed' && row.amountCents > 0 && row.printTask?.printOutcome !== 'printed')
      .map((row) => row.id)
    if (candidates.length === 0) return new Set()
    const matched = await this.prisma.order.findMany({
      where: { id: { in: candidates }, ...staleSuccessUnprintedAttentionWhere() },
      select: { id: true },
    })
    return new Set(matched.map((row) => row.id))
  }

  private async manualReviewIds(rows: OrderRow[]): Promise<Set<string>> {
    const candidates = rows.filter((row) => row.payStatus === 'paid').map((row) => row.id)
    if (candidates.length === 0) return new Set()
    const [refunds, conflicts] = await Promise.all([
      this.prisma.refund.findMany({
        where: { orderId: { in: candidates }, status: 'manual_review' },
        select: { orderId: true },
      }),
      this.prisma.auditLog.findMany({
        where: {
          targetId: { in: candidates },
          action: { in: [CHANNEL_SUCCESS_CONFLICT_AUDIT, 'refund.notify_paper_already_released'] },
        },
        select: { targetId: true },
      }),
    ])
    return new Set([
      ...refunds.map((refund) => refund.orderId),
      ...conflicts.map((row) => row.targetId).filter((id): id is string => Boolean(id)),
    ])
  }

  private async successConflictOrderIds(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { action: { in: [CHANNEL_SUCCESS_CONFLICT_AUDIT, 'refund.notify_paper_already_released'] } },
      select: { targetId: true },
    })
    return [...new Set(rows.map((row) => row.targetId).filter((id): id is string => Boolean(id)))]
  }

  private async unconfirmedAttemptOrderIds(): Promise<string[]> {
    const rows = await this.prisma.paymentAttempt.findMany({
      where: channelAcceptedUnconfirmedWhere(new Date(), { fuzzyLookbackMs: EMPTY_IDENTIFIER_LOOKBACK_MS }),
      select: {
        orderId: true,
        status: true,
        prepayId: true,
        qrCodeContent: true,
        channelTxnNo: true,
        failReason: true,
        createdAt: true,
      },
    })
    return [...new Set(rows.filter((row) => isChannelAcceptedUnconfirmedAttempt(row)).map((row) => row.orderId))]
  }

  private async unconfirmedOrderIdSet(orderIds: string[]): Promise<Set<string>> {
    if (orderIds.length === 0) return new Set()
    const rows = await this.prisma.paymentAttempt.findMany({
      where: { orderId: { in: orderIds }, ...channelAcceptedUnconfirmedWhere() },
      select: {
        orderId: true,
        status: true,
        prepayId: true,
        qrCodeContent: true,
        channelTxnNo: true,
        failReason: true,
        createdAt: true,
      },
    })
    return new Set(rows.filter((row) => isChannelAcceptedUnconfirmedAttempt(row)).map((row) => row.orderId))
  }

  private toItem(
    row: OrderRow,
    labels: LabelMaps,
    channelAcceptedUnconfirmed = false,
    paperRefundFailed = false,
    printReturnManual = false,
  ): AdminOrderReadonlyItem {
    // 手机单在到机放行前只有 Order：展示已确认的打印快照，不伪造 PrintTask。
    // 有真实任务时只认任务参数；材料包/历史现场单不套用单文件快照。
    const pendingSingle = !row.printTask && row.type === 'print' && row.sourceFileId !== null
    const printSummary = parseSafePrintSummary(row.type === 'copy' ? null : row.printTask?.paramsJson ?? (pendingSingle ? row.printParamsJson : null))
    if (pendingSingle && !printSummary.fileName) {
      printSummary.fileName = row.sourceFileName?.trim() || null
    }
    const effectiveTerminalId = row.terminalId ?? row.printTask?.terminalId ?? null
    const ownerType = row.endUserId ? 'member' : 'anonymous'
    const nickname = row.endUserId ? labels.userLabels.get(row.endUserId) : null
    return {
      id: row.id,
      orderNo: row.orderNo,
      type: row.type,
      ...(row.type === 'copy' ? { typeLabel: '复印' as const } : {}),
      ownerType,
      userLabel: ownerType === 'member' ? (nickname && nickname.length > 0 ? nickname : '会员') : '游客',
      terminalCode: effectiveTerminalId ? labels.terminalCodes.get(effectiveTerminalId) ?? null : null,
      amountCents: row.amountCents,
      billablePages: row.billablePages,
      currency: row.currency,
      // channel 为 null = 存量单，前端必须显示「未标注」而非猜成 kiosk
      channel: row.channel,
      pickupStatus: row.pickupStatus,
      pickupCodeExpiresAt: row.pickupCodeExpiresAt ? row.pickupCodeExpiresAt.toISOString() : null,
      payStatus: row.payStatus,
      taskStatus: row.type === 'copy' ? row.copyJob?.state ?? 'unconfirmed' : row.taskStatus,
      ...(row.type === 'copy' ? { taskStatusLabel: ({ handed: '已交给打印机', unconfirmed: '结果未确认',
        failed: '失败', cancelled: '已取消', expired: '已过期', confirmed: '已确认', dispatching: '派发中',
        spooled: '派发中', ready: '待扫描', scanning: '扫描中', scanned: '待确认' } as Record<string, string>)[row.copyJob?.state ?? 'unconfirmed'] ?? '结果未确认' } : {}),
      printFileName: printSummary.fileName,
      copies: printSummary.copies,
      colorMode: printSummary.colorMode,
      paperSize: printSummary.paperSize,
      errorCode: row.type === 'copy' ? row.copyJob?.resultCode
        ?? (row.copyJob?.state === 'unconfirmed' ? 'COPY_RESULT_UNCONFIRMED' : null) : row.printTask?.errorCode ?? null,
      ...deriveAftercare(row, channelAcceptedUnconfirmed, paperRefundFailed, printReturnManual),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
