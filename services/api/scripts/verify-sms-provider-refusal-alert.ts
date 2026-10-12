/**
 * verify:sms-provider-refusal-alert —— 服务商整体拒发时推运维告警，同一类一天一次。
 *
 * 不连腾讯云，也不连真 Redis：分类函数直接调；运行时走额度包装的 sendCode，
 * 底下的发送器按指定码抛 SmsSendError，fetch 和 Redis 都是假的。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { SmsSendError } from '../src/member-auth/sms/sms-sender'
import { MemoryRedis } from './support/internal-auth-verify-harness'

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

const PHONE = '13800138000'
const OTP = '654321'
const BALANCE = 'FailedOperation.InsufficientBalanceInSmsPackage'
const SIGNATURE = 'FailedOperation.SignatureIncorrectOrUnapproved'
const WEBHOOK = 'https://example.invalid/sms-provider-refusal'
const BALANCE_TITLE = '短信发不出去：余额或套餐包用完了（服务商返回 FailedOperation.InsufficientBalanceInSmsPackage）。用户收不到验证码，手机号登录、找回密码等都办不成。'

class AlertRedis extends MemoryRedis {
  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return this.setNxEx(key, value, ttlSeconds)
  }
}

class RejectingSender {
  calls = 0
  providerCode: string | undefined = BALANCE
  forced: SmsSendError | null = null
  succeed = false

  async sendCode(): Promise<void> {
    this.calls += 1
    if (this.succeed) return
    throw this.forced ?? new SmsSendError(this.providerCode)
  }

  async sendPartnerPhoneRegisteredNotice(): Promise<void> {
    await this.sendCode()
  }
}

const flights: Array<Promise<void>> = []

function useFetch(handler: (url: unknown, init?: { body?: unknown }) => Promise<Response> | Response): void {
  // 上一幕如果留下了不会结束的推送，不要让后面的 drain 一直等它。
  flights.splice(0, flights.length)
  globalThis.fetch = ((url: unknown, init?: { body?: unknown }) => {
    const job = Promise.resolve().then(() => handler(url, init))
    flights.push(job.then(() => undefined, () => undefined))
    return job
  }) as typeof fetch
}

async function drain(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  await Promise.all(flights.splice(0, flights.length))
}

function quietLabel(code: string | undefined | null): string {
  if (code === undefined) return 'undefined'
  if (code === null) return 'null'
  if (code === '') return '空串'
  return JSON.stringify(code)
}

async function main(): Promise<void> {
  const savedWebhook = process.env['ALERT_WEBHOOK_URL']
  const savedFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('verify-sms-provider-refusal-alert: 未安装假 fetch，不许触外网')
  }) as typeof fetch

  const { classifySmsProviderRefusal, smsProviderRefusalTitle } = await import('../src/member-auth/sms/sms-provider-refusal')
  const { BudgetedSmsSender, shanghaiDay } = await import('../src/member-auth/sms/sms-budget')

  console.log('\n[分类] 要推的码')
  const pushCases = [
    [BALANCE, 'balance'],
    [SIGNATURE, 'signature_or_template'],
    ['FailedOperation.TemplateIncorrectOrUnapproved', 'signature_or_template'],
    ['AuthFailure.SecretIdNotFound', 'auth_or_account'],
    ['AuthFailure.SignatureFailure', 'auth_or_account'],
    ['UnauthorizedOperation.SmsSdkAppIdVerifyFail', 'auth_or_account'],
    ['UnauthorizedOperation.ServiceSuspendDueToArrears', 'auth_or_account'],
    ['LimitExceeded.AppDailyLimit', 'app_daily_limit'],
    ['LimitExceeded.AppMainlandChinaDailyLimit', 'app_daily_limit'],
    ['LimitExceeded.AppGlobalDailyLimit', 'app_daily_limit'],
    ['template_missing', 'config'],
    ['endpoint_not_allowed', 'config'],
  ] as const
  for (const [code, category] of pushCases) {
    check(`${code} → ${category}`, classifySmsProviderRefusal(code) === category, String(classifySmsProviderRefusal(code)))
  }

  console.log('\n[分类] 不推的码')
  const quietCases: Array<string | undefined | null> = [
    'LimitExceeded.PhoneNumberThirtySecondLimit',
    'LimitExceeded.PhoneNumberOneHourLimit',
    'LimitExceeded.PhoneNumberDailyLimit',
    'LimitExceeded.PhoneNumberSameContentDailyLimit',
    'InvalidParameterValue.IncorrectPhoneNumber',
    'FailedOperation.PhoneNumberInBlacklist',
    'region_rejected',
    'timeout',
    'network',
    '',
    '   ',
    undefined,
    null,
    'FailedOperation.ContainSensitiveWord',
    // 只发中国大陆短信；按国际国家/地区的日上限不代表换号也发不出，不推。
    'LimitExceeded.AppCountryOrRegionDailyLimit',
    'AuthFailure',
    'UnauthorizedOperation',
  ]
  for (const code of quietCases) {
    check(`${quietLabel(code)} 不推`, classifySmsProviderRefusal(code) === null, String(classifySmsProviderRefusal(code)))
  }

  console.log('\n[文案]')
  const titles: Array<[typeof pushCases[number][1], string, string]> = [
    ['balance', BALANCE, '余额或套餐包用完了'],
    ['signature_or_template', SIGNATURE, '签名或模板不可用'],
    ['auth_or_account', 'AuthFailure.SecretIdNotFound', '账号或密钥不可用'],
    ['app_daily_limit', 'LimitExceeded.AppDailyLimit', '今天的发送量到上限了'],
    ['config', 'template_missing', '服务端短信配置不全'],
  ]
  for (const [category, code, label] of titles) {
    const expected = `短信发不出去：${label}（服务商返回 ${code}）。用户收不到验证码，手机号登录、找回密码等都办不成。`
    check(`标题 ${category}`, smsProviderRefusalTitle(category, code) === expected, smsProviderRefusalTitle(category, code))
  }

  const day1 = new Date('2026-09-29T04:00:00Z')
  const day2 = new Date('2026-09-30T04:00:00Z')
  check('东八区相邻两天', shanghaiDay(day1) === '2026-09-29' && shanghaiDay(day2) === '2026-09-30', `${shanghaiDay(day1)} ${shanghaiDay(day2)}`)

  const limits = { dailyTotal: 50, terminalDaily: 50 }
  const make = (
    redis: AlertRedis,
    inner: RejectingSender,
    channel: 'member' | 'internal',
    now: () => Date,
  ) => new BudgetedSmsSender(inner, redis as never, channel, limits, now)

  async function catchSend(sender: { sendCode(phone: string, code: string): Promise<void> }): Promise<unknown> {
    try {
      await sender.sendCode(PHONE, OTP)
      return undefined
    } catch (error) {
      return error
    }
  }

  try {
    process.env['ALERT_WEBHOOK_URL'] = WEBHOOK

    console.log('\n[运行时] 不等推送完成')
    {
      const redis = new AlertRedis()
      const original = new SmsSendError(BALANCE)
      const inner = new RejectingSender()
      inner.forced = original
      const sender = make(redis, inner, 'member', () => day1)
      let started = 0
      let seen = ''
      const hung = new Promise<Response>(() => undefined)
      useFetch((_url, init) => {
        started += 1
        seen = String(init?.body ?? '')
        return hung
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      const raced = await Promise.race([
        sender.sendCode(PHONE, OTP).then(
          () => ({ kind: 'ok' as const }),
          (error: unknown) => ({ kind: 'error' as const, error }),
        ),
        new Promise<{ kind: 'pending' }>((resolve) => {
          timer = setTimeout(() => resolve({ kind: 'pending' }), 2000)
        }),
      ])
      if (timer) clearTimeout(timer)
      const error = raced.kind === 'error' ? raced.error : undefined
      check(
        '推送还没完成，调用方已经拿到原来的错误',
        raced.kind === 'error' && error === original && original.providerCode === BALANCE,
        raced.kind === 'error' ? `code=${original.providerCode}` : raced.kind,
      )
      check('阳性：假发送器被调用了', inner.calls === 1, `calls=${inner.calls}`)
      check(
        '阳性：假 fetch 收到了请求体',
        started === 1 && seen.includes(BALANCE_TITLE) && seen.includes('严重') && !seen.includes(PHONE) && !seen.includes(OTP) && !seen.includes('（终端'),
        seen,
      )
    }

    console.log('\n[运行时] 一天一次')
    {
      const redis = new AlertRedis()
      const inner = new RejectingSender()
      const clock = { date: day1 }
      const sender = make(redis, inner, 'member', () => clock.date)
      const bodies: string[] = []
      useFetch((_url, init) => {
        bodies.push(String(init?.body ?? ''))
        return new Response('ok', { status: 200 })
      })
      const first = await catchSend(sender)
      await drain()
      check(
        '余额不足推了一次，正文含「短信发不出去」和码、不含手机号',
        first instanceof SmsSendError && first.providerCode === BALANCE && bodies.length === 1
          && bodies[0]?.includes('短信发不出去') && bodies[0]?.includes(BALANCE) && !bodies[0]?.includes(PHONE),
        `bodies=${bodies.length} code=${first instanceof SmsSendError ? first.providerCode : typeof first}`,
      )
      await catchSend(sender)
      await catchSend(sender)
      await drain()
      check('同一天再失败两次不再推', bodies.length === 1 && inner.calls === 3, `bodies=${bodies.length} calls=${inner.calls}`)
      clock.date = day2
      await catchSend(sender)
      await drain()
      check('第二天再推一次', bodies.length === 2, `bodies=${bodies.length}`)
    }

    console.log('\n[运行时] 同一天另一类、号码类、成功、两个包装')
    {
      const redis = new AlertRedis()
      const inner = new RejectingSender()
      const sender = make(redis, inner, 'member', () => day1)
      const bodies: string[] = []
      useFetch((_url, init) => {
        bodies.push(String(init?.body ?? ''))
        return new Response('ok', { status: 200 })
      })
      await catchSend(sender)
      inner.providerCode = SIGNATURE
      await catchSend(sender)
      await drain()
      check('同一天另一类仍推一次', bodies.length === 2 && bodies[1]?.includes(SIGNATURE), `bodies=${bodies.length}`)
    }
    {
      const redis = new AlertRedis()
      const inner = new RejectingSender()
      inner.providerCode = 'LimitExceeded.PhoneNumberDailyLimit'
      const sender = make(redis, inner, 'member', () => day1)
      let fetches = 0
      useFetch(() => {
        fetches += 1
        return new Response('ok', { status: 200 })
      })
      const caught = await catchSend(sender)
      await drain()
      check(
        '号码类错误不推',
        fetches === 0 && inner.calls === 1 && caught instanceof SmsSendError && caught.providerCode === 'LimitExceeded.PhoneNumberDailyLimit',
        `fetches=${fetches} calls=${inner.calls}`,
      )
    }
    {
      const redis = new AlertRedis()
      const inner = new RejectingSender()
      inner.succeed = true
      const sender = make(redis, inner, 'member', () => day1)
      let fetches = 0
      useFetch(() => {
        fetches += 1
        return new Response('ok', { status: 200 })
      })
      const caught = await catchSend(sender)
      await drain()
      check('发送成功不推', caught === undefined && fetches === 0 && inner.calls === 1, `fetches=${fetches} calls=${inner.calls}`)
    }
    {
      const redis = new AlertRedis()
      const inner = new RejectingSender()
      const sender = make(redis, inner, 'internal', () => day1)
      const bodies: string[] = []
      useFetch((_url, init) => {
        bodies.push(String(init?.body ?? ''))
        return new Response('ok', { status: 200 })
      })
      const caught = await catchSend(sender)
      await drain()
      check(
        '内部账号额度包装同样会推',
        caught instanceof SmsSendError && bodies.length === 1 && bodies[0]?.includes(BALANCE_TITLE),
        `bodies=${bodies.length}`,
      )
    }

    console.log('\n[运行时] 推送失败与没配地址')
    {
      const redis = new AlertRedis()
      const original = new SmsSendError(BALANCE)
      const inner = new RejectingSender()
      inner.forced = original
      const sender = make(redis, inner, 'member', () => day1)
      let fetches = 0
      useFetch(() => {
        fetches += 1
        return new Response('no', { status: 500 })
      })
      const caught = await catchSend(sender)
      await drain()
      check(
        '推送接口返回 500：调用方照样收到原来的错误',
        caught === original && original.providerCode === BALANCE && fetches === 1,
        `same=${caught === original} fetches=${fetches} code=${caught instanceof SmsSendError ? caught.providerCode : ''}`,
      )
    }
    {
      const redis = new AlertRedis()
      const original = new SmsSendError(BALANCE)
      const inner = new RejectingSender()
      inner.forced = original
      const sender = make(redis, inner, 'member', () => day1)
      let fetches = 0
      useFetch(() => {
        fetches += 1
        throw new Error('socket hang up')
      })
      const caught = await catchSend(sender)
      await drain()
      check(
        '推送接口抛错：调用方照样收到原来的错误',
        caught === original && original.providerCode === BALANCE && fetches === 1,
        `same=${caught === original} fetches=${fetches}`,
      )
    }
    {
      delete process.env['ALERT_WEBHOOK_URL']
      const redis = new AlertRedis()
      const original = new SmsSendError(BALANCE)
      const inner = new RejectingSender()
      inner.forced = original
      const sender = make(redis, inner, 'member', () => day1)
      let fetches = 0
      useFetch(() => {
        fetches += 1
        return new Response('ok', { status: 200 })
      })
      const caught = await catchSend(sender)
      await drain()
      check(
        '没配 ALERT_WEBHOOK_URL：不推、不报错',
        caught === original && fetches === 0,
        `same=${caught === original} fetches=${fetches}`,
      )
    }
  } finally {
    if (savedWebhook === undefined) delete process.env['ALERT_WEBHOOK_URL']
    else process.env['ALERT_WEBHOOK_URL'] = savedWebhook
    globalThis.fetch = savedFetch
  }

  console.log(`\nverify:sms-provider-refusal-alert：PASS=${checks - failures} FAIL=${failures}`)
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
