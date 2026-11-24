import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { BrandingModule } from '../branding/branding.module'
import { PrismaModule } from '../prisma/prisma.module'
import { MiniappCodeController } from './miniapp-code.controller'
import { MiniappCodeService } from './miniapp-code.service'
import { MiniappOrgEntryController } from './miniapp-org-entry.controller'
import { MiniappOrgEntryService } from './miniapp-org-entry.service'

@Module({
  imports: [PrismaModule, AuthModule, BrandingModule],
  controllers: [MiniappCodeController, MiniappOrgEntryController],
  providers: [MiniappCodeService, MiniappOrgEntryService],
  exports: [MiniappCodeService, MiniappOrgEntryService],
})
export class MiniappCodeModule {}
