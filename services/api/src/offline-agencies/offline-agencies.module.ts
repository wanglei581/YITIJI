import { Module } from '@nestjs/common'
import { OfflineAgenciesController } from './offline-agencies.controller'
import { KioskOfflineJobsController } from './kiosk-offline-jobs.controller'
import { AdminOfflineAgenciesController } from './admin-offline-agencies.controller'
import { OfflineAgenciesService } from './offline-agencies.service'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    OfflineAgenciesController,
    KioskOfflineJobsController,
    AdminOfflineAgenciesController,
  ],
  providers: [OfflineAgenciesService],
  exports: [OfflineAgenciesService],
})
export class OfflineAgenciesModule {}
