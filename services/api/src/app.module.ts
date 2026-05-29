import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { AiModule } from './ai/ai.module'
import { AuthModule } from './auth/auth.module'
import { JobsModule } from './jobs/jobs.module'
import { TerminalsModule } from './terminals/terminals.module'
import { PrismaModule } from './prisma/prisma.module'
import { RequestIdMiddleware } from './common/middleware/request-id.middleware'

@Module({
  imports: [PrismaModule, AuthModule, AiModule, JobsModule, TerminalsModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // path-to-regexp v6+ 需要命名参数表达通配。
    // '*path' = 匹配任意路径并捕获到 params.path,
    // 等价于以前的裸 '*',且不再触发 LegacyRouteConverter 警告。
    consumer.apply(RequestIdMiddleware).forRoutes('*path')
  }
}
