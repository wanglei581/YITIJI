import { Module } from '@nestjs/common'
import { AiModule } from './ai/ai.module'
import { JobsModule } from './jobs/jobs.module'

@Module({
  imports: [AiModule, JobsModule],
})
export class AppModule {}
