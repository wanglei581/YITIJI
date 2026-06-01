import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { JobSyncService } from './job-sync.service'

/**
 * Cron scheduler: every 30 minutes, find all enabled API sources whose
 * syncFreq threshold has elapsed, and enqueue them.
 *
 * Works whether or not Redis is available:
 *   - With Redis: enqueues to BullMQ (dedup by jobId)
 *   - Without Redis: JobSyncService.enqueue() runs inline via setImmediate
 */
@Injectable()
export class JobSyncScheduler {
  private readonly logger = new Logger(JobSyncScheduler.name)

  constructor(private readonly service: JobSyncService) {}

  @Cron('0 */30 * * * *', { name: 'job-sync-scheduler' })
  async scheduleDueSources(): Promise<void> {
    try {
      const count = await this.service.enqueueDueSources()
      this.logger.debug(`Scheduler tick: enqueued ${count} source(s)`)
    } catch (e) {
      this.logger.error(`Scheduler error: ${(e as Error).message}`)
    }
  }
}
