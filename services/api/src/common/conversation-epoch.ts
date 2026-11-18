/**
 * 进程内会话代次。
 *
 * 清场、登出、删记录、空闲清扫都会把这一条的代次加一。在途请求进模型前抓住当时的代次，
 * 写回前对不上，就丢掉这一轮要存的内容。回复本身仍交给还在等的调用方。
 *
 * 活着的代次最多留 8192 条。挤掉一条时只作废这一条，并给它留一块墓碑：
 * 挤掉之前抓住的代次不能再对上。没被清、也没被挤掉的会话不受影响。
 * 墓碑只增不减。若把墓碑也挤掉，旧的 0 代次会重新对上。
 * 墓碑只存会话号，不存对话。进程重启后清空。反复作废同一条会把它挪到队尾，
 * 避免一条热会话卡在队首，挤掉时把很高的代次套到别人头上。
 * 三个方法都先去掉会话号两端空白。
 */
export class ConversationEpoch {
  private readonly current = new Map<string, number>()
  private readonly order: string[] = []
  private readonly tombstones = new Set<string>()
  /** 下一个要发出的代次。0 只表示「这条还没被忘掉，也没被挤掉」。 */
  private next = 1

  constructor(private readonly cap = 8192) {}

  capture(id: string): number {
    const key = id.trim()
    if (!key) return 0
    const stored = this.current.get(key)
    if (stored !== undefined) return stored
    if (!this.tombstones.has(key)) return 0
    // 被挤掉或清掉之后的新一轮，另发一个代次。核对旧代次时不会走到这里。
    this.tombstones.delete(key)
    const value = this.next++
    this.current.set(key, value)
    this.place(key)
    return value
  }

  invalidate(id: string): void {
    const key = id.trim()
    if (!key) return
    this.tombstones.delete(key)
    const value = this.next++
    this.current.set(key, value)
    this.place(key)
  }

  matches(id: string, captured: number): boolean {
    const key = id.trim()
    if (!key) return captured === 0
    // 先看墓碑。capture 会给墓碑上的号另发新代次，核对时不能发。
    if (this.tombstones.has(key) && !this.current.has(key)) return false
    return this.capture(key) === captured
  }

  /** 挪到队尾再挤。刚作废的这一条在队尾，不会被自己挤掉。 */
  private place(key: string): void {
    const index = this.order.indexOf(key)
    if (index >= 0) this.order.splice(index, 1)
    this.order.push(key)
    while (this.order.length > this.cap) {
      const dropped = this.order.shift()
      if (!dropped || dropped === key) {
        if (dropped === key) this.order.push(key)
        break
      }
      if (this.current.delete(dropped)) this.tombstones.add(dropped)
    }
  }
}
