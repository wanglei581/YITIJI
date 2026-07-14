import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { FilesModule } from '../files/files.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { ScanTaskReaperTask } from './scan-task-reaper.task'
import { ScanTasksController } from './scan-tasks.controller'
import { ScanTasksService } from './scan-tasks.service'

@Module({
  imports: [FilesModule, JwtVerifierModule, TerminalsModule],
  controllers: [ScanTasksController],
  providers: [ScanTasksService, ScanTaskReaperTask],
  exports: [ScanTasksService],
})
export class ScanTasksModule {}
