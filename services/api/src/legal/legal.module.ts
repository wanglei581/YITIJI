import { Module } from '@nestjs/common'
import { LegalController } from './legal.controller'
import { LegalService } from './legal.service'
import { AdminLegalDocsController } from './admin-legal-docs.controller'

@Module({
  controllers: [LegalController, AdminLegalDocsController],
  providers: [LegalService],
})
export class LegalModule {}
