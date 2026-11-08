import { Module } from '@nestjs/common'
import { PoliciesService } from './policies.service'
import { PolicyEligibilityService } from './policy-eligibility.service'
import { PoliciesController } from './policies.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { PolicyScopeService } from './policy-scope.service'
import { FilesModule } from '../files/files.module'
import { PolicyChecklistService } from './policy-checklist.service'
import { PolicyChecklistController } from './policy-checklist.controller'

@Module({
  // AuthModule:导出 JwtAuthGuard / RolesGuard;AuditService 为 @Global 直接注入
  imports:     [PrismaModule, AuthModule, TerminalsModule, FilesModule],
  providers:   [PoliciesService, PolicyEligibilityService, PolicyScopeService, PolicyChecklistService],
  controllers: [PoliciesController, PolicyChecklistController],
  exports:     [PoliciesService, PolicyEligibilityService, PolicyScopeService],
})
export class PoliciesModule {}
