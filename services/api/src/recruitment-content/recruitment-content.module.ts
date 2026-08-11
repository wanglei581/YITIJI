import { Module } from '@nestjs/common'
import { AuditModule } from '../audit/audit.module'
import { AuthModule } from '../auth/auth.module'
import { FilesModule } from '../files/files.module'
import { PrismaModule } from '../prisma/prisma.module'
import { AdminRecruitmentContentController } from './admin-recruitment-content.controller'
import { RecruitmentContentReadService } from './recruitment-content-read.service'

@Module({
  imports: [PrismaModule, AuthModule, AuditModule, FilesModule],
  controllers: [AdminRecruitmentContentController],
  providers: [RecruitmentContentReadService],
  exports: [RecruitmentContentReadService],
})
export class RecruitmentContentModule {}
