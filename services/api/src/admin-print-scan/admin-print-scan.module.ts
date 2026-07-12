import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PrismaModule } from '../prisma/prisma.module'
import { AdminPrintScanController } from './admin-print-scan.controller'
import { AdminPrintScanService } from './admin-print-scan.service'

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [AdminPrintScanService],
  controllers: [AdminPrintScanController],
  exports: [AdminPrintScanService],
})
export class AdminPrintScanModule {}
