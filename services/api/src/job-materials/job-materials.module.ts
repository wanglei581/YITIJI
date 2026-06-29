import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { FilesModule } from '../files/files.module'
import { JobMaterialPdfService } from './job-material-pdf.service'
import { AdminJobMaterialsController, JobMaterialsController } from './job-materials.controller'
import { JobMaterialsService } from './job-materials.service'

@Module({
  imports: [FilesModule, JwtVerifierModule],
  controllers: [JobMaterialsController, AdminJobMaterialsController],
  providers: [
    JobMaterialsService,
    JobMaterialPdfService,
    EndUserAuthGuard,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [JobMaterialsService],
})
export class JobMaterialsModule {}
