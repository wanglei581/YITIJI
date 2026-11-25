/**
 * 打开「向个人收费」总开关之前，先确认收款渠道可用。
 * 由 verify-terminal-charge-settings 调用（同一个临时库、同一个 Nest 应用），不是单独的门禁入口。
 *
 * 断言照规格写：
 * - 没有可用渠道时打开被拒：明确错误码 + 管理员看得懂的一句话，开关不变，不记打开审计；
 * - 有可用渠道时照常打开；
 * - 关闭不受影响（没有渠道也能关）。
 * 「可用」与按次付款出码同一判据：微信（非生产可用沙箱）。渠道配置不完整算没有；
 * 只有支付宝也算没有（按次付款不走支付宝）。
 */
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { readPersonalChargeEnabled } from '../../src/payment/effective-user-prices'
import { resolvePaymentProviders } from '../../src/payment/payment-provider.factory'
import {
  PERSONAL_CHARGE_CHANNEL_UNAVAILABLE_CODE,
  PERSONAL_CHARGE_CHANNEL_UNAVAILABLE_MESSAGE,
  PERSONAL_CHARGE_DISABLE_AUDIT_ACTION,
  PERSONAL_CHARGE_ENABLE_AUDIT_ACTION,
} from '../../src/payment/terminal-charge-settings'
import { PERSONAL_CHARGE_SETTING_KEY } from '../../src/payment/terminal-charge.contract'
import type { PrismaService } from '../../src/prisma/prisma.service'

interface CallResult {
  status: number
  json: { enabled?: unknown; error?: { code?: string; message?: string }; [key: string]: unknown }
}

export interface PersonalChargeChannelDeps {
  prisma: PrismaService
  call: (method: string, path: string, body?: unknown, extra?: Record<string, string>) => Promise<CallResult>
  adminHeaders: Record<string, string>
}

/** 工厂读取的全部渠道配置项。每个用例先清空再按需填，互不串味。 */
const CHANNEL_ENV_KEYS = [
  'PAYMENT_PROVIDER',
  'SANDBOX_PAYMENT_SECRET',
  'PAYMENT_NOTIFY_BASE_URL',
  'WECHAT_PAY_MCHID',
  'WECHAT_PAY_APPID',
  'WECHAT_PAY_MCH_SERIAL_NO',
  'WECHAT_PAY_PRIVATE_KEY_PEM',
  'WECHAT_PAY_PRIVATE_KEY_PATH',
  'WECHAT_PAY_APIV3_KEY',
  'WECHAT_PAY_PUBLIC_KEY_PEM',
  'WECHAT_PAY_PUBLIC_KEY_PATH',
  'WECHAT_PAY_PUBLIC_KEY_ID',
  'WECHAT_PAY_API_BASE',
  'WECHAT_PAY_CODEPAY_STORE_OUT_ID',
  'ALIPAY_APP_ID',
  'ALIPAY_APP_PRIVATE_KEY_PEM',
  'ALIPAY_APP_PRIVATE_KEY_PATH',
  'ALIPAY_PUBLIC_KEY_PEM',
  'ALIPAY_PUBLIC_KEY_PATH',
  'ALIPAY_GATEWAY_URL',
] as const

