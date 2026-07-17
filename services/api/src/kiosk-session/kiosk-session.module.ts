import { Module } from '@nestjs/common'
import { KioskSessionController } from './kiosk-session.controller'
import { KioskSessionService } from './kiosk-session.service'

@Module({
  controllers: [KioskSessionController],
  providers: [KioskSessionService],
})
export class KioskSessionModule {}
