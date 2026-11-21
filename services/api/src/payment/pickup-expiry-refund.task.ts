import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PickupExpiryRefundService } from './pickup-expiry-refund.service'

/**
 * 付款满 7 天仍未取件的小程序云打印单，自动整单退。
 * 门控与退款收敛任务同一写法：`PICKUP_EXPIRY_AUTO_REFUND_ENABLED=true` 才跑。
 * 资金动作只在 PickupExpiryRefundService → RefundService。
 */
@Injectable()
export class PickupExpiryRefundTask {
  private readonly logger = new Logger(PickupExpiryRefundTask.name)
  private running = false

  constructor(private readonly sweep: PickupExpiryRefundService) {}

  private enabled(): boolean {
    return process.env['PICKUP_EXPIRY_AUTO_REFUND_ENABLED'] === 'true'
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handle(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      if (this.enabled()) {
        const result = await this.sweep.sweep({ limit: 50 })
        if (result.scanned > 0) {
          this.logger.log(
            `pickup expiry auto-refund: scanned=${result.scanned} refunded=${result.refunded} idempotent=${result.idempotent} skipped=${result.skipped} failed=${result.failed}`,
          )
        }
        return
      }
      // 开关默认关着。关着也不许没去向：窗口关闭、没出纸的已付单进待人工。
      const parked = await this.sweep.parkClosedWindowWhenAutoRefundOff({ limit: 50 })
      if (parked.parked > 0) {
        this.logger.log(`pickup window closed without auto-refund: parked=${parked.parked} skipped=${parked.skipped}`)
      }
    } catch (error) {
      this.logger.error(`pickup expiry auto-refund failed: ${(error as Error).message}`)
    } finally {
      this.running = false
    }
  }
}
