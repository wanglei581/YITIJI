import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { JobsModule } from '../jobs/jobs.module'
import { SyncController } from './sync.controller'
import { SyncService } from './sync.service'

/**
 * BE-8 Sync 模块(W3):企业数据源接入。
 *
 * 当前只实现 Webhook 接收端(C 方案)。后续 W3+ 可加:
 *   - JobSourceSyncWorker(BullMQ 定时拉取 API 模式)
 *   - Excel/CSV 字段映射引擎
 */
@Module({
  imports: [PrismaModule, JobsModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
