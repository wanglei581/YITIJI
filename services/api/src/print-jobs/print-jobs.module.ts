import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { PrintJobsController } from './print-jobs.controller'
import { PrintJobsService } from './print-jobs.service'

@Module({
  imports: [
    JwtVerifierModule,
  ],
  controllers: [PrintJobsController],
  providers:   [PrintJobsService],
})
export class PrintJobsModule {}
