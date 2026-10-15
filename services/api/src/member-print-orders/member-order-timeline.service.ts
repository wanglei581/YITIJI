/**
 * 跨端订单时间线：GET /api/v1/me/print-orders/timeline（本人，只读列表）。
 *
 * 为什么是新文件：一体机「我的打印订单」原来只读 PrintTask（member-print-orders.service.ts），
 * 看不到手机下单未到机的单与材料包；三路来源归并 + 游标 + 过滤是一套独立的查询编排，
 * 塞进已有的 PrintTask 列表服务会把两个契约（旧列表与时间线）搅在一起。
 * 映射口径不另起：参数白名单用 parseSafeParams / sanitizePrintParams，
 * 支付与取件凭证字段用 memberOrderPaymentFields，状态口径见 member-order-timeline.status.ts。
 *
 * 到机码只在可取或可续打时解密下发，字段仍叫 pickupCode。没有哈希的现场单保持 null。
 */
import { BadRequestException, Injectable } from '@nestjs/common'
import { parseMemberPageQuery } from '../common/utils/member-page'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalSessionService } from '../terminals/terminal-session.service'
import { MemberPrintOrderCreateService } from './member-print-order-create.service'
import { memberOrderPaymentFields, parseSafeParams, sanitizePrintParams } from './member-print-orders.service'
import { arrivalViewsForOrders, type ArrivalReprintFields } from '../print-jobs/self-service-reprint'
import {
  MEMBER_ORDER_TIMELINE_KIND_FILTERS,
  MEMBER_ORDER_TIMELINE_STATUS_FILTERS,
  type MemberOrderTimelineItem,
  type MemberOrderTimelineKind,
  type MemberOrderTimelineKindFilter,
  type MemberOrderTimelinePage,
  type MemberOrderTimelineStatusFilter,
  type MemberOrderTimelineTerminal,
} from './member-print-orders.types'
import {
  deriveOrderDisplayStatus,
  deriveTaskDisplayStatus,
  hasUsableArrivalCode,
  isClaimableHere,
  orderBucketWhere,
  taskBucketWhere,
} from './member-order-timeline.status'
import { PackageOrderService } from './package-order.service'

export interface MemberOrderTimelineQuery {
  cursor: TimelineCursor | null
  pageSize: number
  status: MemberOrderTimelineStatusFilter
  kind: MemberOrderTimelineKindFilter
}

interface TimelineCursor {
  createdAt: Date
  id: string
  kind: MemberOrderTimelineKind
}

/**
 * 三路归并的全序：createdAt 降序 → 来源名次降序（材料包、单件、一体机任务）→ 同来源内 id 降序。
 *
 * 跨来源同一毫秒时只按来源名次分先后，**从不在 JS 里比较两个来源的 id**：
 * id 的先后由数据库排序规则决定（PostgreSQL 的 en_US 排序与 JS 逐码元比较对下划线等字符结论不同），
 * 如果归并用 JS 比 id、游标却让数据库比 id，同一毫秒的行会在翻页时漏或重。
 * 同来源内保留数据库返回的顺序（稳定排序），游标也只在同来源内用数据库比 id，两边口径一致。
 */
const KIND_RANK: Record<MemberOrderTimelineKind, number> = { kiosk_task: 0, cloud_single: 1, package: 2 }

function queryInvalid(message: string): BadRequestException {
  return new BadRequestException({ error: { code: 'MEMBER_TIMELINE_QUERY_INVALID', message } })
}

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id, k: cursor.kind }), 'utf8')
    .toString('base64url')
}

/** 游标只接受本服务签出的形状；任何解不开的都是 400，不当成「从头开始」静默吞掉。 */
export function decodeTimelineCursor(raw: string): TimelineCursor {
  const invalid = new BadRequestException({
    error: { code: 'MEMBER_TIMELINE_CURSOR_INVALID', message: '翻页位置已失效，请刷新列表' },
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw invalid
  }
  if (typeof parsed !== 'object' || parsed === null) throw invalid
  const { c, i, k } = parsed as Record<string, unknown>
  if (typeof c !== 'string' || typeof i !== 'string' || !i || typeof k !== 'string') throw invalid
  if (!Object.prototype.hasOwnProperty.call(KIND_RANK, k)) throw invalid
  const createdAt = new Date(c)
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== c) throw invalid
  return { createdAt, id: i, kind: k as MemberOrderTimelineKind }
}

