/**
 * 排队超时已经把任务判成失败之后，结算本身又抛了意外。
 * 不能吞掉。记下原因并推进待人工，这一单仍能在后台看到。
 */
import type { PrismaService } from '../prisma/prisma.service'
import { notifyPrintReturnHold } from './print-return-alert'
import { PRINT_NO_PAPER_MANUAL_AUDIT } from './print-return-disposition'

function faultDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : '结算没有完成'
  const sliced = raw.replace(/\s+/g, ' ').slice(0, 120)
  return `排队超时后的结算没有完成：${sliced}`
}

export async function recordTimeoutSettlementFault(
  db: PrismaService,
  taskId: string,
  error: unknown,
): Promise<void> {
  const order = await db.order.findFirst({
    where: { printTaskId: taskId },
    select: { id: true },
  })
  if (!order) return
  await db.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'system',
      action: PRINT_NO_PAPER_MANUAL_AUDIT,
      targetType: 'order',
      targetId: order.id,
      payloadJson: JSON.stringify({ detail: faultDetail(error), taskId }),
    },
  })
  await notifyPrintReturnHold(db, order.id)
}
