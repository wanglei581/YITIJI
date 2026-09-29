import { BadRequestException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { PICKUP_VALIDITY_FROM_PAYMENT_MS } from './pickup-validity'
import { RefundService } from './refund.service'

/** 自动整单退的稳定原因。refundNo 仍是 `RFD-<orderNo>`，重复跑命中同一笔。 */
export const PICKUP_EXPIRED_UNPICKED_REFUND_REASON = 'pickup_expired_unpicked'

const STARTED_OR_PRINTED = ['claimed', 'printing', 'completed'] as const

export interface PickupExpiryRefundSweepResult {
  scanned: number
  refunded: number
  idempotent: number
  skipped: number
  failed: number
}

/**
 * 小程序付款、一体机交付，付款满 7 天仍未取件：整单退。
 * 只调 RefundService。已核销、已挂打印任务、已开始打印或已出纸的不退。
 */
@Injectable()
export class PickupExpiryRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: RefundService,
    private readonly audit: AuditService,
  ) {}

  async sweep(opts: { now?: Date; limit?: number } = {}): Promise<PickupExpiryRefundSweepResult> {
    const now = opts.now ?? new Date()
    const deadline = new Date(now.getTime() - PICKUP_VALIDITY_FROM_PAYMENT_MS)
    const limit = opts.limit ?? 50
    const rows = await this.prisma.order.findMany({
      where: {
        channel: 'miniapp_cloud',
        payStatus: 'paid',
        paidAt: { lte: deadline },
        printTaskId: null,
        pickupStatus: { in: ['pending', 'expired'] },
        taskStatus: { notIn: ['claimed', 'printing', 'completed'] },
      },
      orderBy: { paidAt: 'asc' },
      take: limit,
      select: { id: true, orderNo: true },
    })

    const result: PickupExpiryRefundSweepResult = {
      scanned: rows.length,
      refunded: 0,
      idempotent: 0,
      skipped: 0,
      failed: 0,
    }

    for (const row of rows) {
      try {
        if (await this.hasStartedOrPrinted(row.id)) {
          result.skipped += 1
          await this.audit.write({
            actorId: null,
            actorRole: 'system',
            action: 'order.pickup_expired_auto_refund_skipped',
            targetType: 'order',
            targetId: row.id,
            payload: { reason: 'print_started_or_output' },
          })
          continue
        }
        const refunded = await this.refunds.refund(row.id, {
          reason: PICKUP_EXPIRED_UNPICKED_REFUND_REASON,
          operatorId: 'system:pickup-expiry',
          unreleasedOnly: true,
        })
        if (refunded.order.payStatus === 'refunded') {
          await this.prisma.order.updateMany({
            where: { id: row.id, payStatus: 'refunded', pickupStatus: { in: ['pending', 'expired'] } },
            data: { pickupStatus: 'expired', taskStatus: 'expired' },
          })
        }
        if (refunded.idempotent) result.idempotent += 1
        else result.refunded += 1
        await this.audit.write({
          actorId: null,
          actorRole: 'system',
          action: 'order.pickup_expired_auto_refund',
          targetType: 'order',
          targetId: row.id,
          payload: {
            refundNo: refunded.refund.refundNo,
            idempotent: refunded.idempotent,
            amountCents: refunded.refund.amountCents,
          },
        })
      } catch (error) {
        if (error instanceof BadRequestException) {
          result.skipped += 1
          await this.audit.write({
            actorId: null,
            actorRole: 'system',
            action: 'order.pickup_expired_auto_refund_skipped',
            targetType: 'order',
            targetId: row.id,
            payload: { reason: error.message },
          })
          continue
        }
        result.failed += 1
      }
    }
    return result
  }

  /** 材料包行或关联任务已经开始打印 / 已出纸。 */
  private async hasStartedOrPrinted(orderId: string): Promise<boolean> {
    const task = await this.prisma.printTask.findFirst({
      where: {
        orderId,
        OR: [
          { status: { in: [...STARTED_OR_PRINTED] } },
          { printOutcome: 'printed' },
        ],
      },
      select: { id: true },
    })
    if (task) return true
    const item = await this.prisma.orderItem.findFirst({
      where: {
        orderId,
        OR: [
          { printTaskId: { not: null } },
          { status: { in: ['claimed', 'printing', 'completed'] } },
        ],
      },
      select: { id: true },
    })
    return item != null
  }
}