async function withChannelEnv<T>(env: Partial<Record<(typeof CHANNEL_ENV_KEYS)[number], string>>, run: () => Promise<T>): Promise<T> {
  const saved = new Map(CHANNEL_ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of CHANNEL_ENV_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(env)) process.env[key] = value
  try {
    return await run()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

export async function verifyPersonalChargeChannelGate(deps: PersonalChargeChannelDeps): Promise<void> {
  const { prisma, call, adminHeaders } = deps
  const switchPath = '/api/v1/admin/billing/personal-charge'
  const auditCount = (action: string) => prisma.auditLog.count({ where: { action } })

  // 关闭不受影响：先确保开着，再在没有任何渠道时关掉。
  await prisma.platformSetting.upsert({
    where: { key: PERSONAL_CHARGE_SETTING_KEY },
    create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'true' },
    update: { value: 'true' },
  })
  const disableAuditsBefore = await auditCount(PERSONAL_CHARGE_DISABLE_AUDIT_ACTION)
  await withChannelEnv({}, async () => {
    const closed = await call('PUT', switchPath, { enabled: false }, adminHeaders)
    assert.equal(closed.status, 200, `没有收款渠道也能关：${JSON.stringify(closed.json)}`)
    assert.equal(closed.json.enabled, false)
  })
  assert.equal(await readPersonalChargeEnabled(prisma), false)
  assert.equal(await auditCount(PERSONAL_CHARGE_DISABLE_AUDIT_ACTION), disableAuditsBefore + 1, '关闭照常记审计')
  console.log('PASS 没有收款渠道时关闭总开关不受影响')

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const notifyBase = 'https://pay-notify.verify.test'
  const refusals: Array<{ label: string; env: Partial<Record<(typeof CHANNEL_ENV_KEYS)[number], string>>; channels?: string[] }> = [
    { label: '没有启用任何收款渠道', env: {} },
    { label: '收款渠道明确关闭', env: { PAYMENT_PROVIDER: 'disabled' }, channels: [] },
    { label: '微信渠道配置不完整', env: { PAYMENT_PROVIDER: 'wechat', PAYMENT_NOTIFY_BASE_URL: notifyBase } },
    {
      label: '只有支付宝（按次付款不走支付宝）',
      env: {
        PAYMENT_PROVIDER: 'alipay',
        PAYMENT_NOTIFY_BASE_URL: notifyBase,
        ALIPAY_APP_ID: '2021000000000000',
        ALIPAY_APP_PRIVATE_KEY_PEM: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        ALIPAY_PUBLIC_KEY_PEM: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
      channels: ['alipay'],
    },
  ]
  const enableAuditsBefore = await auditCount(PERSONAL_CHARGE_ENABLE_AUDIT_ACTION)
  for (const item of refusals) {
    await withChannelEnv(item.env, async () => {
      if (item.channels) {
        assert.deepEqual(resolvePaymentProviders().channels(), item.channels, `${item.label}：夹具配置本身要能解析`)
      }
      const refused = await call('PUT', switchPath, { enabled: true, confirm: true }, adminHeaders)
      assert.equal(refused.status, 409, `${item.label}：打开要被拒 → ${refused.status} ${JSON.stringify(refused.json)}`)
      assert.equal(refused.json.error?.code, PERSONAL_CHARGE_CHANNEL_UNAVAILABLE_CODE, `${item.label}：错误码`)
      assert.equal(refused.json.error?.message, PERSONAL_CHARGE_CHANNEL_UNAVAILABLE_MESSAGE, `${item.label}：给管理员看的话`)
    })
    assert.equal(await readPersonalChargeEnabled(prisma), false, `${item.label}：开关仍关着`)
  }
  assert.equal(PERSONAL_CHARGE_CHANNEL_UNAVAILABLE_MESSAGE, '还没有可用的收款渠道，不能打开向个人收费')
  assert.equal(await auditCount(PERSONAL_CHARGE_ENABLE_AUDIT_ACTION), enableAuditsBefore, '被拒的打开不能记打开审计')
  console.log('PASS 没有可用收款渠道（未启用、关闭、配置不完整、只有支付宝）时打开总开关被拒，开关不变')

  await withChannelEnv({ PAYMENT_PROVIDER: 'sandbox', SANDBOX_PAYMENT_SECRET: 'verify-personal-charge-sandbox-0123' }, async () => {
    const opened = await call('PUT', switchPath, { enabled: true, confirm: true }, adminHeaders)
    assert.equal(opened.status, 200, `有可用渠道时照常打开：${JSON.stringify(opened.json)}`)
    assert.equal(opened.json.enabled, true)
  })
  assert.equal(await readPersonalChargeEnabled(prisma), true)
  assert.equal(await auditCount(PERSONAL_CHARGE_ENABLE_AUDIT_ACTION), enableAuditsBefore + 1, '打开照常记审计')
  console.log('PASS 有可用收款渠道时照常打开总开关')
}
