/**
 * 已付款、终端明确没出纸时，按个人收费总开关决定是否自动原路退一次。
 *
 * 开关跟着个人收费总开关，不另开一列：默认关，关时只落待退款信号，和今天一样不调渠道；
 * 打开个人收费，就是同意向个人收打印费，没出纸就要把这笔钱退回去。
 * 公共就业点位生效价永远是 0，应付为 0，不会进到退款。
 *
 * 出纸未确认、打印中报告丢失、部分出纸、缺纸、空错误码都不自动退。
 * 文案仍写「请稍后重试 / 重新上传」的设备故障也不在这里退：自助重打还开着，
 * 先退掉就会把已付单改成已退，重打被拒。排队超时未领取不在那组里，超时没出纸要退。
 * 已按大于 0 付过、又明确没出纸，才走这里。退款失败复用第 2 期 a 的告警，类型单独一条。
 */
import { BadRequestException } from '@nestjs/common'
import {
  PAPER_EMPTY_ERROR_CODE,
  PARTIAL_OUTPUT_ERROR_CODE,
  PRINT_JOB_UNCONFIRMED_ERROR_CODE,
  PRINTING_REPORT_LOST_ERROR_CODE,
} from '../print-jobs/paid-anomaly-disposition'
import type { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { readPersonalChargeEnabled } from './effective-user-prices'
import { resolvePaymentProviders } from './payment-provider.factory'
import { markPaidUnfulfilledRefundRequired, payableCents } from './pending-refund-signal'
import {
  PAID_NO_PAPER_AUTO_REASON,
  PRINT_RETURN_MANUAL_TYPE,
} from './print-no-paper-refund.constants'
import { RefundService } from './refund.service'

export type NoPaperRefundOutcome = 'ignored' | 'signaled' | 'refunded' | 'idempotent' | 'failed'

export interface NoPaperRefundDeps {
  refund?: Pick<RefundService, 'refund'>
}

const UNCERTAIN_ERROR_CODES = new Set<string>([
  PRINT_JOB_UNCONFIRMED_ERROR_CODE,
  PRINTING_REPORT_LOST_ERROR_CODE,
])

/** 用户还能重打或重传的失败。自动退会关掉这条路，所以留给重打。 */
const RETRY_STILL_OPEN_ERROR_CODES = new Set<string>([
  'DOWNLOAD_HASH_MISMATCH',
  'PRINTER_NOT_FOUND',
  'PRINTER_OFFLINE',
  'PRINTER_ERROR',
  'PRINT_TIMEOUT',
  'PRINT_COMMAND_FAILED',
  'UNSUPPORTED_FILE_TYPE',
  'FILE_NOT_FOUND',
])

function exceptionCode(error: unknown): string | null {
  if (!(error instanceof BadRequestException)) return null
  const response = error.getResponse()
  if (typeof response === 'string') return response
  if (response && typeof response === 'object' && 'message' in response) {
    const message = (response as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return null
}

/** 只有失败且错误码明确表示没出纸，才自动退。不确定和部分出纸留在这里会被删掉时门禁变红。 */
function isExplicitNoPaper(status: string, errorCode: string | null): boolean {
  if (status !== 'failed') return false
  if (!errorCode) return false
  if (errorCode === PARTIAL_OUTPUT_ERROR_CODE) return false
  if (UNCERTAIN_ERROR_CODES.has(errorCode)) return false
  if (errorCode === PAPER_EMPTY_ERROR_CODE) return false
  if (RETRY_STILL_OPEN_ERROR_CODES.has(errorCode)) return false
  return true
}

async function pushPrintReturnAlert(orderId: string): Promise<void> {
  const webhook = process.env['ALERT_WEBHOOK_URL']?.trim() || null
  const redisUrl = process.env['REDIS_URL']?.trim()
  if (!webhook || !redisUrl) return
  try {
    const { default: Redis } = await import('ioredis')
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1000,
    })
    try {
      const { deliverOpsAlert } = await import('../admin-ops/admin-alert-push.service')
      await deliverOpsAlert({
        redis: {
          setIfAbsent: async (key, value, ttlSeconds) => {
            const result = await client.set(key, value, 'EX', ttlSeconds, 'NX')
            return result === 'OK'
          },
          del: (key) => client.del(key),
        },
        webhook,
        fetchImpl: fetch,
        alert: {
          subjectKey: `${PRINT_RETURN_MANUAL_TYPE}:${orderId}`,
          episodeToken: orderId,
          type: PRINT_RETURN_MANUAL_TYPE,
          severity: 'error',
          title: '打印没出纸，待人工处理',
          terminalCode: null,
        },
        state: 'firing',
      })
    } finally {
      client.disconnect()
    }
  } catch {
    // 推送失败不改变退款结果。列表仍由收集器现算。
  }
}

/**
 * 明确没出纸的一单。调用方传入的 taskStatus / errorCode 是打印任务的，不是订单的。
 * 已有同原因退款则直接返回，重复回调不再进 RefundService。
 */
export async function settleExplicitNoPaper(
  db: PrismaService,
  input: {
    orderId: string
    taskStatus: string
    errorCode: string | null
    printOutcome: string | null
    completedItemCount: number
  },
  deps?: NoPaperRefundDeps,
): Promise<NoPaperRefundOutcome> {
  if (input.printOutcome === 'printed') return 'ignored'
  if (input.completedItemCount > 0) return 'ignored'
  if (!isExplicitNoPaper(input.taskStatus, input.errorCode)) return 'ignored'

  const order = await db.order.findUnique({ where: { id: input.orderId } })
  if (!order) return 'ignored'
  if (order.taskStatus === 'claimed' || order.taskStatus === 'printing') return 'ignored'
  if (order.payStatus !== 'paid' || payableCents(order) <= 0) return 'ignored'

  await markPaidUnfulfilledRefundRequired(db, order)

  const enabled = await readPersonalChargeEnabled(db)
  if (!enabled) return 'signaled'

  const existing = await db.refund.findFirst({
    where: { orderId: order.id, reason: PAID_NO_PAPER_AUTO_REASON },
    select: { id: true },
  })
  if (existing) return 'idempotent'

  const refundApi = deps?.refund ?? new RefundService(db, new AuditService(db), resolvePaymentProviders(process.env))
  try {
    const view = await refundApi.refund(order.id, {
      refundNo: `RFD-${order.orderNo}`,
      reason: PAID_NO_PAPER_AUTO_REASON,
    })
    if (view.refund.status === 'failed') {
      await pushPrintReturnAlert(order.id)
      return 'failed'
    }
    return view.idempotent ? 'idempotent' : 'refunded'
  } catch (error) {
    const code = exceptionCode(error)
    if (code === 'REFUND_CHANNEL_FAILED') {
      await pushPrintReturnAlert(order.id)
      return 'failed'
    }
    if (code === 'ORDER_ALREADY_REFUNDED' || code === 'ORDER_TASK_IN_PROGRESS') return 'signaled'
    throw error
  }
}

/** 按任务号读失败原因，再决定退不退。队列超时和终端失败上报都走这里。 */
export async function settleExplicitNoPaperFromReportedFailure(
  db: PrismaService,
  taskId: string,
  deps?: NoPaperRefundDeps,
): Promise<NoPaperRefundOutcome> {
  const task = await db.printTask.findUnique({
    where: { id: taskId },
    select: { id: true, status: true, errorCode: true, printOutcome: true, orderId: true },
  })
  if (!task) return 'ignored'
  const order = await db.order.findFirst({
    where: task.orderId
      ? { OR: [{ printTaskId: task.id }, { id: task.orderId }] }
      : { printTaskId: task.id },
    select: { id: true },
  })
  if (!order) return 'ignored'
  const completedItemCount = await db.orderItem.count({
    where: { orderId: order.id, status: 'completed' },
  })
  return settleExplicitNoPaper(db, {
    orderId: order.id,
    taskStatus: task.status,
    errorCode: task.errorCode,
    printOutcome: task.printOutcome,
    completedItemCount,
  }, deps)
}
