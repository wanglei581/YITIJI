import { Module } from '@nestjs/common'
import { AdminAlertActionsService } from './admin-alert-actions.service'
import { AdminOpsService } from './admin-ops.service'
import { AdminOpsController } from './admin-ops.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { AdminAlertPushService } from './admin-alert-push.service'
import { OrgDeviceAlertWebhookService } from './org-device-alert-webhook.service'
import { AdminDeviceAlertNotifyController, PartnerDeviceAlertNotifyController } from './org-device-alert-notify.controller'

@Module({
  imports:     [PrismaModule, AuthModule],
  providers:   [AdminOpsService, AdminAlertActionsService, AdminAlertPushService, OrgDeviceAlertWebhookService],
  controllers: [AdminOpsController, PartnerDeviceAlertNotifyController, AdminDeviceAlertNotifyController],
  exports:     [AdminOpsService],
})
export class AdminOpsModule {}
