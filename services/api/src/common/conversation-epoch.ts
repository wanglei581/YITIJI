/**
 * 进程内会话代次。
 *
 * 代次是进程内全局单调递增的号，从 1 起，发过的号不再用。
 * 新会话，以及墓碑清掉之后又出现的会话，都拿一个从没发过的新号。
 * 在途请求手里的旧号对不上活表里的号，就不能写回。0 只留给空白会话号。
 *
 * 清场、登出、删记录、空闲清扫都会把这一条换成新号，并记下墓碑。
 * 墓碑让清场后的在途写回立刻失败，也让这段时间不再沿用同一个会话号。
 * 墓碑到期之后，旧号仍然对不上；下一次抓住的是新号，可以写回。
 *
 * 活着的代次最多留 cap 条（默认 8192）。挤掉一条时只作废这一条，并刷新它的墓碑。
 * 还在等模型的请求钉住自己的会话号。挤的时候跳过钉住的，也跳过刚放进来的这一条。
 * 钉住挡的是被后来的会话顶掉，挡不住清场：清场仍换成新号，旧号对不上。
 * 钉住期间活表可以短时间超过 cap。请求结束放开后，下一轮再按容量挤。
 * 小青一轮模型调用最长 LLM_TIMEOUT_MS（默认 45 秒，上限 60 秒，见 ai/llm/llm-http.ts）。
 * 作业追问最多试两轮（advisor/llm-advisor.service.ts 的 MAX_ATTEMPTS），每轮同一档。
 * 两条链路在途最长 120 秒。墓碑再留 30 秒余量，超过 150 秒就清掉。
 * 没有钉住时，活表最多 cap 条。墓碑在这 150 秒内不因条数被丢掉：
 * 丢掉后 wasRetired 变 false，清过场的会话号会被小青再次沿用。
 * 时限内墓碑条数等于这段时间里作废过的不同会话号，可以暂时超过 cap。
 * 同一条可以同时在活表和墓碑里，直到墓碑到期。到期只由 purgeExpired 清掉。
 * 丢掉墓碑不会把代次退回成还能对上的旧号。新的、没清过场的会话号照常抓住。
 * 墓碑只存会话号和记下的时间，不存对话。进程重启后清空。反复作废同一条会把它挪到队尾，
 * 避免一条热会话卡在队首，挤掉时把很高的代次套到别人头上。
 * 抓代次、作废、核对都先去掉会话号两端空白。
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
  /** 在途请求数。同一会话可以叠多次，挤表时次数还大于 0 就跳过。 */
  private readonly pins = new Map<string, number>()
  /** 下一个要发出的代次。空白会话号才用 0，见过的号从 1 起不再复用。 */
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
    // 新会话，或墓碑已经不在的旧会话。不在这里摘墓碑，沿用检查还要认这个号清过场。
    const value = this.next++
    this.current.set(key, value)
    this.place(key)
    return value
  }

  invalidate(id: string): void {
    const key = id.trim()
    if (!key) return
    this.purgeExpired()
    const value = this.next++
    this.current.set(key, value)
    this.place(key)
    this.tombstones.set(key, this.now())
  }

  matches(id: string, captured: number): boolean {
    const key = id.trim()
    if (!key) return captured === 0
    // 核对时不能发新号。未知的号对不上，包括墓碑已经清掉的旧号。
    this.purgeExpired()
    if (this.tombstones.has(key) && !this.current.has(key)) return false
    return this.current.get(key) === captured
  }

  /** 在途请求进来时钉住。必须和 release 成对，否则这条会一直占着活表。 */
  hold(id: string): void {
    const key = id.trim()
    if (!key) return
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1)
  }

  /** 这一次在途结束。次数减到 0 就放开，下一轮挤表可以丢掉它。 */
  release(id: string): void {
    const key = id.trim()
    if (!key) return
    const left = (this.pins.get(key) ?? 0) - 1
    if (left > 0) this.pins.set(key, left)
    else this.pins.delete(key)
  }

  /** 墓碑还在：这段时间不要再沿用这个会话号。到期之后为 false。 */
  wasRetired(id: string): boolean {
    const key = id.trim()
    if (!key) return false
    this.purgeExpired()
    return this.tombstones.has(key)
  }

  /** 清掉已超过在途时限的墓碑。分钟任务也会调，避免没人再碰这条时内存不回落。 */
  sweep(): void {
    this.purgeExpired()
  }

  /** 活表条数加墓碑条数。墓碑到期清掉之后，没有钉住时不超过 2 * cap。 */
  size(): number {
    return this.current.size + this.tombstones.size
  }

  private purgeExpired(): void {
    const deadline = this.now() - this.tombstoneTtlMs
    for (const [key, at] of this.tombstones) {
      if (at <= deadline) this.tombstones.delete(key)
    }
  }

  /** 挪到队尾再挤。刚放进来的和还钉着的不挤，免得在途请求被后来的会话顶掉。 */
  private place(key: string): void {
    const index = this.order.indexOf(key)
    if (index >= 0) this.order.splice(index, 1)
    this.order.push(key)
    while (this.order.length > this.cap) {
      const droppedIndex = this.order.findIndex((id) => id !== key && (this.pins.get(id) ?? 0) === 0)
      if (droppedIndex < 0) break
      const dropped = this.order[droppedIndex]
      if (!dropped) break
      this.order.splice(droppedIndex, 1)
      if (this.current.delete(dropped)) this.tombstones.set(dropped, this.now())
    }
  }
}
