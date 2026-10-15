import { ConflictException } from '@nestjs/common'
import { decryptSecret } from '../common/crypto/secret-cipher'
import { payableCents } from '../payment/pending-refund-signal'
import type { PrismaService } from '../prisma/prisma.service'
import {
  PARTIAL_OUTPUT_ERROR_CODE,
  PRINT_JOB_UNCONFIRMED_ERROR_CODE,
} from './paid-anomaly-disposition'
import { isPickupClaimWindowClosed } from './pickup-claim-window'
import {
  REPRINT_BLOCKED_MESSAGE,
  latestHeartbeatAgentVersions,
  paidReprintBlockReason,
} from './paid-reprint-eligibility'

/** 每单自助续打上限。加上首次出纸，最多尝试 3 次。管理员重试不占这 2 次。 */
export const SELF_SERVICE_REPRINT_LIMIT = 2

/** 会员在任务上点「重新提交」时，failed→pending 日志用这个码。 */
export const KIOSK_RETRY_LOG_CODE = 'kiosk_retry'

/** 到机后再输同一个到机码续打时，failed→pending 日志用这个码。 */
export const PICKUP_CODE_RESUME = 'pickup_code_resume'

export const SELF_SERVICE_REPRINT_LOG_CODES = [KIOSK_RETRY_LOG_CODE, PICKUP_CODE_RESUME] as const

export const SELF_SERVICE_REPRINT_LIMIT_MESSAGE = '这单已经接着打过 2 次，不能再打了'

export const PRINT_RETRY_LIMIT_REACHED = 'PRINT_RETRY_LIMIT_REACHED'
export const PICKUP_RESUME_LIMIT_REACHED = 'PICKUP_RESUME_LIMIT_REACHED'

/** 免费单停在「出纸未确认」满这段时间后，才允许自助续打。 */
export const UNCONFIRMED_SELF_SERVICE_COOLDOWN_MS = 5 * 60 * 1000

export const PICKUP_RESUME_UNCONFIRMED = 'PICKUP_RESUME_UNCONFIRMED'
export const PICKUP_RESUME_UNCONFIRMED_MESSAGE = REPRINT_BLOCKED_MESSAGE.unconfirmed

export const PICKUP_RESUME_PARTIAL_OUTPUT = 'PICKUP_RESUME_PARTIAL_OUTPUT'
export const PICKUP_RESUME_PARTIAL_OUTPUT_MESSAGE = REPRINT_BLOCKED_MESSAGE.partial_output

export const PICKUP_RESUME_REFUND_PENDING = 'PICKUP_RESUME_REFUND_PENDING'
export const PICKUP_RESUME_REFUND_PENDING_MESSAGE = '这单没有打完，费用会按原路退回，需要帮助请拨打服务电话'

/** 订单视图给前端的提示。付费单这两种状态不提示续打。 */
export type ReprintNotice = 'may_have_printed' | 'partial_output' | null

export type SelfServiceAnomalyDecision =
  | { action: 'none' }
  | { action: 'cooldown' }
  | { action: 'refund' }
  | { action: 'reprint'; notice: Exclude<ReprintNotice, null> }

/**
 * 实付 = 应付 − 抵扣。实付 0 的未确认单要等冷却期；部分出纸可立刻整单重打。
 * 实付大于 0 的这两种状态不自助重打，调用方改走已付未履约标记。
 * 没有 completedAt 的未确认单视为还没满冷却期。
 */
export function selfServiceAnomalyDecision(input: {
  errorCode?: string | null
  amountCents: number
  discountCents: number
  unconfirmedSince?: Date | null
  now?: Date
}): SelfServiceAnomalyDecision {
  const unconfirmed = input.errorCode === PRINT_JOB_UNCONFIRMED_ERROR_CODE
  const partial = input.errorCode === PARTIAL_OUTPUT_ERROR_CODE
  if (!unconfirmed && !partial) return { action: 'none' }
  if (payableCents({ amountCents: input.amountCents, discountCents: input.discountCents }) > 0) {
    return { action: 'refund' }
  }
  if (partial) return { action: 'reprint', notice: 'partial_output' }
  const now = input.now ?? new Date()
  const since = input.unconfirmedSince
  if (!since || now.getTime() - since.getTime() < UNCONFIRMED_SELF_SERVICE_COOLDOWN_MS) {
    return { action: 'cooldown' }
  }
  return { action: 'reprint', notice: 'may_have_printed' }
}

