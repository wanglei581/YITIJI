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
import { SyncModule } from './sync/sync.module'
import { TerminalsModule } from './terminals/terminals.module'
import { PrintJobsModule } from './print-jobs/print-jobs.module'
import { PrismaModule } from './prisma/prisma.module'
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
    // AuditModule 必须在 FilesModule / JobsModule 之前,
    // @Global() 让 AuditService 被任意业务模块自动注入。
    AuditModule,
    AuthModule,
    AiModule,
    FilesModule,
    JobsModule,
    JobSyncModule,
    SyncModule,
    TerminalsModule,
    PrintJobsModule,
  ],
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
