import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'
import { PrismaModule } from '../prisma/prisma.module'
import { RedisModule } from '../common/redis/redis.module'
import { AiAccessGuard } from './ai-access.guard'
import { AiAccessService } from './ai-access.service'
import { AdminAiAccessController } from './admin-ai-access.controller'
@Module({ imports: [AuthModule, AuditModule, PrismaModule, RedisModule], controllers: [AdminAiAccessController], providers: [Reflector, AiAccessService, AiAccessGuard], exports: [AiAccessService, AiAccessGuard] })
export class AiAccessModule {}
