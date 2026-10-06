import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PrismaModule } from '../prisma/prisma.module'
import { SupportContactAdminController } from './support-contact.admin.controller'
import { SupportContactPublicController } from './support-contact.public.controller'
import { SupportContactService } from './support-contact.service'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SupportContactPublicController, SupportContactAdminController],
  providers: [SupportContactService],
})
export class SupportContactModule {}
