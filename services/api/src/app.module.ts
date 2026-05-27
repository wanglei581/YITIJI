import { Module } from '@nestjs/common'
import { AiModule } from './ai/ai.module'
import { JobsModule } from './jobs/jobs.module'
import { TerminalsModule } from './terminals/terminals.module'

@Module({
  imports: [AiModule, JobsModule, TerminalsModule],
})
export class AppModule {}