export function parseTimelineQuery(raw: {
  cursor?: string
  pageSize?: string
  status?: string
  kind?: string
}): MemberOrderTimelineQuery {
  const page = parseMemberPageQuery(undefined, raw.pageSize)
  const status = (raw.status?.trim() || 'all') as MemberOrderTimelineStatusFilter
  if (!(MEMBER_ORDER_TIMELINE_STATUS_FILTERS as readonly string[]).includes(status)) {
    throw queryInvalid('status 只能是 all / waiting / printing / done')
  }
  const kind = (raw.kind?.trim() || 'all') as MemberOrderTimelineKindFilter
  if (!(MEMBER_ORDER_TIMELINE_KIND_FILTERS as readonly string[]).includes(kind)) {
    throw queryInvalid('kind 只能是 all / kiosk_task / cloud_single / package')
  }
  const cursorRaw = raw.cursor?.trim()
  return { cursor: cursorRaw ? decodeTimelineCursor(cursorRaw) : null, pageSize: page.pageSize, status, kind }
}

/** 本来源里排在游标之后（更旧）的行（全序见 KIND_RANK 注释）。 */
function afterCursor(cursor: TimelineCursor | null, kind: MemberOrderTimelineKind): Record<string, unknown> {
  if (!cursor) return {}
  const or: Array<Record<string, unknown>> = [{ createdAt: { lt: cursor.createdAt } }]
  if (kind === cursor.kind) or.push({ createdAt: cursor.createdAt, id: { lt: cursor.id } })
  else if (KIND_RANK[kind] < KIND_RANK[cursor.kind]) or.push({ createdAt: cursor.createdAt })
  return { OR: or }
}

/** Order 上时间线要用的列。不含明文列；到机码只从 pickupCodeEnc 解密。 */
const ORDER_SELECT = {
  id: true,
  orderNo: true,
  terminalId: true,
  printTaskId: true,
  pickupCodeHash: true,
  pickupCodeEnc: true,
  pickupStatus: true,
  payStatus: true,
  taskStatus: true,
  pickupCodeExpiresAt: true,
  pickupClaimedAt: true,
  paidAt: true,
  amountCents: true,
  paymentSource: true,
  billablePages: true,
  billingPageSource: true,
  refundedAt: true,
  refundedAmountCents: true,
  discountCents: true,
  refundReason: true,
  createdAt: true,
} as const

type SortableRow = { createdAt: Date; id: string; kind: MemberOrderTimelineKind; item: MemberOrderTimelineItem }

/** 只比时间与来源名次；同来源同毫秒返回 0，交给稳定排序保留数据库给的 id 顺序。 */
function compareDesc(a: SortableRow, b: SortableRow): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime()
  if (byTime !== 0) return byTime
  return KIND_RANK[b.kind] - KIND_RANK[a.kind]
}

