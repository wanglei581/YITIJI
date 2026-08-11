import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  assertIsolatedVerificationDatabase,
  type VerificationDatabaseEnvironment,
} from './support/isolated-verification-database'

const ROW_WRITING_VERIFIERS = [
  'verify-payment-real-channels.ts',
  'verify-print-jobs.ts',
  'verify-refund-real-channels.ts',
] as const

function expectRejected(
  env: VerificationDatabaseEnvironment,
  expectedCode: string,
  label: string,
): void {
  assert.throws(
    () => assertIsolatedVerificationDatabase(env),
    (error: unknown) => error instanceof Error && error.message.includes(expectedCode),
    label,
  )
}

function assertGuardPrecedesDatabaseWrites(source: string, filename: string): void {
  const guardCall = source.indexOf('assertIsolatedVerificationDatabase()')
  const protectedOperations = [
    'new PrismaService()',
    'await cleanup()',
    'seedDevDefaultPriceConfig(',
  ] as const

  assert.notEqual(guardCall, -1, `${filename} must require the isolated verification database guard`)
  for (const operation of protectedOperations) {
    const operationIndex = source.indexOf(operation)
    assert.notEqual(operationIndex, -1, `${filename} must contain ${operation} for this regression check`)
    assert.ok(
      guardCall < operationIndex,
      `${filename} must enforce database isolation before ${operation}`,
    )
  }
}

function main(): void {
  const marker = { VERIFICATION_DATABASE_TARGET: 'isolated' }

  expectRejected(
    {
      ...marker,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://verify:verify@127.0.0.1:5432/ai_job_print_ci',
    },
    'VERIFICATION_DATABASE_PRODUCTION_FORBIDDEN',
    'production is always forbidden even for an otherwise isolated URL',
  )
  expectRejected(
    { NODE_ENV: 'test', DATABASE_URL: 'file:./prisma/dev.db' },
    'VERIFICATION_DATABASE_TARGET_REQUIRED',
    'explicit isolated marker is required',
  )
  expectRejected(
    {
      ...marker,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://verify:verify@prod-db.example.com:5432/ai_job_print_ci',
    },
    'VERIFICATION_DATABASE_URL_UNSAFE',
    'remote production database URLs are forbidden even when their database name looks test-only',
  )
  expectRejected(
    {
      ...marker,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://verify:verify@127.0.0.1:5432/ai_job_print',
    },
    'VERIFICATION_DATABASE_NAME_UNSAFE',
    'localhost PostgreSQL still requires an explicitly test-only database name',
  )

  assert.doesNotThrow(() =>
    assertIsolatedVerificationDatabase({
      ...marker,
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./prisma/dev.db',
    }),
  )
  assert.doesNotThrow(() =>
    assertIsolatedVerificationDatabase({
      ...marker,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://ci:ci@localhost:5432/ai_job_print_ci',
    }),
  )

  for (const filename of ROW_WRITING_VERIFIERS) {
    const source = readFileSync(path.join(__dirname, filename), 'utf8')
    assertGuardPrecedesDatabaseWrites(source, filename)
  }

  console.log('verify-isolated-verification-database: all assertions passed')
}

main()
