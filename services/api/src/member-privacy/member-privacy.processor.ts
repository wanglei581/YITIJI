import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Injectable, Optional } from '@nestjs/common'
import type { Job } from 'bullmq'
import { MemberDataExportService } from './member-data-export.service'
import {
  MEMBER_EXPORT_JOB,
  MEMBER_EXPORT_RECONCILE_JOB,
  MEMBER_PRIVACY_QUEUE,
  type MemberExportJobData,
  type MemberExportReconcileJobData,
  type MemberPrivacyJobData,
} from './member-privacy.queue'

export const MEMBER_EXPORT_RECONCILE_HANDLER = Symbol('MEMBER_EXPORT_RECONCILE_HANDLER')

export interface MemberExportReconcileHandler {
  reconcile(data: MemberExportReconcileJobData): Promise<unknown>
}

@Injectable()
@Processor(MEMBER_PRIVACY_QUEUE)
export class MemberPrivacyProcessor extends WorkerHost {
  constructor(
    private readonly exports: MemberDataExportService,
    @Optional() @Inject(MEMBER_EXPORT_RECONCILE_HANDLER)
    private readonly reconciler?: MemberExportReconcileHandler,
  ) {
    super()
  }

  async process(job: Job<MemberPrivacyJobData>): Promise<unknown> {
    if (job.name === MEMBER_EXPORT_JOB) {
      const data = job.data as MemberExportJobData
      if (!data.requestId || !Number.isSafeInteger(data.executionVersion) || data.executionVersion < 0) {
        throw new Error('MEMBER_EXPORT_JOB_INVALID')
      }
      return this.exports.execute(data.requestId, data.executionVersion)
    }
    if (job.name === MEMBER_EXPORT_RECONCILE_JOB) {
      if (!this.reconciler) throw new Error('MEMBER_EXPORT_RECONCILER_UNAVAILABLE')
      return this.reconciler.reconcile(job.data as MemberExportReconcileJobData)
    }
    throw new Error('MEMBER_PRIVACY_JOB_UNSUPPORTED')
  }
}
