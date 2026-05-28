import { Module } from '@nestjs/common'
import { AiModule } from './ai/ai.module'
import { JobsModule } from './jobs/jobs.module'
import { TerminalsModule } from './terminals/terminals.module'
import { PrismaModule } from './prisma/prisma.module'

@Module({
  imports: [PrismaModule, AiModule, JobsModule, TerminalsModule],
})
export class AppModule {}
