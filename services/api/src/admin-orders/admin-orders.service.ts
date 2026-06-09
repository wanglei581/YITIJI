import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { ListOrdersQueryDto } from './dto/list-orders-query.dto'
import type {
  AdminOrderDetail,
  AdminOrderListItem,
  AdminOrderPrintDetail,
  AdminOrdersListResponse,
} from './admin-orders.types'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

// Order 行的最小读形状（service 内部用，避免引入 Prisma 生成类型）。
interface OrderRow {
  id: string
  orderNo: string
  type: string
  printTaskId: string | null
  endUserId: string | null
  terminalId: string | null
  amountCents: number
  currency: string
  payStatus: string
  taskStatus: string
  refundReason: string | null
  refundedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** 从 PrintTask.paramsJson 安全解析展示字段；损坏/缺失/类型不符 → 对应字段 null，绝不抛错。 */
function parseSafeParams(paramsJson: string): {
  fileName: string | null
  copies: number | null
  colorMode: string | null
  duplex: string | null
  paperSize: string | null
  pageRange: string | null
} {
  const empty = { fileName: null, copies: null, colorMode: null, duplex: null, paperSize: null, pageRange: null }
  let raw: unknown
  try {
    raw = JSON.parse(paramsJson)
  } catch {
    return empty
  }
  if (typeof raw !== 'object' || raw === null) return empty
  const p = raw as Record<string, unknown>
  const str = (k: string): string | null =>
    typeof p[k] === 'string' && (p[k] as string).length > 0 ? (p[k] as string) : null
  const copies =
    typeof p['copies'] === 'number' && Number.isInteger(p['copies']) && (p['copies'] as number) >= 1 && (p['copies'] as number) <= 99
      ? (p['copies'] as number)
      : null
  return {
    fileName: str('fileName'),
    copies,
    colorMode: p['colorMode'] === 'black_white' || p['colorMode'] === 'color' ? (p['colorMode'] as string) : null,
    duplex: str('duplex'),
    paperSize: str('paperSize'),
    pageRange: str('pageRange'),
  }
}

@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** 订单列表（支持 type / payStatus / taskStatus / orderNo 模糊 + 分页）。 */
  async list(query: ListOrdersQueryDto): Promise<AdminOrdersListResponse> {
    const limit = Math.min(Math.max(Number(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
    const offset = Math.max(Number(query.offset ?? 0), 0)

    const where: Record<string, unknown> = {}
    if (query.type) where['type'] = query.type
    if (query.payStatus) where['payStatus'] = query.payStatus
    if (query.taskStatus) where['taskStatus'] = query.taskStatus
    if (query.search && query.search.trim()) where['orderNo'] = { contains: query.search.trim() }

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.order.count({ where }),
    ])

    const { userLabels, terminalCodes } = await this.lookupLabels(rows as OrderRow[])
    const items = (rows as OrderRow[]).map((r) => this.toListItem(r, userLabels, terminalCodes))
    return { items, total, limit, offset }
  }

  /** 订单详情（含关联 PrintTask 打印参数 + 状态流转日志）。 */
  async getById(id: string): Promise<AdminOrderDetail> {
    const order = (await this.prisma.order.findUnique({ where: { id } })) as OrderRow | null
    if (!order) {
      throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: `订单 ${id} 不存在` } })
    }
    return this.toDetail(order)
  }

  /**
   * 改订单状态：payStatus 和/或 taskStatus（至少其一）。返回前一状态供审计。
   *
   * - payStatus：订单支付状态（线下运营标记，不接真实支付）；'refunded' 只能经退款端点产生，
   *   已标记退款的订单不允许再改 payStatus。
   * - taskStatus：**仅更新 Order.taskStatus（运营视图状态），不反向修改 PrintTask.status**。
   *   真实打印任务状态源仍是 PrintTask；本视图状态可能被设备状态镜像后续覆盖（已知取舍）。
   */
  async updateStatus(
    id: string,
    changes: { payStatus?: 'paid' | 'failed' | 'unpaid'; taskStatus?: string },
  ): Promise<{ previous: { payStatus: string; taskStatus: string }; detail: AdminOrderDetail }> {
    if (changes.payStatus === undefined && changes.taskStatus === undefined) {
      throw new BadRequestException({
        error: { code: 'ORDER_NO_STATUS_CHANGE', message: '请至少提供 payStatus 或 taskStatus 之一' },
      })
    }
    const order = (await this.prisma.order.findUnique({ where: { id } })) as OrderRow | null
    if (!order) {
      throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: `订单 ${id} 不存在` } })
    }
    // 仅当尝试改「支付状态」时拦截已标记退款的订单；taskStatus（运营视图）变更不受此限制。
    if (changes.payStatus !== undefined && order.payStatus === 'refunded') {
      throw new BadRequestException({
        error: { code: 'ORDER_ALREADY_REFUNDED', message: '订单已标记退款，支付状态不可再变更' },
      })
    }
    const previous = { payStatus: order.payStatus, taskStatus: order.taskStatus }
    const data: Record<string, unknown> = {}
    if (changes.payStatus !== undefined) data['payStatus'] = changes.payStatus
    if (changes.taskStatus !== undefined) data['taskStatus'] = changes.taskStatus // 只改 Order 列，不动 PrintTask
    await this.prisma.order.update({ where: { id }, data })
    return { previous, detail: await this.getById(id) }
  }

  /**
   * 标记退款：仅 payStatus='paid' 可标记；只置状态 + 原因 + 时间，**不发生真实资金流**。
   * 当前系统未接入真实支付退款，本操作仅用于运营记录，将订单标记为「已标记退款」。
   */
  async refund(
    id: string,
    reason: string,
  ): Promise<{ previousPayStatus: string; detail: AdminOrderDetail }> {
    const order = (await this.prisma.order.findUnique({ where: { id } })) as OrderRow | null
    if (!order) {
      throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: `订单 ${id} 不存在` } })
    }
    if (order.payStatus !== 'paid') {
      throw new BadRequestException({
        error: {
          code: 'ORDER_NOT_REFUNDABLE',
          message: `仅已支付订单可标记退款（当前支付状态：${order.payStatus}）`,
        },
      })
    }
    const previousPayStatus = order.payStatus
    await this.prisma.order.update({
      where: { id },
      data: { payStatus: 'refunded', refundReason: reason, refundedAt: new Date() },
    })
    return { previousPayStatus, detail: await this.getById(id) }
  }

  // ── 内部 ──────────────────────────────────────────────────────────────────────

  /** 批量取 endUser 昵称 / terminal 编码，供脱敏标签与展示。 */
  private async lookupLabels(rows: OrderRow[]): Promise<{
    userLabels: Map<string, string | null>
    terminalCodes: Map<string, string>
  }> {
    const endUserIds = [...new Set(rows.map((r) => r.endUserId).filter((v): v is string => !!v))]
    const terminalIds = [...new Set(rows.map((r) => r.terminalId).filter((v): v is string => !!v))]

    const userLabels = new Map<string, string | null>()
    const terminalCodes = new Map<string, string>()

    if (endUserIds.length > 0) {
      const users = await this.prisma.endUser.findMany({
        where: { id: { in: endUserIds } },
        select: { id: true, nickname: true },
      })
      for (const u of users) userLabels.set(u.id, u.nickname ?? null)
    }
    if (terminalIds.length > 0) {
      const terminals = await this.prisma.terminal.findMany({
        where: { id: { in: terminalIds } },
        select: { id: true, terminalCode: true },
      })
      for (const t of terminals) terminalCodes.set(t.id, t.terminalCode)
    }
    return { userLabels, terminalCodes }
  }

  private buildUserLabel(endUserId: string | null, userLabels: Map<string, string | null>): string {
    if (!endUserId) return '游客'
    const nickname = userLabels.get(endUserId)
    return nickname && nickname.length > 0 ? nickname : '会员'
  }

  private toListItem(
    r: OrderRow,
    userLabels: Map<string, string | null>,
    terminalCodes: Map<string, string>,
  ): AdminOrderListItem {
    return {
      id: r.id,
      orderNo: r.orderNo,
      type: r.type,
      endUserId: r.endUserId,
      userLabel: this.buildUserLabel(r.endUserId, userLabels),
      terminalId: r.terminalId,
      terminalCode: r.terminalId ? terminalCodes.get(r.terminalId) ?? null : null,
      amountCents: r.amountCents,
      currency: r.currency,
      payStatus: r.payStatus,
      taskStatus: r.taskStatus,
      refundedAt: r.refundedAt ? r.refundedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }
  }

  private async toDetail(order: OrderRow): Promise<AdminOrderDetail> {
    const { userLabels, terminalCodes } = await this.lookupLabels([order])
    const base = this.toListItem(order, userLabels, terminalCodes)

    let print: AdminOrderPrintDetail | null = null
    let statusLogs: AdminOrderDetail['statusLogs'] = []

    // 订单与 PrintTask 1:1（printTaskId）。读打印参数 / 状态日志（不读 fileUrl / fileMd5）。
    const task = order.printTaskId
      ? await this.prisma.printTask.findUnique({
          where: { id: order.printTaskId },
          select: {
            id: true, status: true, paramsJson: true, createdAt: true, completedAt: true,
            errorCode: true, errorMessage: true,
          },
        })
      : null
    if (task) {
      const p = parseSafeParams(task.paramsJson)
      print = {
        status: task.status,
        fileName: p.fileName,
        copies: p.copies,
        colorMode: p.colorMode,
        duplex: p.duplex,
        paperSize: p.paperSize,
        pageRange: p.pageRange,
        createdAt: task.createdAt.toISOString(),
        completedAt: task.completedAt ? task.completedAt.toISOString() : null,
        errorCode: task.errorCode ?? null,
        errorMessage: task.errorMessage ?? null,
      }
      const logs = await this.prisma.printTaskStatusLog.findMany({
        where: { taskId: task.id },
        orderBy: { createdAt: 'asc' },
        select: { fromStatus: true, toStatus: true, errorCode: true, createdAt: true },
      })
      statusLogs = logs.map((l) => ({
        fromStatus: l.fromStatus,
        toStatus: l.toStatus,
        errorCode: l.errorCode ?? null,
        createdAt: l.createdAt.toISOString(),
      }))
    }

    return {
      ...base,
      refundReason: order.refundReason,
      updatedAt: order.updatedAt.toISOString(),
      print,
      statusLogs,
    }
  }
}
