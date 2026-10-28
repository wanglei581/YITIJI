import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { AuthModule } from '../auth/auth.module'
import { PrismaModule } from '../prisma/prisma.module'
import { RedisModule } from '../common/redis/redis.module'
import { LicenseAdminController } from './license.admin.controller'
import { LicensePartnerController } from './license.partner.controller'
import { LicenseService } from './license.service'
import { LicenseExpiryAlertService } from './license-expiry-alert.service'
import { PartnerLicenseWriteInterceptor } from './partner-license-write.interceptor'

/**
 * 软件使用授权：管理员增改续期暂停恢复吊销、机构只读视图、到期告警、
 * 以及全局拦截器——授权不可用的机构，其合作机构后台的写操作被拒（见 partner-write-policy.ts）。
 * 另外两个管控点不在这里：终端会话签发（terminals/terminal-session.service.ts）与
 * 绑定终端台数（terminals/terminal-org-assignment.ts、terminals-admin.service.ts），
 * 它们直接调用 license-gate.ts，不依赖本模块。
 */
@Module({
  imports: [PrismaModule, AuthModule, RedisModule],
  controllers: [LicenseAdminController, LicensePartnerController],
  providers: [
    LicenseService,
    LicenseExpiryAlertService,
    PartnerLicenseWriteInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: PartnerLicenseWriteInterceptor },
  ],
  exports: [LicenseService],
})
export class LicenseModule {}
