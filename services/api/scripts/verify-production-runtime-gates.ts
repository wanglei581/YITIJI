import { assertProductionRuntimeGates } from '../src/config/production-runtime-gates'
import { resolveJwtSecret } from '../src/common/jwt-verifier.module'

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
const REQUIRED_SMS_KEYS = [
  'TENCENT_SMS_SECRET_ID',
  'TENCENT_SMS_SECRET_KEY',
  'TENCENT_SMS_SDK_APP_ID',
  'TENCENT_SMS_SIGN_NAME',
  'TENCENT_SMS_TEMPLATE_ID',
] as const

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

function expectJwtSecretAllowed(secret: string, label: string): void {
  const prev = process.env['JWT_SECRET']
  process.env['JWT_SECRET'] = secret
  try {
    const resolved = resolveJwtSecret()
    if (resolved !== secret) throw new Error(`${label}: resolved secret mismatch`)
    console.log(`  PASS ${label}`)
  } finally {
    if (prev === undefined) delete process.env['JWT_SECRET']
    else process.env['JWT_SECRET'] = prev
  }
}

function expectJwtSecretRejected(secret: string | undefined, label: string): void {
  const prev = process.env['JWT_SECRET']
  if (secret === undefined) delete process.env['JWT_SECRET']
  else process.env['JWT_SECRET'] = secret
  try {
    resolveJwtSecret()
  } catch {
    console.log(`  PASS ${label}`)
    if (prev === undefined) delete process.env['JWT_SECRET']
    else process.env['JWT_SECRET'] = prev
    return
  }
  if (prev === undefined) delete process.env['JWT_SECRET']
  else process.env['JWT_SECRET'] = prev
  throw new Error(`${label}: expected JWT verifier rejection`)
}

function main(): void {
  console.log('\n=== 生产运行时启动门禁验证 ===')

  // 非生产环境一律放行（即便配置不安全）
  expectAllowed(
    { NODE_ENV: 'development', JWT_SECRET: 'short', FILE_STORAGE_DRIVER: 'local', DATABASE_URL: 'file:./prisma/dev.db' },
    '开发环境放行（不强制生产门禁）',
  )
  expectAllowed(
    { JWT_SECRET: undefined, FILE_STORAGE_DRIVER: undefined, DATABASE_URL: 'file:./prisma/dev.db' },
    '未声明 NODE_ENV 时放行',
  )

  // 运行时 JwtModule 验签配置必须始终 fail-closed；不依赖 NODE_ENV。
  expectJwtSecretRejected(undefined, 'JwtVerifierModule 拒绝缺失 JWT_SECRET')
  expectJwtSecretRejected('too-short', 'JwtVerifierModule 拒绝过短 JWT_SECRET')
  expectJwtSecretAllowed('runtime-jwt-secret-0123456789', 'JwtVerifierModule 接受强 JWT_SECRET')

  // 生产环境：全部满足时放行
  expectAllowed(PROD_OK, '生产环境合规配置放行')

  // 生产环境：JWT_SECRET 门禁
  expectRejected(
    { ...PROD_OK, JWT_SECRET: undefined },
    'PRODUCTION_JWT_SECRET_INVALID',
    '生产环境拒绝缺失 JWT_SECRET',
  )
  expectRejected(
    { ...PROD_OK, JWT_SECRET: 'too-short' },
    'PRODUCTION_JWT_SECRET_INVALID',
    '生产环境拒绝过短 JWT_SECRET（<16）',
  )

  // 生产环境：FILE_STORAGE_DRIVER 门禁
  expectRejected(
    { ...PROD_OK, FILE_STORAGE_DRIVER: 'local' },
    'PRODUCTION_FILE_STORAGE_DRIVER_NOT_COS',
    '生产环境拒绝 FILE_STORAGE_DRIVER=local',
  )
  expectRejected(
    { ...PROD_OK, FILE_STORAGE_DRIVER: undefined },
    'PRODUCTION_FILE_STORAGE_DRIVER_NOT_COS',
    '生产环境拒绝未设置 FILE_STORAGE_DRIVER',
  )

  // 生产环境：DATABASE_URL 门禁（委托 assertRuntimeDatabaseAllowed）
  expectRejected(
    { ...PROD_OK, DATABASE_URL: undefined },
    'PRODUCTION_DATABASE_URL_MISSING',
    '生产环境拒绝缺失 DATABASE_URL',
  )
  expectRejected(
    { ...PROD_OK, DATABASE_URL: 'file:./prisma/dev.db' },
    'PRODUCTION_SQLITE_FORBIDDEN',
    '生产环境拒绝 SQLite 数据库',
  )

  // 生产环境：Redis 必须配置，保障会员会话、队列、幂等和防重放能力
  expectRejected(
    { ...PROD_OK, REDIS_URL: undefined },
    'PRODUCTION_REDIS_URL_MISSING',
    '生产环境拒绝缺失 REDIS_URL',
  )

  // 生产环境：短信必须使用腾讯云真实 provider，且必填项齐全
  expectRejected(
    { ...PROD_OK, SMS_PROVIDER: undefined },
    'PRODUCTION_SMS_PROVIDER_NOT_TENCENT',
    '生产环境拒绝未设置 SMS_PROVIDER',
  )
  expectRejected(
    { ...PROD_OK, SMS_PROVIDER: 'log' },
    'PRODUCTION_SMS_PROVIDER_NOT_TENCENT',
    '生产环境拒绝 SMS_PROVIDER=log',
  )
  for (const key of REQUIRED_SMS_KEYS) {
    expectRejected(
      { ...PROD_OK, [key]: key.endsWith('KEY') ? '   ' : '' },
      'PRODUCTION_TENCENT_SMS_CONFIG_MISSING',
      `生产环境拒绝腾讯短信配置缺项:${key}`,
    )
  }

  // 生产环境：OCR 必须接百度真实服务，且必须填齐百度密钥
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
    { ...PROD_OK, BAIDU_OCR_API_KEY: '   ' },
    'PRODUCTION_BAIDU_OCR_CONFIG_MISSING',
    '生产环境拒绝百度 OCR 缺失 API Key',
  )
  expectRejected(
    { ...PROD_OK, BAIDU_OCR_SECRET_KEY: undefined },
    'PRODUCTION_BAIDU_OCR_CONFIG_MISSING',
    '生产环境拒绝百度 OCR 缺失密钥',
  )
  // 生产环境：AI 必须走真实 LLM adapter，不能回退 mock 或未闭环 stub
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
    '生产环境拒绝未闭环 AI provider stub',
  )
  expectRejected(
    { ...PROD_OK, AI_LLM_API_KEY: '   ', TRTC_LLM_API_KEY: undefined },
    'PRODUCTION_LLM_CONFIG_MISSING',
    '生产环境拒绝缺失真实 LLM 密钥',
  )
  expectAllowed(
    { ...PROD_OK, AI_LLM_API_KEY: undefined, TRTC_LLM_API_KEY: 'trtc-llm-api-key' },
    '生产环境允许 TRTC_LLM_API_KEY 作为 LLM 密钥兼容项',
  )

  console.log('\n=== ALL PASS ===')
}

main()
