import crypto from 'crypto'
import { ConflictException } from '@nestjs/common'
import { signFileUrl } from '../files/signing'

const CLAIM_FILE_URL_TTL_MS = 30 * 60 * 1000

/** Keeps the package-only task chain out of the Agent lifecycle service. */
export class PackageOrderFulfillmentService {
  // The caller owns the PrintTask status CAS and passes its open transaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async advance(tx: any, input: { orderId: string; taskId: string; terminalId: string; endUserId: string | null; status: string }): Promise<void> {
    const item = await tx.orderItem.findFirst({ where: { orderId: input.orderId, printTaskId: input.taskId } })
    if (!item) throw new ConflictException({ error: { code: 'PACKAGE_ITEM_NOT_FOUND', message: '材料包行不存在' } })

    await tx.orderItem.updateMany({
      where: { id: item.id, printTaskId: input.taskId, status: { not: 'completed' } },
      data: { status: input.status },
    })

    if (input.status !== 'completed') {
      // A failed/cancelled current item stops the package. Later items retain no task.
      await tx.order.updateMany({
        where: { id: input.orderId, printTaskId: input.taskId },
        data: { taskStatus: input.status, terminalId: input.terminalId },
      })
      return
    }

    const next = await tx.orderItem.findFirst({
      where: { orderId: input.orderId, seq: item.seq + 1, status: 'pending', printTaskId: null },
    })
    if (!next) {
      await tx.order.updateMany({
        where: { id: input.orderId, printTaskId: input.taskId },
        data: { taskStatus: 'completed', terminalId: input.terminalId },
      })
      return
    }

    const file = await tx.fileObject.findUnique({ where: { id: next.fileId }, select: { sha256: true } })
    const nextTaskId = `ptask_package_${crypto.randomBytes(8).toString('hex')}`
    await tx.printTask.create({
      data: {
        id: nextTaskId,
        terminalId: input.terminalId,
        endUserId: input.endUserId,
        fileUrl: signFileUrl(next.fileId, CLAIM_FILE_URL_TTL_MS).url,
        fileId: next.fileId,
        fileMd5: file?.sha256 ?? '',
        paramsJson: JSON.stringify({
          copies: next.copies,
          colorMode: next.colorMode,
          duplex: next.duplex,
          paperSize: 'A4',
          orientation: 'auto',
          quality: 'standard',
          scale: 'fit',
          pagesPerSheet: 1,
          ...(next.pageRange ? { pageRange: next.pageRange } : {}),
        }),
        status: 'pending',
        orderId: input.orderId,
      },
    })
    const nextUpdate = await tx.orderItem.updateMany({
      where: { id: next.id, status: 'pending', printTaskId: null },
      data: { printTaskId: nextTaskId },
    })
    if (nextUpdate.count !== 1) {
      throw new ConflictException({ error: { code: 'PACKAGE_NEXT_ITEM_CONFLICT', message: '材料包下一行已变更' } })
    }
    await tx.order.updateMany({
      where: { id: input.orderId, printTaskId: input.taskId },
      data: { printTaskId: nextTaskId, taskStatus: 'pending', terminalId: input.terminalId },
    })
  }
}
