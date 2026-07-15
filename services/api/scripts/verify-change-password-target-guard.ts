import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  CHANGE_PASSWORD_VERIFY_DATABASE_URL,
  assertChangePasswordVerifyTarget,
} from './change-password-verify-target'

type VerifyEnvironment = {
  DATABASE_URL?: string
  NODE_ENV?: string
  VERIFY_CHANGE_PASSWORD_DB_PATH?: string
}

const dedicatedDatabasePath = resolve(__dirname, '../prisma/verify-change-password.db')

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(message)
}

function expectRejected(input: VerifyEnvironment, expectedCode: string, label: string): void {
  try {
    assertChangePasswordVerifyTarget(input, dedicatedDatabasePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(expectedCode)) fail(`${label}: expected ${expectedCode}, got ${message}`)
    pass(label)
    return
  }
  fail(`${label}: expected rejection ${expectedCode}`)
}

function main(): void {
  console.log('\n=== 改密 verify 目标守卫验证 ===')

  expectRejected(
    { DATABASE_URL: CHANGE_PASSWORD_VERIFY_DATABASE_URL, NODE_ENV: 'production', VERIFY_CHANGE_PASSWORD_DB_PATH: dedicatedDatabasePath },
    'CHANGE_PASSWORD_VERIFY_PRODUCTION_FORBIDDEN',
    '生产环境一律拒绝改密 verify',
  )
  expectRejected(
    { DATABASE_URL: CHANGE_PASSWORD_VERIFY_DATABASE_URL, VERIFY_CHANGE_PASSWORD_DB_PATH: '/tmp/not-the-dedicated-db' },
    'CHANGE_PASSWORD_VERIFY_DATABASE_PATH_REQUIRED',
    '缺少专用绝对路径标记时拒绝执行',
  )
  expectRejected(
    { DATABASE_URL: 'postgresql://verify:verify@example.com:5432/ai_job_print', VERIFY_CHANGE_PASSWORD_DB_PATH: dedicatedDatabasePath },
    'CHANGE_PASSWORD_VERIFY_DATABASE_UNSAFE',
    '远程 PostgreSQL 一律拒绝改密 verify',
  )

  assertChangePasswordVerifyTarget(
    { DATABASE_URL: CHANGE_PASSWORD_VERIFY_DATABASE_URL, NODE_ENV: 'test', VERIFY_CHANGE_PASSWORD_DB_PATH: dedicatedDatabasePath },
    dedicatedDatabasePath,
  )
  pass('专用本地 SQLite 三元组可以执行')

  const verifySource = readFileSync(resolve(__dirname, 'verify-change-password.ts'), 'utf8')
  if (verifySource.includes('auditLog.deleteMany')) fail('改密 verify 不得删除 AuditLog')
  pass('改密 verify 不删除 AuditLog')

  console.log('\n=== ALL PASS ===')
}

main()