export function throwSelfServiceAnomalyHalt(halt: 'refund' | 'cooldown'): never {
  if (halt === 'refund') {
    throw new ConflictException({
      error: { code: PICKUP_RESUME_REFUND_PENDING, message: PICKUP_RESUME_REFUND_PENDING_MESSAGE },
    })
  }
  throw new ConflictException({
    error: { code: PICKUP_RESUME_UNCONFIRMED, message: PICKUP_RESUME_UNCONFIRMED_MESSAGE },
  })
}

export function selfServiceReprintFlags(notice: ReprintNotice): { mayHavePrinted?: true; partialOutput?: true } {
  if (notice === 'may_have_printed') return { mayHavePrinted: true }
  if (notice === 'partial_output') return { partialOutput: true }
  return {}
}

const LIVE_PAY_FOR_CODE = new Set(['unpaid', 'paying', 'paid'])

export type ArrivalReprintFields = {
  pickupCode: string | null
  reprintAllowed: boolean
  reprintRemaining: number | null
  reprintNotice: ReprintNotice
}

export const EMPTY_ARRIVAL_REPRINT: ArrivalReprintFields = {
  pickupCode: null,
  reprintAllowed: false,
  reprintRemaining: null,
  reprintNotice: null,
}

export type ArrivalOrderRow = {
  id: string
  pickupCodeHash: string | null
  pickupCodeEnc: string | null
  pickupStatus: string
  pickupCodeExpiresAt: Date | null
  pickupClaimedAt: Date | null
  payStatus: string
  paidAt: Date | null
  printTaskId: string | null
  terminalId: string | null
  amountCents: number
  discountCents: number
}

type ReprintLogDb = Pick<PrismaService, 'printTaskStatusLog'>

/** 自助续打次数：只数会员重试和到机码续打，管理员重试不计入。 */
export async function selfServiceReprintCount(db: ReprintLogDb, taskId: string): Promise<number> {
  return db.printTaskStatusLog.count({
    where: {
      taskId,
      fromStatus: 'failed',
      toStatus: 'pending',
      errorCode: { in: [...SELF_SERVICE_REPRINT_LOG_CODES] },
    },
  })
}

export async function selfServiceReprintCounts(db: ReprintLogDb, taskIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (taskIds.length === 0) return counts
  const rows = await db.printTaskStatusLog.groupBy({
    by: ['taskId'],
    where: {
      taskId: { in: taskIds },
      fromStatus: 'failed',
      toStatus: 'pending',
      errorCode: { in: [...SELF_SERVICE_REPRINT_LOG_CODES] },
    },
    _count: { _all: true },
  })
  for (const row of rows) counts.set(row.taskId, row._count._all)
  return counts
}

export function reprintRemainingFromCount(used: number): number {
  return Math.max(0, SELF_SERVICE_REPRINT_LIMIT - used)
}

/** `/print-jobs/:taskId/retry` 与到机码续打共用。已达上限抛 409。 */
export async function assertSelfServiceReprintRemaining(db: ReprintLogDb, taskId: string): Promise<void> {
  const used = await selfServiceReprintCount(db, taskId)
  if (used >= SELF_SERVICE_REPRINT_LIMIT) {
    throw new ConflictException({
      error: { code: PRINT_RETRY_LIMIT_REACHED, message: SELF_SERVICE_REPRINT_LIMIT_MESSAGE },
    })
  }
}

function decryptArrival(enc: string | null): string | null {
  if (!enc) return null
  try { return decryptSecret(enc) } catch { return null }
}

function pendingCodeVisible(order: ArrivalOrderRow, now: Date): boolean {
  if (!order.pickupCodeHash || !order.pickupCodeEnc) return false
  if (order.pickupStatus !== 'pending') return false
  if (!LIVE_PAY_FOR_CODE.has(order.payStatus)) return false
  return Boolean(order.pickupCodeExpiresAt && order.pickupCodeExpiresAt > now)
}

