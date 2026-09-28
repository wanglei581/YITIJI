/**
 * verify:sms-budget —— P1-5 短信验证码发送额度（2026-09-29）
 *
 * 按规格断言：
 *   [A] 额度层本身：全站每日总量、单终端每日上限、先预留后发；满了不发（429 且说清是哪种额度）；
 *       单终端满了时不白占全站额度；服务商明确拒发退回额度、超时 / 网络中断不退；Redis 核不了额度时不发（503）；
 *       按北京时间自然日分桶；非法配置回落默认值而不是变成「不限」。
 *   [B] 接线：内部账号与会员两个模块注册的 SMS_SENDER 都是带额度的发送器；会员发码把已验签的终端编号带到额度层；
 *       控制器对「带了终端编号却验不过签」一律拒绝、不发短信（防冒用别台编号刷光它的额度）。
 *   [C] 端到端：会员发码撞到单终端上限时不留下可用的验证码；内部账号验证码撞到全站上限同样不发；
 *       未知号码走「不下发」分支时不占额度。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { CapturingSmsSender, MemoryRedis, errorCode } from './support/internal-auth-verify-harness'

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
  return result.ok ? '成功' : `失败 ${result.status ?? '-'} ${result.code ?? ''}`
}

class MetaCapturingSender extends CapturingSmsSender {
  readonly metas: Array<{ terminalId?: string | null } | undefined> = []
  override async sendCode(phone: string, code: string, meta?: { terminalId?: string | null }): Promise<void> {
    this.metas.push(meta)
    await super.sendCode(phone, code)
  }
}

async function main(): Promise<void> {
  process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-sms-budget-secret-key-32-bytes-minimum'
  const {
    BudgetedSmsSender, readSmsBudgetLimits, shanghaiDay, smsBudgetGlobalKey, smsBudgetTerminalKey,
    createBudgetedSmsSender, DEFAULT_SMS_DAILY_TOTAL_LIMIT, DEFAULT_SMS_TERMINAL_DAILY_LIMIT,
  } = await import('../src/member-auth/sms/sms-budget')
  const { SMS_SENDER, SmsSendError } = await import('../src/member-auth/sms/sms-sender')
  const { resetRedisCooldownForTests } = await import('../src/common/redis/redis-degradation')
  const { RedisService } = await import('../src/common/redis/redis.service')

  const fixedNow = new Date('2026-09-29T04:00:00Z')
  const now = () => fixedNow
  const day = shanghaiDay(fixedNow)

  // ── [A] 额度层 ─────────────────────────────────────────────────────────────
  console.log('\n[A] 额度层本身')
  {
    const redis = new MemoryRedis()
    const inner = new MetaCapturingSender()
    const sender = new BudgetedSmsSender(inner, redis as never, { dailyTotal: 3, terminalDaily: 2 }, now)
    for (let i = 0; i < 3; i += 1) await sender.sendCode(`1380000000${i}`, '123456')
    const fourth = await outcome(() => sender.sendCode('13800000009', '123456'))
    check('全站每日总量满了第 4 条不发（429 SMS_DAILY_TOTAL_LIMIT）', !fourth.ok && fourth.status === 429 && fourth.code === 'SMS_DAILY_TOTAL_LIMIT', describe(fourth))
    check('全站满了时服务商一条都没多发', inner.deliveries === 3, `deliveries=${inner.deliveries}`)
  }
  {
    const redis = new MemoryRedis()
    const inner = new MetaCapturingSender()
    const sender = new BudgetedSmsSender(inner, redis as never, { dailyTotal: 50, terminalDaily: 2 }, now)
    await sender.sendCode('13800000001', '111111', { terminalId: 'KSK-A' })
    await sender.sendCode('13800000002', '111111', { terminalId: 'KSK-A' })
    const third = await outcome(() => sender.sendCode('13800000003', '111111', { terminalId: 'KSK-A' }))
    check('单终端每日上限满了不发（429 SMS_TERMINAL_DAILY_LIMIT）', !third.ok && third.status === 429 && third.code === 'SMS_TERMINAL_DAILY_LIMIT', describe(third))
    check('单终端满了时不白占全站额度（全站计数仍是 2）', redis.raw(smsBudgetGlobalKey(day)) === '2', `global=${redis.raw(smsBudgetGlobalKey(day))}`)
    const other = await outcome(() => sender.sendCode('13800000004', '111111', { terminalId: 'KSK-B' }))
    check('别的终端不受影响', other.ok, describe(other))
    const phone = await outcome(() => sender.sendCode('13800000005', '111111'))
    check('不是一体机发起（手机 / 网页）只受全站总量约束', phone.ok, describe(phone))
    check('真实发送器也收到终端上下文', inner.metas.some((m) => m?.terminalId === 'KSK-B'), JSON.stringify(inner.metas))
  }
  {
    const redis = new MemoryRedis()
    const failing = {
      sendCode: async (_p: string, _c: string) => { throw new SmsSendError('LimitExceeded.PhoneNumberDailyLimit') },
    }
    const sender = new BudgetedSmsSender(failing, redis as never, { dailyTotal: 5, terminalDaily: 5 }, now)
    await outcome(() => sender.sendCode('13800000001', '1', { terminalId: 'KSK-A' }))
    check('服务商明确拒发（带错误码）：退回全站与终端额度',
      redis.raw(smsBudgetGlobalKey(day)) === null && redis.raw(smsBudgetTerminalKey('KSK-A', day)) === null,
      `global=${redis.raw(smsBudgetGlobalKey(day))} terminal=${redis.raw(smsBudgetTerminalKey('KSK-A', day))}`)
    const timeout = { sendCode: async () => { throw new SmsSendError('timeout') } }
    const sender2 = new BudgetedSmsSender(timeout, redis as never, { dailyTotal: 5, terminalDaily: 5 }, now)
    await outcome(() => sender2.sendCode('13800000001', '1', { terminalId: 'KSK-A' }))
    check('超时（短信可能已发出并计费）：不退回额度', redis.raw(smsBudgetGlobalKey(day)) === '1' && redis.raw(smsBudgetTerminalKey('KSK-A', day)) === '1',
      `global=${redis.raw(smsBudgetGlobalKey(day))}`)
  }
  {
    const dead = new Proxy({}, { get: () => async () => { throw new Error('connect ECONNREFUSED') } })
    const inner = new MetaCapturingSender()
    resetRedisCooldownForTests()
    const sender = new BudgetedSmsSender(inner, dead as never, { dailyTotal: 5, terminalDaily: 5 }, now)
    const result = await outcome(() => sender.sendCode('13800000001', '1'))
    check('Redis 核不了额度时不发（503 SMS_BUDGET_UNAVAILABLE）', !result.ok && result.status === 503 && result.code === 'SMS_BUDGET_UNAVAILABLE', describe(result))
    check('Redis 核不了额度时服务商一条都没发', inner.deliveries === 0, `deliveries=${inner.deliveries}`)
    resetRedisCooldownForTests()
  }
  {
    const redis = new MemoryRedis()
    let current = new Date('2026-09-29T15:59:59Z') // 北京时间 23:59:59
    const inner = new MetaCapturingSender()
    const sender = new BudgetedSmsSender(inner, redis as never, { dailyTotal: 1, terminalDaily: 1 }, () => current)
    await sender.sendCode('13800000001', '1')
    const sameDay = await outcome(() => sender.sendCode('13800000002', '1'))
    current = new Date('2026-09-29T16:00:00Z') // 北京时间次日 00:00
    const nextDay = await outcome(() => sender.sendCode('13800000003', '1'))
    check('按北京时间自然日分桶：23:59 满额，00:00 起新的一天可以再发',
      !sameDay.ok && sameDay.code === 'SMS_DAILY_TOTAL_LIMIT' && nextDay.ok, `${describe(sameDay)} / ${describe(nextDay)}`)
    check('shanghaiDay 取北京日期', shanghaiDay(new Date('2026-09-29T16:00:00Z')) === '2026-09-30', shanghaiDay(new Date('2026-09-29T16:00:00Z')))
  }
  {
    const defaults = readSmsBudgetLimits({})
    const zero = readSmsBudgetLimits({ SMS_DAILY_TOTAL_LIMIT: '0', SMS_TERMINAL_DAILY_LIMIT: '-3' })
    const junk = readSmsBudgetLimits({ SMS_DAILY_TOTAL_LIMIT: 'abc', SMS_TERMINAL_DAILY_LIMIT: '1.5' })
    const custom = readSmsBudgetLimits({ SMS_DAILY_TOTAL_LIMIT: '20', SMS_TERMINAL_DAILY_LIMIT: '7' })
    check('未配置时用默认额度', defaults.dailyTotal === DEFAULT_SMS_DAILY_TOTAL_LIMIT && defaults.terminalDaily === DEFAULT_SMS_TERMINAL_DAILY_LIMIT, JSON.stringify(defaults))
    check('配成 0、负数、非整数、非数字都回落默认值，不会变成「不限」',
      zero.dailyTotal === DEFAULT_SMS_DAILY_TOTAL_LIMIT && zero.terminalDaily === DEFAULT_SMS_TERMINAL_DAILY_LIMIT
      && junk.dailyTotal === DEFAULT_SMS_DAILY_TOTAL_LIMIT && junk.terminalDaily === DEFAULT_SMS_TERMINAL_DAILY_LIMIT,
      `${JSON.stringify(zero)} ${JSON.stringify(junk)}`)
    check('合法配置生效', custom.dailyTotal === 20 && custom.terminalDaily === 7, JSON.stringify(custom))
  }

  // ── [B] 接线 ───────────────────────────────────────────────────────────────
  console.log('\n[B] 接线')
  {
    const { AuthModule } = await import('../src/auth/auth.module')
    const { MemberAuthModule } = await import('../src/member-auth/member-auth.module')
    for (const [name, mod] of [['AuthModule', AuthModule], ['MemberAuthModule', MemberAuthModule]] as const) {
      const providers = (Reflect.getMetadata('providers', mod) ?? []) as Array<{ provide?: unknown; useFactory?: unknown; inject?: unknown[] }>
      const sms = providers.find((p) => p && typeof p === 'object' && p.provide === SMS_SENDER)
      check(`${name} 的 SMS_SENDER 由带额度的工厂创建并注入 RedisService`,
        !!sms && sms.useFactory === createBudgetedSmsSender && Array.isArray(sms.inject) && sms.inject.includes(RedisService),
        sms ? `factory=${String((sms.useFactory as { name?: string })?.name)}` : '未找到 SMS_SENDER')
    }
    const built = createBudgetedSmsSender(new MemoryRedis() as never)
    check('工厂产出的是 BudgetedSmsSender', built instanceof BudgetedSmsSender, built.constructor.name)
  }
  {
    const { MemberAuthController } = await import('../src/member-auth/member-auth.controller')
    const calls: Array<string | null> = []
    const service = { sendSmsCode: async (_p: string, _d: string | undefined, _ip: string, terminalId: string | null) => { calls.push(terminalId); return { sent: true } } }
    const validated: string[] = []
    const sessions = {
      validate: async (terminalId: string | undefined, token: string | undefined) => {
        if (token !== 'good-token') {
          const { UnauthorizedException } = await import('@nestjs/common')
          throw new UnauthorizedException({ error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } })
        }
        validated.push(String(terminalId))
      },
    }
    const controller = new MemberAuthController(service as never, {} as never, {} as never, {} as never, sessions as never)
    const req = (headers: Record<string, string>) => ({ ip: '127.0.0.1', header: (name: string) => headers[name.toLowerCase()] }) as never
    await controller.sendSmsCode({ phone: '13800000001' } as never, req({}))
    check('不带终端编号（手机 / 网页）：照常发码，按「非一体机」计', calls[0] === null, JSON.stringify(calls))
    await controller.sendSmsCode({ phone: '13800000001' } as never, req({ 'x-terminal-id': 'KSK-A', 'x-terminal-session-token': 'good-token' }))
    check('带已验签的终端编号：把编号交给额度层', calls[1] === 'KSK-A' && validated.includes('KSK-A'), JSON.stringify(calls))
    const forged = await outcome(() => controller.sendSmsCode({ phone: '13800000001' } as never, req({ 'x-terminal-id': 'KSK-A', 'x-terminal-session-token': 'forged' })))
    check('带了终端编号却验不过签：拒绝（401），不发短信', !forged.ok && forged.status === 401 && calls.length === 2, `${describe(forged)} calls=${calls.length}`)
    const missing = await outcome(() => controller.sendSmsCode({ phone: '13800000001' } as never, req({ 'x-terminal-id': 'KSK-A' })))
    check('只带终端编号不带会话令牌：拒绝，不发短信', !missing.ok && missing.status === 401 && calls.length === 2, describe(missing))
  }

  // ── [C] 端到端 ─────────────────────────────────────────────────────────────
  console.log('\n[C] 端到端')
  {
    const { MemberAuthService } = await import('../src/member-auth/member-auth.service')
    const { hashPhone } = await import('../src/common/crypto/phone-identity')
    const redis = new MemoryRedis()
    const inner = new MetaCapturingSender()
    const sender = new BudgetedSmsSender(inner, redis as never, { dailyTotal: 50, terminalDaily: 1 }, now)
    const service = new MemberAuthService({} as never, redis as never, {} as never, sender)
    await service.sendSmsCode('13800000001', undefined, '127.0.0.1', 'KSK-E2E')
    check('会员发码把终端编号交给发送器', inner.metas[0]?.terminalId === 'KSK-E2E', JSON.stringify(inner.metas))
    const second = await outcome(() => service.sendSmsCode('13800000002', undefined, '127.0.0.1', 'KSK-E2E'))
    check('会员发码撞到单终端上限：如实 429', !second.ok && second.code === 'SMS_TERMINAL_DAILY_LIMIT', describe(second))
    check('撞到上限的那个号码没有留下可用的验证码', redis.raw(`member:sms:code:${hashPhone('13800000002')}`) === null, '')
    check('撞到上限的那个号码没有被占 60 秒冷却（明天能直接重试）', redis.raw(`member:sms:cooldown:${hashPhone('13800000002')}`) === null, '')
  }
  {
    const { InternalOtpService } = await import('../src/auth/internal-otp.service')
    const redis = new MemoryRedis()
    const inner = new MetaCapturingSender()
    const sender = new BudgetedSmsSender(inner, redis as never, { dailyTotal: 1, terminalDaily: 5 }, now)
    const otp = new InternalOtpService(redis as never, sender)
    await otp.sendCode({ phone: '13900000001', purpose: 'login', ip: '127.0.0.1', shouldDeliver: false })
    check('未知号码走「不下发」分支时不占额度', redis.raw(smsBudgetGlobalKey(day)) === null, `global=${redis.raw(smsBudgetGlobalKey(day))}`)
    await otp.sendCode({ phone: '13900000002', purpose: 'login', ip: '127.0.0.1', shouldDeliver: true })
    const over = await outcome(() => otp.sendCode({ phone: '13900000003', purpose: 'reset_password', ip: '127.0.0.1', shouldDeliver: true }))
    check('内部账号验证码同样受全站总量约束（429 SMS_DAILY_TOTAL_LIMIT）', !over.ok && over.code === 'SMS_DAILY_TOTAL_LIMIT', describe(over))
    check('内部账号撞上限时服务商只发了额度内的那一条', inner.deliveries === 1, `deliveries=${inner.deliveries}`)
  }

  console.log(`\nverify:sms-budget：${checks - failures}/${checks} 通过`)
  if (failures > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
