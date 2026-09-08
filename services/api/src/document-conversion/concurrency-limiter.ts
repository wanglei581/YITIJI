/**
 * 文档转换的并发闸门。
 *
 * 2026-09-08 读代码时发现：等待队列**无上限** —— `limit` 只约束同时执行的数量，
 * 排队的请求可以无限堆积，每个等待者都握着调用方的请求上下文与文件缓冲。
 * 生产机只有 3.8G 内存、soffice 单次可吃 1G，堆积到一定量有把整机拖垮的风险。
 *
 * 注意这是**推演出来的隐患，不是已发生的事故**。同日曾有人把一次「线上连不上」
 * 判为本机制导致的 OOM，事后取证证明那次是探测方 IP 被 fail2ban 封禁，
 * 服务端全程正常（每小时 1250+ 请求未断、无 OOM、未重启）。
 * 记在这里是为了防止后人把本文件当成那次「事故」的复盘。
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
