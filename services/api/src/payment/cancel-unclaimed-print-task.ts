/**
 * 整单退成之后，把还没领走的打印任务取消。已出纸或已经领走的不动。
 */
import type { PrismaTransactionClient } from '../prisma/prisma.service'

export async function cancelUnclaimedPrintTasks(
  tx: PrismaTransactionClient,
  orderId: string,
): Promise<void> {
  await tx.printTask.updateMany({
    where: {
      orderId,
      status: 'pending',
      OR: [{ printOutcome: null }, { printOutcome: { not: 'printed' } }],
    },
    data: {
      status: 'cancelled',
      errorCode: 'REFUND_COMPLETED',
      errorMessage: '退款已经成功，不再出纸',
    },
  })
  await tx.order.updateMany({
    where: { id: orderId, taskStatus: 'pending' },
    data: { taskStatus: 'cancelled' },
  })
}
