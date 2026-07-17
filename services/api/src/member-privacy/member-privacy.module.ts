import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { AuthModule } from '../auth/auth.module'
import { FilesModule } from '../files/files.module'
import { MemberAuthModule } from '../member-auth/member-auth.module'
import { AdminMemberPrivacyController } from './admin-member-privacy.controller'
import { MemberDataExportDownloadService } from './member-data-export-download.service'
import { MemberDataExportReconcilerService } from './member-data-export-reconciler.service'
import { MemberDataExportController } from './member-data-export.controller'
import { MemberDataExportMapper } from './member-data-export.mapper'
import { MemberDataExportService } from './member-data-export.service'
import { MemberDataRequestService } from './member-data-request.service'
import { MemberDataRequestController, MemberPrivacyController } from './member-privacy.controller'
import {
  MEMBER_EXPORT_RECONCILE_HANDLER,
  MemberPrivacyProcessor,
} from './member-privacy.processor'
import { MEMBER_PRIVACY_QUEUE } from './member-privacy.queue'
import { MemberPrivacyScheduler } from './member-privacy.scheduler'
import { MemberPrivacyService } from './member-privacy.service'

const redisUrl = process.env['REDIS_URL']

@Module({
  imports: [
    AuthModule,
    MemberAuthModule,
    FilesModule,
    ...(redisUrl ? [BullModule.registerQueue({ name: MEMBER_PRIVACY_QUEUE })] : []),
  ],
  controllers: [
    MemberPrivacyController,
    MemberDataRequestController,
    AdminMemberPrivacyController,
    MemberDataExportController,
  ],
  providers: [
    MemberPrivacyService,
    MemberDataRequestService,
    MemberDataExportMapper,
    MemberDataExportService,
    MemberDataExportDownloadService,
    MemberDataExportReconcilerService,
    MemberPrivacyScheduler,
    { provide: MEMBER_EXPORT_RECONCILE_HANDLER, useExisting: MemberDataExportReconcilerService },
    ...(redisUrl ? [MemberPrivacyProcessor] : []),
  ],
  exports: [MemberPrivacyService, MemberDataRequestService],
})
export class MemberPrivacyModule {}
