/**
 * 进程内会话代次。
 *
 * 清场、登出、删记录、空闲清扫都会把这一条的代次加一。在途请求进模型前抓住当时的代次，
 * 写回前对不上，就丢掉这一轮要存的内容。回复本身仍交给还在等的调用方。
 *
 * 活着的代次最多留 cap 条（默认 8192）。挤掉一条时只作废这一条，并给它留一块墓碑：
 * 挤掉之前抓住的代次不能再对上。没被清、也没被挤掉的会话不受影响。
 *
 * 墓碑只挡住「挤掉之前抓住、还在路上」的那次写回。小青一轮模型调用最长
 * LLM_TIMEOUT_MS（默认 45 秒，上限 60 秒，见 ai/llm/llm-http.ts）。作业追问
 * 最多试两轮（advisor/llm-advisor.service.ts 的 MAX_ATTEMPTS），每轮同一档。
 * 两条链路在途最长 120 秒。墓碑再留 30 秒余量，超过 150 秒就清掉。
 * 活表最多 cap 条，墓碑最多同样多条，两者合计不超过 2 * cap。
 * 超过这个数时会先清到期墓碑，仍超再丢掉最老的一块。未到期就被丢掉的那一块，
 * 旧的 0 代次会重新对上；正常在途时限内墓碑数量到不了这个上限。
 * 墓碑到期或被新一轮 capture 摘掉之后，同一会话号新抓住的代次可以写回。
 * 墓碑只存会话号和记下的时间，不存对话。进程重启后清空。反复作废同一条会把它挪到队尾，
 * 避免一条热会话卡在队首，挤掉时把很高的代次套到别人头上。
 * 三个方法都先去掉会话号两端空白。
 */

/** 小青一轮与作业追问两轮的模型在途上限，各轮天花板 60 秒。 */
export const CONVERSATION_EPOCH_MODEL_BUDGET_MS = 120_000
/** 在途上限之外多留的余量，盖住写回前的收尾。 */
export const CONVERSATION_EPOCH_TOMBSTONE_MARGIN_MS = 30_000
/** 墓碑保留时间。超过就清，避免 7×24 只涨不落。 */
export const CONVERSATION_EPOCH_TOMBSTONE_TTL_MS =
  CONVERSATION_EPOCH_MODEL_BUDGET_MS + CONVERSATION_EPOCH_TOMBSTONE_MARGIN_MS

export class ConversationEpoch {
  private readonly current = new Map<string, number>()
  private readonly order: string[] = []
  private readonly tombstones = new Map<string, number>()
  /** 下一个要发出的代次。0 只表示「这条还没被忘掉，也没被挤掉」。 */
  private next = 1

  constructor(
    private readonly cap = 8192,
    private readonly now: () => number = Date.now,
    private readonly tombstoneTtlMs = CONVERSATION_EPOCH_TOMBSTONE_TTL_MS,
  ) {}

  capture(id: string): number {
    const key = id.trim()
    if (!key) return 0
    this.purgeExpired()
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
    this.purgeExpired()
    this.tombstones.delete(key)
    const value = this.next++
    this.current.set(key, value)
    this.place(key)
  }

  matches(id: string, captured: number): boolean {
    const key = id.trim()
    if (!key) return captured === 0
    // 先看墓碑。capture 会给墓碑上的号另发新代次，核对时不能发。
    this.purgeExpired()
    if (this.tombstones.has(key) && !this.current.has(key)) return false
    return this.capture(key) === captured
  }

  /** 清掉已超过在途时限的墓碑。分钟任务也会调，避免没人再碰这条时内存不回落。 */
  sweep(): void {
    this.purgeExpired()
  }

  /** 活表条数加墓碑条数。上限是 2 * cap。 */
  size(): number {
    return this.current.size + this.tombstones.size
  }

  private purgeExpired(): void {
    const deadline = this.now() - this.tombstoneTtlMs
    for (const [key, at] of this.tombstones) {
      if (at <= deadline) this.tombstones.delete(key)
    }
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
      if (this.current.delete(dropped)) this.tombstones.set(dropped, this.now())
    }
    this.capTombstones()
  }

  /** 到期的已经清过。仍超过 cap 时丢掉最老的墓碑。 */
  private capTombstones(): void {
    while (this.tombstones.size > this.cap) {
      let oldestKey: string | null = null
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [id, at] of this.tombstones) {
        if (at < oldestAt) {
          oldestAt = at
          oldestKey = id
        }
      }
      if (!oldestKey) return
      this.tombstones.delete(oldestKey)
    }
  }
}
