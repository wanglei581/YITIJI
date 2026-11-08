import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { CopyAgentController } from './copy-agent.controller'
import { CopyAgentService } from './copy-agent.service'
import { CopyJobsController } from './copy-jobs.controller'
import { CopyJobsService } from './copy-jobs.service'
import { CopyJobStore } from './copy-job-store.service'

@Module({
  imports: [JwtVerifierModule, TerminalsModule],
  controllers: [CopyJobsController, CopyAgentController],
  providers: [CopyJobsService, CopyAgentService, CopyJobStore],
})
export class CopyJobsModule {}
