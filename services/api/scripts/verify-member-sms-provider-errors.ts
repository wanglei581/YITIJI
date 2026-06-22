import { HttpException, HttpStatus } from '@nestjs/common'
import { MemberAuthService } from '../src/member-auth/member-auth.service'
import { SmsSendError, type SmsSender } from '../src/member-auth/sms/sms-sender'

process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-member-sms-provider-32-key'

type ProviderError = Error & { providerCode?: string }

class FakeRedis {
  readonly store = new Map<string, string>()

  async setNxEx(key: string, value: string, _ttlSeconds: number): Promise<boolean> {
    if (this.store.has(key)) return false
    this.store.set(key, value)
    return true
  }

  async incrWithTtl(key: string, _ttlSeconds: number): Promise<number> {
    const next = Number(this.store.get(key) ?? '0') + 1
    this.store.set(key, String(next))
    return next
  }

  async setEx(key: string, _ttlSeconds: number, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
  }
}

let pass = 0
let fail = 0

function ok(message: string): void {
  console.log(`  PASS ${message}`)
  pass += 1
}

function bad(message: string): void {
  console.error(`  FAIL ${message}`)
  fail += 1
}

function providerError(providerCode?: string): ProviderError {
  return new SmsSendError(providerCode)
}

function responseCode(error: HttpException): string | undefined {
  const body = error.getResponse()
  if (typeof body !== 'object' || body === null) return undefined
  const errorField = (body as Record<string, unknown>)['error']
  if (typeof errorField !== 'object' || errorField === null) return undefined
  const code = (errorField as Record<string, unknown>)['code']
  return typeof code === 'string' ? code : undefined
}

async function expectSmsFailureMapping(
  sourceError: ProviderError,
  expectedStatus: number,
  expectedCode: string,
  label: string,
): Promise<void> {
  const redis = new FakeRedis()
  const sms: SmsSender = { sendCode: async () => { throw sourceError } }
  const service = new MemberAuthService({} as never, redis as never, {} as never, sms)

  try {
    await service.sendSmsCode('13800000000', 'device-1', '127.0.0.1')
    bad(`${label}: expected sendSmsCode to fail`)
    return
  } catch (error) {
    if (!(error instanceof HttpException)) {
      bad(`${label}: expected HttpException, got ${(error as Error).message}`)
      return
    }

    const status = error.getStatus()
    const code = responseCode(error)
    status === expectedStatus ? ok(`${label}: status ${expectedStatus}`) : bad(`${label}: status ${status}, expected ${expectedStatus}`)
    code === expectedCode ? ok(`${label}: code ${expectedCode}`) : bad(`${label}: code ${String(code)}, expected ${expectedCode}`)
  }

  const leakedRuntimeKeys = [...redis.store.keys()].filter((key) =>
    key.startsWith('member:sms:code:') || key.startsWith('member:sms:cooldown:'),
  )
  leakedRuntimeKeys.length === 0
    ? ok(`${label}: code and cooldown keys cleaned`)
    : bad(`${label}: leaked runtime keys ${leakedRuntimeKeys.join(',')}`)
}

async function main(): Promise<void> {
  console.log('\n=== Member SMS provider error mapping ===')

  await expectSmsFailureMapping(
    providerError('LimitExceeded.PhoneNumberDailyLimit'),
    HttpStatus.TOO_MANY_REQUESTS,
    'SMS_PROVIDER_PHONE_DAILY_LIMIT',
    'Tencent phone daily limit',
  )

  await expectSmsFailureMapping(
    providerError('LimitExceeded.SenderLimit'),
    HttpStatus.TOO_MANY_REQUESTS,
    'SMS_PROVIDER_RATE_LIMIT',
    'Tencent generic rate limit',
  )

  await expectSmsFailureMapping(
    providerError('FailedOperation.SignatureIncorrectOrUnapproved'),
    HttpStatus.BAD_GATEWAY,
    'SMS_SEND_FAILED',
    'Unknown Tencent provider failure',
  )

  console.log(`\n${fail ? 'FAIL' : 'ALL PASS'} (pass=${pass} fail=${fail})`)
  process.exit(fail ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
