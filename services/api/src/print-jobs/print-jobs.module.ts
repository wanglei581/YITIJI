import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { PaymentModule } from '../payment/payment.module'
import { StorageModule } from '../storage/storage.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { AuditModule } from '../audit/audit.module'
import { PrintJobsController } from './print-jobs.controller'
import { AdminPrintJobsController } from './admin-print-jobs.controller'
import { PrintJobsService } from './print-jobs.service'
import { PrintPageCountService } from './print-page-count.service'
import { AdminPrintJobsAbandonService } from './admin-print-jobs-abandon.service'

@Module({
  imports: [
    JwtVerifierModule,
    StorageModule,
    PaymentModule,
    TerminalsModule,
    AuditModule,
  ],
  controllers: [PrintJobsController, AdminPrintJobsController],
  providers:   [PrintJobsService, PrintPageCountService, AdminPrintJobsAbandonService],
  exports:     [PrintPageCountService],
})
export class PrintJobsModule {}
