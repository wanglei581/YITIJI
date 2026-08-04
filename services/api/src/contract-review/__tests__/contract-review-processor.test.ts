import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Job } from 'bullmq'
import {
  CONTRACT_REVIEW_ANALYZE_JOB,
  CONTRACT_REVIEW_EXTRACT_JOB,
  ContractReviewQueueService,
  type ContractReviewJobData,
  type ContractReviewQueueAdapter,
  type ContractReviewQueueOptions,
} from '../contract-review.queue'
import { ContractReviewProcessor } from '../contract-review.processor'

test('queue gateway is unavailable without an explicit adapter and never runs inline', async () => {
  const queue = new ContractReviewQueueService()
  await assert.rejects(() => queue.enqueueExtract('task-1'), /CONTRACT_REVIEW_QUEUE_UNAVAILABLE/)
  await assert.rejects(() => queue.enqueueAnalyze('task-1'), /CONTRACT_REVIEW_QUEUE_UNAVAILABLE/)
})

test('queue uses deterministic per-stage job ids and never retries analyze', async () => {
  const writes: Array<{ name: string; data: ContractReviewJobData; options: ContractReviewQueueOptions }> = []
  const adapter: ContractReviewQueueAdapter = {
    async add(name, data, options) {
      writes.push({ name, data, options })
      return { id: String(options.jobId) }
    },
  }
  const queue = new ContractReviewQueueService(adapter)

  assert.equal(await queue.enqueueExtract('task-1'), `${CONTRACT_REVIEW_EXTRACT_JOB}.task-1`)
  assert.equal(await queue.enqueueAnalyze('task-1'), `${CONTRACT_REVIEW_ANALYZE_JOB}.task-1`)
  assert.equal(writes[0]?.options.attempts, 3)
  assert.deepEqual(writes[0]?.options.backoff, { type: 'exponential', delay: 5_000 })
  assert.equal(writes[1]?.options.attempts, 1)
  assert.equal(writes[1]?.options.backoff, undefined)
  assert.deepEqual(writes.map((write) => write.data), [{ taskId: 'task-1' }, { taskId: 'task-1' }])
})

test('queue rejects malformed task ids before calling the adapter', async () => {
  let calls = 0
  const queue = new ContractReviewQueueService({
    async add() {
      calls += 1
      return { id: 'unexpected' }
    },
  })
  for (const taskId of ['', ' task-1', 'task:1', 'x'.repeat(129)]) {
    await assert.rejects(() => queue.enqueueExtract(taskId), /CONTRACT_REVIEW_JOB_INVALID/)
  }
  assert.equal(calls, 0)
})

test('processor strictly dispatches extract and analyze jobs', async () => {
  const calls: string[] = []
  const processor = new ContractReviewProcessor({
    async extract(taskId: string, context) { calls.push(`extract:${taskId}:${context.finalAttempt}`); return 'extracted' },
    async analyze(taskId: string) { calls.push(`analyze:${taskId}`); return 'analyzed' },
    async settleFailedJob() { assert.fail('must not settle successful job') },
  })

  assert.equal(await processor.process(job(CONTRACT_REVIEW_EXTRACT_JOB, { taskId: 'task-1' }, 0, 3)), 'extracted')
  assert.equal(await processor.process(job(CONTRACT_REVIEW_EXTRACT_JOB, { taskId: 'task-2' }, 2, 3)), 'extracted')
  assert.equal(await processor.process(job(CONTRACT_REVIEW_ANALYZE_JOB, { taskId: 'task-1' })), 'analyzed')
  assert.deepEqual(calls, ['extract:task-1:false', 'extract:task-2:true', 'analyze:task-1'])
})

test('processor rejects unknown names and non-exact job payloads', async () => {
  const processor = new ContractReviewProcessor({
    async extract() { assert.fail('must not dispatch') },
    async analyze() { assert.fail('must not dispatch') },
    async settleFailedJob() { assert.fail('must not settle invalid job') },
  })
  const invalid = [
    job('contract-review.unknown', { taskId: 'task-1' }),
    job(CONTRACT_REVIEW_EXTRACT_JOB, { taskId: '' }),
    job(CONTRACT_REVIEW_EXTRACT_JOB, { taskId: 'task-1', rawText: 'secret' } as unknown as ContractReviewJobData),
  ]
  for (const item of invalid) {
    await assert.rejects(() => processor.process(item), /CONTRACT_REVIEW_JOB_INVALID/)
  }
})

test('processor settles only validated final failed jobs without using raw worker errors', async () => {
  const settled: string[] = []
  const processor = new ContractReviewProcessor({
    async extract() { assert.fail('must not process') },
    async analyze() { assert.fail('must not process') },
    async settleFailedJob(taskId, stage) { settled.push(`${stage}:${taskId}`) },
  })

  await processor.onFailed(job(CONTRACT_REVIEW_EXTRACT_JOB, { taskId: 'task-1' }, 2, 3))
  await processor.onFailed(job(CONTRACT_REVIEW_EXTRACT_JOB, { taskId: 'task-retrying' }, 2, 3))
  await processor.onFailed(job(CONTRACT_REVIEW_ANALYZE_JOB, { taskId: 'task-2' }, 1, 1))
  await processor.onFailed(job(CONTRACT_REVIEW_EXTRACT_JOB, { taskId: 'task-stalled' }, 1, 3, Date.now()))
  await processor.onFailed(job(CONTRACT_REVIEW_EXTRACT_JOB, { taskId: 'task-3' }, 0, 3))
  await processor.onFailed(job(CONTRACT_REVIEW_EXTRACT_JOB, { taskId: 'task-1' }, 3, 3))
  assert.deepEqual(settled, ['analyze:task-2', 'extract:task-stalled', 'extract:task-1'])
})

function job(
  name: string,
  data: ContractReviewJobData,
  attemptsMade = 0,
  attempts = 1,
  finishedOn?: number,
): Job<ContractReviewJobData> {
  return { name, data, attemptsMade, opts: { attempts }, finishedOn } as Job<ContractReviewJobData>
}
