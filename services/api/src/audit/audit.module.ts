import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditController } from './audit.controller'
import { AuditService } from './audit.service'

/**
 * BE-2 审计模块。
 *
 * **@Global()**:AuditService 被 FilesModule / JobsModule / Admin 各模块
 * 大量复用,设为全局 provider 避免每个业务模块单独 imports。
 *
 * 业务模块要写审计:
 *   constructor(private readonly audit: AuditService) {}
 * 直接注入即可,不需要在 Module imports 里写 AuditModule。
 */
@Global()
@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-secret',
    }),
  ],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
