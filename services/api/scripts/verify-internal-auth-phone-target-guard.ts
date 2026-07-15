import { readFileSync } from 'fs'
import { join } from 'path'
import { assertInternalAuthVerifyTarget } from '../src/auth/internal-auth-verify-target'

type VerifyEnvironment = {
  DATABASE_URL?: string
  INTERNAL_AUTH_VERIFY_TARGET?: string
  NODE_ENV?: string
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(message)
}

function expectRejected(input: VerifyEnvironment, expectedCode: string, label: string): void {
  try {
    assertInternalAuthVerifyTarget(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(expectedCode)) {
      fail(`${label}: expected ${expectedCode}, got ${message}`)
    }
    pass(label)
    return
  }
  fail(`${label}: expected rejection ${expectedCode}`)
}

function main(): void {
  console.log('\n=== 内部认证 verify 目标守卫验证 ===')

  expectRejected(
    { DATABASE_URL: 'file:./prisma/dev.db', NODE_ENV: 'production', INTERNAL_AUTH_VERIFY_TARGET: 'isolated' },
    'INTERNAL_AUTH_VERIFY_PRODUCTION_FORBIDDEN',
    '生产环境一律拒绝行写入 verify',
  )
  expectRejected(
    { DATABASE_URL: 'file:./prisma/dev.db', NODE_ENV: 'test' },
    'INTERNAL_AUTH_VERIFY_TARGET_REQUIRED',
    '未显式声明隔离目标时拒绝执行',
  )
  expectRejected(
    {
      DATABASE_URL: 'postgresql://verify:verify@example.com:5432/ai_job_print',
      NODE_ENV: 'test',
      INTERNAL_AUTH_VERIFY_TARGET: 'isolated',
    },
    'INTERNAL_AUTH_VERIFY_DATABASE_UNSAFE',
    '远程 PostgreSQL 即使标记 isolated 也拒绝执行',
  )

  assertInternalAuthVerifyTarget({
    DATABASE_URL: 'file:./prisma/dev.db',
    NODE_ENV: 'test',
    INTERNAL_AUTH_VERIFY_TARGET: 'isolated',
  })
  pass('显式隔离本地 SQLite 可以执行')

  assertInternalAuthVerifyTarget({
    DATABASE_URL: 'postgresql://verify:verify@127.0.0.1:5432/ai_job_print',
    NODE_ENV: 'development',
    INTERNAL_AUTH_VERIFY_TARGET: 'isolated',
  })
  pass('显式隔离 localhost PostgreSQL 可以执行')

  const verifySource = readFileSync(join(__dirname, 'verify-internal-auth-phone.ts'), 'utf8')
  if (verifySource.includes('prisma.auditLog.deleteMany')) {
    fail('验证脚本不得删除全局 auth 审计日志')
  }
  pass('验证脚本不删除 AuditLog')

  console.log('\n=== ALL PASS ===')
}

main()
