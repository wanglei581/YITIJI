/**
 * verify:admin-login-hardening —— P1-4 管理员登录加固（2026-09-29；feature-scope §七 #27）
 *
 * 按规格写的断言（不是照现状写的）：
 *   [A] 密码登录次数闸门：Redis 不可用 / 拒绝写入时拒绝登录（失败关闭，503 AUTH_LOGIN_UNAVAILABLE），
 *       正确密码也不行；并发错误密码最多只有上限次数能走到比对；5 次后锁定、成功后清零、未知账号同样计数。
 *   [B] 管理员来源地址名单（ADMIN_IP_ALLOWLIST）：登录入口在动计数器之前就拒；已登录请求（守卫）与
 *       混合鉴权路由都拒；IPv4 映射地址、CIDR、IPv6 都认；写错配置时失败关闭；合作机构不受影响。
 *   [C] 管理员短信第二步（ADMIN_LOGIN_SECOND_FACTOR=sms）：密码通过只拿到一次性第二步凭证、不签发登录凭证；
 *       验证码错不作废凭证、对了才签发；凭证一次性、改密后作废、伪造无效；登录用途的验证码过不了第二步；
 *       没绑手机的管理员被拒；管理员「只用短信登录」被关；合作机构不受影响；首位管理员受控改密不受影响。
 *   [D] /health 的 Redis 降级影响声明写明「内部账号新登录不可用」（HTTP 实测在 verify:redis-degradation-truth）。
 *
 * 真实 Prisma（隔离 SQLite）+ 共享内存 Redis（原子预留语义与生产 Lua 一致）+ 捕获短信，不连外网。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { randomBytes, randomUUID } from 'crypto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { CapturingSmsSender, MemoryRedis, RecordingAudit, errorCode } from './support/internal-auth-verify-harness'

assertIsolatedVerificationDatabase()
process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-admin-login-hardening-key-32-bytes-minimum'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  ✅ ${name}`); return }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

async function outcome(op: () => Promise<unknown>): Promise<{ ok: true; value: unknown } | { ok: false; status: number | null; code: string | undefined }> {
  try {
    return { ok: true, value: await op() }
  } catch (error) {
    const status = typeof (error as { getStatus?: () => number }).getStatus === 'function'
      ? (error as { getStatus: () => number }).getStatus()
      : null
    return { ok: false, status, code: errorCode(error) }
  }
}

function describe(result: Awaited<ReturnType<typeof outcome>>): string {
  return result.ok ? `成功：${JSON.stringify(result.value).slice(0, 120)}` : `失败 ${result.status ?? '-'} ${result.code ?? ''}`
}

async function main(): Promise<void> {
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { AuthService } = await import('../src/auth/auth.service')
  const { InternalOtpService } = await import('../src/auth/internal-otp.service')
  const { JwtAuthGuard } = await import('../src/common/guards/jwt-auth.guard')
  const { resolveOptionalInternalUser } = await import('../src/common/auth/optional-internal-user')
  const { resetRedisCooldownForTests, REDIS_DEGRADED_IMPACT } = await import('../src/common/redis/redis-degradation')
  const { resetAdminIpAllowlistCacheForTests } = await import('../src/common/auth/admin-ip-allowlist')
  const { encryptPhone, hashPhone } = await import('../src/common/crypto/phone-identity')
  const { FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION } = await import('../src/auth/first-admin-bootstrap')

  const secret = process.env['JWT_SECRET'] && process.env['JWT_SECRET'].length >= 16
    ? process.env['JWT_SECRET']
    : 'verify-admin-login-hardening-jwt'
  const realJwt = new JwtService({ secret, signOptions: { expiresIn: '1h' } })
  let signs = 0
  const countingJwt = {
    sign: (payload: object) => { signs += 1; return realJwt.sign(payload) },
    verify: realJwt.verify.bind(realJwt),
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const password = `Verify-${suffix}-Aa1!`
  const hash = await bcrypt.hash(password, 4)
  const phoneOf = (n: number) => `139${String(Date.now()).slice(-7)}${n}`.slice(0, 11)
  const adminPhone = phoneOf(1)
  const orgId = `vah-org-${suffix}`
  const ids = {
    admin: `vah-admin-${suffix}`,
    adminNoPhone: `vah-admin-nophone-${suffix}`,
    adminLock: `vah-admin-lock-${suffix}`,
    adminRace: `vah-admin-race-${suffix}`,
    adminTemp: `vah-admin-temp-${suffix}`,
    adminTempNoAudit: `vah-admin-temp-noaudit-${suffix}`,
    partner: `vah-partner-${suffix}`,
  }
  const usernames = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, `u-${v}`])) as Record<keyof typeof ids, string>
  const envBackup = {
    allow: process.env['ADMIN_IP_ALLOWLIST'],
    second: process.env['ADMIN_LOGIN_SECOND_FACTOR'],
    nodeEnv: process.env['NODE_ENV'],
  }
  const setEnv = (allow: string | undefined, second: string | undefined): void => {
    if (allow === undefined) delete process.env['ADMIN_IP_ALLOWLIST']
    else process.env['ADMIN_IP_ALLOWLIST'] = allow
    if (second === undefined) delete process.env['ADMIN_LOGIN_SECOND_FACTOR']
    else process.env['ADMIN_LOGIN_SECOND_FACTOR'] = second
    resetAdminIpAllowlistCacheForTests()
  }

  const cleanup = async (): Promise<void> => {
    setEnv(envBackup.allow, envBackup.second)
    if (envBackup.nodeEnv === undefined) delete process.env['NODE_ENV']
    else process.env['NODE_ENV'] = envBackup.nodeEnv
    await prisma.auditLog.deleteMany({ where: { targetId: { in: Object.values(ids) } } })
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
    await prisma.onModuleDestroy()
  }

  try {
    setEnv(undefined, undefined)
    await prisma.organization.create({ data: { id: orgId, name: `门禁机构 ${suffix}`, type: 'school', enabled: true } })
    const base = { passwordHash: hash, passwordProofState: 'owner_managed', role: 'admin', enabled: true, tokenVersion: 0 }
    await prisma.user.create({ data: {
      ...base, id: ids.admin, username: usernames.admin, name: '门禁管理员',
      phoneHash: hashPhone(adminPhone), phoneEnc: encryptPhone(adminPhone), phoneVerifiedAt: new Date(),
    } })
    await prisma.user.create({ data: { ...base, id: ids.adminNoPhone, username: usernames.adminNoPhone, name: '未绑手机管理员' } })
    await prisma.user.create({ data: { ...base, id: ids.adminLock, username: usernames.adminLock, name: '锁定用管理员' } })
    await prisma.user.create({ data: { ...base, id: ids.adminRace, username: usernames.adminRace, name: '并发用管理员' } })
    await prisma.user.create({ data: {
      ...base, id: ids.adminTemp, username: usernames.adminTemp, name: '首位管理员（临时密码）', passwordProofState: 'temporary',
    } })
    await prisma.user.create({ data: {
      ...base, id: ids.adminTempNoAudit, username: usernames.adminTempNoAudit, name: '临时密码管理员（无初始化审计）',
      passwordProofState: 'temporary', phoneHash: hashPhone(phoneOf(2)), phoneEnc: encryptPhone(phoneOf(2)), phoneVerifiedAt: new Date(),
    } })
    await prisma.user.create({ data: { ...base, id: ids.partner, username: usernames.partner, name: '门禁机构账号', role: 'partner', orgId } })

    const build = (redis: unknown) => {
      const sms = new CapturingSmsSender()
      const otp = new InternalOtpService(redis as never, sms)
      const audit = new RecordingAudit()
      const auth = new AuthService(countingJwt as never, prisma as never, redis as never, otp, audit as never)
      return { auth, sms, otp, audit }
    }

    // ── [A] 次数闸门 ─────────────────────────────────────────────────────────
    console.log('\n[A] 密码登录次数闸门（失败关闭、原子预留）')
    {
      const healthy = build(new MemoryRedis())
      const control = await outcome(() => healthy.auth.login(usernames.admin, password, 'admin', '127.0.0.1'))
      check('阳性对照：Redis 正常时正确密码能登录', control.ok && typeof (control.value as { token?: unknown }).token === 'string', describe(control))

      const dead = new Proxy({}, { get: () => async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { name: 'Error' }) } })
      resetRedisCooldownForTests()
      const signsBefore = signs
      const refused = await outcome(() => build(dead).auth.login(usernames.admin, password, 'admin', '127.0.0.1'))
      check('Redis 连不上时正确密码也被拒（503 AUTH_LOGIN_UNAVAILABLE）',
        !refused.ok && refused.status === 503 && refused.code === 'AUTH_LOGIN_UNAVAILABLE', describe(refused))
      check('Redis 连不上时没有签发任何登录凭证', signs === signsBefore, `signs +${signs - signsBefore}`)
      resetRedisCooldownForTests()

      // Redis 活着但拒绝写入（例如内存满 noeviction）：读得到、预留写不进 —— 也必须拒。
      const rejecting = new MemoryRedis() as unknown as Record<string, unknown>
      rejecting['reserveWithinLimitWithTtl'] = async () => { throw Object.assign(new Error('OOM command not allowed'), { name: 'ReplyError' }) }
      const rejected = await outcome(() => build(rejecting).auth.login(usernames.admin, password, 'admin', '127.0.0.1'))
      check('Redis 拒绝写入时正确密码也被拒（不因「读得到计数」而放行）',
        !rejected.ok && rejected.status === 503 && rejected.code === 'AUTH_LOGIN_UNAVAILABLE', describe(rejected))
      resetRedisCooldownForTests()
    }
    {
      const { auth } = build(new MemoryRedis())
      for (let i = 0; i < 5; i += 1) await outcome(() => auth.login(usernames.adminLock, 'wrong-password', 'admin', '127.0.0.1'))
      const sixth = await outcome(() => auth.login(usernames.adminLock, password, 'admin', '127.0.0.1'))
      check('连续 5 次错误后，第 6 次即使密码正确也被锁定（429 AUTH_LOGIN_LOCKED）',
        !sixth.ok && sixth.status === 429 && sixth.code === 'AUTH_LOGIN_LOCKED', describe(sixth))
    }
    {
      const redis = new MemoryRedis()
      const { auth } = build(redis)
      for (let i = 0; i < 4; i += 1) await outcome(() => auth.login(usernames.admin, 'wrong-password', 'admin', '127.0.0.1'))
      const success = await outcome(() => auth.login(usernames.admin, password, 'admin', '127.0.0.1'))
      check('4 次错误后正确密码能登录', success.ok, describe(success))
      let allowedAfterReset = 0
      for (let i = 0; i < 5; i += 1) {
        const r = await outcome(() => auth.login(usernames.admin, 'wrong-password', 'admin', '127.0.0.1'))
        if (!r.ok && r.code === 'AUTH_LOGIN_FAILED') allowedAfterReset += 1
      }
      check('登录成功后计数清零（之后又能试满 5 次才锁）', allowedAfterReset === 5, `只试了 ${allowedAfterReset} 次`)
    }
    {
      const { auth } = build(new MemoryRedis())
      const ghost = `ghost-${suffix}`
      for (let i = 0; i < 5; i += 1) await outcome(() => auth.login(ghost, 'wrong-password', 'admin', '127.0.0.1'))
      const sixth = await outcome(() => auth.login(ghost, 'wrong-password', 'admin', '127.0.0.1'))
      check('不存在的账号同样计数并锁定（不暴露账号是否存在）', !sixth.ok && sixth.status === 429, describe(sixth))
    }
    {
      // 并发：12 个错误密码同时到达，只有前 5 个能走到数据库查账号与比对密码。
      let reached = 0
      const raceUser = await prisma.user.findUniqueOrThrow({ where: { id: ids.adminRace } })
      const countingPrisma = {
        user: {
          findFirst: async () => { reached += 1; await new Promise((resolve) => setImmediate(resolve)); return raceUser },
          updateMany: prisma.user.updateMany.bind(prisma.user),
        },
        organization: prisma.organization,
      }
      const redis = new MemoryRedis()
      const auth = new AuthService(countingJwt as never, countingPrisma as never, redis as never, new InternalOtpService(redis as never, new CapturingSmsSender()), new RecordingAudit() as never)
      const results = await Promise.all(Array.from({ length: 12 }, () => outcome(() => auth.login(usernames.adminRace, 'wrong-password', 'admin', '127.0.0.1'))))
      const locked = results.filter((r) => !r.ok && r.code === 'AUTH_LOGIN_LOCKED').length
      check(`并发 12 次错误密码：最多 5 次走到比对（实际 ${reached}），其余直接锁定（${locked}）`, reached <= 5 && locked >= 7, `reached=${reached} locked=${locked}`)
    }

    // ── [B] 来源地址名单 ─────────────────────────────────────────────────────
    console.log('\n[B] 管理员来源地址名单')
    {
      setEnv('203.0.113.0/24, 2001:db8::1', undefined)
      const redis = new MemoryRedis()
      const { auth } = build(redis)
      const outside = await outcome(() => auth.login(usernames.admin, password, 'admin', '198.51.100.9'))
      check('名单外地址的管理员登录被拒（403 AUTH_ADMIN_IP_FORBIDDEN）', !outside.ok && outside.status === 403 && outside.code === 'AUTH_ADMIN_IP_FORBIDDEN', describe(outside))
      check('名单外地址被拒时没有动任何尝试计数（在比对与计数之前就拒）', redis.keysWithPrefix('internal:password-login:').length === 0,
        redis.keysWithPrefix('internal:password-login:').join(','))
      const noIp = await outcome(() => auth.login(usernames.admin, password, 'admin', null))
      check('拿不到来源地址时管理员登录被拒', !noIp.ok && noIp.code === 'AUTH_ADMIN_IP_FORBIDDEN', describe(noIp))
      for (const ip of ['203.0.113.44', '::ffff:203.0.113.44', '2001:db8::1']) {
        const inside = await outcome(() => auth.login(usernames.admin, password, 'admin', ip))
        check(`名单内地址 ${ip} 的管理员能登录`, inside.ok, describe(inside))
      }
      const partner = await outcome(() => auth.login(usernames.partner, password, 'partner', '198.51.100.9'))
      check('合作机构账号不受管理员地址名单影响', partner.ok, describe(partner))
      const smsOutside = await outcome(() => auth.sendSmsCode({ phone: adminPhone, purpose: 'login', portal: 'admin' }, '198.51.100.9'))
      check('名单外地址不给管理员发登录验证码', !smsOutside.ok && smsOutside.code === 'AUTH_ADMIN_IP_FORBIDDEN', describe(smsOutside))

      // 已登录请求：守卫与混合鉴权路由。
      const adminRow = await prisma.user.findUniqueOrThrow({ where: { id: ids.admin } })
      const adminToken = realJwt.sign({ sub: ids.admin, role: 'admin', orgId: null, ver: adminRow.tokenVersion, jti: randomUUID() })
      const partnerRow = await prisma.user.findUniqueOrThrow({ where: { id: ids.partner } })
      const partnerToken = realJwt.sign({ sub: ids.partner, role: 'partner', orgId, ver: partnerRow.tokenVersion, jti: randomUUID() })
      const guard = new JwtAuthGuard(realJwt, prisma, redis as never)
      const ctx = (token: string, ip: string) => ({
        switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` }, ip }) }),
      }) as never
      const guardOutside = await outcome(() => guard.canActivate(ctx(adminToken, '198.51.100.9')))
      check('已登录的管理员请求从名单外地址来被拒（守卫 403）', !guardOutside.ok && guardOutside.status === 403 && guardOutside.code === 'AUTH_ADMIN_IP_FORBIDDEN', describe(guardOutside))
      const guardInside = await outcome(() => guard.canActivate(ctx(adminToken, '203.0.113.5')))
      check('已登录的管理员请求从名单内地址来放行（阳性对照）', guardInside.ok && guardInside.value === true, describe(guardInside))
      const guardPartner = await outcome(() => guard.canActivate(ctx(partnerToken, '198.51.100.9')))
      check('合作机构已登录请求不受名单影响', guardPartner.ok && guardPartner.value === true, describe(guardPartner))
      const mixed = await outcome(() => resolveOptionalInternalUser(`Bearer ${adminToken}`, realJwt, redis as never, prisma, '198.51.100.9'))
      check('混合鉴权路由：管理员令牌从名单外来直接 403，不退回会员 / 匿名分支', !mixed.ok && mixed.code === 'AUTH_ADMIN_IP_FORBIDDEN', describe(mixed))

      setEnv('203.0.113.0/24, not-an-ip', undefined)
      const broken = await outcome(() => build(new MemoryRedis()).auth.login(usernames.admin, password, 'admin', '203.0.113.44'))
      check('名单写错时失败关闭（403 AUTH_ADMIN_IP_CONFIG_INVALID），名单内地址也进不来', !broken.ok && broken.code === 'AUTH_ADMIN_IP_CONFIG_INVALID', describe(broken))
      const brokenPartner = await outcome(() => build(new MemoryRedis()).auth.login(usernames.partner, password, 'partner', '198.51.100.9'))
      check('名单写错不影响合作机构登录', brokenPartner.ok, describe(brokenPartner))
      setEnv(undefined, undefined)
      const unrestricted = await outcome(() => build(new MemoryRedis()).auth.login(usernames.admin, password, 'admin', '198.51.100.9'))
      check('不设名单时不限制（今天的行为不变）', unrestricted.ok, describe(unrestricted))
    }

    // ── [C] 短信第二步 ───────────────────────────────────────────────────────
    console.log('\n[C] 管理员短信第二步')
    {
      setEnv(undefined, undefined)
      const off = build(new MemoryRedis())
      const direct = await outcome(() => off.auth.login(usernames.admin, password, 'admin', '127.0.0.1'))
      check('开关关着：管理员密码登录直接拿到登录凭证（今天的行为）', direct.ok && typeof (direct.value as { token?: unknown }).token === 'string', describe(direct))
      const offRoute = await outcome(() => off.auth.completeAdminSecondFactor(`${ids.admin}.${randomBytes(32).toString('base64url')}`, '123456', '127.0.0.1'))
      check('开关关着：第二步入口如实告知未开启（400 AUTH_SECOND_FACTOR_DISABLED）', !offRoute.ok && offRoute.code === 'AUTH_SECOND_FACTOR_DISABLED', describe(offRoute))

      setEnv(undefined, 'sms')
      const redis = new MemoryRedis()
      const on = build(redis)
      const signsBefore = signs
      const first = await outcome(() => on.auth.login(usernames.admin, password, 'admin', '127.0.0.1'))
      const challenge = first.ok ? first.value as { secondFactorRequired?: boolean; challengeTicket?: string; codeSent?: boolean; token?: unknown } : null
      check('开关打开：密码通过后只返回第二步凭证，不含登录凭证',
        !!challenge?.secondFactorRequired && typeof challenge.challengeTicket === 'string' && challenge.token === undefined, describe(first))
      check('开关打开：密码这一步没有签发任何登录凭证', signs === signsBefore, `signs +${signs - signsBefore}`)
      check('开关打开：给绑定手机号发了一条第二步验证码', challenge?.codeSent === true && on.sms.deliveries === 1 && !!on.sms.lastCode, `deliveries=${on.sms.deliveries}`)
      const ticket = challenge?.challengeTicket ?? ''
      const goodCode = on.sms.lastCode ?? ''
      const badCode = goodCode === '000000' ? '111111' : '000000'

      // 登录用途的验证码不能拿来过第二步。
      await redis.setEx(`internal:sms:code:login:${hashPhone(adminPhone)}`, 300, badCode)
      const crossPurpose = await outcome(() => on.auth.completeAdminSecondFactor(ticket, badCode, '127.0.0.1'))
      check('登录用途的验证码过不了第二步', !crossPurpose.ok && crossPurpose.code === 'SMS_CODE_INVALID', describe(crossPurpose))
      const stillValid = await outcome(() => on.auth.completeAdminSecondFactor(ticket, goodCode, '127.0.0.1'))
      check('验证码错一次不作废凭证：正确验证码随后换到登录凭证', stillValid.ok && typeof (stillValid.value as { token?: unknown }).token === 'string', describe(stillValid))
      check('第二步成功写了带 secondFactor 的登录审计',
        on.audit.entries.some((e) => e.action === 'auth.password_login' && e.payload?.['secondFactor'] === 'sms'), '')
      const reuse = await outcome(() => on.auth.completeAdminSecondFactor(ticket, goodCode, '127.0.0.1'))
      check('第二步凭证一次性：再用被拒', !reuse.ok && reuse.code === 'AUTH_SECOND_FACTOR_CHALLENGE_INVALID', describe(reuse))

      const forged = await outcome(() => on.auth.completeAdminSecondFactor(`${ids.admin}.${randomBytes(32).toString('base64url')}`, goodCode, '127.0.0.1'))
      check('伪造的第二步凭证被拒', !forged.ok && forged.code === 'AUTH_SECOND_FACTOR_CHALLENGE_INVALID', describe(forged))

      // 发出第二步之后改了密码（tokenVersion 提升）：旧凭证作废。
      redis.advanceSeconds(61)
      const again = await outcome(() => on.auth.login(usernames.admin, password, 'admin', '127.0.0.1'))
      const ticket2 = again.ok ? (again.value as { challengeTicket?: string }).challengeTicket ?? '' : ''
      const code2 = on.sms.lastCode ?? ''
      await prisma.user.update({ where: { id: ids.admin }, data: { tokenVersion: { increment: 1 } } })
      const afterChange = await outcome(() => on.auth.completeAdminSecondFactor(ticket2, code2, '127.0.0.1'))
      check('发出第二步后改过密码或被撤销会话：旧凭证作废', !afterChange.ok && afterChange.code === 'AUTH_SECOND_FACTOR_CHALLENGE_INVALID', describe(afterChange))

      const noPhone = await outcome(() => on.auth.login(usernames.adminNoPhone, password, 'admin', '127.0.0.1'))
      check('没绑手机的管理员被如实拒绝（403 AUTH_SECOND_FACTOR_NOT_ENROLLED），不退回只验密码',
        !noPhone.ok && noPhone.status === 403 && noPhone.code === 'AUTH_SECOND_FACTOR_NOT_ENROLLED', describe(noPhone))

      const deliveriesBefore = on.sms.deliveries
      redis.advanceSeconds(61)
      const smsCode = await outcome(() => on.auth.sendSmsCode({ phone: adminPhone, purpose: 'login', portal: 'admin' }, '127.0.0.1'))
      check('开关打开：管理员「只用短信登录」不再发验证码', !smsCode.ok && smsCode.code === 'AUTH_ADMIN_SMS_LOGIN_REQUIRES_PASSWORD' && on.sms.deliveries === deliveriesBefore, describe(smsCode))
      const smsLogin = await outcome(() => on.auth.loginWithSms(adminPhone, '123456', 'admin', '127.0.0.1'))
      check('开关打开：管理员「只用短信登录」被关', !smsLogin.ok && smsLogin.code === 'AUTH_ADMIN_SMS_LOGIN_REQUIRES_PASSWORD', describe(smsLogin))

      const partner = await outcome(() => on.auth.login(usernames.partner, password, 'partner', '127.0.0.1'))
      check('开关打开：合作机构密码登录不受影响', partner.ok && typeof (partner.value as { token?: unknown }).token === 'string', describe(partner))

      // 60 秒冷却内（刚给同一号码发过别的验证码）：凭证照发、codeSent=false；冷却后重发成功。
      const cooldownRedis = new MemoryRedis()
      const cd = build(cooldownRedis)
      await cooldownRedis.setNxEx(`internal:sms:cooldown:global:${hashPhone(adminPhone)}`, 'other-purpose', 60)
      const cdLogin = await outcome(() => cd.auth.login(usernames.admin, password, 'admin', '127.0.0.1'))
      const cdChallenge = cdLogin.ok ? cdLogin.value as { codeSent?: boolean; challengeTicket?: string } : null
      check('冷却中：仍返回第二步凭证但如实标 codeSent=false', cdChallenge?.codeSent === false && typeof cdChallenge.challengeTicket === 'string', describe(cdLogin))
      cooldownRedis.advanceSeconds(61)
      const resend = await outcome(() => cd.auth.resendAdminSecondFactor(cdChallenge?.challengeTicket ?? '', '127.0.0.1'))
      check('冷却结束后「重新发送」真的发出验证码', resend.ok && (resend.value as { codeSent?: boolean }).codeSent === true && cd.sms.deliveries === 1, describe(resend))
      const badResend = await outcome(() => cd.auth.resendAdminSecondFactor(`${ids.admin}.${randomBytes(32).toString('base64url')}`, '127.0.0.1'))
      check('无效凭证不能触发重发', !badResend.ok && badResend.code === 'AUTH_SECOND_FACTOR_CHALLENGE_INVALID', describe(badResend))

      // 首位管理员（临时密码 + 初始化审计）：只换得到受控改密凭证，不走第二步。
      process.env['NODE_ENV'] = 'development'
      await prisma.auditLog.create({ data: {
        actorId: null, actorRole: 'system', action: FIRST_ADMIN_BOOTSTRAP_AUDIT_ACTION, targetType: 'auth', targetId: ids.adminTemp, payloadJson: '{}',
      } })
      const temp = await outcome(() => build(new MemoryRedis()).auth.login(usernames.adminTemp, password, 'admin', '127.0.0.1'))
      check('首位管理员初始化（临时密码）不走第二步，仍拿到受控改密凭证', temp.ok && (temp.value as { passwordChangeRequired?: boolean }).passwordChangeRequired === true, describe(temp))
      const tempNoAuditSigns = signs
      const tempNoAudit = await outcome(() => build(new MemoryRedis()).auth.login(usernames.adminTempNoAudit, password, 'admin', '127.0.0.1'))
      check('临时密码但不是首位管理员初始化：照样走第二步，不因「临时密码」直接拿到登录凭证',
        tempNoAudit.ok && (tempNoAudit.value as { secondFactorRequired?: boolean }).secondFactorRequired === true && signs === tempNoAuditSigns, describe(tempNoAudit))
      if (envBackup.nodeEnv === undefined) delete process.env['NODE_ENV']
      else process.env['NODE_ENV'] = envBackup.nodeEnv
      setEnv(undefined, undefined)
    }

    // ── [D] /health 影响声明 ─────────────────────────────────────────────────
    console.log('\n[D] Redis 降级影响声明')
    check('REDIS_DEGRADED_IMPACT 声明「内部账号新登录」在 Redis 不可用时不可用',
      (REDIS_DEGRADED_IMPACT as Record<string, string>)['internal-password-login'] === 'unavailable',
      JSON.stringify(REDIS_DEGRADED_IMPACT))
  } finally {
    await cleanup()
  }

  console.log(`\nverify:admin-login-hardening：${checks - failures}/${checks} 通过`)
  if (failures > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
