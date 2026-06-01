import { Module } from '@nestjs/common'
import { PrintJobsController } from './print-jobs.controller'
import { PrintJobsService } from './print-jobs.service'

@Module({
  controllers: [PrintJobsController],
  providers:   [PrintJobsService],
})
export class PrintJobsModule {}
