/**
 * 排队超时：已付款（含免费）且仍是 pending 的打印任务，自「可以被本机领取」起
 * 超过 N 分钟还没被终端领走，就判失败。纸没有出去。
 *
 * 可以被本机领取的时刻 = max(PrintTask.updatedAt, Order.paidAt)。
 * - 一体机建单时任务先落成 pending，订单还是 unpaid；免费单随后 markPaid，付费单要等付款。
 *   付款只改订单，任务的 updatedAt 仍停在创建时，所以要用 paidAt 把钟拨到付款之后。
 * - 小程序到机码预下单只建 Order，不建 PrintTask。到机核销 release() 才创建可领取任务，
 *   那时 updatedAt 就是可领取时刻；paidAt 可能早几天，不能拿它当起点。
 * - 重新提交把任务从 failed 改回 pending，updatedAt 刷新，钟重新算。paidAt 保持原付款时间。
 *
 * 到机码本身 7 天有效，不归这条超时管。没有 PrintTask 的预订单不会被扫到。
 */
import { BadRequestException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PackageOrderFulfillmentService } from '../member-print-orders/package-order-fulfillment.service'
import {
  markPaidUnfulfilledRefundRequired,
  PAID_UNFULFILLED_PENDING_REFUND_REASON,
} from '../payment/pending-refund-signal'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'

export const PRINT_QUEUE_TIMEOUT = 'PRINT_QUEUE_TIMEOUT'
export const PRINT_QUEUE_TIMEOUT_AUDIT = 'print_job.queue_timeout'
export const PRINT_QUEUE_TIMEOUT_SETTING_AUDIT = 'print_queue_timeout_setting.update'
export const PRINT_QUEUE_TIMEOUT_SETTING_KEY = 'print.queueClaimTimeoutMinutes'
export const PRINT_QUEUE_TIMEOUT_DEFAULT_MINUTES = 15
export const PRINT_QUEUE_TIMEOUT_MIN_MINUTES = 5
export const PRINT_QUEUE_TIMEOUT_MAX_MINUTES = 120

const SETTING_TARGET = 'print-queue-timeout'

type SettingStore = PrismaService | PrismaTransactionClient

export function parsePrintQueueTimeoutMinutes(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === '') return PRINT_QUEUE_TIMEOUT_DEFAULT_MINUTES
  if (!/^\d+$/.test(raw.trim())) return PRINT_QUEUE_TIMEOUT_DEFAULT_MINUTES
  const minutes = Number(raw)
  if (!inPrintQueueTimeoutRange(minutes)) return PRINT_QUEUE_TIMEOUT_DEFAULT_MINUTES
  return minutes
}

export function inPrintQueueTimeoutRange(minutes: number): boolean {
  return Number.isInteger(minutes)
    && minutes >= PRINT_QUEUE_TIMEOUT_MIN_MINUTES
    && minutes <= PRINT_QUEUE_TIMEOUT_MAX_MINUTES
}

export function assertPrintQueueTimeoutMinutes(minutes: number): void {
  if (!inPrintQueueTimeoutRange(minutes)) {
    throw new BadRequestException({
      error: {
        code: 'PRINT_QUEUE_TIMEOUT_INVALID',
        message: '排队等待上限须是 5 到 120 的整数分钟',
      },
    })
  }
}

export function printQueueClaimableSinceCutoff(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000)
}

/** 领取查询的时间上限。updatedAt 或 paidAt 有一个还在窗口内，就还能领。 */
export function claimableFreshnessFilter(cutoff: Date): {
  OR: [
    { updatedAt: { gte: Date } },
    { order: { is: { paidAt: { gte: Date } } } },
  ]
} {
  return {
    OR: [
      { updatedAt: { gte: cutoff } },
      { order: { is: { paidAt: { gte: cutoff } } } },
    ],
  }
}

export async function readPrintQueueTimeoutMinutes(db: SettingStore): Promise<number> {
  if (typeof db.platformSetting?.findUnique !== 'function') return PRINT_QUEUE_TIMEOUT_DEFAULT_MINUTES
  const row = await db.platformSetting.findUnique({
    where: { key: PRINT_QUEUE_TIMEOUT_SETTING_KEY },
    select: { value: true },
  })
  return parsePrintQueueTimeoutMinutes(row?.value)
}

