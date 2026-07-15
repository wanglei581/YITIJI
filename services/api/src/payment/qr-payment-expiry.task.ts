import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { OnlinePaymentService } from './online-payment.service'

/**
 * 屏上动态二维码过期释放：不依赖 Kiosk 页面持续轮询。
 *
 * 对已到服务端 `expiresAt` 的二维码先查渠道账本，仍待支付时请求关单；只有渠道确认
 * closed / failed 才释放本地尝试。网络、验签或未知结果保持互斥锁，不伪造失败或退款。
 */
@Injectable()
export class QrPaymentExpiryTask {
  private readonly logger = new Logger(QrPaymentExpiryTask.name)
  private running = false

  constructor(private readonly payments: OnlinePaymentService) {}

  private enabled(): boolean {
    return process.env['PAYMENT_QR_EXPIRY_AUTO_RELEASE_ENABLED'] === 'true'
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handle(): Promise<void> {
    if (!this.enabled() || this.running) return
    this.running = true
    try {
      const result = await this.payments.releaseExpiredQrPayments({ limit: 100 })
      if (result.scanned > 0) {
        this.logger.log(
          `screen-qr expiry release: scanned=${result.scanned} released=${result.released} closed=${result.closed} skipped=${result.skipped} failed=${result.failed}`,
        )
      }
    } catch (error) {
      this.logger.error(`screen-qr expiry release failed: ${(error as Error).message}`)
    } finally {
      this.running = false
    }
  }
}
