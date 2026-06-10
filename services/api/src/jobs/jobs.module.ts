import { Module } from '@nestjs/common'
import { JobsService } from './jobs.service'
import { JobsController } from './jobs.controller'
import { AdminFairsService } from './admin-fairs.service'
import { AdminFairsController } from './admin-fairs.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  // PrismaModule:供 importJobs 访问 prisma.job / prisma.organization
  // AuthModule:导出 JwtAuthGuard / RolesGuard,partner 导入接口要用
  // StorageService 为 @Global 模块导出,AdminFairsService 直接注入(活动资料落地)
  imports:     [PrismaModule, AuthModule],
  providers:   [JobsService, AdminFairsService],
  controllers: [JobsController, AdminFairsController],
  exports:     [JobsService, AdminFairsService],
})
export class JobsModule {}
