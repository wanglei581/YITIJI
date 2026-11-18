import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ConversationEpoch } from '../common/conversation-epoch'

// ============================================================
// S3-3 · P26 问答型的多轮上下文。
//
// ⚠️ **只在进程内存里，永不落库**。这是设计页
// （docs/design/kiosk-ai-os-v3-2026-08/26-advisor-work.html「隐私 · 对话保存口径」）
// 对用户的明文承诺：「对话不保存；只有你主动钉住的条目会带进后续步骤」。
//
// 单独成文件不是为了减行数，是为了让这条承诺有一个明确的归属点：
// 任何人想给顾问加「对话历史」功能时，会先撞见这段说明，而不是在 500 行服务里顺手加张表。
//
// 代价（已知且接受）：
//   - 服务重启 / 多实例部署时上下文会丢，用户的追问会被当成新问题作答。
//     这是**诚实的降级**（答得更泛，但不会答错），远好于违背对用户的保存承诺。
//   - 一体机是公共设备，所以必须有 TTL 与容量上限，见下面两个常量。
//   - 用户删记录、登出或清场时当场丢掉；空闲超过 TTL 的由每分钟清扫丢掉，
//     不再等下一次追问才顺手清。
// ============================================================

/** 保留的最近轮数（user + assistant 各算一条），与 LlmChatService 同量级。 */
const MAX_TURNS = 8
/** 空闲过期。超过即视为新会话，用户离场后不会把上下文留给下一个人。 */
const TTL_MS = 30 * 60 * 1000
/** 内存会话数上限，防止公共设备上无界增长。 */
const MAX_SESSIONS = 500

export interface QaTurn {
  role: 'user' | 'assistant'
  content: string
}

interface Entry {
  turns: QaTurn[]
  updatedAt: number
  /** 登录会员是 `u:<会员号>`；匿名作业没有归属，登出时不动它。 */
  ownerKey: string | null
}

@Injectable()
export class AdvisorQaMemory {
  private readonly logger = new Logger(AdvisorQaMemory.name)
  private readonly store = new Map<string, Entry>()
  /** 忘掉之后加一。追问写回前核对，对不上就不再放进内存。 */
  private readonly epoch = new ConversationEpoch()
  /** 还在等模型的追问。内存里可以还没有这条，清的时候也要作废。 */
  private readonly inflight = new Map<string, { ownerKey: string | null; n: number }>()

  /** 进模型前抓住代次。写回时原样交回来。 */
  capture(sessionId: string): number {
    return this.epoch.capture(sessionId.trim())
  }

  /**
   * 请求一进来就登记这一次在途请求属于谁，并抓住代次。必须在任何 await 之前。
   * 首次追问还没写进内存，登出和按作业号清也要能找到它。
   * 归属查询挂起时若还没登记，清理抬高代次之后这次才会抓到新代次，原话又写回。
   */
  begin(sessionId: string, ownerKey: string | null): number {
    const id = sessionId.trim()
    if (id) {
      const current = this.inflight.get(id)
      if (current) current.n += 1
      else this.inflight.set(id, { ownerKey, n: 1 })
    }
    return this.epoch.capture(id)
  }

  /** 这一次请求结束（答完、抛错、设备故障早退）后注销登记。 */
  end(sessionId: string): void {
    const id = sessionId.trim()
    const current = id ? this.inflight.get(id) : undefined
    if (!current) return
    current.n -= 1
    if (current.n <= 0) this.inflight.delete(id)
  }

  /** 读上下文。过期的当作没有 —— 不返回陈旧上下文，也不报错。 */
  read(sessionId: string): QaTurn[] {
    const entry = this.store.get(sessionId)
    if (!entry) return []
    if (Date.now() - entry.updatedAt > TTL_MS) {
      this.drop(sessionId)
      return []
    }
    return entry.turns
  }

  /**
   * 追加一轮问答，并顺带回收过期会话。ownerKey 只在调用方给了会员归属时写入。
   * captured 是进模型前抓住的代次。这段作业已经忘掉就不写。不传则照旧写（测试直接灌内存）。
   */
  append(sessionId: string, question: string, answer: string, ownerKey: string | null = null, captured?: number): void {
    const now = Date.now()
    this.sweep(now)
    if (captured !== undefined && !this.epoch.matches(sessionId, captured)) return
    const existing = this.store.get(sessionId)
    const entry = existing ?? { turns: [], updatedAt: now, ownerKey }
    entry.turns.push({ role: 'user', content: question }, { role: 'assistant', content: answer })
    if (entry.turns.length > MAX_TURNS) entry.turns = entry.turns.slice(-MAX_TURNS)
    entry.updatedAt = now
    if (ownerKey) entry.ownerKey = ownerKey
    this.store.set(sessionId, entry)
    this.evictIfNeeded()
  }

  /** 归属对得上才删。身份库故障时不能按作业号去清别人的。匿名作业对不上会员归属。 */
  forgetIfOwner(sessionId: string, ownerKey: string): boolean {
    const id = sessionId.trim()
    if (!id || !ownerKey) return false
    const entry = this.store.get(id)
    const flight = this.inflight.get(id)
    if (entry?.ownerKey !== ownerKey && flight?.ownerKey !== ownerKey) return false
    this.drop(id)
    return true
  }

  /** 删掉这一次作业的问答内存。没有这条就当已经删过。在途写回同样作废。 */
  forget(sessionId: string): boolean {
    const id = sessionId.trim()
    if (!id) return false
    const had = this.store.has(id)
    this.drop(id)
    return had
  }

  /** 删掉这个归属下的全部作业问答。匿名条目的归属是 null，对不上就不会动。 */
  forgetOwner(ownerKey: string): number {
    if (!ownerKey) return 0
    for (const [id, flight] of this.inflight) {
      if (flight.ownerKey === ownerKey) this.epoch.invalidate(id)
    }
    let removed = 0
    for (const [id, entry] of this.store) {
      if (entry.ownerKey !== ownerKey) continue
      this.drop(id)
      removed += 1
    }
    return removed
  }

  private drop(id: string): void {
    this.store.delete(id)
    this.epoch.invalidate(id)
  }

  /** 空闲超过 TTL 的作业问答立刻丢掉。每分钟扫，不等下一次追问。 */
  @Cron(CronExpression.EVERY_MINUTE)
  sweep(now = Date.now()): number {
    this.epoch.sweep()
    const before = this.store.size
    for (const [id, entry] of this.store) {
      if (now - entry.updatedAt > TTL_MS) this.drop(id)
    }
    const removed = before - this.store.size
    if (removed > 0) this.logger.log(`advisor.qa_memory_swept removed=${removed}`)
    return removed
  }

  /** 容量兜底：淘汰最久未活动的一条。 */
  private evictIfNeeded(): void {
    if (this.store.size <= MAX_SESSIONS) return
    let oldestId: string | null = null
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [id, entry] of this.store) {
      if (entry.updatedAt < oldestAt) { oldestAt = entry.updatedAt; oldestId = id }
    }
    if (!oldestId) return
    this.drop(oldestId)
    // 只报容量，不报 sessionId / 内容。被淘汰的在途回复不再写回；下一轮追问会失去上文，仍能作答。
    this.logger.warn(`advisor.qa_memory_evicted size=${this.store.size}`)
  }
}
