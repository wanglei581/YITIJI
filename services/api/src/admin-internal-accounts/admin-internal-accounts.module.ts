import { Module } from '@nestjs/common'
import { AuditModule } from '../audit/audit.module'
import { AuthModule } from '../auth/auth.module'
import { PrismaModule } from '../prisma/prisma.module'
import { AdminInternalAccountsController } from './admin-internal-accounts.controller'
import { AdminInternalAccountsService } from './admin-internal-accounts.service'
import { BackupAdminCreateService } from './backup-admin-create.service'

/** 内部账号名册 + 备用管理员（3.9）。Redis 服务来自全局 RedisModule；短信验证码服务来自 AuthModule。 */
@Module({
  imports: [PrismaModule, AuditModule, AuthModule],
  controllers: [AdminInternalAccountsController],
  providers: [AdminInternalAccountsService, BackupAdminCreateService],
})
export class AdminInternalAccountsModule {}
