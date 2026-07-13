import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { FilesModule } from '../files/files.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { IdPhotoController } from './id-photo.controller'
import { IdPhotoService } from './id-photo.service'

@Module({
  imports: [FilesModule, JwtVerifierModule, TerminalsModule],
  controllers: [IdPhotoController],
  providers: [IdPhotoService],
})
export class IdPhotoModule {}
