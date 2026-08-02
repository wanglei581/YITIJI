import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Injectable } from '@nestjs/common'
import type { Job } from 'bullmq'
import {
  CONTRACT_REVIEW_ANALYZE_JOB,
  CONTRACT_REVIEW_EXTRACT_JOB,
  CONTRACT_REVIEW_QUEUE,
  assertContractReviewTaskId,
  type ContractReviewJobData,
} from './contract-review.queue'

export const CONTRACT_REVIEW_ORCHESTRATOR = Symbol('CONTRACT_REVIEW_ORCHESTRATOR')

export interface ContractReviewJobOrchestrator {
  extract(taskId: string, context: { readonly finalAttempt: boolean }): Promise<unknown>
  analyze(taskId: string): Promise<unknown>
  settleFailedJob(taskId: string, stage: 'extract' | 'analyze'): Promise<void>
}

@Injectable()
@Processor(CONTRACT_REVIEW_QUEUE)
export class ContractReviewProcessor extends WorkerHost {
  constructor(
    @Inject(CONTRACT_REVIEW_ORCHESTRATOR)
    private readonly orchestrator: ContractReviewJobOrchestrator,
  ) {
    super()
  }

  async process(job: Job<ContractReviewJobData>): Promise<unknown> {
    assertContractReviewJob(job)
    if (job.name === CONTRACT_REVIEW_EXTRACT_JOB) {
      return this.orchestrator.extract(job.data.taskId, { finalAttempt: isFinalAttempt(job) })
    }
    if (job.name === CONTRACT_REVIEW_ANALYZE_JOB) return this.orchestrator.analyze(job.data.taskId)
    throw new Error('CONTRACT_REVIEW_JOB_INVALID')
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ContractReviewJobData> | undefined): Promise<void> {
    if (!job || !isFinalFailedEvent(job)) return
    try {
      assertContractReviewJob(job)
      const stage = job.name === CONTRACT_REVIEW_EXTRACT_JOB ? 'extract' : 'analyze'
      await this.orchestrator.settleFailedJob(job.data.taskId, stage)
    } catch {
      // Worker event handling is best-effort and must never expose BullMQ/raw failure details.
    }
  }
}

function isFinalAttempt(job: Job<ContractReviewJobData>): boolean {
  const attempts = job.opts?.attempts
  if (typeof attempts !== 'number' || !Number.isSafeInteger(attempts) || attempts < 1) return true
  if (!Number.isSafeInteger(job.attemptsMade) || job.attemptsMade < 0) return true
  return job.attemptsMade + 1 >= attempts
}

function isFinalFailedEvent(job: Job<ContractReviewJobData>): boolean {
  const attempts = job.opts?.attempts
  if (typeof attempts !== 'number' || !Number.isSafeInteger(attempts) || attempts < 1) return true
  if (!Number.isSafeInteger(job.attemptsMade) || job.attemptsMade < 0) return true
  // BullMQ sets finishedOn only when moveToFailed reaches a terminal state. This
  // also covers UnrecoverableError/stall exhaustion before the attempts budget.
  if (typeof job.finishedOn === 'number' && Number.isFinite(job.finishedOn)) return true
  // BullMQ increments attemptsMade before emitting the worker "failed" event.
  return job.attemptsMade >= attempts
}

function assertContractReviewJob(job: Job<ContractReviewJobData>): void {
  if (!job || typeof job !== 'object') throw new Error('CONTRACT_REVIEW_JOB_INVALID')
  if (job.name !== CONTRACT_REVIEW_EXTRACT_JOB && job.name !== CONTRACT_REVIEW_ANALYZE_JOB) {
    throw new Error('CONTRACT_REVIEW_JOB_INVALID')
  }
  const data: unknown = job.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('CONTRACT_REVIEW_JOB_INVALID')
  const keys = Object.keys(data)
  if (keys.length !== 1 || keys[0] !== 'taskId') throw new Error('CONTRACT_REVIEW_JOB_INVALID')
  assertContractReviewTaskId((data as { readonly taskId?: unknown }).taskId)
}
