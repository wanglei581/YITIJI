import { Module } from '@nestjs/common'
import { CommunityController } from './community.controller'
import { CommunityService } from './community.service'
import { TerminalsModule } from '../terminals/terminals.module'
import { PolicyScopeService } from '../policies/policy-scope.service'

@Module({
  imports: [TerminalsModule],
  controllers: [CommunityController],
  providers: [CommunityService, PolicyScopeService],
})
export class CommunityModule {}
