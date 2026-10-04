/**
 * verify:member-auth-races —— 1.8 排雷第一批（鉴权一路）三条竞态 / 异常路径（2026-09-29）
 *
 * 按规格断言：
 *   [C-3] 扫码登录的 pending → confirmed 只许发生一次：两个会员同时确认（都先读到 pending）时，
 *         恰好一人成功、另一人 409 QR_LOGIN_ALREADY_CONFIRMED，票据里记的是成功那一位。
 *         旧实现读后无条件覆盖：两人都「成功」，后写者覆盖前写者，一体机领到的是后一位的登录。
 *   [C-4] 换绑手机号先踢会话、再改手机号：踢会话失败时整单不改（503 REBIND_UNAVAILABLE），
 *         数据库里的手机号不变；踢会话成功才改库。
 *   [C-5] 扫码领取在取走票据后若签发失败，票据恢复、「已领取」标记撤掉，用户重试能拿到登录；
 *         成功领取后票据不可再领。
 *
 * 服务层用受控屏障造并发交错、内存 Redis 按生产 Lua 的语义实现；末段对真 Redis（REDIS_URL）直测
 * replaceExactWithCurrentTtl 的 Lua 本身——内存假库证明不了 Lua 写对了。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { createHash, randomBytes } from 'crypto'
import Redis from 'ioredis'
import { errorCode } from './support/internal-auth-verify-harness'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  ✅ ${name}`); return }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

class TtlRedis {
  readonly store = new Map<string, { value: string; ttl: number }>()
  revokeFails = false
  revoked: string[] = []
  async get(key: string): Promise<string | null> { return this.store.get(key)?.value ?? null }
  async ttl(key: string): Promise<number> { return this.store.get(key)?.ttl ?? -2 }
  async setEx(key: string, ttl: number, value: string): Promise<void> { this.store.set(key, { value, ttl }) }
  async del(key: string): Promise<number> { return this.store.delete(key) ? 1 : 0 }
  async setExistingWithCurrentTtl(key: string, value: string): Promise<'missing' | 'updated'> {
    const cur = this.store.get(key)
    if (!cur || cur.ttl <= 0) return 'missing'
    this.store.set(key, { value, ttl: cur.ttl })
    return 'updated'
  }
  async replaceExactWithCurrentTtl(key: string, expected: string, next: string): Promise<'missing' | 'changed' | 'updated'> {
    const cur = this.store.get(key)
    if (!cur) return 'missing'
    if (cur.value !== expected) return 'changed'
    if (cur.ttl <= 0) return 'missing'
    this.store.set(key, { value: next, ttl: cur.ttl })
    return 'updated'
  }
  async getDelAndSetEx(key: string, markerKey: string, markerTtl: number, markerValue: string): Promise<string | null> {
    const cur = this.store.get(key)
    if (!cur) return null
    this.store.delete(key)
    this.store.set(markerKey, { value: markerValue, ttl: markerTtl })
    return cur.value
  }
  async incrWithTtl(key: string, ttl: number): Promise<number> {
    const next = Number(this.store.get(key)?.value ?? '0') + 1
    this.store.set(key, { value: String(next), ttl })
    return next
  }
  async getAndDelIfEquals(key: string, expected: string): Promise<'missing' | 'matched' | 'mismatched'> {
    const cur = this.store.get(key)
    if (!cur) return 'missing'
    if (cur.value !== expected) return 'mismatched'
    this.store.delete(key)
    return 'matched'
  }
  async revokeMemberSessions(endUserId: string): Promise<number> {
    if (this.revokeFails) throw new Error('simulated Redis failure while revoking sessions')
    this.revoked.push(endUserId)
    return 2
  }
}

function barrier(n: number): () => Promise<void> {
  let arrived = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  return async () => {
    arrived += 1
    if (arrived >= n) release()
    await gate
  }
}

async function outcome(op: () => Promise<unknown>): Promise<{ ok: true; value: unknown } | { ok: false; status: number | null; code: string | undefined; message?: string }> {
  try {
    return { ok: true, value: await op() }
  } catch (error) {
    const status = typeof (error as { getStatus?: () => number }).getStatus === 'function' ? (error as { getStatus: () => number }).getStatus() : null
    return { ok: false, status, code: errorCode(error), message: status === null ? (error as Error).message : undefined }
  }
}

async function main(): Promise<void> {
  const { MemberQrLoginService } = await import('../src/member-auth/member-qr-login.service')
  const { MemberPhoneRebindService } = await import('../src/member-auth/member-phone-rebind.service')
  const { encryptPhone, hashPhone } = await import('../src/common/crypto/phone-identity')

  const ticketId = randomBytes(24).toString('base64url')
  const claimToken = randomBytes(24).toString('base64url')
  const claimTokenHash = createHash('sha256').update(claimToken).digest('hex')
  const terminalId = 'KSK-RACE'
  const seedTicket = (redis: TtlRedis) => redis.setEx(`member:qr:${ticketId}`, 180, JSON.stringify({
    status: 'pending', terminalId, claimTokenHash, deviceLabel: '门禁终端', returnTo: '/me', createdAt: new Date().toISOString(),
  }))
  const userA = { id: 'member-A', phoneMasked: '138****0001' }
  const userB = { id: 'member-B', phoneMasked: '139****0002' }
  const terminals = { validateTerminalToken: async () => undefined }

  console.log('\n[C-3] 扫码登录并发确认')
  {
    const redis = new TtlRedis()
    await seedTicket(redis)
    const both = barrier(2)
    const memberAuth = {
      // 两次确认都先读到 pending，再在屏障处汇合后各自写入 —— 真实并发里就是这个交错。
      verifySmsCodeForUser: async (phone: string) => { await both(); return phone.endsWith('1') ? userA : userB },
      me: async () => userB,
    }
    const service = new MemberQrLoginService(redis as never, memberAuth as never, terminals as never)
    const [a, b] = await Promise.all([
      outcome(() => service.confirm(ticketId, { phone: '13800000001', code: '000000' })),
      outcome(() => service.confirm(ticketId, { phone: '13900000002', code: '000000' })),
    ])
    const okCount = [a, b].filter((r) => r.ok).length
    const loser = [a, b].find((r) => !r.ok) as { code?: string } | undefined
    check('两人同时确认：恰好一人成功', okCount === 1, `成功 ${okCount} 人`)
    check('另一人被如实拒绝（409 QR_LOGIN_ALREADY_CONFIRMED）', loser?.code === 'QR_LOGIN_ALREADY_CONFIRMED', JSON.stringify([a, b]))
    const stored = JSON.parse((await redis.get(`member:qr:${ticketId}`)) ?? '{}') as { user?: { id?: string } }
    const winner = a.ok ? userA.id : userB.id
    check('票据里记的是成功确认的那一位（不被后写者覆盖）', stored.user?.id === winner, `stored=${stored.user?.id} winner=${winner}`)
  }
  {
    // 一个用短信确认、一个用已登录令牌确认，同样只许一个。
    const redis = new TtlRedis()
    await seedTicket(redis)
    const both = barrier(2)
    const memberAuth = {
      verifySmsCodeForUser: async () => { await both(); return userA },
      me: async () => { await both(); return userB },
    }
    const service = new MemberQrLoginService(redis as never, memberAuth as never, terminals as never)
    const [a, b] = await Promise.all([
      outcome(() => service.confirm(ticketId, { phone: '13800000001', code: '000000' })),
      outcome(() => service.confirmByToken(ticketId, userB.id)),
    ])
    check('短信确认与令牌确认同时到：也只许一个成功', [a, b].filter((r) => r.ok).length === 1, JSON.stringify([a, b]))
  }

  console.log('\n[C-5] 扫码领取失败后可重试')
  {
    const redis = new TtlRedis()
    await seedTicket(redis)
    let issueCalls = 0
    const memberAuth = {
      verifySmsCodeForUser: async () => userA,
      me: async () => userA,
      assertAccountLoginable: async () => undefined,
      persistResolvedLegalConsent: async () => undefined,
      issueLoginForUser: async (user: { id: string }) => {
        issueCalls += 1
        if (issueCalls === 1) throw new Error('simulated session issue failure')
        return { token: `token-for-${user.id}`, user }
      },
    }
    const service = new MemberQrLoginService(redis as never, memberAuth as never, terminals as never)
    await service.confirm(ticketId, { phone: '13800000001', code: '000000' })
    const first = await outcome(() => service.claim(ticketId, claimToken, terminalId, 'Bearer terminal'))
    check('第一次领取签发失败如实报错', !first.ok, JSON.stringify(first))
    check('失败后票据已恢复、「已领取」标记已撤', (await redis.get(`member:qr:${ticketId}`)) !== null && (await redis.get(`member:qr:claimed:${ticketId}`)) === null)
    const second = await outcome(() => service.claim(ticketId, claimToken, terminalId, 'Bearer terminal'))
    check('重试领取拿到登录', second.ok && (second.value as { token?: string }).token === `token-for-${userA.id}`, JSON.stringify(second))
    const third = await outcome(() => service.claim(ticketId, claimToken, terminalId, 'Bearer terminal'))
    check('领取成功后不能再领（410 QR_LOGIN_ALREADY_CLAIMED）', !third.ok && third.code === 'QR_LOGIN_ALREADY_CLAIMED', JSON.stringify(third))
  }

  {
    // 恢复本身失败（这里是同步抛错）时，调用方必须拿到原始错误，而不是恢复时的故障。
    const redis = new TtlRedis()
    await seedTicket(redis)
    const memberAuth = {
      verifySmsCodeForUser: async () => userA,
      assertAccountLoginable: async () => undefined,
      persistResolvedLegalConsent: async () => undefined,
      issueLoginForUser: async () => { throw new Error('original issue failure') },
    }
    const service = new MemberQrLoginService(redis as never, memberAuth as never, terminals as never)
    await service.confirm(ticketId, { phone: '13800000001', code: '000000' })
    ;(redis as unknown as { setEx: unknown }).setEx = () => { throw new TypeError('restore exploded') }
    const r = await outcome(() => service.claim(ticketId, claimToken, terminalId, 'Bearer terminal'))
    check('恢复票据失败也不盖掉原始错误', !r.ok && r.message === 'original issue failure', JSON.stringify(r))
  }
  console.log('\n[C-4] 换绑手机号：先踢会话再改库')
  const newPhone = '13700000003'
  const setupRebind = async (revokeFails: boolean) => {
    const redis = new TtlRedis()
    redis.revokeFails = revokeFails
    await redis.setEx(`member:sms:code:${hashPhone(newPhone)}`, 300, '123456')
    const updates: unknown[] = []
    const prisma = {
      endUser: {
        findUnique: async ({ where }: { where: { id?: string; phoneHash?: string } }) =>
          where.phoneHash ? null : { phoneEnc: encryptPhone('13800000001'), enabled: true, status: 'active' },
        update: async (args: unknown) => { updates.push(args); return {} },
      },
    }
    const stepUp = { consumeGrant: async () => undefined }
    const audit = { write: async () => 'audit' }
    const service = new MemberPhoneRebindService(prisma as never, redis as never, stepUp as never, audit as never)
    return { service, redis, updates }
  }
  {
    const { service, updates } = await setupRebind(true)
    const r = await outcome(() => service.rebind('member-A', 'step-up', newPhone, '123456'))
    check('踢会话失败：整单不改、如实 503 REBIND_UNAVAILABLE', !r.ok && r.status === 503 && r.code === 'REBIND_UNAVAILABLE', JSON.stringify(r))
    check('踢会话失败：数据库里的手机号一次都没改', updates.length === 0, `update 次数 ${updates.length}`)
  }
  {
    const { service, redis, updates } = await setupRebind(false)
    const r = await outcome(() => service.rebind('member-A', 'step-up', newPhone, '123456'))
    check('踢会话成功后才改手机号', r.ok && redis.revoked.includes('member-A') && updates.length === 1, JSON.stringify(r))
  }

  console.log('\n[C-3] 真 Redis：replaceExactWithCurrentTtl 的 Lua')
  {
    const redisUrl = process.env['REDIS_URL']
    if (!redisUrl) {
      check('需要 REDIS_URL 才能直测 Lua（CI 两个作业都有）', false)
    } else {
      const { RedisService } = await import('../src/common/redis/redis.service')
      const raw = new Redis(redisUrl, { maxRetriesPerRequest: 1 })
      const real = new RedisService(raw)
      const key = `verify:member-auth-races:${randomBytes(8).toString('hex')}`
      try {
        await raw.set(key, 'pending-json', 'EX', 120)
        check('原值相符：写入并返回 updated', (await real.replaceExactWithCurrentTtl(key, 'pending-json', 'confirmed-A')) === 'updated' && (await raw.get(key)) === 'confirmed-A')
        const ttl = await raw.ttl(key)
        check('写入保留原有效期（不续命、不变永久）', ttl > 0 && ttl <= 120, `ttl=${ttl}`)
        check('原值已变：返回 changed、不覆盖', (await real.replaceExactWithCurrentTtl(key, 'pending-json', 'confirmed-B')) === 'changed' && (await raw.get(key)) === 'confirmed-A')
        await raw.del(key)
        check('键已不在：返回 missing、不凭空建键', (await real.replaceExactWithCurrentTtl(key, 'pending-json', 'confirmed-B')) === 'missing' && (await raw.exists(key)) === 0)
        await raw.set(key, 'pending-json')
        check('没有有效期的键：返回 missing、不改', (await real.replaceExactWithCurrentTtl(key, 'pending-json', 'confirmed-B')) === 'missing' && (await raw.get(key)) === 'pending-json')
      } finally {
        await raw.del(key).catch(() => undefined)
        raw.disconnect()
      }
    }
  }

  console.log(`\nverify:member-auth-races：${checks - failures}/${checks} 通过`)
  if (failures > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
