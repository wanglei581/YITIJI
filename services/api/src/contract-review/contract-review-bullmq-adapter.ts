// BullMQ 队列适配器 — 将 @nestjs/bullmq 注入的 Queue 对象包装为
// ContractReviewQueueAdapter 接口，仅在 REDIS_URL 和 CONTRACT_REVIEW_API_KEY
// 均配置时才会被注册（模块条件展开决定）。
import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import type { Queue } from 'bullmq'
import {
  CONTRACT_REVIEW_QUEUE,
  type ContractReviewJobData,
  type ContractReviewQueueAdapter,
  type ContractReviewQueueJob,
  type ContractReviewQueueOptions,
} from './contract-review.queue'

@Injectable()
export class ContractReviewBullMqAdapter implements ContractReviewQueueAdapter {
  constructor(
    @InjectQueue(CONTRACT_REVIEW_QUEUE) private readonly queue: Queue,
  ) {}

  async add(
    name: string,
    data: ContractReviewJobData,
    options: ContractReviewQueueOptions,
  ): Promise<ContractReviewQueueJob> {
    return this.queue.add(name, data, options)
  }
}
