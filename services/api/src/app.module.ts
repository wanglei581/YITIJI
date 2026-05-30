import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AiModule } from './ai/ai.module'
import { AuthModule } from './auth/auth.module'
import { JobsModule } from './jobs/jobs.module'
import { TerminalsModule } from './terminals/terminals.module'
import { PrismaModule } from './prisma/prisma.module'
import { RequestIdMiddleware } from './common/middleware/request-id.middleware'

@Module({
  imports: [
    // Throttler:防字典爆破。默认全局每 IP 每分钟 60 次,
    // /auth/login 单独用更严格的 5 次/60 秒(见 auth.controller)。
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 60 },
    ]),
    PrismaModule,
    AuthModule,
    AiModule,
    JobsModule,
    TerminalsModule,
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
