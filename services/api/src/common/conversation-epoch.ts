/**
 * 进程内会话代次。
 *
 * 清场、登出、删记录、空闲清扫都会把代次加一。在途请求进模型前抓住当时的代次，
 * 写回前对不上，就丢掉这一轮要存的内容。回复本身仍交给还在等的调用方。
 *
 * 代次表有上限，避免进程长开时无界增长。刚忘掉的记在末尾，挤掉的是最早那条。
 */
export class ConversationEpoch {
  private readonly current = new Map<string, number>()
  private readonly order: string[] = []

  constructor(private readonly cap = 8192) {}

  capture(id: string): number {
    return this.current.get(id) ?? 0
  }

  invalidate(id: string): void {
    const key = id.trim()
    if (!key) return
    if (!this.current.has(key)) {
      this.order.push(key)
      if (this.order.length > this.cap) {
        const dropped = this.order.shift()
        if (dropped) this.current.delete(dropped)
      }
    }
    this.current.set(key, (this.current.get(key) ?? 0) + 1)
  }

  matches(id: string, captured: number): boolean {
    return this.capture(id) === captured
  }
}
