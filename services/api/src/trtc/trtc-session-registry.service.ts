import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { REDIS_CLIENT } from '../common/redis/redis.service'

const INDEX = 'trtc:deadline:index'
const recordKey = (id: string) => `trtc:deadline:session:${id}`
const taskKey = (id: string) => `trtc:deadline:task:${id}`

export function readTrtcMaxSessionSeconds(raw = process.env.TRTC_MAX_SESSION_MINUTES): number {
  const minutes = Number(raw)
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 30 ? minutes * 60 : 600
}

export interface TrtcSessionRecord {
  sessionId: string
  sdkAppId: number
  region: string
  startedAt: number
  expiresAt: number
  taskId: string | null
  stopped: boolean
}

/** 截止时间只写一次；无续期操作。未结束的记录/索引不设 TTL，失败一直重试。 */
@Injectable()
export class TrtcSessionRegistry {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async reserve(record: TrtcSessionRecord): Promise<void> {
    await this.redis.eval(`
      if redis.call('EXISTS', KEYS[1]) == 1 then return redis.error_reply('session already exists') end
      redis.call('SET', KEYS[1], ARGV[1])
      redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
      return 1
    `, 2, recordKey(record.sessionId), INDEX, JSON.stringify(record), record.expiresAt, record.sessionId)
  }

  async activate(record: TrtcSessionRecord, taskId: string): Promise<void> {
    await this.redis.eval(`
      local raw = redis.call('GET', KEYS[1])
      if not raw then return redis.error_reply('missing session') end
      local item = cjson.decode(raw)
      if item.stopped then return redis.error_reply('session stopped') end
      item.taskId = ARGV[1]
      redis.call('SET', KEYS[1], cjson.encode(item))
      redis.call('SET', KEYS[2], ARGV[2])
      return 1
    `, 2, recordKey(record.sessionId), taskKey(taskId), taskId, record.sessionId)
  }

  async due(now: number): Promise<TrtcSessionRecord[]> {
    const ids = await this.redis.zrangebyscore(INDEX, '-inf', now, 'LIMIT', 0, 100)
    const records = await Promise.all(ids.map(id => this.redis.get(recordKey(id))))
    return records.filter((raw): raw is string => raw !== null).map(raw => JSON.parse(raw) as TrtcSessionRecord)
  }

  async sessionForTask(taskId: string): Promise<string | null> { return this.redis.get(taskKey(taskId)) }

  async finish(sessionId: string, stop: (record: TrtcSessionRecord) => Promise<void>): Promise<void> {
    const lockKey = `${recordKey(sessionId)}:lock`
    const token = randomUUID()
    if (await this.redis.set(lockKey, token, 'PX', 30_000, 'NX') !== 'OK') {
      throw new ServiceUnavailableException('语音会话正在结束，请稍后重试')
    }
    try {
      const raw = await this.redis.get(recordKey(sessionId))
      if (!raw) throw new Error('Missing TRTC deadline record')
      const record = JSON.parse(raw) as TrtcSessionRecord
      if (record.stopped) return
      await stop(record)
      await this.redis.eval(`
        redis.call('SET', KEYS[1], ARGV[1], 'EX', 86400)
        redis.call('ZREM', KEYS[2], ARGV[2])
        if ARGV[3] ~= '' then redis.call('EXPIRE', KEYS[3], 86400) end
        return 1
      `, 3, recordKey(sessionId), INDEX, taskKey(record.taskId ?? ''),
      JSON.stringify({ ...record, stopped: true }), sessionId, record.taskId ?? '')
    } finally {
      await this.redis.eval(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`, 1, lockKey, token)
    }
  }

  /** 只推迟失败重试的扫描时间，不改原始会话截止时间；避免一条故障堵住后续会话。 */
  async retry(sessionId: string, now: number): Promise<void> {
    await this.redis.zadd(INDEX, 'XX', now + 5_000, sessionId)
  }
}