@Injectable()
export class MemberOrderTimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudOrders: MemberPrintOrderCreateService,
    private readonly packages: PackageOrderService,
    private readonly sessions: TerminalSessionService,
  ) {}

  /**
   * 可选终端身份：终端头齐全且会话验签通过才算本机；否则按「无终端」处理。
   * 这是只读列表，验不过不报错，但绝不会因此算出 claimableHere。
   */
  async resolveVerifiedTerminal(terminalId: string | undefined, sessionToken: string | undefined): Promise<string | null> {
    const id = terminalId?.trim()
    if (!id || !sessionToken?.trim()) return null
    try {
      await this.sessions.validate(id, sessionToken)
      return id
    } catch {
      return null
    }
  }

  async list(endUserId: string, query: MemberOrderTimelineQuery, verifiedTerminalId: string | null): Promise<MemberOrderTimelinePage> {
    const wants = (kind: MemberOrderTimelineKind) => query.kind === 'all' || query.kind === kind
    // 与小程序两个列表同一口径：先把本人到期未取的单落成 expired，展示与过滤都只看落库状态。
    if (wants('cloud_single')) await this.cloudOrders.expirePendingForUser(endUserId)
    if (wants('package')) await this.packages.expireExpiredForUser(endUserId)

    const take = query.pageSize + 1
    const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }]
    const bucketTask = query.status === 'all' ? {} : taskBucketWhere(query.status)
    const bucketOrder = query.status === 'all' ? {} : orderBucketWhere(query.status)
    const taskBase = { AND: [{ endUserId, orderId: null }, bucketTask] }
    const cloudBase = { AND: [{ endUserId, sourceFileId: { not: null }, printTaskId: null }, bucketOrder] }
    const packageBase = { AND: [{ endUserId, orderItems: { some: {} } }, bucketOrder] }

    const [taskRows, cloudRows, packageRows, taskTotal, cloudTotal, packageTotal] = await Promise.all([
      wants('kiosk_task')
        ? this.prisma.printTask.findMany({
            where: { AND: [taskBase, afterCursor(query.cursor, 'kiosk_task')] },
            select: {
              id: true,
              status: true,
              terminalId: true,
              paramsJson: true,
              createdAt: true,
              completedAt: true,
              order: { select: ORDER_SELECT },
            },
            orderBy,
            take,
          })
        : [],
      wants('cloud_single')
        ? this.prisma.order.findMany({
            where: { AND: [cloudBase, afterCursor(query.cursor, 'cloud_single')] },
            select: { ...ORDER_SELECT, sourceFileName: true, printParamsJson: true },
            orderBy,
            take,
          })
        : [],
      wants('package')
        ? this.prisma.order.findMany({
            where: { AND: [packageBase, afterCursor(query.cursor, 'package')] },
            select: {
              ...ORDER_SELECT,
              orderItems: { select: { copies: true, colorMode: true, duplex: true }, orderBy: { seq: 'asc' } },
              printTask: { select: { completedAt: true } },
            },
            orderBy,
            take,
          })
        : [],
      wants('kiosk_task') ? this.prisma.printTask.count({ where: taskBase }) : 0,
      wants('cloud_single') ? this.prisma.order.count({ where: cloudBase }) : 0,
      wants('package') ? this.prisma.order.count({ where: packageBase }) : 0,
    ])

    const terminalIds = new Set<string>()
    for (const row of taskRows) if (row.terminalId) terminalIds.add(row.terminalId)
    for (const row of [...cloudRows, ...packageRows]) if (row.terminalId) terminalIds.add(row.terminalId)
    const terminals = terminalIds.size
      ? await this.prisma.terminal.findMany({
          where: { id: { in: [...terminalIds] } },
          select: { id: true, displayName: true, locationLabel: true },
        })
      : []
    const terminalById = new Map<string, MemberOrderTimelineTerminal>(terminals.map((t) => [t.id, t]))
    const terminalOf = (id: string | null) => (id ? terminalById.get(id) ?? null : null)
    const now = new Date()
    const arrivalViews = await arrivalViewsForOrders(this.prisma, [
      ...taskRows.flatMap((task) => (task.order ? [task.order] : [])),
      ...cloudRows,
      ...packageRows,
    ], now)

    const rows: SortableRow[] = []
    for (const task of taskRows) {
      const order = task.order
      const params = parseSafeParams(task.paramsJson)
      rows.push({
        createdAt: task.createdAt,
        id: task.id,
        kind: 'kiosk_task',
        item: this.item({
          kind: 'kiosk_task',
          id: task.id,
          order,
          printTaskId: task.id,
          title: params.fileName,
          itemCount: 1,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          params,
          taskStatus: task.status,
          displayStatus: deriveTaskDisplayStatus(task.status, order),
          terminal: terminalOf(task.terminalId),
          verifiedTerminalId,
          now,
          arrival: order ? arrivalViews.get(order.id) ?? null : null,
        }),
      })
    }
    for (const order of cloudRows) {
      const params = parseSafeParams(order.printParamsJson)
      rows.push({
        createdAt: order.createdAt,
        id: order.id,
        kind: 'cloud_single',
        item: this.item({
          kind: 'cloud_single',
          id: order.id,
          order,
          printTaskId: order.printTaskId,
          title: order.sourceFileName ?? params.fileName,
          itemCount: 1,
          createdAt: order.createdAt,
          completedAt: null,
          params,
          taskStatus: order.taskStatus,
          displayStatus: deriveOrderDisplayStatus(order),
          terminal: terminalOf(order.terminalId),
          verifiedTerminalId,
          now,
          arrival: arrivalViews.get(order.id) ?? null,
        }),
      })
    }
    for (const order of packageRows) {
      const first = order.orderItems[0]
      // 材料包各份共用份数/颜色/单双面；页范围逐份不同，列表不给（进详情看）。
      const shared = sanitizePrintParams(first ? { copies: first.copies, colorMode: first.colorMode, duplex: first.duplex } : null)
      rows.push({
        createdAt: order.createdAt,
        id: order.id,
        kind: 'package',
        item: this.item({
          kind: 'package',
          id: order.id,
          order,
          printTaskId: order.printTaskId,
          title: null,
          itemCount: order.orderItems.length,
          createdAt: order.createdAt,
          completedAt: order.printTask?.completedAt ?? null,
          params: { ...shared, paperSize: null, pageRange: null },
          taskStatus: order.taskStatus,
          displayStatus: deriveOrderDisplayStatus(order),
          terminal: terminalOf(order.terminalId),
          verifiedTerminalId,
          now,
          arrival: arrivalViews.get(order.id) ?? null,
        }),
      })
    }

    rows.sort(compareDesc) // Array.prototype.sort 是稳定排序（ES2019 起），同来源内保持数据库顺序
    const hasMore = rows.length > query.pageSize
    const page = rows.slice(0, query.pageSize)
    const last = page[page.length - 1]
    return {
      items: page.map((row) => row.item),
      nextCursor: hasMore && last ? encodeTimelineCursor({ createdAt: last.createdAt, id: last.id, kind: last.kind }) : null,
      total: taskTotal + cloudTotal + packageTotal,
    }
  }

  private item(input: {
    kind: MemberOrderTimelineKind
    id: string
    order: (Parameters<typeof memberOrderPaymentFields>[0] & Parameters<typeof isClaimableHere>[0] & { id: string; orderNo: string }) | null
    printTaskId: string | null
    title: string | null
    itemCount: number
    createdAt: Date
    completedAt: Date | null
    params: Pick<ReturnType<typeof parseSafeParams>, 'copies' | 'colorMode' | 'duplex' | 'paperSize' | 'pageRange'>
    taskStatus: string
    displayStatus: MemberOrderTimelineItem['displayStatus']
    terminal: MemberOrderTimelineTerminal | null
    verifiedTerminalId: string | null
    now: Date
    arrival: ArrivalReprintFields | null
  }): MemberOrderTimelineItem {
    const { order } = input
    const pay = memberOrderPaymentFields(order, input.arrival)
    return {
      kind: input.kind,
      id: input.id,
      orderId: order?.id ?? null,
      orderNo: order?.orderNo ?? null,
      printTaskId: input.printTaskId,
      title: input.title,
      itemCount: input.itemCount,
      createdAt: input.createdAt.toISOString(),
      completedAt: input.completedAt ? input.completedAt.toISOString() : null,
      copies: input.params.copies,
      colorMode: input.params.colorMode,
      duplex: input.params.duplex,
      paperSize: input.params.paperSize,
      pageRange: input.params.pageRange,
      amountCents: pay.amountCents,
      billablePages: pay.billablePages,
      payStatus: pay.payStatus,
      paymentSource: pay.paymentSource,
      refundedAmountCents: pay.refundedAmountCents,
      discountCents: pay.discountCents,
      refundRequired: pay.refundRequired,
      taskStatus: input.taskStatus,
      pickupStatus: order?.pickupStatus ?? null,
      displayStatus: input.displayStatus,
      arrivalCodeExpiresAt: order?.pickupCodeHash && order.pickupCodeExpiresAt ? order.pickupCodeExpiresAt.toISOString() : null,
      hasArrivalCode: hasUsableArrivalCode(order, input.now),
      pickupCode: pay.pickupCode,
      terminal: input.terminal,
      claimableHere: isClaimableHere(order, input.verifiedTerminalId, input.now),
      reprintAllowed: pay.reprintAllowed,
      reprintRemaining: pay.reprintRemaining,
      reprintNotice: pay.reprintNotice,
    }
  }
}
