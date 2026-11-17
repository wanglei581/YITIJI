/**
 * 进程内会话代次。
 *
 * 清场、登出、删记录、空闲清扫都会把代次加一。在途请求进模型前抓住当时的代次，
 * 写回前对不上，就丢掉这一轮要存的内容。回复本身仍交给还在等的调用方。
 *
 * 代次表有上限。挤掉一条时抬高下限：挤掉之前抓住的代次一律对不上。
 * 表里没有的号抓到的是当前下限，所以挤掉之后新的一轮仍能写回。
 * 三个方法都先去掉会话号两端空白。
 */
export class ConversationEpoch {
  private readonly current = new Map<string, number>()
  private readonly order: string[] = []
  /** 下一个要发出的代次。0 只表示「这条还没被忘掉」。 */
  private next = 1
  /** 早于这个值的代次都是被挤掉之前抓住的，不许再写回。 */
  private floor = 0

  constructor(private readonly cap = 8192) {}

  capture(id: string): number {
    const key = id.trim()
    if (!key) return this.floor
    const stored = this.current.get(key)
    if (stored === undefined || stored < this.floor) return this.floor
    return stored
  }

  invalidate(id: string): void {
    const key = id.trim()
    if (!key) return
    if (!this.current.has(key)) {
      this.order.push(key)
      if (this.order.length > this.cap) {
        const dropped = this.order.shift()
        if (dropped) {
          const evicted = this.current.get(dropped) ?? 0
          this.current.delete(dropped)
          if (evicted + 1 > this.floor) this.floor = evicted + 1
          if (this.next < this.floor) this.next = this.floor
        }
      }
    }
    const value = this.next < this.floor ? this.floor : this.next
    this.next = value + 1
    this.current.set(key, value)
  }

  matches(id: string, captured: number): boolean {
    if (captured < this.floor) return false
    return this.capture(id) === captured
  }
}
