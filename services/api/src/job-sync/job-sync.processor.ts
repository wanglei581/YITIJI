import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { JOB_SYNC_QUEUE, JOB_SYNC_JOB_NAME, type ApiSyncJobData, type SyncStats } from './job-sync.types'
import { JobSyncService } from './job-sync.service'

/**
 * BullMQ worker processor.
 * Activated only when REDIS_URL is set (JobSyncModule conditionally registers this).
 *
 * concurrency=1 per queue by default; BullMQ jobId dedup prevents a source
 * from being queued twice (non-manual runs use sourceId as jobId).
 */
@Processor(JOB_SYNC_QUEUE)
export class JobSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(JobSyncProcessor.name)

  constructor(private readonly service: JobSyncService) {
    super()
  }

  async process(job: Job<ApiSyncJobData>): Promise<SyncStats> {
    if (job.name !== JOB_SYNC_JOB_NAME) {
      this.logger.warn(`Unknown job name: ${job.name}`)
      return { added: 0, updated: 0, dup: 0, error: 0 }
    }
    this.logger.log(`Processing sourceId=${job.data.sourceId} manual=${job.data.manual} attempt=${job.attemptsMade + 1}`)
    return this.service.pullApiSource(job.data.sourceId)
  }
}
