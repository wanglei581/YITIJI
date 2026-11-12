import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AdminPrintQueueTimeoutController } from './print-queue-timeout.controller'

@Module({
  imports: [AuthModule],
  controllers: [AdminPrintQueueTimeoutController],
})
export class PrintQueueTimeoutModule {}
