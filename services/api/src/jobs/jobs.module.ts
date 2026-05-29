import { Module } from '@nestjs/common'
import { JobsService } from './jobs.service'
import { JobsController } from './jobs.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  // PrismaModule:供 importJobs 访问 prisma.job / prisma.organization
  // AuthModule:导出 JwtAuthGuard / RolesGuard,partner 导入接口要用
  imports:     [PrismaModule, AuthModule],
  providers:   [JobsService],
  controllers: [JobsController],
  exports:     [JobsService],
})
export class JobsModule {}
