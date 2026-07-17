import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { REDIS_CLIENT } from './redis.service'

export interface MemberExportDownloadTicketPayload {
  requestId: string
  endUserId: string
  fileId: string
  executionVersion: number
  requestDigest: string
  endUserDigest: string
}

export type MemberExportDownloadClaimResult =
  | { status: 'claimed'; payload: string }
  | { status: 'missing' | 'busy' }

export type MemberExportDownloadClaimActionResult =
  | { status: 'matched'; payload: string }
  | { status: 'missing' | 'mismatched' }

export interface MemberExportRecoverableClaim {
  claimDigest: string
  payload: MemberExportDownloadTicketPayload
}

const FINISH_RECOVERY_TTL_MS = 24 * 60 * 60 * 1_000
const FINISH_RECOVERY_RETRY_SECONDS = 60

@Injectable()
export class MemberDataExportRedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async registerTicket(args: {
    ticketDigest: string
    payload: MemberExportDownloadTicketPayload
    ttlSeconds: number
  }): Promise<'stored' | 'exists'> {
    assertDigest(args.ticketDigest)
    assertPayload(args.payload)
    assertTtl(args.ttlSeconds)
    const ns = namespace()
    const result = await this.client.eval(
      `
      if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
      local ttl = tonumber(ARGV[2])
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ttl)
      redis.call('SADD', KEYS[2], ARGV[3])
      redis.call('SADD', KEYS[3], ARGV[3])
      for i = 2, 3 do
        local current = redis.call('TTL', KEYS[i])
        if current < ttl then redis.call('EXPIRE', KEYS[i], ttl) end
      end
      return 1
      `,
      3,
      `${ns}:ticket:${args.ticketDigest}`,
      `${ns}:ticket-request:${args.payload.requestDigest}`,
      `${ns}:ticket-user:${args.payload.endUserDigest}`,
      JSON.stringify(args.payload),
      args.ttlSeconds,
      args.ticketDigest,
    )
    return result === 1 ? 'stored' : 'exists'
  }

  async claimTicket(args: {
    ticketDigest: string
    expectedRequestId: string
    claimDigest: string
    claimTtlSeconds: number
  }): Promise<MemberExportDownloadClaimResult> {
    assertDigest(args.ticketDigest)
    assertDigest(args.claimDigest)
    assertTtl(args.claimTtlSeconds)
    if (!args.expectedRequestId || args.expectedRequestId.length > 128) throw new Error('Invalid export request id')
    const ns = namespace()
    const result: unknown = await this.client.eval(
      `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return { 'missing' } end
      local ok, payload = pcall(cjson.decode, raw)
      if not ok or type(payload) ~= 'table' or payload.requestId ~= ARGV[1]
        or type(payload.requestDigest) ~= 'string' or type(payload.endUserDigest) ~= 'string' then
        return { 'missing' }
      end
      local leaseKey = ARGV[5] .. ':claim-request:' .. payload.requestDigest
      if redis.call('EXISTS', leaseKey) == 1 then return { 'busy' } end
      local claimKey = ARGV[5] .. ':claim:' .. ARGV[2]
      if redis.call('EXISTS', claimKey) == 1 then return { 'busy' } end
      redis.call('DEL', KEYS[1])
      redis.call('SREM', ARGV[5] .. ':ticket-request:' .. payload.requestDigest, ARGV[3])
      redis.call('SREM', ARGV[5] .. ':ticket-user:' .. payload.endUserDigest, ARGV[3])
      local ttl = tonumber(ARGV[4])
      redis.call('SET', leaseKey, ARGV[2], 'EX', ttl)
      redis.call('SET', claimKey, cjson.encode({ status = 'active', payload = payload }), 'EX', ttl)
      local userIndex = ARGV[5] .. ':claim-user:' .. payload.endUserDigest
      redis.call('SADD', userIndex, ARGV[2])
      local current = redis.call('TTL', userIndex)
      if current < ttl then redis.call('EXPIRE', userIndex, ttl) end
      redis.call('ZADD', KEYS[2], tonumber(ARGV[6]), ARGV[2])
      return { 'claimed', raw }
      `,
      2,
      `${ns}:ticket:${args.ticketDigest}`,
      `${ns}:claim-expiries`,
      args.expectedRequestId,
      args.claimDigest,
      args.ticketDigest,
      args.claimTtlSeconds,
      ns,
      Math.floor(Date.now() / 1_000) + args.claimTtlSeconds,
    )
    if (!Array.isArray(result) || typeof result[0] !== 'string') throw new Error('Invalid export claim result')
    if (result[0] === 'claimed' && typeof result[1] === 'string') return { status: 'claimed', payload: result[1] }
    return { status: result[0] === 'busy' ? 'busy' : 'missing' }
  }

  beginFinish(claimDigest: string): Promise<MemberExportDownloadClaimActionResult> {
    return this.actOnClaim(claimDigest, 'begin')
  }

  async completeClaim(claimDigest: string): Promise<'matched' | 'missing' | 'mismatched'> {
    return (await this.actOnClaim(claimDigest, 'complete')).status
  }

  async abortClaim(claimDigest: string): Promise<'matched' | 'missing' | 'mismatched'> {
    return (await this.actOnClaim(claimDigest, 'abort')).status
  }

  async revokeTicketsByRequest(requestDigest: string): Promise<number> {
    assertDigest(requestDigest)
    const ns = namespace()
    const result = await this.client.eval(
      `
      local members = redis.call('SMEMBERS', KEYS[1])
      local deleted = 0
      for _, digest in ipairs(members) do
        local ticketKey = ARGV[1] .. ':ticket:' .. digest
        local raw = redis.call('GET', ticketKey)
        if raw then
          local ok, payload = pcall(cjson.decode, raw)
          if ok and type(payload) == 'table' and payload.requestDigest == ARGV[2] then
            if type(payload.endUserDigest) == 'string' then
              redis.call('SREM', ARGV[1] .. ':ticket-user:' .. payload.endUserDigest, digest)
            end
            deleted = deleted + redis.call('DEL', ticketKey)
          end
        end
      end
      redis.call('DEL', KEYS[1])
      return deleted
      `,
      1,
      `${ns}:ticket-request:${requestDigest}`,
      ns,
      requestDigest,
    )
    return Number(result)
  }

  async revokeCapabilitiesByRequest(requestDigest: string): Promise<number> {
    const tickets = await this.revokeTicketsByRequest(requestDigest)
    const ns = namespace()
    const claims = await this.client.eval(
      `
      local digest = redis.call('GET', KEYS[1])
      if not digest then return 0 end
      local claimKey = ARGV[1] .. ':claim:' .. digest
      local raw = redis.call('GET', claimKey)
      if raw then
        local ok, wrapper = pcall(cjson.decode, raw)
        if ok and type(wrapper) == 'table' and type(wrapper.payload) == 'table'
          and type(wrapper.payload.endUserDigest) == 'string' then
          redis.call('SREM', ARGV[1] .. ':claim-user:' .. wrapper.payload.endUserDigest, digest)
        end
      end
      if redis.call('GET', KEYS[1]) == digest then redis.call('DEL', KEYS[1]) end
      redis.call('DEL', claimKey)
      redis.call('ZREM', KEYS[2], digest)
      return 1
      `,
      2,
      `${ns}:claim-request:${requestDigest}`,
      `${ns}:claim-expiries`,
      ns,
    )
    return tickets + Number(claims)
  }

  async revokeCapabilitiesByUser(endUserDigest: string): Promise<number> {
    assertDigest(endUserDigest)
    const ns = namespace()
    const result = await this.client.eval(
      `
      local deleted = 0
      for _, digest in ipairs(redis.call('SMEMBERS', KEYS[1])) do
        local key = ARGV[1] .. ':ticket:' .. digest
        local raw = redis.call('GET', key)
        if raw then
          local ok, payload = pcall(cjson.decode, raw)
          if ok and type(payload) == 'table' and payload.endUserDigest == ARGV[2] then
            redis.call('SREM', ARGV[1] .. ':ticket-request:' .. payload.requestDigest, digest)
            deleted = deleted + redis.call('DEL', key)
          end
        end
      end
      for _, digest in ipairs(redis.call('SMEMBERS', KEYS[2])) do
        local key = ARGV[1] .. ':claim:' .. digest
        local raw = redis.call('GET', key)
        if raw then
          local ok, wrapper = pcall(cjson.decode, raw)
          if ok and type(wrapper) == 'table' and type(wrapper.payload) == 'table'
            and wrapper.payload.endUserDigest == ARGV[2] then
            local lease = ARGV[1] .. ':claim-request:' .. wrapper.payload.requestDigest
            if redis.call('GET', lease) == digest then redis.call('DEL', lease) end
            deleted = deleted + redis.call('DEL', key)
            redis.call('ZREM', KEYS[3], digest)
          end
        end
      end
      redis.call('DEL', KEYS[1], KEYS[2])
      return deleted
      `,
      3,
      `${ns}:ticket-user:${endUserDigest}`,
      `${ns}:claim-user:${endUserDigest}`,
      `${ns}:claim-expiries`,
      ns,
      endUserDigest,
    )
    return Number(result)
  }

  async cleanupExpiredClaims(nowEpochSeconds: number, limit: number): Promise<number> {
    return (await this.takeDueClaims(nowEpochSeconds, limit)).cleaned
  }

  async takeDueClaims(nowEpochSeconds: number, limit: number): Promise<{
    cleaned: number
    recoverable: MemberExportRecoverableClaim[]
  }> {
    if (!Number.isSafeInteger(nowEpochSeconds) || nowEpochSeconds <= 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('Invalid export claim cleanup input')
    }
    const ns = namespace()
    const result: unknown = await this.client.eval(
      `
      local digests = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
      local response = { 0 }
      for _, digest in ipairs(digests) do
        local key = ARGV[3] .. ':claim:' .. digest
        local raw = redis.call('GET', key)
        local recoverable = false
        if raw then
          local ok, wrapper = pcall(cjson.decode, raw)
          if ok and type(wrapper) == 'table' and type(wrapper.payload) == 'table' then
            local payload = wrapper.payload
            if wrapper.status == 'finishing' and type(payload.requestDigest) == 'string'
              and type(payload.endUserDigest) == 'string' then
              table.insert(response, digest)
              table.insert(response, cjson.encode(payload))
              redis.call('ZADD', KEYS[1], tonumber(ARGV[1]) + tonumber(ARGV[4]), digest)
              recoverable = true
            else
              if type(payload.requestDigest) == 'string' then
                local lease = ARGV[3] .. ':claim-request:' .. payload.requestDigest
                if redis.call('GET', lease) == digest then redis.call('DEL', lease) end
              end
              if type(payload.endUserDigest) == 'string' then
                redis.call('SREM', ARGV[3] .. ':claim-user:' .. payload.endUserDigest, digest)
              end
            end
          end
        end
        if not recoverable then
          redis.call('DEL', key)
          redis.call('ZREM', KEYS[1], digest)
          response[1] = response[1] + 1
        end
      end
      return response
      `,
      1,
      `${ns}:claim-expiries`,
      nowEpochSeconds,
      limit,
      ns,
      FINISH_RECOVERY_RETRY_SECONDS,
    )
    if (!Array.isArray(result) || typeof result[0] !== 'number' || (result.length - 1) % 2 !== 0) {
      throw new Error('Invalid export claim recovery result')
    }
    const recoverable: MemberExportRecoverableClaim[] = []
    for (let index = 1; index < result.length; index += 2) {
      const claimDigest = result[index]
      const rawPayload = result[index + 1]
      if (typeof claimDigest !== 'string' || typeof rawPayload !== 'string') {
        throw new Error('Invalid export claim recovery item')
      }
      assertDigest(claimDigest)
      const payload = JSON.parse(rawPayload) as MemberExportDownloadTicketPayload
      assertPayload(payload)
      recoverable.push({ claimDigest, payload })
    }
    return { cleaned: result[0], recoverable }
  }

  private async actOnClaim(
    claimDigest: string,
    action: 'begin' | 'complete' | 'abort',
  ): Promise<MemberExportDownloadClaimActionResult> {
    assertDigest(claimDigest)
    const ns = namespace()
    const result: unknown = await this.client.eval(
      `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return { 'missing' } end
      local ok, wrapper = pcall(cjson.decode, raw)
      if not ok or type(wrapper) ~= 'table' or type(wrapper.payload) ~= 'table'
        or type(wrapper.payload.requestDigest) ~= 'string' then return { 'missing' } end
      local lease = ARGV[2] .. ':claim-request:' .. wrapper.payload.requestDigest
      if redis.call('GET', lease) ~= ARGV[1] then return { 'mismatched' } end
      if ARGV[3] == 'begin' then
        if wrapper.status ~= 'active' and wrapper.status ~= 'finishing' then return { 'mismatched' } end
        wrapper.status = 'finishing'
        local ttl = math.max(redis.call('PTTL', KEYS[1]), tonumber(ARGV[4]))
        if ttl <= 0 then return { 'missing' } end
        redis.call('PSETEX', KEYS[1], ttl, cjson.encode(wrapper))
        redis.call('PEXPIRE', lease, ttl)
        local userIndex = ARGV[2] .. ':claim-user:' .. wrapper.payload.endUserDigest
        if redis.call('PTTL', userIndex) < ttl then redis.call('PEXPIRE', userIndex, ttl) end
        redis.call('ZADD', KEYS[2], tonumber(ARGV[5]), ARGV[1])
        return { 'matched', cjson.encode(wrapper.payload) }
      end
      if (ARGV[3] == 'complete' and wrapper.status ~= 'finishing')
        or (ARGV[3] == 'abort' and wrapper.status ~= 'active') then return { 'mismatched' } end
      if redis.call('GET', lease) == ARGV[1] then redis.call('DEL', lease) end
      redis.call('DEL', KEYS[1])
      redis.call('SREM', ARGV[2] .. ':claim-user:' .. wrapper.payload.endUserDigest, ARGV[1])
      redis.call('ZREM', KEYS[2], ARGV[1])
      return { 'matched', cjson.encode(wrapper.payload) }
      `,
      2,
      `${ns}:claim:${claimDigest}`,
      `${ns}:claim-expiries`,
      claimDigest,
      ns,
      action,
      FINISH_RECOVERY_TTL_MS,
      Math.floor(Date.now() / 1_000) + FINISH_RECOVERY_RETRY_SECONDS,
    )
    if (!Array.isArray(result) || typeof result[0] !== 'string') throw new Error('Invalid export claim action result')
    if (result[0] === 'matched' && typeof result[1] === 'string') return { status: 'matched', payload: result[1] }
    return { status: result[0] === 'mismatched' ? 'mismatched' : 'missing' }
  }
}

function namespace(): string {
  const value = process.env['MEMBER_EXPORT_REDIS_NAMESPACE']?.trim() || 'member:export'
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(value)) throw new Error('Invalid member export Redis namespace')
  return value
}

function assertDigest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid member export digest')
}

function assertPayload(payload: MemberExportDownloadTicketPayload): void {
  if (!payload.requestId || payload.requestId.length > 128 || !payload.endUserId || payload.endUserId.length > 128
    || !payload.fileId || payload.fileId.length > 128 || !Number.isSafeInteger(payload.executionVersion)
    || payload.executionVersion < 0) throw new Error('Invalid member export ticket payload')
  assertDigest(payload.requestDigest)
  assertDigest(payload.endUserDigest)
  if (payload.requestDigest !== sha256(payload.requestId) || payload.endUserDigest !== sha256(payload.endUserId)) {
    throw new Error('Invalid member export reverse index digest')
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertTtl(ttlSeconds: number): void {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 86_400) {
    throw new Error('Invalid member export TTL')
  }
}
