import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PrismaModule } from '../prisma/prisma.module'
import { AdminFulfillmentListsController } from './admin-fulfillment-lists.controller'
import { AdminFulfillmentListsService } from './admin-fulfillment-lists'
import { AdminPrintScanController } from './admin-print-scan.controller'
import { AdminPrintScanService } from './admin-print-scan.service'

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [AdminPrintScanService, AdminFulfillmentListsService],
  controllers: [AdminPrintScanController, AdminFulfillmentListsController],
  exports: [AdminPrintScanService],
})
export class AdminPrintScanModule {}
