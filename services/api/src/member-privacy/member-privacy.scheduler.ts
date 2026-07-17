import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common'
import type { Queue } from 'bullmq'
import {
  MEMBER_EXPORT_RECONCILE_JOB,
  MEMBER_PRIVACY_QUEUE,
  type MemberExportReconcileJobData,
  type MemberPrivacyJobData,
} from './member-privacy.queue'

const RECONCILE_SCHEDULER_ID = 'member-export-reconcile-sweep-v1'

@Injectable()
export class MemberPrivacyScheduler implements OnModuleInit {
  private readonly logger = new Logger(MemberPrivacyScheduler.name)

  constructor(
    @Optional() @InjectQueue(MEMBER_PRIVACY_QUEUE)
    private readonly queue?: Queue<MemberPrivacyJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.queue) return
    const data: MemberExportReconcileJobData = { reason: 'periodic_sweep' }
    try {
      await this.queue.upsertJobScheduler(
        RECONCILE_SCHEDULER_ID,
        { every: 60_000 },
        {
          name: MEMBER_EXPORT_RECONCILE_JOB,
          data,
          opts: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: { age: 86_400 },
            removeOnFail: { age: 7 * 86_400 },
          },
        },
      )
    } catch (error) {
      this.logger.error(`Member export scheduler registration failed code=EXPORT_SCHEDULER_FAILED errorType=${safeErrorType(error)}`)
      throw new Error('MEMBER_EXPORT_SCHEDULER_UNAVAILABLE')
    }
  }
}

function safeErrorType(error: unknown): string {
  const value = error instanceof Error ? error.name : typeof error
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value) ? value : 'UnknownError'
}
