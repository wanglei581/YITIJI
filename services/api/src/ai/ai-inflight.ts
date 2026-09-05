/**
 * 进程内 in-flight 合并：同一 key 的并发调用共用一个 Promise。
 * 用于 optimize 懒执行、模拟面试 end 等「只该跑一次」的路径。
 */
export class InflightCoalescer<T> {
  private readonly inflight = new Map<string, Promise<T>>()

  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) return existing
    const pending = work().finally(() => {
      this.inflight.delete(key)
    })
    this.inflight.set(key, pending)
    return pending
  }
}
