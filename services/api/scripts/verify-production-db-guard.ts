import { assertRuntimeDatabaseAllowed } from '../src/prisma/create-client'

function expectAllowed(
  url: string,
  nodeEnv: string | undefined,
  label: string,
  options?: Parameters<typeof assertRuntimeDatabaseAllowed>[2],
): void {
  assertRuntimeDatabaseAllowed(url, nodeEnv, options)
  console.log(`  PASS ${label}`)
}

function expectRejected(url: string, nodeEnv: string | undefined, expectedCode: string, label: string): void {
  try {
    assertRuntimeDatabaseAllowed(url, nodeEnv)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(expectedCode)) {
      throw new Error(`${label}: expected ${expectedCode}, got ${message}`)
    }
    console.log(`  PASS ${label}`)
    return
  }
  throw new Error(`${label}: expected rejection`)
}

function main(): void {
  console.log('\n=== 生产数据库启动门禁验证 ===')
  expectAllowed('file:./prisma/dev.db', 'development', '开发环境允许 SQLite')
  expectAllowed('file:./prisma/dev.db', undefined, '未声明 NODE_ENV 时允许本地 SQLite')
  expectAllowed('postgresql://user:pass@127.0.0.1:5432/ai_job_print', 'production', '生产环境允许 PostgreSQL')
  expectRejected(
    'file:./prisma/dev.db',
    'production',
    'PRODUCTION_SQLITE_FORBIDDEN',
    '生产环境拒绝 SQLite',
  )
  expectAllowed(
    'file:./prisma/dev.db',
    'production',
    '生产迁移源库显式豁免时允许读取 SQLite',
    { allowProductionSqliteSource: true },
  )
  console.log('\n=== ALL PASS ===')
}

main()
