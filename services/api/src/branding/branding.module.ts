import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PrismaModule } from '../prisma/prisma.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { BrandLogoService } from './brand-logo.service'
import { BrandingAdminController } from './branding.admin.controller'
import { BrandingPublicController } from './branding.public.controller'
import { BrandingService } from './branding.service'
import { KioskProfileService } from './kiosk-profile.service'

/**
 * 贴牌：平台默认品牌与备案、机构覆盖的解析、Logo 上传与公开读取、一体机 kiosk-profile。
 * 存储用全局的 StorageModule，审计用全局的 AuditModule。
 */
@Module({
  imports: [PrismaModule, AuthModule, TerminalsModule],
  controllers: [BrandingPublicController, BrandingAdminController],
  providers: [BrandLogoService, BrandingService, KioskProfileService],
  exports: [BrandingService, BrandLogoService],
})
export class BrandingModule {}
