/**
 * 出码前按订单所属终端的当前状态重算一次「这台机器现在该不该向个人收费」。
 *
 * 算法只认 effective-user-prices.ts（打印、复印、一体机配置、两个后台共用的那一份）。
 * 订单建好之后，终端可能被改绑到公共就业机构、总开关可能被关掉、可能改成机构付费；
 * 这时旧单不能再出收款码：在出码预留的同一事务里把这笔未付单关掉，还没领走的打印任务一并取消，
 * 调用方沿用「订单已关闭」错误码，一体机走它已有的那条出路。
 *
 * 仍该收费时什么都不做：哪怕单价变了，出码仍按订单冻结的金额，调价不在这里处理。
 * 免费单在调用方更早就被拒绝出码，不会走到这里。
 */
import { BadRequestException } from '@nestjs/common'
import type { PrismaTransactionClient } from '../prisma/prisma.service'
import { getEffectiveUserPrices } from './effective-user-prices'
import { TERMINAL_CHARGE_SERVICE_KEYS, type EffectivePriceReason } from './terminal-charge.contract'

export const TERMINAL_NOT_CHARGING_CLOSE_ACTION = 'order.closed_terminal_not_charging'
export const TERMINAL_NOT_CHARGING_TASK_ERROR_CODE = 'TERMINAL_NOT_CHARGING'
const TERMINAL_NOT_CHARGING_TASK_MESSAGE = '这台机器现在不向个人收费，未付订单已关闭，不再出纸'

const LIVE_ATTEMPT_STATUSES = ['created', 'pending'] as const
const BUSY_TASK_STATUSES = ['claimed', 'printing', 'completed'] as const

type ChargeRecheckDb = Pick<
  PrismaTransactionClient,
  'terminal' | 'platformSetting' | 'order' | 'printTask' | 'printTaskStatusLog' | 'auditLog'
>

interface UnpaidOrderRef {
  id: string
  orderNo: string
  terminalId: string | null
  printTaskId: string | null
  payStatus: string
  pickupStatus: string
  amountCents: number
}

/** 这台机器现在还向个人收费就返回 null；否则返回不收费的原因。 */
export async function terminalStopChargingReason(
  db: Pick<PrismaTransactionClient, 'terminal' | 'platformSetting'>,
  terminalId: string | null,
): Promise<EffectivePriceReason | null> {
  const prices = await getEffectiveUserPrices(db, terminalId)
  if (TERMINAL_CHARGE_SERVICE_KEYS.some((key) => prices.prices[key].reason === 'user_pays')) return null
  return prices.prices[TERMINAL_CHARGE_SERVICE_KEYS[0]].reason
}

/**
 * 在出码预留的同一事务里、写 paying 之前调用。传入的是事务里刚读到的订单行。
 * 返回 true：这台机器现在不该向个人收费，不能出码（订单已关闭，或已被别的流程改走），
 * 调用方抛 ORDER_CLOSED。返回 false：照常出码。
 */
export async function closeUnpaidOrderIfTerminalStoppedCharging(
  tx: ChargeRecheckDb,
  order: UnpaidOrderRef,
): Promise<boolean> {
  // 只处理还没预留的未付单。paying 等状态交给调用方原有的预留判断。
  if (order.payStatus !== 'unpaid') return false
  const reason = await terminalStopChargingReason(tx, order.terminalId)
  if (reason === null) return false

  let taskCancelled = false
  if (order.printTaskId) {
    const task = await tx.printTask.updateMany({
      where: { id: order.printTaskId, status: 'pending' },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errorCode: TERMINAL_NOT_CHARGING_TASK_ERROR_CODE,
        errorMessage: TERMINAL_NOT_CHARGING_TASK_MESSAGE,
      },
    })
    // 任务已不在待领状态（被别的流程处理过）：不改订单，只拒绝出码。
    if (task.count !== 1) return true
    taskCancelled = true
    await tx.printTaskStatusLog.create({
      data: {
        taskId: order.printTaskId,
        fromStatus: 'pending',
        toStatus: 'cancelled',
        errorCode: TERMINAL_NOT_CHARGING_TASK_ERROR_CODE,
      },
    })
  }

  const closed = await tx.order.updateMany({
    where: {
      id: order.id,
      payStatus: 'unpaid',
      taskStatus: { notIn: [...BUSY_TASK_STATUSES] },
      paymentAttempts: { none: { status: { in: [...LIVE_ATTEMPT_STATUSES] } } },
    },
    data: {
      payStatus: 'closed',
      ...(taskCancelled ? { taskStatus: 'cancelled' } : {}),
      // 与超时关单同口径：认领后未付被关单，pickupStatus 不得停在 claimed。
      ...(order.pickupStatus === 'claimed' ? { pickupStatus: 'pending' } : {}),
    },
  })
  // 订单刚被别的请求改走：整段回滚（含上面的任务取消），按出码互斥口径拒绝。
  if (closed.count !== 1) throw new BadRequestException('PAYMENT_ATTEMPT_PENDING')

  await tx.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'system',
      action: TERMINAL_NOT_CHARGING_CLOSE_ACTION,
      targetType: 'order',
      targetId: order.id,
      payloadJson: JSON.stringify({
        orderNo: order.orderNo,
        terminalId: order.terminalId,
        reason,
        amountCents: order.amountCents,
        printTaskId: order.printTaskId,
        taskCancelled,
      }),
    },
  })
  return true
}
