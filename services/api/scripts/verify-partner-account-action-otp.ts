import assert from 'node:assert/strict'
import { HttpException } from '@nestjs/common'
import { InternalOtpService } from '../src/auth/internal-otp.service'
import type { InternalOtpPurpose } from '../src/auth/internal-otp.types'

class MemoryRedis {
  readonly values = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async setEx(key: string, _ttlSeconds: number, value: string): Promise<void> {
    this.values.set(key, value)
  }

  async setNxEx(key: string, value: string, _ttlSeconds: number): Promise<boolean> {
    if (this.values.has(key)) return false
    this.values.set(key, value)
    return true
  }

  async del(key: string): Promise<void> {
    this.values.delete(key)
  }

  async incrWithTtl(key: string, _ttlSeconds: number): Promise<number> {
    const next = Number(this.values.get(key) ?? '0') + 1
    this.values.set(key, String(next))
    return next
  }

  async getAndDelIfEquals(key: string, expected: string): Promise<'consumed' | 'missing' | 'mismatched'> {
    const value = this.values.get(key)
    if (value === undefined) return 'missing'
    if (value !== expected) return 'mismatched'
    this.values.delete(key)
    return 'consumed'
  }
}

class MemorySmsSender {
  failNext = false
  readonly deliveries: Array<{ phone: string; code: string }> = []

  async sendCode(phone: string, code: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('provider unavailable')
    }
    this.deliveries.push({ phone, code })
  }
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined
  const response = error.getResponse() as { error?: { code?: string } }
  return response.error?.code
}

async function expectCode(action: () => Promise<unknown>, expected: string): Promise<void> {
  await assert.rejects(action, (error) => codeOf(error) === expected)
}

async function main(): Promise<void> {
  process.env['SECRET_ENCRYPTION_KEY'] ??= 'partner-account-action-otp-test-key-32-bytes-minimum'

  const purposes: InternalOtpPurpose[] = [
    'login',
    'reset_password',
    'bind_phone',
    'transfer_phone',
    'partner_account_delete',
    'partner_phone_rebind_authorize',
    'partner_phone_rebind_new',
  ]
  assert.equal(purposes.length, 7)

  {
    const redis = new MemoryRedis()
    const sms = new MemorySmsSender()
    const otp = new InternalOtpService(redis as never, sms as never)
    await otp.sendCode({ phone: '13800000001', purpose: 'bind_phone', ip: '127.0.0.1', shouldDeliver: false })
    await expectCode(
      () =>
        otp.sendCode({
          phone: '13800000001',
          purpose: 'transfer_phone',
          ip: '127.0.0.1',
          shouldDeliver: false,
        }),
      'SMS_TOO_FREQUENT',
    )
    console.log('  PASS global cooldown is shared across purposes')
  }

  {
    const redis = new MemoryRedis()
    const sms = new MemorySmsSender()
    const otp = new InternalOtpService(redis as never, sms as never)
    await otp.sendCode({
      phone: '13800000002',
      purpose: 'partner_account_delete',
      ip: '127.0.0.2',
      shouldDeliver: true,
    })
    const correctCode = sms.deliveries.at(-1)?.code
    assert.match(correctCode ?? '', /^\d{6}$/)

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expectCode(
        () => otp.verifyCode('13800000002', 'partner_account_delete', '000000'),
        'SMS_CODE_INVALID',
      )
    }
    await expectCode(
      () => otp.verifyCode('13800000002', 'partner_account_delete', '000000'),
      'SMS_CODE_LOCKED',
    )
    await expectCode(
      () => otp.verifyCode('13800000002', 'partner_account_delete', correctCode!),
      'SMS_CODE_LOCKED',
    )
    await expectCode(
      () =>
        otp.sendCode({
          phone: '13800000002',
          purpose: 'partner_account_delete',
          ip: '127.0.0.2',
          shouldDeliver: true,
        }),
      'SMS_CODE_LOCKED',
    )
    console.log('  PASS fifth failure locks verification and resend for the full lock window')
  }

  {
    const redis = new MemoryRedis()
    const sms = new MemorySmsSender()
    const otp = new InternalOtpService(redis as never, sms as never)
    sms.failNext = true
    await expectCode(
      () =>
        otp.sendCode({
          phone: '13800000003',
          purpose: 'partner_phone_rebind_new',
          ip: '127.0.0.3',
          shouldDeliver: true,
        }),
      'SMS_SEND_FAILED',
    )
    await otp.sendCode({
      phone: '13800000003',
      purpose: 'login',
      ip: '127.0.0.3',
      shouldDeliver: false,
    })
    console.log('  PASS provider failure compare-releases only its own global cooldown')
  }

  {
    const redis = new MemoryRedis()
    const sms = new MemorySmsSender()
    const otp = new InternalOtpService(redis as never, sms as never)
    await otp.sendCode({
      phone: '13800000004',
      purpose: 'partner_phone_rebind_authorize',
      ip: '127.0.0.4',
      shouldDeliver: true,
    })
    const descriptor = otp.verificationDescriptor(
      '13800000004',
      'partner_phone_rebind_authorize',
      sms.deliveries.at(-1)!.code,
    )
    assert.match(descriptor.codeKey, /partner_phone_rebind_authorize/)
    assert.match(descriptor.lockedKey, /partner_phone_rebind_authorize/)
    assert.equal(descriptor.maxAttempts, 5)
    assert.equal(descriptor.lockSeconds, 300)
    console.log('  PASS action Lua receives a purpose-isolated OTP descriptor')
  }

  console.log('=== PARTNER ACCOUNT ACTION OTP ALL PASS ===')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