/**
 * 订单视图上的到机码与续打资格。
 * 没有哈希（现场单）或没有任务时，reprintRemaining 为 null。
 * reprintAllowed 为真时才在已放行的单上继续下发到机码；仅 pending 且窗口仍开时也下发。
 */
export async function arrivalViewsForOrders(
  prisma: PrismaService,
  orders: ArrivalOrderRow[],
  now: Date = new Date(),
): Promise<Map<string, ArrivalReprintFields>> {
  const views = new Map<string, ArrivalReprintFields>()
  if (orders.length === 0) return views
  const taskIds = [...new Set(orders.map((order) => order.printTaskId).filter((id): id is string => Boolean(id)))]
  const tasks = taskIds.length
    ? await prisma.printTask.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, status: true, errorCode: true, terminalId: true, fileId: true, completedAt: true },
      })
    : []
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const fileIds = [...new Set(tasks.map((task) => task.fileId).filter((id): id is string => Boolean(id)))]
  const files = fileIds.length
    ? await prisma.fileObject.findMany({
        where: { id: { in: fileIds } },
        select: { id: true, status: true, deletedAt: true, expiresAt: true },
      })
    : []
  const fileById = new Map(files.map((file) => [file.id, file]))
  const versions = await latestHeartbeatAgentVersions(
    prisma,
    tasks.map((task) => task.terminalId).filter((id): id is string => Boolean(id)),
  )
  const counts = await selfServiceReprintCounts(prisma, taskIds)

  for (const order of orders) {
    const task = order.printTaskId ? taskById.get(order.printTaskId) : undefined
    const hasHash = Boolean(order.pickupCodeHash && order.pickupCodeEnc)
    let reprintAllowed = false
    let reprintRemaining: number | null = null
    let reprintNotice: ReprintNotice = null
    if (hasHash && task) {
      const used = counts.get(task.id) ?? 0
      reprintRemaining = reprintRemainingFromCount(used)
      const sameTerminal = Boolean(order.terminalId && task.terminalId === order.terminalId)
      const windowOpen = !isPickupClaimWindowClosed({
        pickupCodeExpiresAt: order.pickupCodeExpiresAt,
        pickupStatus: order.pickupStatus,
        printTaskId: order.printTaskId,
        payStatus: order.payStatus,
        pickupClaimedAt: order.pickupClaimedAt,
        paidAt: order.paidAt,
        pickupCodeHash: order.pickupCodeHash,
      }, now)
      const anomaly = selfServiceAnomalyDecision({
        errorCode: task.errorCode,
        amountCents: order.amountCents,
        discountCents: order.discountCents,
        unconfirmedSince: task.completedAt,
        now,
      })
      if (anomaly.action === 'cooldown') reprintNotice = 'may_have_printed'
      else if (anomaly.action === 'reprint') reprintNotice = anomaly.notice
      const block = paidReprintBlockReason({
        status: task.status,
        errorCode: task.errorCode,
        hasOrder: true,
        payStatus: order.payStatus,
        file: task.fileId ? fileById.get(task.fileId) ?? null : null,
        terminalId: task.terminalId,
        agentVersion: task.terminalId ? versions.get(task.terminalId) ?? null : null,
        selfServiceAnomalyCleared: anomaly.action === 'reprint',
      })
      reprintAllowed = sameTerminal && windowOpen && block === null && used < SELF_SERVICE_REPRINT_LIMIT
    }
    const showCode = reprintAllowed || pendingCodeVisible(order, now)
    views.set(order.id, {
      pickupCode: showCode ? decryptArrival(order.pickupCodeEnc) : null,
      reprintAllowed,
      reprintRemaining,
      reprintNotice,
    })
  }
  return views
}

export async function arrivalViewForOrder(
  prisma: PrismaService,
  order: ArrivalOrderRow,
  now?: Date,
): Promise<ArrivalReprintFields> {
  const views = await arrivalViewsForOrders(prisma, [order], now)
  return views.get(order.id) ?? EMPTY_ARRIVAL_REPRINT
}
