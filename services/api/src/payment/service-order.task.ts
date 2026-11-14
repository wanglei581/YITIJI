import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { describeBackgroundError, scheduleBackground } from '../common/process/background-task'
import { SERVICE_SWEEP_INTERVAL_MS } from './service-order.policy'
import { ServiceOrderService } from './service-order.service'

/** 未付过期、免费再试过期、退款重试、扫描有没有出文件。失败只记类型，下一拍再试。 */
@Injectable()
export class ServiceOrderTask implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServiceOrderTask.name)
  private timer?: NodeJS.Timeout

  constructor(private readonly orders: ServiceOrderService) {}

  onModuleInit(): void {
    this.timer = scheduleBackground(() => this.orders.sweep(), SERVICE_SWEEP_INTERVAL_MS, (error) => {
      this.logger.warn(`service order sweep failed ${describeBackgroundError(error)}`)
    })
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
