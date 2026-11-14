import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { ServiceOrderModule } from '../payment/service-order.module'
import { KioskSessionController } from './kiosk-session.controller'
import { KioskSessionRetentionTask } from './kiosk-session-retention.task'
import { KioskSessionService } from './kiosk-session.service'

@Module({
  imports: [PrismaModule, TerminalsModule, ServiceOrderModule],
  controllers: [KioskSessionController],
  providers: [KioskSessionService, KioskSessionRetentionTask],
})
export class KioskSessionModule {}
