import { Module } from '@nestjs/common'
import { APP_GUARD, Reflector } from '@nestjs/core'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'
import { PrismaModule } from '../prisma/prisma.module'
import { RedisModule } from '../common/redis/redis.module'
import { AiAccessGuard } from './ai-access.guard'
import { AiAccessService } from './ai-access.service'
import { AdminAiAccessController } from './admin-ai-access.controller'
@Module({ imports: [AuthModule, AuditModule, PrismaModule, RedisModule], controllers: [AdminAiAccessController], providers: [
    Reflector,
    AiAccessService,
    AiAccessGuard,
    // 全局守卫：没有这一行，AiAccessGuard 只是一个没人调用的类，整套拦截在线上都不生效
    { provide: APP_GUARD, useExisting: AiAccessGuard },
  ], exports: [AiAccessService, AiAccessGuard] })
export class AiAccessModule {}
