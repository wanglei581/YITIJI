/**
 * verify:sms-egress-limits —— 会员验证码的出口限流（A 按已验签终端计，B 受信出口默认关）。
 *
 * 守的事实：
 *   - 同一 IP 下两台已验签终端各自计数，不写入 IP 桶，也不互相挤占；
 *   - 不带终端仍按 IP：每小时 20 条，文案与原来一致；
 *   - 伪造终端编号在验签处被拒，每分钟限流也不按伪造编号拆桶；
 *   - 受信地址段只放宽 IP 的每小时和每分钟，手机号冷却 / 每天 10 条 / 设备 / 全站每日额度照旧；
 *   - 过宽的地址段或超过天花板的上限，启动校验抛错，且不替换已生效的配置；
 *   - 用量到上限的 80% 时告警一次，同一段同一小时不重复。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ExecutionContext } from '@nestjs/common'
import { CapturingSmsSender, MemoryRedis, errorCode } from './support/internal-auth-verify-harness'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) {
    console.log(`  ✅ ${name}`)
    return
  }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

type Outcome =
  | { ok: true }
  | { ok: false; status: number | null; code: string | undefined; message: string | undefined }

function errorMessage(error: unknown): string | undefined {
  const response = (typeof (error as { getResponse?: () => unknown }).getResponse === 'function'
    ? (error as { getResponse: () => unknown }).getResponse()
    : undefined) as { error?: { message?: string } } | undefined
  return response?.error?.message
}

async function outcome(op: () => Promise<unknown>): Promise<Outcome> {
  try {
    await op()
    return { ok: true }
  } catch (error) {
    const status = typeof (error as { getStatus?: () => number }).getStatus === 'function'
      ? (error as { getStatus: () => number }).getStatus()
      : null
    return { ok: false, status, code: errorCode(error), message: errorMessage(error) }
  }
}

function describe(result: Outcome): string {
  return result.ok ? '成功' : `失败 ${result.status ?? '-'} ${result.code ?? ''} ${result.message ?? ''}`
}

function phone(n: number): string {
  return `138${String(n).padStart(8, '0')}`
}

class EgressRedis extends MemoryRedis {
  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return this.setNxEx(key, value, ttlSeconds)
  }
}

function fakeContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
    getClass: () => function FakeClass() { return undefined },
    getHandler: () => function fakeHandler() { return undefined },
    getArgs: () => [],
    getArgByIndex: () => undefined,
    getType: () => 'http',
  } as unknown as ExecutionContext
}

function throttleReq(ip: string, headers: Record<string, string> = {}): Record<string, unknown> {
  return { ip, headers, header: (name: string) => headers[name.toLowerCase()] }
}

async function main(): Promise<void> {
  if (!process.env['SECRET_ENCRYPTION_KEY'] || process.env['SECRET_ENCRYPTION_KEY'].length < 32) {
    process.env['SECRET_ENCRYPTION_KEY'] = 'verify-sms-egress-limits-secret-32b-min'
  }
  const { MemberAuthService } = await import('../src/member-auth/member-auth.service')
  const { MemberAuthController } = await import('../src/member-auth/member-auth.controller')
  const { MemberAuthModule } = await import('../src/member-auth/member-auth.module')
  const { hashPhone } = await import('../src/common/crypto/phone-identity')
  const { BudgetedSmsSender } = await import('../src/member-auth/sms/sms-budget')
  const {
    assertSmsTrustedEgressConfig,
    currentSmsTrustedEgressConfig,
    matchTrustedEgress,
    resetSmsTrustedEgressConfigForTests,
    IP_HOURLY_MAX,
    TERMINAL_HOURLY_MAX,
  } = await import('../src/member-auth/sms/sms-egress-config')
  const {
    bindSmsEgressAlertForTests,
    dispatchTrustedEgressAlert,
    enforceMemberSmsHourlyLimit,
    trustedEgressReachedHot,
    SMS_IP_LIMIT_MESSAGE,
    SMS_TERMINAL_HOURLY_MESSAGE,
  } = await import('../src/member-auth/sms/sms-egress-limits')
  const {
    SmsCodeThrottleBinder,
    bindSmsCodeTerminalProof,
    smsCodeGetTracker,
    smsCodeMinuteLimit,
    SMS_CODE_IP_MINUTE_LIMIT,
  } = await import('../src/member-auth/sms/sms-code-throttle')

  resetSmsTrustedEgressConfigForTests()
  bindSmsEgressAlertForTests(async () => undefined)
  bindSmsCodeTerminalProof(null)

  const make = (redis: EgressRedis, sender: CapturingSmsSender | InstanceType<typeof BudgetedSmsSender> = new CapturingSmsSender()) =>
    new MemberAuthService({} as never, redis as never, {} as never, sender as never)

  const send = (svc: MemberAuthService, n: number, ip: string, terminalId: string | null, deviceId?: string) =>
    outcome(() => svc.sendSmsCode(phone(n), deviceId, ip, terminalId))

  try {
    check('未配置时每 IP 每小时仍是 20、每台终端每小时是 30', IP_HOURLY_MAX === 20 && TERMINAL_HOURLY_MAX === 30)
    check('终端上限的人话就是指定的那句', SMS_TERMINAL_HOURLY_MESSAGE === '这台设备请求验证码太频繁了，请稍后再试')
    check('IP 上限的人话与原来逐字一致', SMS_IP_LIMIT_MESSAGE === '当前网络请求过于频繁,请稍后再试')

    console.log('\n[A] 已验签终端按台计，不占 IP 桶')
    {
      const redis = new EgressRedis()
      const svc = make(redis)
      const ip = '198.51.100.10'
      let okCount = 0
      let detail = ''
      for (let i = 0; i < 30; i += 1) {
        const result = await send(svc, 1000 + i, ip, 'KSK-HALL-A')
        if (!result.ok) { detail = `第 ${i + 1} 条 ${describe(result)}`; break }
        okCount += 1
      }
      check('同一 IP 下终端 A 前 30 条各自成功', okCount === 30, detail)
      const termKeys = redis.keysWithPrefix('member:sms:term:KSK-HALL-A:')
      check('终端计数键是 member:sms:term:<终端>:<小时>', termKeys.length === 1 && redis.raw(termKeys[0] ?? '') === '30', termKeys.join(','))
      const blocked = await send(svc, 1031, ip, 'KSK-HALL-A')
      check(
        '第 31 条拒绝，错误码 SMS_TERMINAL_HOURLY_LIMIT，人话不变',
        !blocked.ok && blocked.status === 429 && blocked.code === 'SMS_TERMINAL_HOURLY_LIMIT'
          && blocked.message === '这台设备请求验证码太频繁了，请稍后再试',
        describe(blocked),
      )
      const other = await send(svc, 1100, ip, 'KSK-HALL-B')
      check('同一 IP 的终端 B 不受 A 挤占', other.ok, describe(other))
      check('这两台终端的请求都没有写入 IP 桶', redis.keysWithPrefix('member:sms:ip:').length === 0, redis.keysWithPrefix('member:sms:ip:').join(','))
      const plain = await send(svc, 1200, ip, null)
      check('同一 IP 不带终端，仍能按 IP 额度发一条', plain.ok, describe(plain))
      const blankTerminal = await send(svc, 1201, '198.51.100.77', '   ')
      check('空白终端编号按「没有终端」计入 IP，不单开一台', blankTerminal.ok && redis.keysWithPrefix('member:sms:term:').every((key) => !key.includes('   ')), describe(blankTerminal))
      check('空白终端编号写入的是 IP 桶', redis.keysWithPrefix('member:sms:ip:198.51.100.77:').length === 1)
    }
    {
      const redis = new EgressRedis()
      const svc = make(redis)
      const ip = '198.51.100.20'
      let okCount = 0
      for (let i = 0; i < 20; i += 1) {
        const result = await send(svc, 1300 + i, ip, null)
        if (result.ok) okCount += 1
      }
      const blocked = await send(svc, 1320, ip, null)
      check('不带终端：同一 IP 前 20 条成功，第 21 条仍是 SMS_IP_LIMIT', okCount === 20 && !blocked.ok && blocked.code === 'SMS_IP_LIMIT' && blocked.message === '当前网络请求过于频繁,请稍后再试', describe(blocked))
    }

    console.log('\n[B] 受信出口只放宽 IP 这一层')
    assertSmsTrustedEgressConfig({
      SMS_TRUSTED_EGRESS_CIDRS: '203.0.113.0/24,203.0.113.9/32',
      SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT: '100',
      SMS_TRUSTED_EGRESS_IP_MINUTE_LIMIT: '15',
    })
    check('最长前缀：.9 用 /32，.10 用 /24', matchTrustedEgress('203.0.113.9')?.token === '203.0.113.9/32' && matchTrustedEgress('203.0.113.10')?.token === '203.0.113.0/24')
    check('IPv4 映射地址先还原再匹配', matchTrustedEgress('::ffff:203.0.113.9')?.token === '203.0.113.9/32')
    check('认不出的地址不算受信', matchTrustedEgress('unknown') === null)
    {
      const redis = new EgressRedis()
      const svc = make(redis)
      const ip = '203.0.113.20'
      let okCount = 0
      for (let i = 0; i < 21; i += 1) {
        const result = await send(svc, 1600 + i, ip, null)
        if (result.ok) okCount += 1
      }
      check('受信 /24 把每小时上限放到 20 以上：第 21 个不同号码成功', okCount === 21, `ok=${okCount}`)
    }
    {
      const redis = new EgressRedis()
      const svc = make(redis)
      const ip = 'unknown'
      let okCount = 0
      for (let i = 0; i < 20; i += 1) {
        const result = await send(svc, 4000 + i, ip, null)
        if (result.ok) okCount += 1
      }
      const blocked = await send(svc, 4020, ip, null)
      check('地址认不出时不吃受信上限，第 21 条仍被 IP 额度拦住', okCount === 20 && !blocked.ok && blocked.code === 'SMS_IP_LIMIT', describe(blocked))
    }
    {
      const redis = new EgressRedis()
      const svc = make(redis)
      const ip = '203.0.113.10'
      const same = phone(2000)
      let okCount = 0
      for (let i = 0; i < 10; i += 1) {
        if (i > 0) await redis.del(`member:sms:cooldown:${hashPhone(same)}`)
        const result = await outcome(() => svc.sendSmsCode(same, undefined, ip, null))
        if (result.ok) okCount += 1
      }
      await redis.del(`member:sms:cooldown:${hashPhone(same)}`)
      const eleventh = await outcome(() => svc.sendSmsCode(same, undefined, ip, null))
      check('受信地址段不放宽手机号每天 10 条', okCount === 10 && !eleventh.ok && eleventh.code === 'SMS_DAILY_LIMIT', `${okCount} ${describe(eleventh)}`)
      const freshPhone = phone(2001)
      const first = await outcome(() => svc.sendSmsCode(freshPhone, undefined, ip, null))
      const second = await outcome(() => svc.sendSmsCode(freshPhone, undefined, ip, null))
      check('受信地址段不放宽 60 秒冷却', first.ok && !second.ok && second.code === 'SMS_TOO_FREQUENT', `${describe(first)} / ${describe(second)}`)
    }
    {
      const redis = new EgressRedis()
      const svc = make(redis)
      const ip = '203.0.113.11'
      let okCount = 0
      for (let i = 0; i < 20; i += 1) {
        const result = await send(svc, 2100 + i, ip, null, 'dev-hall-1')
        if (result.ok) okCount += 1
      }
      const blocked = await send(svc, 2120, ip, null, 'dev-hall-1')
      check('受信地址段不放宽同一设备每小时 20 条', okCount === 20 && !blocked.ok && blocked.code === 'SMS_DEVICE_LIMIT', `${okCount} ${describe(blocked)}`)
    }
    {
      const redis = new EgressRedis()
      const inner = new CapturingSmsSender()
      const sender = new BudgetedSmsSender(inner, redis as never, 'member', { dailyTotal: 2, terminalDaily: 100 })
      const svc = make(redis, sender)
      const ip = '203.0.113.12'
      const first = await send(svc, 1500, ip, null)
      const second = await send(svc, 1501, ip, null)
      const third = await send(svc, 1502, ip, null)
      check('受信地址段不放宽全站每日短信额度', first.ok && second.ok && !third.ok && third.code === 'SMS_DAILY_TOTAL_LIMIT' && inner.deliveries === 2, describe(third))
    }

    console.log('\n[B] 低上限：IPv6 /56 与 IPv4 映射地址真的参与计数')
    assertSmsTrustedEgressConfig({
      SMS_TRUSTED_EGRESS_CIDRS: '2001:db8:abcd::/56,203.0.113.0/24',
      SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT: '5',
      SMS_TRUSTED_EGRESS_IP_MINUTE_LIMIT: '15',
    })
    {
      const redis = new EgressRedis()
      const svc = make(redis)
      let okCount = 0
      for (let i = 0; i < 5; i += 1) {
        const result = await send(svc, 1700 + i, '2001:db8:abcd:0::1', null)
        if (result.ok) okCount += 1
      }
      const blocked = await send(svc, 1705, '2001:db8:abcd:0::1', null)
      let outside = 0
      for (let i = 0; i < 6; i += 1) {
        const result = await send(svc, 1710 + i, '2001:db8:abce::1', null)
        if (result.ok) outside += 1
      }
      check('IPv6 /56 命中后按受信上限拦住第 6 条，相邻网段不命中', okCount === 5 && !blocked.ok && blocked.code === 'SMS_IP_LIMIT' && outside === 6, `in=${okCount} ${describe(blocked)} out=${outside}`)
    }
    {
      const redis = new EgressRedis()
      const svc = make(redis)
      let okCount = 0
      for (let i = 0; i < 5; i += 1) {
        const result = await send(svc, 1800 + i, '::ffff:203.0.113.60', null)
        if (result.ok) okCount += 1
      }
      const blocked = await send(svc, 1805, '::ffff:203.0.113.60', null)
      check('::ffff: 映射地址按里面的 IPv4 计入受信上限', okCount === 5 && !blocked.ok && blocked.code === 'SMS_IP_LIMIT', describe(blocked))
    }

    console.log('\n[B] 启动校验：不合格就拒绝，不改掉已经生效的配置')
    {
      const kept = assertSmsTrustedEgressConfig({
        SMS_TRUSTED_EGRESS_CIDRS: '203.0.113.9/32',
        SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT: '100',
        SMS_TRUSTED_EGRESS_IP_MINUTE_LIMIT: '15',
      })
      const expectThrow = (env: Record<string, string>, snippet: string): string | null => {
        try {
          assertSmsTrustedEgressConfig(env)
          return null
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return message.includes(snippet) ? message : `文案不含「${snippet}」：${message}`
        }
      }
      const wideV4 = expectThrow({ SMS_TRUSTED_EGRESS_CIDRS: '10.0.0.0/8' }, '比 /24 更宽')
      check('IPv4 /8 拒绝启动', wideV4 !== null && !wideV4.startsWith('文案'), wideV4 ?? '没有抛错')
      check('拒绝启动后，原来的 /32 还在', matchTrustedEgress('203.0.113.9')?.token === '203.0.113.9/32' && matchTrustedEgress('10.0.0.1') === null)
      const wideV6 = expectThrow({ SMS_TRUSTED_EGRESS_CIDRS: '2001:db8::/48' }, '比 /56 更宽')
      check('IPv6 /48 拒绝启动', wideV6 !== null && !wideV6.startsWith('文案'), wideV6 ?? '没有抛错')
      const slash23 = expectThrow({ SMS_TRUSTED_EGRESS_CIDRS: '203.0.113.0/23' }, '比 /24 更宽')
      const slash55 = expectThrow({ SMS_TRUSTED_EGRESS_CIDRS: '2001:db8:abcd::/55' }, '比 /56 更宽')
      check('/23 与 IPv6 /55 也算过宽', slash23 !== null && !slash23.startsWith('文案') && slash55 !== null && !slash55.startsWith('文案'), `${slash23} | ${slash55}`)
      const mapped = expectThrow({ SMS_TRUSTED_EGRESS_CIDRS: '::ffff:10.0.0.0/96' }, '请直接写 IPv4 地址段')
      const slash33 = expectThrow({ SMS_TRUSTED_EGRESS_CIDRS: '10.0.0.0/33' }, '不是合法的地址段')
      const bare = expectThrow({ SMS_TRUSTED_EGRESS_CIDRS: '203.0.113.9' }, '不是合法的地址段')
      const leadingZero = expectThrow({ SMS_TRUSTED_EGRESS_CIDRS: '010.0.0.0/24' }, '不是合法的地址段')
      check('映射写法、/33、裸 IP、前导零都算格式不对', [mapped, slash33, bare, leadingZero].every((item) => item !== null && !item.startsWith('文案')), [mapped, slash33, bare, leadingZero].join(' | '))
      const hourly = expectThrow({ SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT: '201' }, '每小时上限')
      const minute = expectThrow({ SMS_TRUSTED_EGRESS_IP_MINUTE_LIMIT: '31' }, '每分钟上限')
      const zero = expectThrow({ SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT: '0' }, '每小时上限')
      const fraction = expectThrow({ SMS_TRUSTED_EGRESS_IP_MINUTE_LIMIT: '1.5' }, '每分钟上限')
      const padded = expectThrow({ SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT: '0200' }, '每小时上限')
      check('上限超过天花板或不是正整数，即使没写地址段也拒绝启动', [hourly, minute, zero, fraction, padded].every((item) => item !== null && !item.startsWith('文案')), [hourly, minute, zero, fraction, padded].join(' | '))
      check('失败没有换成 10.0.0.0/8', currentSmsTrustedEgressConfig().rules.some((rule) => rule.token === kept.rules[0]?.token) && matchTrustedEgress('10.1.2.3') === null)
      const boundary = assertSmsTrustedEgressConfig({
        SMS_TRUSTED_EGRESS_CIDRS: '203.0.113.0/24,2001:db8:abcd::/56',
        SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT: '200',
        SMS_TRUSTED_EGRESS_IP_MINUTE_LIMIT: '30',
      })
      check('/24、/56、每小时 200、每分钟 30 可以通过', boundary.enabled && boundary.hourlyLimit === 200 && boundary.minuteLimit === 30 && boundary.rules.length === 2)
      const defaults = assertSmsTrustedEgressConfig({ SMS_TRUSTED_EGRESS_CIDRS: '198.51.100.0/24' })
      check('不写上限时用默认 100 与 15', defaults.hourlyLimit === 100 && defaults.minuteLimit === 15)
      const off = assertSmsTrustedEgressConfig({ SMS_TRUSTED_EGRESS_CIDRS: '   ', SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT: '150' })
      check('地址段留空等于不启用', !off.enabled && off.hourlyLimit === 150 && matchTrustedEgress('198.51.100.1') === null)
    }

    console.log('\n[B] 八成告警每段每小时只写一次')
    check('8/10 到八成，7/10 没有；12/15 到了，11/15 没有；80/100 到了，79/100 没有',
      !trustedEgressReachedHot(7, 10) && trustedEgressReachedHot(8, 10)
      && !trustedEgressReachedHot(11, 15) && trustedEgressReachedHot(12, 15)
      && !trustedEgressReachedHot(79, 100) && trustedEgressReachedHot(80, 100))
    {
      assertSmsTrustedEgressConfig({
        SMS_TRUSTED_EGRESS_CIDRS: '203.0.113.0/24',
        SMS_TRUSTED_EGRESS_IP_HOURLY_LIMIT: '10',
        SMS_TRUSTED_EGRESS_IP_MINUTE_LIMIT: '15',
      })
      const events: Array<{ cidr: string; count: number; limit: number }> = []
      bindSmsEgressAlertForTests(async (event) => { events.push(event) })
      const redis = new EgressRedis()
      const svc = make(redis)
      for (let i = 0; i < 7; i += 1) await send(svc, 1900 + i, '203.0.113.50', null)
      check('前 7 条（不到八成）不告警', events.length === 0, `writes=${events.length}`)
      await send(svc, 1907, '203.0.113.50', null)
      check('第 8 条写一条，带地址段、8 和上限 10', events.length === 1 && events[0]?.cidr === '203.0.113.0/24' && events[0]?.count === 8 && events[0]?.limit === 10, JSON.stringify(events))
      await send(svc, 1908, '203.0.113.50', null)
      check('同一地址再来一条不再写', events.length === 1, `writes=${events.length}`)
      for (let i = 0; i < 8; i += 1) await send(svc, 1920 + i, '203.0.113.51', null)
      check('同一地址段的另一个地址这一小时也不再写', events.length === 1, `writes=${events.length}`)
      const tenth = await send(svc, 1909, '203.0.113.50', null)
      const overflow = await send(svc, 1910, '203.0.113.50', null)
      check('到了八成之后，第 10 条仍可发，第 11 条被拒绝，且不再多写告警', tenth.ok && !overflow.ok && overflow.code === 'SMS_IP_LIMIT' && events.length === 1, `${describe(tenth)} / ${describe(overflow)}`)
      bindSmsEgressAlertForTests(async () => undefined)
    }

    console.log('\n[B] 没绑测试替身时，走现有运维告警推送')
    {
      const limitsSrc = readFileSync(path.resolve(__dirname, '../src/member-auth/sms/sms-egress-limits.ts'), 'utf8')
      const mainSrc = readFileSync(path.resolve(__dirname, '../src/main.ts'), 'utf8')
      check('默认出口调用 deliverOpsAlert', limitsSrc.includes('await deliverOpsAlert('))
      check('启动校验紧挨在生产闸门后面', /assertProductionRuntimeGates\(\)\n {2}assertSmsTrustedEgressConfig\(\)/.test(mainSrc))
      const previousWebhook = process.env['ALERT_WEBHOOK_URL']
      const previousFetch = globalThis.fetch
      const bodies: string[] = []
      process.env['ALERT_WEBHOOK_URL'] = 'https://example.invalid/sms-egress-alert'
      globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
        bodies.push(String(init?.body ?? ''))
        return new Response('ok', { status: 200 })
      }) as typeof fetch
      let absent = false
      const redis = {
        async setIfAbsent() { const first = !absent; absent = true; return first },
        async del() { return 1 },
        async incrWithTtl() { return 1 },
        async setNxEx() { return true },
      }
      try {
        bindSmsEgressAlertForTests(null)
        await dispatchTrustedEgressAlert(redis, { cidr: '203.0.113.0/24', count: 80, limit: 100, hour: '2026-09-29T01' })
        await dispatchTrustedEgressAlert(redis, { cidr: '203.0.113.0/24', count: 80, limit: 100, hour: '2026-09-29T01' })
        const body = bodies[0] ?? ''
        check('未绑替身时推送一次，正文含八成、不含手机号', bodies.length === 1 && body.includes('八成') && body.includes('【职易达告警】') && !body.includes('138'), body)
      } finally {
        globalThis.fetch = previousFetch
        if (previousWebhook === undefined) delete process.env['ALERT_WEBHOOK_URL']
        else process.env['ALERT_WEBHOOK_URL'] = previousWebhook
        bindSmsEgressAlertForTests(async () => undefined)
      }
    }

    console.log('\n[A] 每分钟限流只对发验证码这一条按已验签终端计')
    {
      let proofCalls = 0
      bindSmsCodeTerminalProof(async (id, token) => {
        proofCalls += 1
        if (token === 'throw') throw new Error('bad session')
        return token === `ok:${id}`
      })
      assertSmsTrustedEgressConfig({
        SMS_TRUSTED_EGRESS_CIDRS: '203.0.113.0/24',
        SMS_TRUSTED_EGRESS_IP_MINUTE_LIMIT: '15',
      })
      const ip = '198.51.100.40'
      const forgedA = await smsCodeGetTracker(throttleReq(ip, { 'x-terminal-id': 'FORGED-A', 'x-terminal-session-token': 'nope' }), fakeContext(throttleReq(ip)))
      const forgedB = await smsCodeGetTracker(throttleReq(ip, { 'x-terminal-id': 'FORGED-B', 'x-terminal-session-token': 'nope' }), fakeContext(throttleReq(ip)))
      const thrown = await smsCodeGetTracker(throttleReq(ip, { 'x-terminal-id': 'FORGED-C', 'x-terminal-session-token': 'throw' }), fakeContext(throttleReq(ip)))
      check('两个伪造编号和验签失败共用同一个 IP 桶', forgedA === ip && forgedB === ip && thrown === ip, `${forgedA} ${forgedB} ${thrown}`)
      const verifiedLeft = throttleReq('198.51.100.1', { 'x-terminal-id': 'KSK-A', 'x-terminal-session-token': 'ok:KSK-A' })
      const verifiedRight = throttleReq('203.0.113.1', { 'x-terminal-id': 'KSK-A', 'x-terminal-session-token': 'ok:KSK-A' })
      const verifiedOther = throttleReq('198.51.100.1', { 'x-terminal-id': 'KSK-B', 'x-terminal-session-token': 'ok:KSK-B' })
      const trackerLeft = await smsCodeGetTracker(verifiedLeft, fakeContext(verifiedLeft))
      const trackerRight = await smsCodeGetTracker(verifiedRight, fakeContext(verifiedRight))
      const trackerOther = await smsCodeGetTracker(verifiedOther, fakeContext(verifiedOther))
      check('同一台已验签终端换 IP 仍是同一个桶，两台终端不是同一个桶，桶里没有明文编号',
        trackerLeft === trackerRight && trackerLeft.startsWith('t:') && !trackerLeft.includes('KSK-A') && trackerLeft !== trackerOther,
        `${trackerLeft} ${trackerOther}`)
      const shared = throttleReq('203.0.113.8', { 'x-terminal-id': 'KSK-A', 'x-terminal-session-token': 'ok:KSK-A' })
      const sharedContext = fakeContext(shared)
      proofCalls = 0
      const minuteOnTerminal = await smsCodeMinuteLimit(sharedContext)
      await smsCodeGetTracker(shared, sharedContext)
      check('已验签终端即使地址受信，每分钟仍是 5 次，且这一次请求只验签一次', minuteOnTerminal === SMS_CODE_IP_MINUTE_LIMIT && proofCalls === 1, `limit=${minuteOnTerminal} proofs=${proofCalls}`)
      const trustedAnon = throttleReq('203.0.113.8')
      const outsideAnon = throttleReq('198.51.100.8')
      check('不带终端：受信地址每分钟用配置值，外面的地址仍是 5 次',
        await smsCodeMinuteLimit(fakeContext(trustedAnon)) === 15 && await smsCodeMinuteLimit(fakeContext(outsideAnon)) === 5)
      bindSmsCodeTerminalProof(null)
      const fresh = throttleReq('198.51.100.1', { 'x-terminal-id': 'KSK-A', 'x-terminal-session-token': 'ok:KSK-A' })
      const unbound = await smsCodeGetTracker(fresh, fakeContext(fresh))
      check('验签还没接上时，带了终端编号也按 IP 计', unbound === '198.51.100.1', unbound)

      const sendHandler = MemberAuthController.prototype.sendSmsCode
      const loginHandler = MemberAuthController.prototype.login
      check('发验证码的每分钟计数函数就是这条路由自己的', Reflect.getMetadata('THROTTLER:TRACKERdefault', sendHandler) === smsCodeGetTracker)
      check('发验证码的每分钟上限是函数，不是写死的 5', typeof Reflect.getMetadata('THROTTLER:LIMITdefault', sendHandler) === 'function')
      check('发验证码的窗口仍是 60 秒', Reflect.getMetadata('THROTTLER:TTLdefault', sendHandler) === 60_000)
      check('登录路由的每分钟 10 次没有被改掉', Reflect.getMetadata('THROTTLER:LIMITdefault', loginHandler) === 10)
      check('发验证码没有跳过全站每 IP 的兜底桶', Reflect.getMetadata('THROTTLER:SKIPip-wide', sendHandler) === undefined)
      const providers = (Reflect.getMetadata('providers', MemberAuthModule) ?? []) as unknown[]
      check('模块会在启动时把终端验签接上每分钟限流', providers.includes(SmsCodeThrottleBinder))
    }

    console.log('\n[A] 伪造终端编号在控制器被拒，发码服务不会被调用')
    {
      const calls: Array<string | null> = []
      const service = {
        sendSmsCode: async (_phone: string, _deviceId: string | undefined, _ip: string, terminalId: string | null) => {
          calls.push(terminalId)
          return { sent: true }
        },
      }
      const sessions = {
        validate: async (_terminalId: string | undefined, token: string | undefined) => {
          if (token !== 'good-token') {
            const { UnauthorizedException } = await import('@nestjs/common')
            throw new UnauthorizedException({ error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } })
          }
        },
      }
      const controller = new MemberAuthController(service as never, {} as never, {} as never, {} as never, sessions as never)
      const req = (headers: Record<string, string>) => ({ ip: '198.51.100.10', header: (name: string) => headers[name.toLowerCase()] }) as never
      const forged = await outcome(() => controller.sendSmsCode({ phone: phone(5000) } as never, req({ 'x-terminal-id': 'KSK-FORGED', 'x-terminal-session-token': 'nope' })))
      check('伪造终端编号：401，且没有发验证码', !forged.ok && forged.status === 401 && calls.length === 0, describe(forged))
    }

    // 直接走小时计数，确认已验签分支在计数函数里就返回，不依赖服务层是否记得不传 IP。
    {
      resetSmsTrustedEgressConfigForTests()
      const redis = new EgressRedis()
      await enforceMemberSmsHourlyLimit(redis, { ip: '198.51.100.10', hour: '2026-09-29T01', terminalId: 'KSK-DIRECT' })
      check('计数函数对已验签终端只写终端键', redis.raw('member:sms:term:KSK-DIRECT:2026-09-29T01') === '1' && redis.keysWithPrefix('member:sms:ip:').length === 0)
    }
  } finally {
    resetSmsTrustedEgressConfigForTests()
    bindSmsCodeTerminalProof(null)
    bindSmsEgressAlertForTests(null)
  }

  console.log(`\n${checks - failures}/${checks} passed, ${failures} failed`)
  if (failures > 0) process.exit(1)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
