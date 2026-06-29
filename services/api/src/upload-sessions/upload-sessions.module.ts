import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { FilesModule } from '../files/files.module'
import { UploadSessionsController } from './upload-sessions.controller'
import { UploadSessionsService } from './upload-sessions.service'

@Module({
  imports: [FilesModule, JwtVerifierModule],
  controllers: [UploadSessionsController],
  providers: [UploadSessionsService],
  exports: [UploadSessionsService],
})
export class UploadSessionsModule {}
