import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { Redis } from 'ioredis'

export const REDIS_CLIENT = Symbol('REDIS_CLIENT')

export type MemberStepUpChallengeConsumeResult =
  | { status: 'missing' }
  | { status: 'owner_mismatch' }
  | { status: 'mismatched'; attempts: number }
  | { status: 'matched'; meta: string }

/**
 * ioredis 薄封装。阶段 A(member-auth)用于:
 *   - 短信验证码(TTL 5min,用后删除)
 *   - 多维频控计数(手机号/IP/设备)
 *   - C 端登录会话(member:session:{jti}),logout/idle 时删除即失效
 *
 * 只暴露用到的原子操作,避免散落 raw client 调用。
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async getDel(key: string): Promise<string | null> {
    const value = await this.client.call('GETDEL', key)
    return typeof value === 'string' ? value : null
  }

  async getAndDelIfEquals(key: string, expectedValue: string): Promise<'missing' | 'matched' | 'mismatched'> {
    const result = await this.client.eval(
      `
      local value = redis.call('GET', KEYS[1])
      if not value then return 0 end
      if value == ARGV[1] then
        redis.call('DEL', KEYS[1])
        return 1
      end
      return -1
      `,
      1,
      key,
      expectedValue,
    )
    if (result === 1) return 'matched'
    if (result === -1) return 'mismatched'
    return 'missing'
  }

  async getDelAndSetEx(
    key: string,
    markerKey: string,
    markerTtlSeconds: number,
    markerValue: string,
  ): Promise<string | null> {
    const value = await this.client.eval(
      `
      local value = redis.call('GET', KEYS[1])
      if not value then return nil end
      redis.call('DEL', KEYS[1])
      redis.call('SET', KEYS[2], ARGV[2], 'EX', tonumber(ARGV[1]))
      return value
      `,
      2,
      key,
      markerKey,
      markerTtlSeconds,
      markerValue,
    )
    return typeof value === 'string' ? value : null
  }

  async setExistingWithCurrentTtl(key: string, value: string): Promise<'missing' | 'updated'> {
    const result = await this.client.eval(
      `
      local ttl = redis.call('TTL', KEYS[1])
      if ttl <= 0 then return 0 end
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ttl)
      return 1
      `,
      1,
      key,
      value,
    )
    return result === 1 ? 'updated' : 'missing'
  }

  ttl(key: string): Promise<number> {
    return this.client.ttl(key)
  }

  /** SET key val EX ttl(秒) */
  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds)
  }

  async registerMemberSession(endUserId: string, sessionId: string, ttlSeconds: number): Promise<void> {
    const result = await this.client.eval(
      `
      local owner = redis.call('GET', KEYS[1])
      if owner and owner ~= ARGV[1] then return 0 end

      local sessionTtl = tonumber(ARGV[3])
      redis.call('SET', KEYS[1], ARGV[1], 'EX', sessionTtl)
      redis.call('SADD', KEYS[2], ARGV[2])
      local currentIndexTtl = redis.call('TTL', KEYS[2])
      if currentIndexTtl < 0 or currentIndexTtl < sessionTtl then
        redis.call('EXPIRE', KEYS[2], sessionTtl)
      end
      return 1
      `,
      2,
      `member:session:${sessionId}`,
      `member:user-sessions:${endUserId}`,
      endUserId,
      sessionId,
      ttlSeconds,
    )
    if (result !== 1) throw new Error('Member session ownership conflict')
  }

  async unregisterMemberSession(endUserId: string, sessionId: string): Promise<void> {
    await this.client.eval(
      `
      local owner = redis.call('GET', KEYS[1])
      if owner == ARGV[1] then redis.call('DEL', KEYS[1]) end
      redis.call('SREM', KEYS[2], ARGV[2])
      if redis.call('SCARD', KEYS[2]) == 0 then
        redis.call('DEL', KEYS[2])
      end
      return 1
      `,
      2,
      `member:session:${sessionId}`,
      `member:user-sessions:${endUserId}`,
      endUserId,
      sessionId,
    )
  }

  async revokeMemberSessions(endUserId: string): Promise<number> {
    const result = await this.client.eval(
      `
      local sessions = redis.call('SMEMBERS', KEYS[1])
      local deleted = 0
      for _, sessionId in ipairs(sessions) do
        local sessionKey = 'member:session:' .. sessionId
        if redis.call('GET', sessionKey) == ARGV[1] then
          deleted = deleted + redis.call('DEL', sessionKey)
        end
      end
      redis.call('DEL', KEYS[1])
      return deleted
      `,
      1,
      `member:user-sessions:${endUserId}`,
      endUserId,
    )
    return Number(result)
  }

  async consumeMemberStepUpChallenge(
    endUserId: string,
    challengeId: string,
    expectedCodeDigest: string,
    maxAttempts: number,
  ): Promise<MemberStepUpChallengeConsumeResult> {
    if (!endUserId || !challengeId || !/^[a-f0-9]{64}$/.test(expectedCodeDigest)) {
      throw new Error('Invalid member step-up challenge input')
    }
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error('Invalid member step-up challenge max attempts')
    }

    const challengeKeyPrefix = `member:step-up:challenge:${challengeId}`
    const result: unknown = await this.client.eval(
      `
      local function keyType(key)
        local result = redis.call('TYPE', key)
        if type(result) == 'table' then return result.ok end
        return result
      end

      local function clearChallenge()
        redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
      end

      local metaType = keyType(KEYS[1])
      local codeType = keyType(KEYS[2])
      local attemptType = keyType(KEYS[3])
      local meta = metaType == 'string' and redis.call('GET', KEYS[1]) or nil
      local code = codeType == 'string' and redis.call('GET', KEYS[2]) or nil
      local attempt = attemptType == 'string' and redis.call('GET', KEYS[3]) or nil

      if metaType ~= 'string' or not meta or meta == '' then
        clearChallenge()
        return { 'missing' }
      end

      local decodedOk, decoded = pcall(cjson.decode, meta)
      if not decodedOk or type(decoded) ~= 'table'
        or type(decoded.endUserId) ~= 'string' or decoded.endUserId == '' then
        clearChallenge()
        return { 'missing' }
      end

      if decoded.endUserId ~= ARGV[1] then
        return { 'owner_mismatch' }
      end

      if codeType ~= 'string' or not code or string.len(code) ~= 64
        or not string.match(code, '^[0-9a-f]+$') then
        clearChallenge()
        return { 'missing' }
      end

      if attemptType ~= 'string' or not attempt then
        clearChallenge()
        return { 'missing' }
      end
      local attemptNumber = tonumber(attempt)
      if not attemptNumber or attemptNumber < 0
        or attemptNumber ~= math.floor(attemptNumber)
        or attemptNumber >= tonumber(ARGV[3]) then
        clearChallenge()
        return { 'missing' }
      end

      local metaTtl = redis.call('PTTL', KEYS[1])
      local codeTtl = redis.call('PTTL', KEYS[2])
      local attemptTtl = redis.call('PTTL', KEYS[3])
      if metaTtl <= 0 or codeTtl <= 0 or attemptTtl <= 0 then
        clearChallenge()
        return { 'missing' }
      end

      if code == ARGV[2] then
        clearChallenge()
        return { 'matched', meta }
      end

      local attempts = redis.pcall('INCR', KEYS[3])
      if type(attempts) ~= 'number' then
        clearChallenge()
        return { 'missing' }
      end

      if attempts >= tonumber(ARGV[3]) then
        clearChallenge()
      else
        redis.call('PEXPIRE', KEYS[3], math.min(metaTtl, codeTtl))
      end
      return { 'mismatched', attempts }
      `,
      3,
      `${challengeKeyPrefix}:meta`,
      `${challengeKeyPrefix}:code`,
      `${challengeKeyPrefix}:attempt`,
      endUserId,
      expectedCodeDigest,
      maxAttempts,
    )

    if (!Array.isArray(result) || typeof result[0] !== 'string') {
      throw new Error('Invalid member step-up challenge consume result')
    }
    if (result[0] === 'missing' && result.length === 1) return { status: 'missing' }
    if (result[0] === 'owner_mismatch' && result.length === 1) return { status: 'owner_mismatch' }
    if (
      result[0] === 'mismatched'
      && result.length === 2
      && typeof result[1] === 'number'
      && Number.isSafeInteger(result[1])
      && result[1] > 0
    ) {
      return { status: 'mismatched', attempts: result[1] }
    }
    if (
      result[0] === 'matched'
      && result.length === 2
      && typeof result[1] === 'string'
      && result[1] !== ''
    ) {
      return { status: 'matched', meta: result[1] }
    }
    throw new Error('Invalid member step-up challenge consume result')
  }

  async registerMemberStepUpGrant(
    endUserId: string,
    tokenHash: string,
    ttlSeconds: number,
    payload: string,
  ): Promise<void> {
    const result = await this.client.eval(
      `
      if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end

      local indexType = redis.call('TYPE', KEYS[2])
      if type(indexType) == 'table' then indexType = indexType.ok end
      if indexType ~= 'none' and indexType ~= 'set' then return -1 end

      local grantTtl = tonumber(ARGV[3])
      if not grantTtl or grantTtl <= 0 then return -1 end

      redis.call('SET', KEYS[1], ARGV[1], 'EX', grantTtl)
      redis.call('SADD', KEYS[2], ARGV[2])
      local currentIndexTtl = redis.call('TTL', KEYS[2])
      if currentIndexTtl < 0 or currentIndexTtl < grantTtl then
        redis.call('EXPIRE', KEYS[2], grantTtl)
      end
      return 1
      `,
      2,
      `member:step-up:grant:${tokenHash}`,
      `member:user-step-up-grants:${endUserId}`,
      payload,
      tokenHash,
      ttlSeconds,
    )
    if (result !== 1) throw new Error('Member step-up grant registration failed')
  }

  async getDelMemberStepUpGrant(endUserId: string, tokenHash: string): Promise<string | null> {
    const result = await this.client.eval(
      `
      local function removeFromIndex(indexKey)
        local removed = redis.pcall('SREM', indexKey, ARGV[1])
        if type(removed) == 'table' and removed.err then return end

        local size = redis.pcall('SCARD', indexKey)
        if type(size) == 'number' and size == 0 then
          redis.call('DEL', indexKey)
        end
      end

      local value = redis.call('GET', KEYS[1])
      if value then redis.call('DEL', KEYS[1]) end

      removeFromIndex(KEYS[2])
      if not value then return nil end

      local decodedOk, decoded = pcall(cjson.decode, value)
      if decodedOk and type(decoded) == 'table'
        and type(decoded.endUserId) == 'string' and decoded.endUserId ~= '' then
        local ownerIndexKey = 'member:user-step-up-grants:' .. decoded.endUserId
        removeFromIndex(ownerIndexKey)
      end
      return value
      `,
      2,
      `member:step-up:grant:${tokenHash}`,
      `member:user-step-up-grants:${endUserId}`,
      tokenHash,
    )
    return typeof result === 'string' ? result : null
  }

  async revokeMemberStepUpGrants(endUserId: string): Promise<number> {
    const result = await this.client.eval(
      `
      local grants = redis.pcall('SMEMBERS', KEYS[1])
      if grants.err then
        redis.call('DEL', KEYS[1])
        return 0
      end

      local deleted = 0
      for _, tokenHash in ipairs(grants) do
        local grantKey = 'member:step-up:grant:' .. tokenHash
        local payload = redis.pcall('GET', grantKey)
        if type(payload) == 'string' then
          local decodedOk, decoded = pcall(cjson.decode, payload)
          if decodedOk and type(decoded) == 'table' and decoded.endUserId == ARGV[1] then
            deleted = deleted + redis.call('DEL', grantKey)
          end
        end
      end
      redis.call('DEL', KEYS[1])
      return deleted
      `,
      1,
      `member:user-step-up-grants:${endUserId}`,
      endUserId,
    )
    return Number(result)
  }

  /**
   * 仅当缓存中不存在更高 tokenVersion 时写入 JSON 会话状态。
   * 防止并发 Guard 在密码变更后把旧版本冷缓存重新写回。
   */
  async setJsonIfVersionNotOlder(
    key: string,
    ttlSeconds: number,
    value: string,
    tokenVersion: number,
  ): Promise<'stored' | 'stale'> {
    const result = await this.client.eval(
      `
      local current = redis.call('GET', KEYS[1])
      if current then
        local ok, decoded = pcall(cjson.decode, current)
        if ok and decoded and type(decoded.tokenVersion) == 'number'
          and decoded.tokenVersion > tonumber(ARGV[3]) then
          return 0
        end
      end
      redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
      return 1
      `,
      1,
      key,
      value,
      ttlSeconds,
      tokenVersion,
    )
    return result === 1 ? 'stored' : 'stale'
  }

  del(key: string): Promise<number> {
    return this.client.del(key)
  }

  /** SET key val NX EX ttl — 仅当 key 不存在时写入,返回是否写入成功(用于冷却闸)。 */
  async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const res = await this.client.set(key, value, 'EX', ttlSeconds, 'NX')
    return res === 'OK'
  }

  /** INCR 并在首次出现时设置过期,返回自增后的值(用于滑动窗口计数)。 */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const result = await this.client.eval(
      `
      local n = redis.call('INCR', KEYS[1])
      if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
      return n
      `,
      1,
      key,
      ttlSeconds,
    )
    return Number(result)
  }

  /**
   * 在固定窗口内原子预留一个额度。达到上限时不修改 key，避免先 INCR 再 DECR
   * 在并发 DEL 之间把缺失 key 重建为负数。
   */
  async reserveWithinLimitWithTtl(key: string, ttlSeconds: number, limit: number): Promise<boolean> {
    const result = await this.client.eval(
      `
      local current = tonumber(redis.call('GET', KEYS[1]) or '0')
      if current >= tonumber(ARGV[2]) then return 0 end
      local next = redis.call('INCR', KEYS[1])
      if next == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
      return 1
      `,
      1,
      key,
      ttlSeconds,
      limit,
    )
    return result === 1
  }

  /**
   * 仅释放仍存在且为正数的预留额度。清零后迟到的释放不会重建 key。
   */
  async releaseReservedLimit(key: string): Promise<void> {
    await this.client.eval(
      `
      local current = tonumber(redis.call('GET', KEYS[1]) or '0')
      if current <= 0 then return 0 end
      if current == 1 then
        redis.call('DEL', KEYS[1])
        return 1
      end
      redis.call('DECR', KEYS[1])
      return 1
      `,
      1,
      key,
    )
  }

  decr(key: string): Promise<number> {
    return this.client.decr(key)
  }

  onModuleDestroy(): void {
    this.client.disconnect()
  }
}
