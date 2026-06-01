import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { PrismaModule } from '../prisma/prisma.module'
import { JOB_SYNC_QUEUE } from './job-sync.types'
import { JobSyncService } from './job-sync.service'
import { JobSyncScheduler } from './job-sync.scheduler'
import { JobSyncController } from './job-sync.controller'
import { JobSyncProcessor } from './job-sync.processor'

const redisUrl = process.env['REDIS_URL']

/**
 * JobSyncModule — W8 BullMQ API pull worker
 *
 * - 有 REDIS_URL：注册 BullMQ queue + processor，实现并发安全、持久化队列、自动重试。
 * - 无 REDIS_URL（开发模式）：跳过 BullMQ，scheduler 触发时 JobSyncService.enqueue()
 *   通过 setImmediate 直接在进程内执行，日志会提示"inline mode"。
 *
 * @Cron 调度器和 Admin trigger 端点在两种模式下都工作。
 */
@Module({
  imports: [
    PrismaModule,
    ...(redisUrl
      ? [BullModule.registerQueue({ name: JOB_SYNC_QUEUE })]
      : []),
  ],
  providers: [
    JobSyncService,
    JobSyncScheduler,
    ...(redisUrl ? [JobSyncProcessor] : []),
  ],
  controllers: [JobSyncController],
  exports: [JobSyncService],
})
export class JobSyncModule {}
