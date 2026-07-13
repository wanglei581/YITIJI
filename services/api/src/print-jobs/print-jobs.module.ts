import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { PaymentModule } from '../payment/payment.module'
import { StorageModule } from '../storage/storage.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { FilesModule } from '../files/files.module'
import { PrintJobsController } from './print-jobs.controller'
import { PrintJobsService } from './print-jobs.service'
import { PrintPageCountService } from './print-page-count.service'

@Module({
  imports: [
    JwtVerifierModule,
    StorageModule,
    PaymentModule,
    TerminalsModule,
    FilesModule,
  ],
  controllers: [PrintJobsController],
  providers:   [PrintJobsService, PrintPageCountService],
  exports:     [PrintPageCountService],
})
export class PrintJobsModule {}
