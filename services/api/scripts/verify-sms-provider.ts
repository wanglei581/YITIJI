/**
 * SMS provider wiring verification.
 *
 * This is intentionally network-free: it validates provider selection, production
 * safety guards, and Tencent config validation without calling any SMS vendor.
 */
import 'dotenv/config'
import { createSmsSender, LogSmsSender, resolveSmsProvider } from '../src/member-auth/sms/sms-sender'

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }

const trackedEnv = [
  'NODE_ENV',
  'SMS_PROVIDER',
  'TENCENT_SMS_SECRET_ID',
  'TENCENT_SMS_SECRET_KEY',
  'TENCENT_SMS_SDK_APP_ID',
  'TENCENT_SMS_SIGN_NAME',
  'TENCENT_SMS_TEMPLATE_ID',
  'TENCENT_SMS_REGION',
] as const

const original = new Map<string, string | undefined>()
for (const key of trackedEnv) original.set(key, process.env[key])

function resetEnv(): void {
  for (const key of trackedEnv) {
    const value = original.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function clearSmsEnv(): void {
  for (const key of trackedEnv) delete process.env[key]
}

function expectThrows(label: string, fn: () => unknown, contains: string): void {
  try {
    fn()
    fail(`${label}: 未抛错`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes(contains)) pass(label)
    else fail(`${label}: 错误信息不匹配 ${message}`)
  }
}

async function main() {
  console.log('\n=== SMS provider wiring verification ===')
  try {
    clearSmsEnv()
    process.env['NODE_ENV'] = 'development'
    if (resolveSmsProvider() === 'log' && createSmsSender() instanceof LogSmsSender) {
      pass('开发环境未配置 SMS_PROVIDER 时默认使用 log provider')
    } else {
      fail('开发环境默认 provider 不是 log')
    }

    clearSmsEnv()
    process.env['NODE_ENV'] = 'production'
    expectThrows(
      '生产环境未配置 SMS_PROVIDER 时拒绝启动',
      () => resolveSmsProvider(),
      '生产环境必须显式配置',
    )

    clearSmsEnv()
    process.env['NODE_ENV'] = 'production'
    process.env['SMS_PROVIDER'] = 'log'
    expectThrows(
      '生产环境禁止 SMS_PROVIDER=log',
      () => resolveSmsProvider(),
      '生产环境禁止',
    )

    clearSmsEnv()
    process.env['NODE_ENV'] = 'production'
    process.env['SMS_PROVIDER'] = 'tencent'
    expectThrows(
      'SMS_PROVIDER=tencent 时缺少腾讯云短信配置会失败',
      () => createSmsSender(),
      'TENCENT_SMS_SECRET_ID 未配置',
    )

    clearSmsEnv()
    process.env['NODE_ENV'] = 'production'
    process.env['SMS_PROVIDER'] = 'tencent'
    process.env['TENCENT_SMS_SECRET_ID'] = 'placeholder-secret-id'
    process.env['TENCENT_SMS_SECRET_KEY'] = 'placeholder-secret-key'
    process.env['TENCENT_SMS_SDK_APP_ID'] = '1400000000'
    process.env['TENCENT_SMS_SIGN_NAME'] = 'AI求职打印服务终端'
    process.env['TENCENT_SMS_TEMPLATE_ID'] = '123456'
    const sender = createSmsSender()
    if (sender.constructor.name === 'TencentSmsSender') {
      pass('腾讯云短信配置完整时可创建 TencentSmsSender 预留实现')
    } else {
      fail(`腾讯云 provider 创建异常: ${sender.constructor.name}`)
    }
  } finally {
    resetEnv()
  }

  if (process.exitCode) process.exit(process.exitCode)
  console.log('\nALL PASS')
}

main().catch((error) => {
  console.error(error)
  resetEnv()
  process.exit(1)
})
