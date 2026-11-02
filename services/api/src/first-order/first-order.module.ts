import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'
import { PrismaModule } from '../prisma/prisma.module'
import { FirstOrderAccessService } from './first-order-access.service'
import { FirstOrderProjectsService } from './first-order-projects.service'
import { FirstOrderReportsService } from './first-order-reports.service'
import { FirstOrderIncidentsService } from './first-order-incidents.service'
import { AdminFirstOrderController, PartnerFirstOrderController } from './first-order.controller'
import { AdminFirstOrderIncidentsController, PartnerFirstOrderIncidentsController } from './first-order-incidents.controller'

@Module({
  imports: [PrismaModule, AuthModule, AuditModule],
  providers: [FirstOrderAccessService, FirstOrderProjectsService, FirstOrderReportsService, FirstOrderIncidentsService],
  controllers: [AdminFirstOrderController, PartnerFirstOrderController, AdminFirstOrderIncidentsController, PartnerFirstOrderIncidentsController],
})
export class FirstOrderModule {}
