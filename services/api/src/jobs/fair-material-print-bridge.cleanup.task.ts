import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { FairMaterialPrintBridgeService } from './fair-material-print-bridge.service'

@Injectable()
export class FairMaterialPrintBridgeCleanupTask {
  private readonly logger = new Logger(FairMaterialPrintBridgeCleanupTask.name)

  constructor(private readonly bridges: FairMaterialPrintBridgeService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly(): Promise<void> {
    try {
      const reclaimed = await this.bridges.cleanupStaleBridges()
      if (reclaimed > 0) this.logger.log(`Reclaimed ${reclaimed} fair material bridge files`)
    } catch (error) {
      this.logger.error(`Fair material bridge cleanup failed: ${(error as Error).message}`)
    }
  }
}
