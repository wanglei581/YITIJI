import { Module } from '@nestjs/common'
import { LegalController } from './legal.controller'
import { LegalService } from './legal.service'
import { AdminLegalDocsController } from './admin-legal-docs.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [LegalController, AdminLegalDocsController],
  providers: [LegalService],
})
export class LegalModule {}
