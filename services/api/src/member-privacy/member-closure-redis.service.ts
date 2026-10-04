import { createHash, createHmac, randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { MemberDataExportRedisService } from '../common/redis/member-data-export-redis.service'
import { REDIS_CLIENT, RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { conflict, unavailable } from './member-data-request.helpers'

@Injectable()
export class MemberClosureRedisService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    private readonly redis: RedisService,
    private readonly exports: MemberDataExportRedisService,
    private readonly prisma: PrismaService,
  ) {}

  async withLock<T>(endUserId: string, operation: (assertLease: () => Promise<void>) => Promise<T>): Promise<T> {
    const key = `member:closure:lock:${endUserId}`
    const owner = randomUUID()
    if (await this.client.set(key, owner, 'PX', 120_000, 'NX') !== 'OK') {
      throw conflict('CLOSURE_IN_PROGRESS', '账号注销正在执行，请稍后重试')
    }
    let lost = false
    const assertLease = async () => {
      const renewed = await this.client.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], 120000) end return 0",
        1, key, owner,
      )
      if (lost || renewed !== 1) throw unavailable('CLOSURE_LOCK_LOST', '注销协调服务暂不可用，请重试')
    }
    const timer = setInterval(() => { void assertLease().catch(() => { lost = true }) }, 30_000)
    timer.unref()
    try { return await operation(assertLease) } finally {
      clearInterval(timer)
      await this.redis.getAndDelIfEquals(key, owner).catch(() => undefined)
    }
  }

  async revoke(endUserId: string, phoneHash: string, persistFiles?: (ids: string[]) => Promise<void>): Promise<string[]> {
    const files: string[] = []
    await this.redis.revokeMemberSessions(endUserId)
    await this.redis.revokeMemberStepUpGrants(endUserId)
    await this.exports.revokeCapabilitiesByUser(createHash('sha256').update(endUserId).digest('hex'))
    const digest = createHmac('sha256', process.env['SECRET_ENCRYPTION_KEY']!)
      .update(`member-step-up:end-user:${endUserId}`).digest('hex')
    for (const pattern of [`member:sms:*${phoneHash}*`, `member:step-up:cooldown:${digest}:*`,
      `member:data-request:create:${endUserId}`]) {
      for (const key of await this.keys(pattern)) await this.client.del(key)
    }
    // 未登记在授权索引里的待验证 challenge 与 QR 确认载荷也包含会员信息。
    for (const key of await this.keys('member:step-up:challenge:*:meta')) {
      const raw = await this.client.get(key)
      if (raw && this.owned(raw, endUserId)) {
        const prefix = key.slice(0, -5)
        await this.client.del(key, `${prefix}:code`, `${prefix}:attempt`)
      }
    }
    for (const key of await this.keys('member:qr:*')) {
      if (await this.client.type(key) !== 'string') continue
      const raw = await this.client.get(key)
      if (raw && this.owned(raw, endUserId)) await this.client.del(key)
    }
    // 硬删会话前把绑定复制件/临时文件送入数据库删除账本，不丢 cleanup 对象。
    for (const key of [...await this.keys('upload_session:*'), ...await this.keys('upload_session_cleanup:*')]) {
      const raw = await this.client.get(key)
      if (!raw || !this.owned(raw, endUserId)) continue
      const record = JSON.parse(raw) as { sessionId: string; file?: { fileId: string }; stagedObjectKey?: string;
        stagedBucket?: string; bind?: { userKey: string; previousKey: string; bucket: string } }
      const sessionId = record.sessionId
      if (record.file?.fileId) {
        const file = await this.prisma.fileObject.findUnique({ where: { id: record.file.fileId } })
        if (file && ((file.endUserId && file.endUserId !== endUserId)
          || (file.ownerType === 'user' && file.ownerId && file.ownerId !== endUserId))) continue
        if (file) {
          // 先持久保存文件 id，再删 Redis；中断后不丢未绑定文件的归属证据。
          await persistFiles?.([file.id])
          files.push(file.id)
        }
      }
      const cleanupKey = `upload_session_cleanup:${sessionId}`
      const cleanupRaw = await this.client.get(cleanupKey)
      const cleanup = cleanupRaw ? JSON.parse(cleanupRaw) as typeof record : record
      for (const storageKey of [cleanup.stagedObjectKey, record.bind?.userKey, record.bind?.previousKey].filter((x): x is string => Boolean(x))) {
        await this.prisma.storageDeletion.upsert({ where: { storageKey },
          create: { storageKey, bucket: cleanup.stagedBucket ?? record.bind?.bucket ?? 'local-fs' }, update: {} })
      }
      await this.client.del(key, cleanupKey, `upload_session:${sessionId}`, `upload_session_upload_lock:${sessionId}`)
      await this.client.zrem('upload_session_expiry_index', sessionId)
      for (const scene of await this.keys('upload_session_scene:*')) {
        if (await this.client.get(scene) === sessionId) await this.client.del(scene)
      }
    }
    return files
  }

  private owned(raw: string, id: string): boolean {
    try {
      const check = (value: unknown): boolean => {
        if (!value || typeof value !== 'object') return false
        return Object.entries(value).some(([key, child]) =>
          (['endUserId', 'pendingEndUserId', 'id'].includes(key) && child === id) || check(child))
      }
      return check(JSON.parse(raw))
    } catch { return false }
  }

  private async keys(pattern: string): Promise<string[]> {
    const result: string[] = []
    let cursor = '0'
    do {
      const page = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
      cursor = page[0]; result.push(...page[1])
    } while (cursor !== '0')
    return result
  }
}
