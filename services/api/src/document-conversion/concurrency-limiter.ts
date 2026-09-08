/**
 * 文档转换的并发闸门。
 *
 * 2026-09-08：等待队列此前**无上限** —— `limit` 只约束同时执行的数量，
 * 排队的请求可以无限堆积，每个等待者都握着调用方的请求上下文与文件缓冲。
 * 生产机只有 3.8G 内存、soffice 单次可吃 1G，堆积到一定量就会把整机拖垮
 * （用户态起不来新进程，连 sshd 都发不出 banner）。
 *
 * 现在队列有硬上限：满了立刻拒绝，让调用方拿到一条**诚实的「忙」**，
 * 而不是排在一个看不见的队列里慢慢把内存吃光。
 * 这是 fail-closed：宁可明确拒绝，不可无声堆积。
 */
import { ConversionBusyError } from './document-conversion.types'

/** 队列上限 = 并发上限 × 该系数。取 4 是让短暂尖峰能排上，但不至于堆到内存危险区。 */
const QUEUE_DEPTH_FACTOR = 4

export class ConcurrencyLimiter {
  private active = 0
  private readonly waiters: Array<() => void> = []
  private readonly maxQueue: number

  constructor(
    private readonly limit: number,
    maxQueue?: number,
  ) {
    this.maxQueue = maxQueue ?? limit * QUEUE_DEPTH_FACTOR
  }

  /** 当前排队人数，供健康检查与测试观察。 */
  get queueLength(): number {
    return this.waiters.length
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await work()
    } finally {
      this.release()
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    // 队列已满：立刻拒绝，不入队。调用方会拿到 503 + 可读原因。
    if (this.waiters.length >= this.maxQueue) throw new ConversionBusyError()
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.active += 1
  }

  private release(): void {
    this.active -= 1
    this.waiters.shift()?.()
  }
}
