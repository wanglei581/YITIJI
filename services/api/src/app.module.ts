import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { BullModule } from '@nestjs/bullmq'
import { AiModule } from './ai/ai.module'
import { AuditModule } from './audit/audit.module'
import { AuthModule } from './auth/auth.module'
import { FilesModule } from './files/files.module'
import { JobsModule } from './jobs/jobs.module'
import { JobSyncModule } from './job-sync/job-sync.module'
import { OrgsModule } from './orgs/orgs.module'
import { PoliciesModule } from './policies/policies.module'
import { AdminOpsModule } from './admin-ops/admin-ops.module'
import { AdminOrderActionsModule } from './payment/admin-order-actions.module'
import { AdminOrdersReadonlyModule } from './admin-orders-readonly/admin-orders-readonly.module'
import { AdminPrintScanModule } from './admin-print-scan/admin-print-scan.module'
import { MemberAuthModule } from './member-auth/member-auth.module'
import { HealthController } from './common/health.controller'
import { ActivityModule } from './activity/activity.module'
import { CompaniesModule } from './companies/companies.module'
import { MemberAssetsModule } from './member-assets/member-assets.module'
import { MockInterviewModule } from './mock-interview/mock-interview.module'
import { MemberFavoritesModule } from './member-favorites/member-favorites.module'
import { MemberBenefitsModule } from './member-benefits/member-benefits.module'
import { BenefitActivitiesModule } from './benefit-activities/benefit-activities.module'
import { MemberPrintOrdersModule } from './member-print-orders/member-print-orders.module'
import { MemberNotificationsModule } from './member-notifications/member-notifications.module'
import { MemberFeedbackModule } from './member-feedback/member-feedback.module'
import { MaterialsModule } from './materials/materials.module'
import { JobMaterialsModule } from './job-materials/job-materials.module'
import { JobAiModule } from './job-ai/job-ai.module'
import { MemberPrivacyModule } from './member-privacy/member-privacy.module'
import { RedisModule } from './common/redis/redis.module'
import { SyncModule } from './sync/sync.module'
import { TerminalsModule } from './terminals/terminals.module'
import { PrintJobsModule } from './print-jobs/print-jobs.module'
import { TrtcModule } from './trtc/trtc.module'
import { ContentModule } from './content/content.module'
import { StorageModule } from './storage/storage.module'
import { PrismaModule } from './prisma/prisma.module'
import { SmartCampusModule } from './smart-campus/smart-campus.module'
import { UploadSessionsModule } from './upload-sessions/upload-sessions.module'
import { ScanTasksModule } from './scan-tasks/scan-tasks.module'
import { PrintConversionModule } from './print-conversion/print-conversion.module'
import { PrintSignModule } from './print-sign/print-sign.module'
import { DeviceFleetModule } from './device-fleet/device-fleet.module'
import { OfflineAgenciesModule } from './offline-agencies/offline-agencies.module'
import { KioskSessionModule } from './kiosk-session/kiosk-session.module'
import { HelpModule } from './help/help.module'
import { LegalModule } from './legal/legal.module'
import { NotificationsModule } from './notifications/notifications.module'
import { ActivitiesModule } from './activities/activities.module'
import { ScreensaverModule } from './screensaver/screensaver.module'
import { RequestIdMiddleware } from './common/middleware/request-id.middleware'

function parseRedisConnection(url: string): { host: string; port: number; password?: string; db?: number } {
  const u = new URL(url)
  return {
    host: u.hostname || 'localhost',
    port: u.port ? parseInt(u.port, 10) : 6379,
    password: u.password || undefined,
    db: u.pathname && u.pathname.length > 1 ? parseInt(u.pathname.slice(1), 10) || 0 : 0,
  }
}

const redisUrl = process.env['REDIS_URL']

@Module({
  imports: [
    // Throttler:防字典爆破。默认全局每 IP 每分钟 60 次,
    // /auth/login 单独用更严格的 5 次/60 秒(见 auth.controller)。
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 60 },
    ]),
    // BE-1 文件清理 cron 依赖 ScheduleModule 在根模块初始化。
    ScheduleModule.forRoot(),
    // BullMQ root config：有 REDIS_URL 时注册，否则跳过（JobSyncModule 自行处理）。
    ...(redisUrl
      ? [BullModule.forRoot({ connection: parseRedisConnection(redisUrl) })]
      : []),
    PrismaModule,
    // StorageModule(@Global): COS / 本地对象存储,files / content / print 共用。
    StorageModule,
    // RedisModule(@Global): member-auth 会话/验证码/频控强依赖。
    RedisModule,
    // AuditModule 必须在 FilesModule / JobsModule 之前,
    // @Global() 让 AuditService 被任意业务模块自动注入。
    AuditModule,
    AuthModule,
    MemberAuthModule,
    ActivityModule,
    CompaniesModule,
    MemberAssetsModule,
    MockInterviewModule,
    MemberFavoritesModule,
    MemberBenefitsModule,
    BenefitActivitiesModule,
    MemberNotificationsModule,
    MemberFeedbackModule,
    MemberPrintOrdersModule,
    MaterialsModule,
    JobMaterialsModule,
    MemberPrivacyModule,
    JobAiModule,
    AiModule,
    FilesModule,
    JobsModule,
    JobSyncModule,
    OrgsModule,
    PoliciesModule,
    AdminOpsModule,
    AdminOrdersReadonlyModule,
    AdminPrintScanModule,
    AdminOrderActionsModule,
    SyncModule,
    TerminalsModule,
    PrintJobsModule,
    TrtcModule,
    ContentModule,
    SmartCampusModule,
    UploadSessionsModule,
    ScanTasksModule,
    PrintConversionModule,
    PrintSignModule,
    DeviceFleetModule,
    OfflineAgenciesModule,
    KioskSessionModule,
    HelpModule,
    LegalModule,
    NotificationsModule,
    ActivitiesModule,
    ScreensaverModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // path-to-regexp v6+ 需要命名参数表达通配。
    // '*path' = 匹配任意路径并捕获到 params.path,
    // 等价于以前的裸 '*',且不再触发 LegacyRouteConverter 警告。
    consumer.apply(RequestIdMiddleware).forRoutes('*path')
  }
}
