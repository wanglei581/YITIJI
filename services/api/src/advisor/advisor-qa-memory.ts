import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'

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

  /** 读上下文。过期的当作没有 —— 不返回陈旧上下文，也不报错。 */
  read(sessionId: string): QaTurn[] {
    const entry = this.store.get(sessionId)
    if (!entry) return []
    if (Date.now() - entry.updatedAt > TTL_MS) {
      this.store.delete(sessionId)
      return []
    }
    return entry.turns
  }

  /** 追加一轮问答，并顺带回收过期会话。ownerKey 只在调用方给了会员归属时写入。 */
  append(sessionId: string, question: string, answer: string, ownerKey: string | null = null): void {
    const now = Date.now()
    this.sweep(now)
    const existing = this.store.get(sessionId)
    const entry = existing ?? { turns: [], updatedAt: now, ownerKey }
    entry.turns.push({ role: 'user', content: question }, { role: 'assistant', content: answer })
    if (entry.turns.length > MAX_TURNS) entry.turns = entry.turns.slice(-MAX_TURNS)
    entry.updatedAt = now
    if (ownerKey) entry.ownerKey = ownerKey
    this.store.set(sessionId, entry)
    this.evictIfNeeded()
  }

  /** 删掉这一次作业的问答内存。没有这条就当已经删过。 */
  forget(sessionId: string): boolean {
    const id = sessionId.trim()
    if (!id || !this.store.has(id)) return false
    this.store.delete(id)
    return true
  }

  /** 删掉这个归属下的全部作业问答。匿名条目的归属是 null，对不上就不会动。 */
  forgetOwner(ownerKey: string): number {
    if (!ownerKey) return 0
    let removed = 0
    for (const [id, entry] of this.store) {
      if (entry.ownerKey !== ownerKey) continue
      this.store.delete(id)
      removed += 1
    }
    return removed
  }

  /** 空闲超过 TTL 的作业问答立刻丢掉。每分钟扫，不等下一次追问。 */
  @Cron(CronExpression.EVERY_MINUTE)
  sweep(now = Date.now()): number {
    const before = this.store.size
    for (const [id, entry] of this.store) {
      if (now - entry.updatedAt > TTL_MS) this.store.delete(id)
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
    this.store.delete(oldestId)
    // 只报容量，不报 sessionId / 内容。被淘汰的会话下一轮追问会失去上文（仍能作答）。
    this.logger.warn(`advisor.qa_memory_evicted size=${this.store.size}`)
  }
}
