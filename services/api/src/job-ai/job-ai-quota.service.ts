import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { createHash } from 'crypto'
import { RedisService } from '../common/redis/redis.service'
import type { JobAiOperation } from './job-ai.types'

export interface JobAiQuotaContext {
  member: string | null
  terminal: string | null
  ip: string | null
}

export interface JobAiQuotaTicket {
  keys: string[]
}

const DAILY_TTL_SECONDS = 60 * 60 * 48

@Injectable()
export class JobAiQuotaService {
  constructor(private readonly redis: RedisService) {}

  async consume(operation: JobAiOperation, input: JobAiQuotaContext): Promise<JobAiQuotaTicket> {
    const limits = [
      input.member ? { key: this.key(operation, 'member', input.member), limit: envLimit('JOB_AI_MEMBER_DAILY_LIMIT', 20) } : null,
      input.terminal ? { key: this.key(operation, 'terminal', input.terminal), limit: envLimit('JOB_AI_TERMINAL_DAILY_LIMIT', 100) } : null,
      input.ip ? { key: this.key(operation, 'ip', input.ip), limit: envLimit('JOB_AI_IP_DAILY_LIMIT', 60) } : null,
    ].filter((item): item is { key: string; limit: number } => item !== null)

    const incrementedKeys: string[] = []
    try {
      for (const item of limits) {
        const count = await this.redis.incrWithTtl(item.key, DAILY_TTL_SECONDS)
        incrementedKeys.push(item.key)
        if (count > item.limit) {
          await this.rollbackKeys(incrementedKeys)
          throw new HttpException({
            error: { code: 'JOB_AI_QUOTA_EXCEEDED', message: '今日岗位 AI 使用次数已达上限，请稍后再试' },
          }, HttpStatus.TOO_MANY_REQUESTS)
        }
      }
      return { keys: incrementedKeys }
    } catch (error) {
      if (error instanceof HttpException) throw error
      await this.rollbackKeys(incrementedKeys)
      throw new ServiceUnavailableException({
        error: { code: 'JOB_AI_QUOTA_UNAVAILABLE', message: '配额服务暂时不可用，请稍后再试' },
      })
    }
  }

  async rollback(ticket: JobAiQuotaTicket | null): Promise<void> {
    if (!ticket || ticket.keys.length === 0) return
    await this.rollbackKeys(ticket.keys)
  }

  private key(operation: JobAiOperation, dimension: 'member' | 'terminal' | 'ip', value: string): string {
    const digest = createHash('sha256').update(value, 'utf8').digest('hex')
    return `quota:job_ai:${operation}:${dimension}:${digest}:${dayKey()}`
  }

  private async rollbackKeys(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.redis.decr(key).catch(() => undefined)))
  }
}

function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

function dayKey(): string {
  const now = new Date()
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return chinaTime.toISOString().slice(0, 10)
}
