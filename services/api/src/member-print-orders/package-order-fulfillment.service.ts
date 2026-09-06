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

    // 防御性幂等：这一行已经是 completed 就不再派发后续任务。
    // 说明白它的实际地位，免得下一个人以为重放靠它挡住：真正挡住重放的是上游
    // `terminals-agent.service.ts:540` —— 任务已是终态且上报同一终态时直接幂等返回，
    // 根本进不到这里；下面每处 order.updateMany 还带 `printTaskId: input.taskId` 指针守卫。
    // 这行是第三层，删掉它现有门禁不会转红（已做变异验证）。
    // （Antigravity 第 17 轮复审阻塞项 3：其「误判整单完成」的后果核实后不成立。）
    if (item.status === 'completed') return

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
    // 这里必须断言命中 1 行：新 PrintTask 已经建出来、下一行也已绑定，
    // 若 Order 指针此刻已被并发（取消 / 退款 / 关单）改走而静默不更新，
    // 就会留下一条 Agent 能领、但订单已不认的任务 —— 直接回滚整个事务。
    // （Antigravity 第 17 轮复审阻塞项 2）
    const orderUpdate = await tx.order.updateMany({
      where: { id: input.orderId, printTaskId: input.taskId },
      data: { printTaskId: nextTaskId, taskStatus: 'pending', terminalId: input.terminalId },
    })
    if (orderUpdate.count !== 1) {
      throw new ConflictException({ error: { code: 'PACKAGE_ORDER_POINTER_CONFLICT', message: '材料包订单当前任务指针已变更' } })
    }
  }
}
