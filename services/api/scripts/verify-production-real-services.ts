import { assertProductionRuntimeGates } from '../src/config/production-runtime-gates'

type Env = Parameters<typeof assertProductionRuntimeGates>[0]

const PROD_OK: Env = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-strong-production-secret-0123456789',
  FILE_STORAGE_DRIVER: 'cos',
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/ai_job_print',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  SMS_PROVIDER: 'tencent',
  TENCENT_SMS_SECRET_ID: 'sms-secret-id',
  TENCENT_SMS_SECRET_KEY: 'sms-secret-key',
  TENCENT_SMS_SDK_APP_ID: 'sms-sdk-app-id',
  TENCENT_SMS_SIGN_NAME: 'sms-sign-name',
  TENCENT_SMS_TEMPLATE_ID: 'sms-template-id',
  OCR_PROVIDER: 'baidu',
  BAIDU_OCR_API_KEY: 'baidu-api-key',
  BAIDU_OCR_SECRET_KEY: 'baidu-secret-key',
  AI_PROVIDER: 'llm',
  AI_LLM_API_KEY: 'llm-api-key',
}

function expectAllowed(env: Env, label: string): void {
  assertProductionRuntimeGates(env)
  console.log(`  PASS ${label}`)
}

function expectRejected(env: Env, expectedCode: string, label: string): void {
  try {
    assertProductionRuntimeGates(env)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(expectedCode)) {
      throw new Error(`${label}: expected ${expectedCode}, got ${message}`)
    }
    console.log(`  PASS ${label}`)
    return
  }
  throw new Error(`${label}: expected rejection (${expectedCode})`)
}

function main(): void {
  console.log('\n=== 生产真实服务门禁验证 ===')

  expectAllowed(
    {
      NODE_ENV: 'development',
      FILE_STORAGE_DRIVER: 'local',
      DATABASE_URL: 'file:./prisma/dev.db',
      AI_PROVIDER: 'mock',
      OCR_PROVIDER: 'disabled',
    },
    '开发环境允许本地/mock/disabled 配置',
  )
  expectAllowed(PROD_OK, '生产环境真实服务配置放行')
  expectAllowed(
    { ...PROD_OK, AI_LLM_API_KEY: undefined, TRTC_LLM_API_KEY: 'trtc-llm-api-key' },
    '生产环境允许 TRTC_LLM_API_KEY 作为 LLM 密钥兼容项',
  )

  expectRejected(
    { ...PROD_OK, AI_PROVIDER: undefined },
    'PRODUCTION_AI_PROVIDER_NOT_LLM',
    '生产环境拒绝未设置 AI_PROVIDER',
  )
  expectRejected(
    { ...PROD_OK, AI_PROVIDER: 'mock' },
    'PRODUCTION_AI_PROVIDER_NOT_LLM',
    '生产环境拒绝 AI_PROVIDER=mock',
  )
  expectRejected(
    { ...PROD_OK, AI_PROVIDER: 'openai' },
    'PRODUCTION_AI_PROVIDER_NOT_LLM',
    '生产环境拒绝接入未闭环的 AI provider stub',
  )
  expectRejected(
    { ...PROD_OK, AI_LLM_API_KEY: '   ', TRTC_LLM_API_KEY: undefined },
    'PRODUCTION_LLM_CONFIG_MISSING',
    '生产环境拒绝缺失真实 LLM 密钥',
  )
  expectRejected(
    { ...PROD_OK, OCR_PROVIDER: undefined },
    'PRODUCTION_OCR_PROVIDER_NOT_BAIDU',
    '生产环境拒绝未设置 OCR_PROVIDER',
  )
  expectRejected(
    { ...PROD_OK, OCR_PROVIDER: 'disabled' },
    'PRODUCTION_OCR_PROVIDER_NOT_BAIDU',
    '生产环境拒绝 OCR_PROVIDER=disabled',
  )
  expectRejected(
    { ...PROD_OK, REDIS_URL: undefined },
    'PRODUCTION_REDIS_URL_MISSING',
    '生产环境拒绝缺失 REDIS_URL',
  )

  console.log('\n=== ALL PASS ===')
}

main()
