/**
 * Wave 1-B 数据权利请求基础契约门禁。
 *
 * 覆盖 shared DTO、SQLite/PostgreSQL schema/migration、真实 SQLite unique
 * 行为，以及 AuditService required/best-effort 两条写入路径。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type {
  AdminMemberDataRequestItem,
  CreateMemberDataRequestInput,
  MemberDataRequestItem,
  MemberDataRequestPage,
  MemberExportDownloadAuthorization,
} from '../../../packages/shared/src/types/member-privacy'
import { AuditService } from '../src/audit/audit.service'
import type { PrismaService, PrismaTransactionClient } from '../src/prisma/prisma.service'

const repoRoot = resolve(__dirname, '../../..')
const apiRoot = resolve(repoRoot, 'services/api')
let failures = 0

function pass(label: string): void {
  console.log(`  PASS ${label}`)
}

function fail(label: string, error?: unknown): void {
  failures += 1
  const detail = error instanceof Error ? `: ${error.message}` : ''
  console.error(`  FAIL ${label}${detail}`)
}

async function check(label: string, operation: () => void | Promise<void>): Promise<void> {
  try {
    await operation()
    pass(label)
  } catch (error) {
    fail(label, error)
  }
}

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
}

function modelBlock(schema: string, modelName: string): string {
  const startMarker = `model ${modelName} {`
  const start = schema.indexOf(startMarker)
  if (start === -1) return ''
  const nextModel = schema.indexOf('\nmodel ', start + startMarker.length)
  return schema.slice(start, nextModel === -1 ? schema.length : nextModel)
}

function interfaceBlock(source: string, interfaceName: string): string {
  const startMarker = `export interface ${interfaceName}`
  const start = source.indexOf(startMarker)
  if (start === -1) return ''
  const openingBrace = source.indexOf('{', start + startMarker.length)
  if (openingBrace === -1) return ''
  const end = source.indexOf('\n}', openingBrace + 1)
  return end === -1 ? source.slice(start) : source.slice(start, end + 2)
}

function compact(source: string): string {
  return source.replace(/\s+/g, ' ').trim()
}

function assertContains(source: string, markers: readonly string[]): void {
  for (const marker of markers) assert.ok(source.includes(marker), `缺少 ${marker}`)
}

function assertNotContains(source: string, markers: readonly string[]): void {
  for (const marker of markers) assert.ok(!source.includes(marker), `不应包含 ${marker}`)
}

function verifyTypedSharedFixtures(): void {
  const item: MemberDataRequestItem = {
    id: 'request-contract',
    requestType: 'export',
    status: 'ready',
    requestedAt: '2026-07-17T00:00:00.000Z',
    handledAt: null,
    executionStep: null,
    exportExpiresAt: '2026-07-18T00:00:00.000Z',
    failureCode: null,
    canRetry: false,
    canDownload: true,
  }
  const page: MemberDataRequestPage = {
    items: [item],
    nextCursor: null,
    capabilities: { accountClosureAvailable: false },
  }
  const adminItem: AdminMemberDataRequestItem = {
    ...item,
    endUserId: 'member-contract',
    phoneMasked: '***',
    nickname: null,
    retryCount: 0,
    lastAttemptAt: null,
    handledBy: null,
    auditRef: null,
  }
  const input: CreateMemberDataRequestInput = { requestType: 'export' }
  const authorization: MemberExportDownloadAuthorization = {
    requestId: item.id,
    downloadUrl: '/api/v1/member/data-exports/request-contract/content',
    expiresAt: '2026-07-17T00:10:00.000Z',
  }
  assert.equal(page.items[0]?.id, item.id)
  assert.equal(adminItem.requestType, input.requestType)
  assert.equal(authorization.requestId, item.id)
}

function verifySharedSource(): void {
  const shared = read('packages/shared/src/types/member-privacy.ts')
  const memberItem = interfaceBlock(shared, 'MemberDataRequestItem')
  const page = interfaceBlock(shared, 'MemberDataRequestPage')
  const adminItem = interfaceBlock(shared, 'AdminMemberDataRequestItem')
  const input = interfaceBlock(shared, 'CreateMemberDataRequestInput')
  const authorization = interfaceBlock(shared, 'MemberExportDownloadAuthorization')

  assertContains(compact(memberItem), [
    'requestType: MemberDataRequestType',
    'status: MemberDataRequestStatus',
    'executionStep: string | null',
    'exportExpiresAt: string | null',
    'failureCode: string | null',
    'canRetry: boolean',
    'canDownload: boolean',
  ])
  assertContains(compact(page), [
    'items: MemberDataRequestItem[]',
    'nextCursor: string | null',
    'accountClosureAvailable: boolean',
  ])
  assertContains(compact(adminItem), [
    'extends MemberDataRequestItem',
    'phoneMasked: string',
    'retryCount: number',
    'lastAttemptAt: string | null',
  ])
  assertContains(compact(input), ['requestType: MemberDataRequestType'])
  assertContains(compact(authorization), ['requestId: string', 'downloadUrl: string', 'expiresAt: string'])
  for (const block of [memberItem, page, adminItem, input, authorization]) {
    assertNotContains(block, ['failureMessage', 'storageKey', 'downloadTicket', 'claimSecret', 'token:'])
  }
}

function verifySchemaAndMigrationSource(): void {
  const sqliteModel = compact(modelBlock(read('services/api/prisma/schema.prisma'), 'UserDataRequest'))
  const postgresModel = compact(modelBlock(read('services/api/prisma/postgres/schema.prisma'), 'UserDataRequest'))
  const schemaMarkers = [
    'idempotencyKey String? @unique',
    'activeKey String? @unique',
    'executionVersion Int @default(0)',
    'executionStep String?',
    'progressJson String?',
    'workerJobId String?',
    'exportFileId String? @unique',
    'exportExpiresAt DateTime?',
    'downloadConsumedAt DateTime?',
    'failureCode String?',
    'failureMessage String?',
    'retryCount Int @default(0)',
    'lastAttemptAt DateTime?',
    '@@index([exportExpiresAt])',
  ] as const
  assertContains(sqliteModel, schemaMarkers)
  assertContains(postgresModel, schemaMarkers)
  assertNotContains(sqliteModel, ['exportFile FileObject'])
  assertNotContains(postgresModel, ['exportFile FileObject'])

  const sqliteMigration = [
    read('services/api/prisma/migrations/20260717130000_extend_user_data_requests/migration.sql'),
    read('services/api/prisma/migrations/20260717140000_complete_member_data_export/migration.sql'),
  ].join('\n')
  const postgresMigration = [
    read('services/api/prisma/postgres/migrations/20260717130000_extend_user_data_requests/migration.sql'),
    read('services/api/prisma/postgres/migrations/20260717140000_complete_member_data_export/migration.sql'),
  ].join('\n')
  const commonMarkers = [
    'ADD COLUMN "idempotencyKey" TEXT',
    'ADD COLUMN "activeKey" TEXT',
    'ADD COLUMN "executionVersion" INTEGER NOT NULL DEFAULT 0',
    'ADD COLUMN "progressJson" TEXT',
    'ADD COLUMN "exportFileId" TEXT',
    'ADD COLUMN "failureMessage" TEXT',
    'ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0',
    'CREATE UNIQUE INDEX "UserDataRequest_idempotencyKey_key" ON "UserDataRequest"("idempotencyKey");',
    'CREATE UNIQUE INDEX "UserDataRequest_activeKey_key" ON "UserDataRequest"("activeKey");',
    'CREATE UNIQUE INDEX "UserDataRequest_exportFileId_key" ON "UserDataRequest"("exportFileId");',
    'CREATE INDEX "UserDataRequest_exportExpiresAt_idx" ON "UserDataRequest"("exportExpiresAt");',
  ] as const
  assertContains(sqliteMigration, commonMarkers)
  assertContains(postgresMigration, commonMarkers)
  assertContains(sqliteMigration, ['"exportExpiresAt" DATETIME', '"lastAttemptAt" DATETIME'])
  assertContains(postgresMigration, ['"exportExpiresAt" TIMESTAMP(3)', '"lastAttemptAt" TIMESTAMP(3)'])
  assertNotContains(sqliteMigration, ['TIMESTAMP(3)', 'UPDATE "UserDataRequest"'])
  assertNotContains(postgresMigration, ['DATETIME', 'UPDATE "UserDataRequest"'])
}

function sqlite(databasePath: string, sql: string): string {
  return execFileSync('sqlite3', ['-batch', '-noheader', '-separator', '|', databasePath, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function expectSqliteConstraint(
  databasePath: string,
  sql: string,
  column: 'idempotencyKey' | 'activeKey' | 'exportFileId',
  label: string,
): void {
  try {
    sqlite(databasePath, sql)
  } catch (error) {
    const commandError = error as { message?: string; stderr?: string | Buffer }
    const errorText = [commandError.message, commandError.stderr?.toString()]
      .filter((value): value is string => Boolean(value))
      .join('\n')
    assert.ok(
      errorText.includes(`UNIQUE constraint failed: UserDataRequest.${column}`),
      `${label} 返回了非目标约束错误: ${errorText}`,
    )
    pass(label)
    return
  }
  throw new Error(`${label} 未拒绝重复非 NULL 值`)
}

function verifyRealSqliteMigrationBehavior(): void {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'member-data-request-contract-'))
  const databasePath = join(temporaryDirectory, 'contract.db')
  closeSync(openSync(databasePath, 'a'))
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const insert = (id: string, extraColumns = '', extraValues = '') => sqlite(
      databasePath,
      `INSERT INTO "UserDataRequest" ("id", "endUserId", "requestType"${extraColumns}) VALUES ('${id}', 'member-contract', 'export'${extraValues});`,
    )
    insert('nullable-one')
    insert('nullable-two')
    assert.equal(
      sqlite(
        databasePath,
        `SELECT COUNT(*) FROM "UserDataRequest" WHERE "idempotencyKey" IS NULL AND "activeKey" IS NULL AND "exportFileId" IS NULL;`,
      ),
      '2',
    )
    assert.equal(
      sqlite(
        databasePath,
        `SELECT "executionVersion", "progressJson", "retryCount", "lastAttemptAt" IS NULL FROM "UserDataRequest" WHERE "id"='nullable-one';`,
      ),
      '0||0|1',
    )

    insert('idempotency-first', ', "idempotencyKey"', ", 'duplicate-idempotency'")
    expectSqliteConstraint(
      databasePath,
      `INSERT INTO "UserDataRequest" ("id", "endUserId", "requestType", "idempotencyKey") VALUES ('idempotency-second', 'member-contract', 'export', 'duplicate-idempotency');`,
      'idempotencyKey',
      'SQLite idempotencyKey 重复非 NULL 被拒',
    )
    insert('active-first', ', "activeKey"', ", 'member-contract:privacy-exclusive'")
    expectSqliteConstraint(
      databasePath,
      `INSERT INTO "UserDataRequest" ("id", "endUserId", "requestType", "activeKey") VALUES ('active-second', 'member-contract', 'export', 'member-contract:privacy-exclusive');`,
      'activeKey',
      'SQLite activeKey 重复非 NULL 被拒',
    )
    insert('export-file-first', ', "exportFileId"', ", 'file-contract'")
    expectSqliteConstraint(
      databasePath,
      `INSERT INTO "UserDataRequest" ("id", "endUserId", "requestType", "exportFileId") VALUES ('export-file-second', 'member-contract', 'export', 'file-contract');`,
      'exportFileId',
      'SQLite exportFileId 重复非 NULL 被拒',
    )
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

interface AuditCreateInput {
  data: { payloadJson: string }
}

const auditArgs = {
  actorId: 'member-contract',
  actorRole: 'end_user',
  action: 'member_data_request.contract',
  targetType: 'user_data_request',
  targetId: 'request-contract',
}

async function verifyAuditRuntimeBehavior(): Promise<void> {
  let globalCalls = 0
  let transactionCalls = 0
  let transactionPayload = ''
  let loggerCalls = 0
  const globalFailure = new Error('expected global audit failure')
  const globalClient = {
    auditLog: {
      create: async (_input: AuditCreateInput) => {
        globalCalls += 1
        throw globalFailure
      },
    },
  } as unknown as PrismaService
  const service = new AuditService(globalClient)
  ;(service as unknown as { logger: { error: (message: string) => void } }).logger = {
    error: (_message: string) => {
      loggerCalls += 1
    },
  }
  const transactionClient = {
    auditLog: {
      create: async (input: AuditCreateInput) => {
        transactionCalls += 1
        transactionPayload = input.data.payloadJson
        return { id: 'required-audit' }
      },
    },
  } as unknown as Pick<PrismaTransactionClient, 'auditLog'>

  const requiredId = await service.writeRequired(transactionClient, {
    ...auditArgs,
    payload: { oversized: 'x'.repeat(5_000) },
  })
  assert.equal(requiredId, 'required-audit')
  assert.equal(transactionCalls, 1)
  assert.equal(globalCalls, 0, 'writeRequired 不得回退到全局 Prisma client')
  const serialized = JSON.parse(transactionPayload) as { truncated?: boolean; head?: string }
  assert.equal(serialized.truncated, true)
  assert.equal(serialized.head?.length, 2_048)

  const requiredFailure = new Error('expected required audit failure')
  const failingTransaction = {
    auditLog: { create: async () => Promise.reject(requiredFailure) },
  } as unknown as Pick<PrismaTransactionClient, 'auditLog'>
  await assert.rejects(
    () => service.writeRequired(failingTransaction, auditArgs),
    (error: unknown) => error === requiredFailure,
  )
  assert.equal(globalCalls, 0, 'writeRequired 失败时也不得调用全局 Prisma client')

  const optionalResult = await service.write(auditArgs)
  assert.equal(optionalResult, null)
  assert.equal(globalCalls, 1)
  assert.equal(loggerCalls, 1)
}

async function main(): Promise<void> {
  console.log('\n=== Wave 1-B 数据权利请求基础契约 ===')
  await check('shared DTO 编译期形状', verifyTypedSharedFixtures)
  await check('shared DTO 不暴露内部字段', verifySharedSource)
  await check('双 schema/migration additive parity', verifySchemaAndMigrationSource)
  await check('正式 migrations 的 SQLite nullable unique 真实行为', verifyRealSqliteMigrationBehavior)
  await check('AuditService transaction client / 失败语义', verifyAuditRuntimeBehavior)

  if (failures > 0) {
    console.error(`\n❌ ${failures} 项失败 — Wave 1-B 基础契约不完整\n`)
    process.exitCode = 1
    return
  }
  console.log('\n✅ ALL PASS — Wave 1-B 基础契约与真实行为一致\n')
}

void main()
