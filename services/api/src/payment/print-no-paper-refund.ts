/**
 * 已付款、终端明确没出纸时，按个人收费总开关决定是否自动原路退一次。
 *
 * 开关跟着个人收费总开关，不另开一列：默认关，关时只落待退款信号，和今天一样不调渠道；
 * 打开个人收费，就是同意向个人收打印费，没出纸就要把这笔钱退回去。
 * 公共就业点位生效价永远是 0，应付为 0，不会进到退款。
 *
 * 自动原路退只认「确定没交给打印机」的允许名单。终端状态上报没有阶段字段，
 * 同一个码若在交给打印机前后都会出现，就不能整码放进名单。
 * PRINT_COMMAND_FAILED 作为上报码只出现在调用 print() 之前（下载失败、队列还没送去打印）。
 * print() 已经调用之后的命令失败会被改写成 PRINT_JOB_UNCONFIRMED，不在名单里。
 * 名单外、以后新出现的码一律不自动退。缺纸即使发生在预检、文件还没交出去，也不自动退。
 * PRINT_QUEUE_TIMEOUT 是服务端排队超时未领取，不是终端上报码，原文写明没有出纸，留在名单里。
 * 已按大于 0 付过、又明确没出纸，才走这里。退款失败复用第 2 期 a 的告警，类型单独一条。
 */
import { BadRequestException } from '@nestjs/common'
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

/**
 * 确定没交给打印机，才自动原路退。
 * 出处都在终端程序：下载失败与队列准备失败是 task-runner 在 print() 之前上报的
 * PRINT_COMMAND_FAILED；校验失败是 DOWNLOAD_HASH_MISMATCH；预检失败是
 * PRINTER_NOT_FOUND / PRINTER_OFFLINE / PRINTER_ERROR；本地状态写不下去是
 * LOCAL_TASK_STATE_PERSIST_FAILED；文件不存在与不支持的格式在 print() 里、
 * 派发开始前返回，并原样上报。PRINT_QUEUE_TIMEOUT 由服务端在领取前写成失败。
 */
const EXPLICIT_NO_PAPER_ERROR_CODES = new Set<string>([
  'PRINT_COMMAND_FAILED',
  'DOWNLOAD_HASH_MISMATCH',
  'PRINTER_NOT_FOUND',
  'PRINTER_OFFLINE',
  'PRINTER_ERROR',
  'LOCAL_TASK_STATE_PERSIST_FAILED',
  'FILE_NOT_FOUND',
  'UNSUPPORTED_FILE_TYPE',
  'PRINT_QUEUE_TIMEOUT',
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

/** 只有失败，且错误码在「确定没交给打印机」的允许名单里，才自动退。 */
function isExplicitNoPaper(status: string, errorCode: string | null): boolean {
  if (status !== 'failed') return false
  if (!errorCode) return false
  return EXPLICIT_NO_PAPER_ERROR_CODES.has(errorCode)
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
