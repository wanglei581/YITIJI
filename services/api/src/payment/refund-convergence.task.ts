import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { RefundService } from './refund.service'

/**
 * 退款自动收敛调度（W-C part2b-1；关闭 W-B codex M1 的运营卡单风险）。
 *
 * 背景：真实渠道退款受理中（wechat PROCESSING）或结果不可知（超时/5xx）时，Refund 停在
 * pending + 订单 refunding，W-B 只在「运营再次点退款」时收敛。本任务定时自动收敛，
 * 让此类单不依赖人工点击也能终态化。
 *
 * 安全：只调 RefundService.convergeStalePendingRefunds（与人工重复退款完全相同的幂等查证路径，
 * 渠道 out_refund_no/out_request_no 幂等，绝不二次出款）；本任务不含任何资金决策逻辑。
 *
 * 门控：`REFUND_AUTO_CONVERGE_ENABLED=true` 显式开启（默认关闭，避免在未接真实渠道的
 * 环境空跑；沙箱退款同步完成不会留 pending，开与不开都安全）。cron 由 AppModule 顶层
 * ScheduleModule.forRoot() 驱动。
 */
@Injectable()
export class RefundConvergenceTask {
  private readonly logger = new Logger(RefundConvergenceTask.name)

  constructor(private readonly refunds: RefundService) {}

  private enabled(): boolean {
    return process.env['REFUND_AUTO_CONVERGE_ENABLED'] === 'true'
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handle(): Promise<void> {
    if (!this.enabled()) return
    try {
      const r = await this.refunds.convergeStalePendingRefunds({ limit: 100 })
      if (r.scanned > 0) {
        this.logger.log(
          `refund auto-converge: scanned=${r.scanned} refunded=${r.refunded} stillPending=${r.stillPending} failed=${r.failed}`,
        )
      }
    } catch (err) {
      this.logger.error(`refund auto-converge failed: ${(err as Error).message}`)
    }
  }
}
