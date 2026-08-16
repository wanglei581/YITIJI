import { Logger } from '@nestjs/common'

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
}

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

  /** 追加一轮问答，并顺带回收过期会话。 */
  append(sessionId: string, question: string, answer: string): void {
    const now = Date.now()
    for (const [id, entry] of this.store) {
      if (now - entry.updatedAt > TTL_MS) this.store.delete(id)
    }
    const entry = this.store.get(sessionId) ?? { turns: [], updatedAt: now }
    entry.turns.push({ role: 'user', content: question }, { role: 'assistant', content: answer })
    if (entry.turns.length > MAX_TURNS) entry.turns = entry.turns.slice(-MAX_TURNS)
    entry.updatedAt = now
    this.store.set(sessionId, entry)
    this.evictIfNeeded()
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
