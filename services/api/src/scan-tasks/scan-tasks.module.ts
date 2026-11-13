import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { FilesModule } from '../files/files.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { ServiceOrderModule } from '../payment/service-order.module'
import { ScanDeviceController } from './scan-device.controller'
import { ScanDeviceSessionsService } from './scan-device-sessions.service'
import { ScanTaskReaperTask } from './scan-task-reaper.task'
import { ScanTasksController } from './scan-tasks.controller'
import { ScanTasksService } from './scan-tasks.service'

@Module({
  imports: [FilesModule, JwtVerifierModule, TerminalsModule, ServiceOrderModule],
  controllers: [ScanTasksController, ScanDeviceController],
  providers: [ScanTasksService, ScanTaskReaperTask, ScanDeviceSessionsService],
  exports: [ScanTasksService],
})
export class ScanTasksModule {}
