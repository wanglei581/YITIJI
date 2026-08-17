// ============================================================================
// 公网匿名 AI 端点的日配额
//
// 背景
// ---------------------------------------------------------------------------
// `POST /assistant/chat` 与 `POST /resume/parse` 是全部 AI 路由里唯二既无
// @Throttle 又无配额的端点，而它们恰好是流量最大的两个：
//
//   - /assistant/chat 落在 60 次/分钟的公共默认桶里（兄弟 LLM 路由是 6 次/分钟）
//   - /resume/parse 同样没有任何独立限额
//   - 两者都完全匿名、无 Guard
//
// 匿名是**产品口径**（求职者不该被迫注册才能用 AI），所以这里不加认证门槛，
// 只加限流与配额。
//
// 设计参考：job-ai/job-ai-quota.service.ts
// ---------------------------------------------------------------------------
// 直接沿用它已经跑在生产上的形状，避免第二套并行标准：
//
//   - Redis INCR + TTL 计数，key 按「维度 + sha256 摘要 + 自然日(UTC+8)」拼；
//   - 三个维度同时计数：member / terminal / ip，任一超限即 429；
//   - 超限时回滚本次已经 INCR 过的维度，避免被拒的请求仍然吃掉别的维度额度；
//   - 调用失败时 rollback(ticket)，让「没真正花掉 token 的请求」不占额度；
//   - Redis 异常 fail-closed（503）。与 job-ai 一致：配额基础设施挂掉时
//     宁可拒绝，也不放任 token 无限燃烧。注意这与「AI 挂了要退化成手动」
//     是两件事——那说的是模型不可用，本文件说的是计费闸门不可用。
//
// 为什么 IP 维度必须留着
// ---------------------------------------------------------------------------
// terminal 维度取自 `x-terminal-id`，是客户端可伪造的请求头。伪造能换到更多
// **请求数**，但换不到更多 **token 花费**——因为 IP 维度伪造不了。两个维度
// 各守一件事：terminal 让同一大厅的多台机器不互相抢额度，ip 给花钱封顶。
//
// 为什么 IP 日限额比 job-ai 宽
// ---------------------------------------------------------------------------
// 同一个大厅的 N 台一体机共用一个 NAT 出口 IP。IP 维度定太低会让「第 3 台机器
// 就用不了 AI」——这正是本次要修的那类故障，不能在配额层再犯一次。
// 精细控制交给 member / terminal 两个维度，IP 只做花费天花板。
// ============================================================================

import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { RedisService } from '../common/redis/redis.service'

/** 目前只有这两个端点没有任何配额，先把它们纳管。 */
export type AiPublicOperation = 'assistant_chat' | 'resume_parse'

export interface AiPublicQuotaContext {
  member: string | null
  terminal: string | null
  ip: string | null
}

export interface AiPublicQuotaTicket {
  keys: string[]
}

/** 与 job-ai 一致：留 48 小时，跨自然日边界时旧 key 自然过期。 */
const DAILY_TTL_SECONDS = 60 * 60 * 48

interface DimensionLimit {
  key: string
  limit: number
}

@Injectable()
export class AiPublicQuotaService {
  constructor(private readonly redis: RedisService) {}

  async consume(operation: AiPublicOperation, input: AiPublicQuotaContext): Promise<AiPublicQuotaTicket> {
    const limits: DimensionLimit[] = [
      input.member
        ? { key: this.key(operation, 'member', input.member), limit: memberLimit(operation) }
        : null,
      input.terminal
        ? { key: this.key(operation, 'terminal', input.terminal), limit: terminalLimit(operation) }
        : null,
      input.ip ? { key: this.key(operation, 'ip', input.ip), limit: ipLimit(operation) } : null,
    ].filter((item): item is DimensionLimit => item !== null)

    const incrementedKeys: string[] = []
    try {
      for (const item of limits) {
        const count = await this.redis.incrWithTtl(item.key, DAILY_TTL_SECONDS)
        incrementedKeys.push(item.key)
        if (count > item.limit) {
          await this.rollbackKeys(incrementedKeys)
          throw new HttpException(
            {
              error: {
                code: 'AI_PUBLIC_QUOTA_EXCEEDED',
                message: '今日 AI 使用次数已达上限，请稍后再试',
              },
            },
            HttpStatus.TOO_MANY_REQUESTS,
          )
        }
      }
      return { keys: incrementedKeys }
    } catch (error) {
      if (error instanceof HttpException) throw error
      await this.rollbackKeys(incrementedKeys)
      throw new ServiceUnavailableException({
        error: { code: 'AI_PUBLIC_QUOTA_UNAVAILABLE', message: '配额服务暂时不可用，请稍后再试' },
      })
    }
  }

  /** 下游失败（模型报错 / 参数被拒）时归还额度，避免用户为没拿到的结果买单。 */
  async rollback(ticket: AiPublicQuotaTicket | null): Promise<void> {
    if (!ticket || ticket.keys.length === 0) return
    await this.rollbackKeys(ticket.keys)
  }

  private key(
    operation: AiPublicOperation,
    dimension: 'member' | 'terminal' | 'ip',
    value: string,
  ): string {
    const hashed = createHash('sha256').update(value, 'utf8').digest('hex')
    return `quota:ai_public:${operation}:${dimension}:${hashed}:${dayKey()}`
  }

  private async rollbackKeys(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.redis.decr(key).catch(() => undefined)))
  }
}

function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

// 默认值按「一次正常求职服务用不到这么多次」定，同时给大厅留出多台机器的余量。
// 对话比解析便宜且天然更频繁，故 chat 的额度高于 parse。

function memberLimit(operation: AiPublicOperation): number {
  return operation === 'assistant_chat'
    ? envLimit('AI_ASSISTANT_MEMBER_DAILY_LIMIT', 80)
    : envLimit('AI_RESUME_PARSE_MEMBER_DAILY_LIMIT', 20)
}

function terminalLimit(operation: AiPublicOperation): number {
  return operation === 'assistant_chat'
    ? envLimit('AI_ASSISTANT_TERMINAL_DAILY_LIMIT', 300)
    : envLimit('AI_RESUME_PARSE_TERMINAL_DAILY_LIMIT', 120)
}

function ipLimit(operation: AiPublicOperation): number {
  return operation === 'assistant_chat'
    ? envLimit('AI_ASSISTANT_IP_DAILY_LIMIT', 600)
    : envLimit('AI_RESUME_PARSE_IP_DAILY_LIMIT', 240)
}

/** 自然日按 UTC+8 切分，与 job-ai-quota.service.ts 的 dayKey 完全一致。 */
function dayKey(): string {
  const now = new Date()
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return chinaTime.toISOString().slice(0, 10)
}
