import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { AuthModule } from '../auth/auth.module'
import { AdminRecruitmentHostingController } from './admin-recruitment-hosting.controller'
import { RecruitmentEmergencyService } from './recruitment-emergency.service'
import { RecruitmentEmergencyController } from './recruitment-emergency.controller'

@Module({
  imports: [PrismaModule, AuditModule, AuthModule],
  providers: [RecruitmentEmergencyService],
  controllers: [RecruitmentEmergencyController, AdminRecruitmentHostingController],
  exports: [RecruitmentEmergencyService],
})
export class RecruitmentHostingModule {}