export async function updatePrintQueueTimeoutMinutes(
  prisma: PrismaService,
  audit: AuditService,
  minutes: number,
  actor: { userId: string; role: string },
): Promise<number> {
  assertPrintQueueTimeoutMinutes(minutes)
  return prisma.$transaction(async (tx) => {
    const before = await readPrintQueueTimeoutMinutes(tx)
    await tx.platformSetting.upsert({
      where: { key: PRINT_QUEUE_TIMEOUT_SETTING_KEY },
      create: { key: PRINT_QUEUE_TIMEOUT_SETTING_KEY, value: String(minutes), updatedBy: actor.userId },
      update: { value: String(minutes), updatedBy: actor.userId },
    })
    const after = await readPrintQueueTimeoutMinutes(tx)
    await audit.writeRequired(tx, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: PRINT_QUEUE_TIMEOUT_SETTING_AUDIT,
      targetType: 'system',
      targetId: SETTING_TARGET,
      payload: { before, after },
    })
    return after
  })
}

/**
 * 重新提交排队超时的单时，清掉当时写上的「已付未履约待退款」。
 * 只清这一条原因。其它退款原因不动。免费单本来就没有这个标记。
 * 不清的话，任务虽然回到 pending，领取查询仍会因为这个原因把单留在队列里。
 */
export async function clearQueueTimeoutRefundMark(
  db: SettingStore,
  orderId: string,
  errorCode: string | null | undefined,
): Promise<void> {
  if (errorCode !== PRINT_QUEUE_TIMEOUT) return
  await db.order.updateMany({
    where: { id: orderId, refundReason: PAID_UNFULFILLED_PENDING_REFUND_REASON },
    data: { refundReason: null },
  })
}

function failWhere(cutoff: Date, now: Date) {
  return {
    status: 'pending' as const,
    updatedAt: { lt: cutoff },
    order: {
      is: {
        payStatus: 'paid',
        taskStatus: 'pending',
        AND: [
          { OR: [{ paidAt: null }, { paidAt: { lt: cutoff } }] },
          {
            OR: [
              { refundReason: null },
              { refundReason: { not: PAID_UNFULFILLED_PENDING_REFUND_REASON } },
            ],
          },
        ],
      },
    },
    OR: [
      { fileId: null },
      {
        file: {
          is: {
            status: 'active',
            deletedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
    ],
  }
}

/**
 * 把超过排队上限、仍没被领走的任务判成失败。
 * 与领取抢同一行时只看 status 仍是 pending 的 CAS：一边成功，另一边改不到。
 * 传入 now 便于测试把「现在」拨到将来；生产调用用当前时间。
 */
export async function expireQueuedPrintTasks(prisma: PrismaService, now = new Date()): Promise<number> {
  const minutes = await readPrintQueueTimeoutMinutes(prisma)
  const cutoff = printQueueClaimableSinceCutoff(now, minutes)
  const candidates = await prisma.printTask.findMany({
    where: failWhere(cutoff, now),
    select: { id: true, terminalId: true, orderId: true, endUserId: true },
  })
  const packages = new PackageOrderFulfillmentService()
  let expired = 0
  for (const task of candidates) {
    const didFail = await prisma.$transaction(async (tx) => {
      const updated = await tx.printTask.updateMany({
        where: { id: task.id, status: 'pending', updatedAt: { lt: cutoff } },
        data: {
          status: 'failed',
          completedAt: now,
          errorCode: PRINT_QUEUE_TIMEOUT,
          errorMessage: '排队超时未领取，没有出纸',
        },
      })
      if (updated.count !== 1) return false
      await tx.printTaskStatusLog.create({
        data: {
          taskId: task.id,
          fromStatus: 'pending',
          toStatus: 'failed',
          errorCode: PRINT_QUEUE_TIMEOUT,
        },
      })
      const packageItem = task.orderId
        ? await tx.orderItem.findFirst({
          where: { orderId: task.orderId, printTaskId: task.id },
          select: { id: true },
        })
        : null
      if (packageItem && task.orderId) {
        await packages.advance(tx, {
          orderId: task.orderId,
          taskId: task.id,
          terminalId: task.terminalId ?? '',
          endUserId: task.endUserId,
          status: 'failed',
        })
      } else {
        await tx.order.updateMany({
          where: { printTaskId: task.id, taskStatus: 'pending' },
          data: { taskStatus: 'failed', terminalId: task.terminalId },
        })
      }
      const order = await tx.order.findFirst({
        where: { printTaskId: task.id },
        select: { id: true, payStatus: true, amountCents: true, discountCents: true, refundReason: true },
      })
      if (order) await markPaidUnfulfilledRefundRequired(tx, order)
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'system',
          action: PRINT_QUEUE_TIMEOUT_AUDIT,
          targetType: 'print_task',
          targetId: task.id,
          payloadJson: JSON.stringify({
            errorCode: PRINT_QUEUE_TIMEOUT,
            terminalId: task.terminalId,
            minutes,
            cutoff: cutoff.toISOString(),
          }),
        },
      })
      return true
    })
    if (didFail) expired += 1
  }
  return expired
}
