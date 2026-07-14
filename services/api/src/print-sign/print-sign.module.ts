import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { FilesModule } from '../files/files.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { PrintSignController } from './print-sign.controller'
import { PrintSignService } from './print-sign.service'

@Module({
  imports: [FilesModule, JwtVerifierModule, TerminalsModule],
  controllers: [PrintSignController],
  providers: [PrintSignService],
})
export class PrintSignModule {}
