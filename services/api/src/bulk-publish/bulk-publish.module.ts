import { Module } from '@nestjs/common'
import { BulkPublishService } from './bulk-publish.service'
import { BulkPublishController } from './bulk-publish.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { JobsModule } from '../jobs/jobs.module'
import { PoliciesModule } from '../policies/policies.module'

@Module({
  // JobsModule / PoliciesModule:注入已导出的门面服务,
  // 批量发布复用它们的单条发布方法,不自建第二条写路径。
  // PrismaModule:仅供 preview 只读统计与标题预取。
  imports: [PrismaModule, AuthModule, JobsModule, PoliciesModule],
  providers: [BulkPublishService],
  controllers: [BulkPublishController],
  exports: [BulkPublishService],
})
export class BulkPublishModule {}
