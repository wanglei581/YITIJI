import { Module } from '@nestjs/common'
import { JobsService } from './jobs.service'
import { JobsKioskService } from './jobs-kiosk.service'
import { JobsAdminService } from './jobs-admin.service'
import { JobsPartnerService } from './jobs-partner.service'
import { JobsExcelService } from './jobs-excel.service'
import { JobsController } from './jobs.controller'
import { AdminFairsService } from './admin-fairs.service'
import { AdminFairsController } from './admin-fairs.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { JobQualityService } from '../job-ai/job-quality.service'
import { FilesModule } from '../files/files.module'
import { FairMaterialPrintBridgeService } from './fair-material-print-bridge.service'
import { FairMaterialPrintBridgeCleanupTask } from './fair-material-print-bridge.cleanup.task'
import { FairCompanyZoneService } from './fair-company-zone.service'
import { FairMaterialService } from './fair-material.service'
import { FairVenueGuideService } from './fair-venue-guide.service'

@Module({
  // PrismaModule:供 importJobs 访问 prisma.job / prisma.organization
  // AuthModule:导出 JwtAuthGuard / RolesGuard,partner 导入接口要用
  // StorageService 为 @Global 模块导出,AdminFairsService 直接注入(活动资料落地)
  // N5/N6: AdminFairsService 拆为门面 + 3 个内部子服务(不对外 export)
  // N1: JobsService 拆为门面 + 4 个业务域子服务
  imports:     [PrismaModule, AuthModule, FilesModule],
  providers:   [
    // N1 子服务（不对外 export，仅供 JobsService 门面注入）
    JobsKioskService,
    JobsAdminService,
    JobsPartnerService,
    JobsExcelService,
    // 门面（对外 export，保持现有 controller / sync 注入路径）
    JobsService,
    FairCompanyZoneService,
    FairMaterialService,
    FairVenueGuideService,
    AdminFairsService,
    JobQualityService,
    FairMaterialPrintBridgeService,
    FairMaterialPrintBridgeCleanupTask,
  ],
  controllers: [JobsController, AdminFairsController],
  exports:     [JobsService, AdminFairsService],
})
export class JobsModule {}
