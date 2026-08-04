import { Inject, Injectable, Optional } from '@nestjs/common'

export const CONTRACT_REVIEW_QUEUE = 'contract-review'
export const CONTRACT_REVIEW_EXTRACT_JOB = 'contract-review.extract'
export const CONTRACT_REVIEW_ANALYZE_JOB = 'contract-review.analyze'
export const CONTRACT_REVIEW_QUEUE_ADAPTER = Symbol('CONTRACT_REVIEW_QUEUE_ADAPTER')

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const RETAIN_COMPLETED_SECONDS = 24 * 60 * 60
const RETAIN_FAILED_SECONDS = 7 * RETAIN_COMPLETED_SECONDS

export interface ContractReviewJobData {
  readonly taskId: string
}

export interface ContractReviewQueueJob {
  readonly id?: string | number | null
}

export interface ContractReviewQueueOptions {
  readonly jobId: string
  readonly attempts: number
  readonly backoff?: { readonly type: 'exponential'; readonly delay: number }
  readonly removeOnComplete: { readonly age: number }
  readonly removeOnFail: { readonly age: number }
}

export interface ContractReviewQueueAdapter {
  add(
    name: string,
    data: ContractReviewJobData,
    options: ContractReviewQueueOptions,
  ): Promise<ContractReviewQueueJob>
}

@Injectable()
export class ContractReviewQueueService {
  constructor(
    @Optional() @Inject(CONTRACT_REVIEW_QUEUE_ADAPTER)
    private readonly adapter?: ContractReviewQueueAdapter,
  ) {}

  enqueueExtract(taskId: string): Promise<string> {
    return this.enqueue(CONTRACT_REVIEW_EXTRACT_JOB, taskId, 3)
  }

  enqueueAnalyze(taskId: string): Promise<string> {
    return this.enqueue(CONTRACT_REVIEW_ANALYZE_JOB, taskId, 1)
  }

  private async enqueue(name: string, taskId: string, attempts: number): Promise<string> {
    assertContractReviewTaskId(taskId)
    if (!this.adapter) throw new Error('CONTRACT_REVIEW_QUEUE_UNAVAILABLE')
    const jobId = `${name}.${taskId}`
    const options: ContractReviewQueueOptions = {
      jobId,
      attempts,
      ...(attempts > 1 ? { backoff: { type: 'exponential' as const, delay: 5_000 } } : {}),
      removeOnComplete: { age: RETAIN_COMPLETED_SECONDS },
      removeOnFail: { age: RETAIN_FAILED_SECONDS },
    }
    const job = await this.adapter.add(name, Object.freeze({ taskId }), Object.freeze(options))
    return job.id == null ? jobId : String(job.id)
  }
}

export function assertContractReviewTaskId(taskId: unknown): asserts taskId is string {
  if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) {
    throw new Error('CONTRACT_REVIEW_JOB_INVALID')
  }
}
