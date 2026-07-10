import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { OnlinePaymentService } from './online-payment.service'

/**
 * 付款码自动收敛：被扫支付没有独立回调时，不能依赖 Kiosk 页面持续打开来查单。
 * 只扫描真实通道且无屏上二维码的 pending/expired 尝试，业务入账仍复用 OnlinePaymentService。
 */
@Injectable()
export class CodePaymentConvergenceTask {
  private readonly logger = new Logger(CodePaymentConvergenceTask.name)
  private running = false

  constructor(private readonly payments: OnlinePaymentService) {}

  private enabled(): boolean {
    return process.env['PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED'] === 'true'
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handle(): Promise<void> {
    if (!this.enabled() || this.running) return
    this.running = true
    try {
      const result = await this.payments.convergeStaleCodePayments({ limit: 100 })
      if (result.scanned > 0) {
        this.logger.log(
          `code-payment auto-converge: scanned=${result.scanned} paid=${result.paid} released=${result.released} pending=${result.stillPending} skipped=${result.skipped} failed=${result.failed}`,
        )
      }
    } catch (error) {
      this.logger.error(`code-payment auto-converge failed: ${(error as Error).message}`)
    } finally {
      this.running = false
    }
  }
}
