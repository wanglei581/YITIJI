import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { OrderQuoteController } from '../payment/order-quote.controller'
import { OrderQuoteService } from '../payment/order-quote.service'
import { PaymentModule } from '../payment/payment.module'
import { StorageModule } from '../storage/storage.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { AuditModule } from '../audit/audit.module'
import { PrintJobsController } from './print-jobs.controller'
import { AdminPrintJobsController } from './admin-print-jobs.controller'
import { PrintJobsService } from './print-jobs.service'
import { PrintPageCountService } from './print-page-count.service'
import { AdminPrintJobsAbandonService } from './admin-print-jobs-abandon.service'
import { AdminPrintJobsVerifyOutcomeService } from './admin-print-jobs-verify-outcome.service'
import { PickupOrderService } from './pickup-order.service'

/**
 * 打印任务 + 报价预览。
 * OrderQuoteController（POST /orders/quote）挂在此模块：需要 PrintPageCountService，
 * 且 PaymentModule 已导入 PricingService；放在 PaymentModule 会与 PrintJobsModule 形成循环依赖。
 */
@Module({
  imports: [
    JwtVerifierModule,
    StorageModule,
    PaymentModule,
    TerminalsModule,
    AuditModule,
  ],
  controllers: [PrintJobsController, AdminPrintJobsController, OrderQuoteController],
  providers:   [PrintJobsService, PrintPageCountService, AdminPrintJobsAbandonService, AdminPrintJobsVerifyOutcomeService, OrderQuoteService, PickupOrderService],
  exports:     [PrintPageCountService, OrderQuoteService],
})
export class PrintJobsModule {}
