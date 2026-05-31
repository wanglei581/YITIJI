/**
 * 防重放守卫:5min 窗口内同一 nonce 只接受一次。
 *
 * 实现:in-memory Map + 定时淘汰过期项。生产可换 Redis,接口不变。
 *
 * 容量上限 10000(单实例可承载 ≥ 33 req/s 平均请求,远超本场景需要)。
 * 超过上限时按"最早进入"顺序淘汰,极端情况下退化为短窗口(< 5min)
 * 但不会出现"内存爆炸"的失控。
 */

const WINDOW_MS = 5 * 60 * 1000
const MAX_ENTRIES = 10_000

interface Entry {
  expiresAt: number
}

export class ReplayGuard {
  private readonly map = new Map<string, Entry>()

  /**
   * 尝试登记一个 nonce。
   * @returns true = 新 nonce 已登记;false = 已见过(replay)或参数无效
   */
  register(nonce: string, sourceId: string, timestampMs: number): boolean {
    if (!nonce || typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 128) return false
    if (!Number.isFinite(timestampMs)) return false

    const now = Date.now()
    this.evictExpired(now)

    const key = `${sourceId}:${nonce}`
    if (this.map.has(key)) return false

    // 容量裁剪:超上限时丢最早的一批(简单一刀切,够用)
    if (this.map.size >= MAX_ENTRIES) {
      const evictCount = Math.ceil(MAX_ENTRIES * 0.05)
      const iter = this.map.keys()
      for (let i = 0; i < evictCount; i++) {
        const k = iter.next().value
        if (k === undefined) break
        this.map.delete(k)
      }
    }

    this.map.set(key, { expiresAt: now + WINDOW_MS })
    return true
  }

  /** 测试/管理用,清空记录。 */
  reset(): void {
    this.map.clear()
  }

  private evictExpired(now: number): void {
    for (const [k, v] of this.map) {
      if (v.expiresAt <= now) this.map.delete(k)
      else break // Map 按插入顺序遍历;到第一个未过期就停
    }
  }
}
