import { assertProductionRuntimeGates } from '../src/config/production-runtime-gates'

type Env = Parameters<typeof assertProductionRuntimeGates>[0]

const PROD_OK: Env = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-strong-production-secret-0123456789',
  FILE_STORAGE_DRIVER: 'cos',
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/ai_job_print',
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

  console.log('\n=== ALL PASS ===')
}

main()
