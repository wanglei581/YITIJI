import { ConflictException } from '@nestjs/common'
import { decryptSecret } from '../common/crypto/secret-cipher'
import type { PrismaService } from '../prisma/prisma.service'
import { isPickupClaimWindowClosed } from './pickup-claim-window'
import {
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

export const PICKUP_RESUME_UNCONFIRMED = 'PICKUP_RESUME_UNCONFIRMED'
export const PICKUP_RESUME_UNCONFIRMED_MESSAGE = '这单的出纸结果还没确认，暂时不能接着打，请稍后再试'

export const PICKUP_RESUME_PARTIAL_OUTPUT = 'PICKUP_RESUME_PARTIAL_OUTPUT'
export const PICKUP_RESUME_PARTIAL_OUTPUT_MESSAGE = '这单已经出了一部分纸，不能整单重打'

const LIVE_PAY_FOR_CODE = new Set(['unpaid', 'paying', 'paid'])

export type ArrivalReprintFields = {
  pickupCode: string | null
  reprintAllowed: boolean
  reprintRemaining: number | null
}

export const EMPTY_ARRIVAL_REPRINT: ArrivalReprintFields = {
  pickupCode: null,
  reprintAllowed: false,
  reprintRemaining: null,
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
        select: { id: true, status: true, errorCode: true, terminalId: true, fileId: true },
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
      const block = paidReprintBlockReason({
        status: task.status,
        errorCode: task.errorCode,
        hasOrder: true,
        payStatus: order.payStatus,
        file: task.fileId ? fileById.get(task.fileId) ?? null : null,
        terminalId: task.terminalId,
        agentVersion: task.terminalId ? versions.get(task.terminalId) ?? null : null,
      })
      reprintAllowed = sameTerminal && windowOpen && block === null && used < SELF_SERVICE_REPRINT_LIMIT
    }
    const showCode = reprintAllowed || pendingCodeVisible(order, now)
    views.set(order.id, {
      pickupCode: showCode ? decryptArrival(order.pickupCodeEnc) : null,
      reprintAllowed,
      reprintRemaining,
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
