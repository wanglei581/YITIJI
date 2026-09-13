import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-tasks-secret-0123456789-abcdef'
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-scan-tasks-admin-secret'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-scan-tasks-action-secret'

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { Prisma } from '../src/generated/prisma/client'
import { createPrismaClient, dbKindOf } from '../src/prisma/create-client'
import { ScanTaskReaperTask } from '../src/scan-tasks/scan-task-reaper.task'
import {
  ScanTasksService,
  SCAN_CONTENT_DEDUP_WINDOW_MS,
  SCAN_MAX_FUTURE_OBSERVATION_MS,
  SCAN_RETRY_AUTHORITY_TTL_MS,
  SCAN_STALE_CAPTURE_TOLERANCE_MS,
} from '../src/scan-tasks/scan-tasks.service'
import type { CreateScanTaskDto } from '../src/scan-tasks/dto/create-scan-task.dto'
// B1-11 follow-up：真实 DB 端到端跑一遍 deliverScanFile() 的内容级去重护栏，需要真实
// AuditService / StorageService / FilesService（而不是本文件的 FakeFilesService）——
// 见 assertRealDbDedupGuardClosesCrossUserLeak() 顶部注释说明为什么必须是这三个真实服务。
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { runScanLeaseContractTests } from './scan-lease-contract.helper'

function runPrisma(apiRoot: string, args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync(
    process.execPath,
    [path.join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js'), ...args],
    {
      cwd: apiRoot,
      env,
      stdio: 'pipe',
    }
  )
}

function ensureSqliteFile(dbPath: string): void {
  closeSync(openSync(dbPath, 'a'))
}

const RETRY_HARDENING_MIGRATION = '20260913223000_harden_scan_retry_authority'
const RETRY_HARDENING_PREVIOUS_MIGRATION = '20260913210000_add_scan_input_lockout_telemetry'

function runPrismaExpectFailure(
  apiRoot: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  label: string
): void {
  let failed = false
  try {
    runPrisma(apiRoot, args, env)
  } catch {
    failed = true
  }
  assert.equal(failed, true, `${label}: duplicate-data migration must fail`)
}

function createMigrationSandbox(
  apiRoot: string,
  sourceMigrationsRoot: string,
  schemaPath: string,
  provider: 'sqlite' | 'postgresql'
): { root: string; migrationsRoot: string; configPath: string } {
  const root = mkdtempSync(path.join(tmpdir(), `verify-scan-retry-upgrade-${provider}-`))
  const migrationsRoot = path.join(root, 'migrations')
  mkdirSync(migrationsRoot)
  for (const entry of readdirSync(sourceMigrationsRoot, { withFileTypes: true })) {
    if (entry.name === RETRY_HARDENING_MIGRATION) continue
    cpSync(path.join(sourceMigrationsRoot, entry.name), path.join(migrationsRoot, entry.name), {
      recursive: entry.isDirectory(),
    })
  }
  const configPath = path.join(root, 'prisma.config.ts')
  const prismaConfigModule = path.join(apiRoot, 'node_modules', 'prisma', 'config.js')
  writeFileSync(
    configPath,
    `import { defineConfig } from ${JSON.stringify(prismaConfigModule)};\n` +
      `export default defineConfig({ schema: ${JSON.stringify(schemaPath)}, migrations: { path: ${JSON.stringify(migrationsRoot)} }, datasource: { url: process.env[${JSON.stringify(provider === 'postgresql' ? 'POSTGRES_URL' : 'DATABASE_URL')}] } });\n`
  )
  return { root, migrationsRoot, configPath }
}

function addHardeningMigrationToSandbox(
  sourceMigrationsRoot: string,
  migrationsRoot: string
): void {
  cpSync(
    path.join(sourceMigrationsRoot, RETRY_HARDENING_MIGRATION),
    path.join(migrationsRoot, RETRY_HARDENING_MIGRATION),
    { recursive: true }
  )
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '\n').replace(/--[^\n]*/g, '')
}

function stripTypeScriptComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '\n').replace(/\/\/[^\n]*/g, '')
}

function assertRetryHardeningMigrationSql(
  sql: string,
  dialect: 'sqlite' | 'postgres',
  label: string
): void {
  const body = stripSqlComments(sql)
  const ddlMatch = body.match(/\b(?:ALTER|DROP|CREATE)\b/i)
  assert.ok(ddlMatch && ddlMatch.index !== undefined, `${label}: hardening migration must contain DDL`)
  const prefix = body.slice(0, ddlMatch.index)
  assert.match(
    prefix,
    /retryOfScanTaskId/,
    `${label}: duplicate-lineage preflight must inspect retryOfScanTaskId before any DDL`
  )
  assert.match(
    prefix,
    /retryConsumedByScanTaskId/,
    `${label}: duplicate-lineage preflight must inspect retryConsumedByScanTaskId before any DDL`
  )
  assert.match(
    prefix,
    /HAVING\s+COUNT\s*\(\s*\*\s*\)\s*>\s*1/i,
    `${label}: duplicate-lineage preflight must abort on grouped duplicates before any DDL`
  )
  if (dialect === 'sqlite') {
    assert.match(
      prefix,
      /THEN\s+abs\s*\(\s*-9223372036854775808\s*\)/i,
      `${label}: SQLite preflight must abort via integer overflow before any DDL`
    )
  } else {
    assert.match(
      prefix,
      /RAISE\s+EXCEPTION\s+'SCAN_RETRY_LINEAGE_DUPLICATES'/i,
      `${label}: PostgreSQL preflight must RAISE SCAN_RETRY_LINEAGE_DUPLICATES before any DDL`
    )
  }
  assert.match(
    body.slice(ddlMatch.index),
    /^\s*ALTER\s+TABLE\s+"ScanTask"\s+ADD\s+COLUMN\s+"retryAuthorityExpiresAt"/i,
    `${label}: first DDL after preflight must add retryAuthorityExpiresAt`
  )
  assert.match(
    body,
    /CREATE UNIQUE INDEX "ScanTask_retryOfScanTaskId_key"[\s\S]*?WHERE "retryOfScanTaskId" IS NOT NULL/,
    `${label}: retryOfScanTaskId must be a partial unique index`
  )
  assert.match(
    body,
    /CREATE UNIQUE INDEX "ScanTask_retryConsumedByScanTaskId_key"[\s\S]*?WHERE "retryConsumedByScanTaskId" IS NOT NULL/,
    `${label}: retryConsumedByScanTaskId must be a partial unique index`
  )
}

function assertRetryHardeningMigrationContracts(apiRoot: string): void {
  assertRetryHardeningMigrationSql(
    readFileSync(
      path.join(apiRoot, 'prisma', 'migrations', RETRY_HARDENING_MIGRATION, 'migration.sql'),
      'utf8'
    ),
    'sqlite',
    'SQLite harden_scan_retry_authority'
  )
  assertRetryHardeningMigrationSql(
    readFileSync(
      path.join(
        apiRoot,
        'prisma',
        'postgres',
        'migrations',
        RETRY_HARDENING_MIGRATION,
        'migration.sql'
      ),
      'utf8'
    ),
    'postgres',
    'PostgreSQL harden_scan_retry_authority'
  )
}

function assertDeliverScanFileRequiresBidirectionalLineage(apiRoot: string): void {
  const source = readFileSync(path.join(apiRoot, 'src', 'scan-tasks', 'scan-tasks.service.ts'), 'utf8')
  const start = source.indexOf('async deliverScanFile')
  const end = source.indexOf('private effectiveStatus', start)
  assert.ok(start >= 0 && end > start, 'deliverScanFile() must exist in scan-tasks.service.ts')
  const body = stripTypeScriptComments(source.slice(start, end))
  const required = [
    'prior.retryConsumedByScanTaskId === task.id',
    'prior.lastAttemptHash === contentHash',
    'prior.endUserId === task.endUserId',
    'prior.terminalId === task.terminalId',
    'prior.scanType === task.scanType',
    'prior.retryConsumedAt.getTime() <= prior.retryAuthorityExpiresAt.getTime()',
  ]
  for (const snippet of required) {
    assert.ok(
      body.includes(snippet),
      `deliverScanFile() must keep bidirectional lineage check: ${snippet}`
    )
  }
}

function sqliteQuery(databasePath: string, sql: string): string {
  return execFileSync('sqlite3', ['-batch', '-noheader', '-separator', '|', databasePath, sql], {
    encoding: 'utf8',
  }).trim()
}

function postgresQuery(databaseUrl: string, sql: string): string {
  return execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function retryUpgradeSeedSql(field: 'retryOfScanTaskId' | 'retryConsumedByScanTaskId'): string {
  const duplicateValue = field === 'retryOfScanTaskId' ? 'prior_duplicate' : 'child_duplicate'
  return `
    INSERT INTO "Terminal" ("id", "terminalCode", "agentToken", "deviceFingerprint", "lastSeenAt")
    VALUES ('upgrade_terminal', 'UPGRADE-TERMINAL', 'upgrade-agent-token', 'upgrade-fingerprint', CURRENT_TIMESTAMP);
    INSERT INTO "ScanTask" ("id", "terminalId", "scanType", "status", "${field}", "expiresAt", "updatedAt")
    VALUES
      ('upgrade_scan_a', 'upgrade_terminal', 'document', 'failed', '${duplicateValue}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('upgrade_scan_b', 'upgrade_terminal', 'document', 'failed', '${duplicateValue}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  `
}

function assertSqliteHardeningStructure(
  databasePath: string,
  expected: 'previous' | 'hardened',
  label: string
): void {
  const snapshot = sqliteQuery(
    databasePath,
    `
      SELECT COUNT(*) FROM pragma_table_info('ScanTask') WHERE name = 'retryAuthorityExpiresAt';
      SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'ScanTask_retryOfScanTaskId_idx';
      SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'ScanTask_retryConsumedByScanTaskId_idx';
      SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'ScanTask_retryOfScanTaskId_key';
      SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'ScanTask_retryConsumedByScanTaskId_key';
      SELECT COUNT(*) FROM "_prisma_migrations" WHERE migration_name = '${RETRY_HARDENING_MIGRATION}' AND finished_at IS NOT NULL;
      SELECT COALESCE(MAX(applied_steps_count), 0) FROM "_prisma_migrations" WHERE migration_name = '${RETRY_HARDENING_MIGRATION}';
    `
  ).split('\n')
  assert.deepEqual(
    snapshot,
    expected === 'previous'
      ? ['0', '1', '1', '0', '0', '0', '0']
      : ['1', '0', '0', '1', '1', '1', '1'],
    `${label}: schema/index/migration state must remain ${expected}`
  )
  if (expected === 'hardened') {
    for (const [indexName, column] of [
      ['ScanTask_retryOfScanTaskId_key', 'retryOfScanTaskId'],
      ['ScanTask_retryConsumedByScanTaskId_key', 'retryConsumedByScanTaskId'],
    ] as const) {
      const indexSql = sqliteQuery(
        databasePath,
        `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = '${indexName}';`
      )
      assert.match(
        indexSql,
        new RegExp(`UNIQUE[\\s\\S]*WHERE\\s+"${column}"\\s+IS\\s+NOT\\s+NULL`, 'i'),
        `${label}: ${indexName} must remain a partial unique index`
      )
    }
  }
}

function assertPostgresHardeningStructure(
  databaseUrl: string,
  expected: 'previous' | 'hardened',
  label: string
): void {
  const snapshot = postgresQuery(
    databaseUrl,
    `
      SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ScanTask' AND column_name = 'retryAuthorityExpiresAt';
      SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ScanTask_retryOfScanTaskId_idx';
      SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ScanTask_retryConsumedByScanTaskId_idx';
      SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ScanTask_retryOfScanTaskId_key';
      SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ScanTask_retryConsumedByScanTaskId_key';
      SELECT COUNT(*) FROM "_prisma_migrations" WHERE migration_name = '${RETRY_HARDENING_MIGRATION}' AND finished_at IS NOT NULL;
      SELECT COALESCE(MAX(applied_steps_count), 0) FROM "_prisma_migrations" WHERE migration_name = '${RETRY_HARDENING_MIGRATION}';
    `
  ).split('\n')
  assert.deepEqual(
    snapshot,
    expected === 'previous'
      ? ['0', '1', '1', '0', '0', '0', '0']
      : ['1', '0', '0', '1', '1', '1', '1'],
    `${label}: schema/index/migration state must remain ${expected}`
  )
  if (expected === 'hardened') {
    for (const [indexName, column] of [
      ['ScanTask_retryOfScanTaskId_key', 'retryOfScanTaskId'],
      ['ScanTask_retryConsumedByScanTaskId_key', 'retryConsumedByScanTaskId'],
    ] as const) {
      const indexSql = postgresQuery(
        databaseUrl,
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${indexName}';`
      )
      assert.match(
        indexSql,
        new RegExp(`UNIQUE[\\s\\S]*WHERE[\\s\\S]*${column}[\\s\\S]*IS NOT NULL`, 'i'),
        `${label}: ${indexName} must remain a partial unique index`
      )
    }
  }
}

// Task 10 能力门禁直通 stub：门禁真实语义由 verify:admin-print-scan 覆盖，
// 本脚本聚焦扫描任务状态机，不重复测门禁。
const passthroughCapabilities = { assertUserTaskAllowed: async () => undefined } as never

interface StoredScanTask {
  id: string
  terminalId: string
  scanType: string
  status: string
  endUserId: string | null
  fileId: string | null
  matchedFileMtime: Date | null
  lastAttemptHash: string | null
  errorCode: string | null
  errorMessage: string | null
  controlTokenHash: string | null
  retryOfScanTaskId: string | null
  retryContentHash: string | null
  retryConsumedAt: Date | null
  retryConsumedByScanTaskId: string | null
  retryAuthorityExpiresAt: Date | null
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

interface StoredFileObject {
  id: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  purpose: string
  endUserId: string | null
  deletedAt: Date | null
  expiresAt: Date | null
}

/**
 * 最小合法 PDF 字节(魔数 %PDF 开头)。真实 FilesService.upload 现在做魔数校验
 * (files/content-sniff.ts),扫描投递 fixture 与真机行为保持同款字节形态。
 * 按仓库测试惯例本地复制 helper(参考 verify-admin-fairs.ts 的 tinyPdf)。
 */
function tinyPdf(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1')
}

/** 兼容真实 Prisma 调用形态：status 既可能是裸字符串，也可能是 `{ in: [...] }`（cancel() 的 CAS 用后者）。 */
type StatusMatcher = string | { in: string[] }

function statusMatches(current: string, matcher: StatusMatcher): boolean {
  return typeof matcher === 'string' ? current === matcher : matcher.in.includes(current)
}

class FakePrisma {
  private seq = 1
  readonly scanTasksById = new Map<string, StoredScanTask>()
  readonly filesById = new Map<string, StoredFileObject>()
  readonly terminals = new Map<
    string,
    { id: string; enabled: boolean; terminalCode: string; lifecycleStatus: string }
  >()

  constructor() {
    this.terminals.set('t_1', {
      id: 't_1',
      enabled: true,
      terminalCode: 'T-001',
      lifecycleStatus: 'active',
    })
    this.terminals.set('t_disabled', {
      id: 't_disabled',
      enabled: false,
      terminalCode: 'T-002',
      lifecycleStatus: 'active',
    })
    // B1-5 多行 reap 测试需要第二个独立启用的终端（证明一次 reap 能跨终端一起收敛，
    // 不是只测同一终端的两条行）。
    this.terminals.set('t_2', {
      id: 't_2',
      enabled: true,
      terminalCode: 'T-003',
      lifecycleStatus: 'active',
    })
  }

  readonly terminal = {
    findFirst: async ({
      where,
    }: {
      where: { OR: Array<{ id?: string; terminalCode?: string }> }
    }) => {
      const ref = where.OR[0]?.id ?? where.OR[1]?.terminalCode
      for (const t of this.terminals.values()) {
        if (t.id === ref || t.terminalCode === ref) return t
      }
      return null
    },
    updateMany: async ({
      where,
    }: {
      where: { id: string; enabled: boolean; lifecycleStatus: string }
      data: { lifecycleStatus: string }
    }) => {
      const terminal = this.terminals.get(where.id)
      const matches =
        terminal?.enabled === where.enabled && terminal.lifecycleStatus === where.lifecycleStatus
      return { count: matches ? 1 : 0 }
    },
  }

  readonly $transaction = async <T>(callback: (tx: this) => Promise<T>): Promise<T> =>
    callback(this)

  readonly scanTask = {
    create: async ({ data }: { data: Partial<StoredScanTask> }) => {
      const id = `scan_${this.seq++}`
      const now = new Date()
      const record: StoredScanTask = {
        id,
        terminalId: data.terminalId!,
        scanType: data.scanType!,
        status: 'waiting',
        endUserId: data.endUserId ?? null,
        fileId: null,
        matchedFileMtime: null,
        lastAttemptHash: data.lastAttemptHash ?? null,
        errorCode: null,
        errorMessage: null,
        controlTokenHash: data.controlTokenHash ?? null,
        retryOfScanTaskId: data.retryOfScanTaskId ?? null,
        retryContentHash: data.retryContentHash ?? null,
        retryConsumedAt: data.retryConsumedAt ?? null,
        retryConsumedByScanTaskId: data.retryConsumedByScanTaskId ?? null,
        retryAuthorityExpiresAt: data.retryAuthorityExpiresAt ?? null,
        expiresAt: data.expiresAt!,
        createdAt: now,
        updatedAt: now,
      }
      this.scanTasksById.set(id, record)
      return { id }
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.scanTasksById.get(where.id) ?? null,
    findFirst: async ({
      where,
    }: {
      where: {
        id?: string | { not: string }
        terminalId: string
        status?: StatusMatcher
        scanType?: string
        endUserId?: string | null
        controlTokenHash?: string
        fileId?: null
        retryConsumedAt?: Date | null
        expiresAt?: { gt: Date }
        lastAttemptHash?: string | null | { not: null }
        retryAuthorityExpiresAt?: { gt: Date }
        updatedAt?: { gt?: Date; lt?: Date }
      }
    }) => {
      const candidates = Array.from(this.scanTasksById.values()).filter((t) => {
        if (typeof where.id === 'string' && t.id !== where.id) return false
        if (typeof where.id === 'object' && t.id === where.id.not) return false
        if (t.terminalId !== where.terminalId) return false
        if (where.status !== undefined && !statusMatches(t.status, where.status)) return false
        if (where.scanType !== undefined && t.scanType !== where.scanType) return false
        if (where.endUserId !== undefined && t.endUserId !== where.endUserId) return false
        if (where.controlTokenHash !== undefined && t.controlTokenHash !== where.controlTokenHash)
          return false
        if (where.fileId === null && t.fileId !== null) return false
        if (where.retryConsumedAt === null && t.retryConsumedAt !== null) return false
        if (
          where.retryConsumedAt instanceof Date &&
          t.retryConsumedAt?.getTime() !== where.retryConsumedAt.getTime()
        )
          return false
        if (where.lastAttemptHash !== undefined) {
          if (where.lastAttemptHash === null) {
            if (t.lastAttemptHash !== null) return false
          } else if (typeof where.lastAttemptHash === 'object') {
            if (t.lastAttemptHash === null) return false
          } else if (t.lastAttemptHash !== where.lastAttemptHash) {
            return false
          }
        }
        if (
          where.retryAuthorityExpiresAt?.gt !== undefined &&
          !(t.retryAuthorityExpiresAt &&
            t.retryAuthorityExpiresAt.getTime() > where.retryAuthorityExpiresAt.gt.getTime())
        )
          return false
        if (
          where.expiresAt?.gt !== undefined &&
          !(t.expiresAt.getTime() > where.expiresAt.gt.getTime())
        )
          return false
        if (
          where.updatedAt?.gt !== undefined &&
          !(t.updatedAt.getTime() > where.updatedAt.gt.getTime())
        )
          return false
        if (
          where.updatedAt?.lt !== undefined &&
          !(t.updatedAt.getTime() < where.updatedAt.lt.getTime())
        )
          return false
        return true
      })
      return candidates[0] ?? null
    },
    // 服务层所有写路径都必须走 CAS 的 updateMany（无条件 update 会绕开状态匹配检查），
    // 这里刻意不提供 update() 方法——如果服务代码回退到无条件 update，测试会直接因方法不存在而报错，
    // 而不是悄悄通过。
    //
    // 支持三种调用形态：
    //   1) 服务层的单行 CAS：{ where: { id, status } }（status 命中才更新，返回 count 0|1）
    //   2) B1-5 reaper 的批量收敛：{ where: { status, updatedAt: { lt } } }（无 id，可能命中多行）
    //   3) waiting 过期 reaper：{ where: { status, expiresAt: { lte } } }（无 id，可能命中多行）
    updateMany: async ({
      where,
      data,
    }: {
      where: {
        id?: string
        status?: StatusMatcher
        terminalId?: string
        scanType?: string
        endUserId?: string | null
        controlTokenHash?: string
        fileId?: null
        retryConsumedAt?: Date | null
        lastAttemptHash?: string | null | { not: null }
        retryAuthorityExpiresAt?: { gt: Date }
        updatedAt?: { gt?: Date; lt?: Date }
        expiresAt?: { lte: Date }
      }
      data: Partial<StoredScanTask>
    }) => {
      const matches = Array.from(this.scanTasksById.values()).filter((t) => {
        if (where.id !== undefined && t.id !== where.id) return false
        if (where.status !== undefined && !statusMatches(t.status, where.status)) return false
        if (where.terminalId !== undefined && t.terminalId !== where.terminalId) return false
        if (where.scanType !== undefined && t.scanType !== where.scanType) return false
        if (where.endUserId !== undefined && t.endUserId !== where.endUserId) return false
        if (where.controlTokenHash !== undefined && t.controlTokenHash !== where.controlTokenHash)
          return false
        if (where.fileId === null && t.fileId !== null) return false
        if (where.retryConsumedAt === null && t.retryConsumedAt !== null) return false
        if (
          where.retryConsumedAt instanceof Date &&
          t.retryConsumedAt?.getTime() !== where.retryConsumedAt.getTime()
        )
          return false
        if (where.lastAttemptHash !== undefined) {
          if (where.lastAttemptHash === null) {
            if (t.lastAttemptHash !== null) return false
          } else if (typeof where.lastAttemptHash === 'object') {
            if (t.lastAttemptHash === null) return false
          } else if (t.lastAttemptHash !== where.lastAttemptHash) {
            return false
          }
        }
        if (
          where.retryAuthorityExpiresAt?.gt !== undefined &&
          !(t.retryAuthorityExpiresAt &&
            t.retryAuthorityExpiresAt.getTime() > where.retryAuthorityExpiresAt.gt.getTime())
        )
          return false
        if (
          where.updatedAt?.lt !== undefined &&
          !(t.updatedAt.getTime() < where.updatedAt.lt.getTime())
        )
          return false
        if (
          where.updatedAt?.gt !== undefined &&
          !(t.updatedAt.getTime() > where.updatedAt.gt.getTime())
        )
          return false
        if (
          where.expiresAt?.lte !== undefined &&
          !(t.expiresAt.getTime() <= where.expiresAt.lte.getTime())
        )
          return false
        return true
      })
      for (const m of matches) {
        this.scanTasksById.set(m.id, { ...m, ...data, updatedAt: new Date() })
      }
      return { count: matches.length }
    },
    // B1-11：内容级去重需要查"该终端最近一段时间内、真正建档完成过（fileId 非空）的任务"，
    // 形态和既有的单条 findFirst 不同（需要返回多条），故单独提供一个 findMany。
    findMany: async ({
      where,
      select,
    }: {
      where: { terminalId: string; fileId: { not: null }; updatedAt: { gt: Date } }
      select?: { fileId: true }
    }) => {
      const matches = Array.from(this.scanTasksById.values()).filter(
        (t) =>
          t.terminalId === where.terminalId &&
          t.fileId !== null &&
          t.updatedAt.getTime() > where.updatedAt.gt.getTime()
      )
      void select
      return matches.map((t) => ({ fileId: t.fileId }))
    },
  }

  readonly fileObject = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.filesById.get(where.id) ?? null,
    // B1-11：内容级去重的第二步——在候选 fileId 集合里找 sha256 完全一致的一条。
    findFirst: async ({ where }: { where: { id: { in: string[] }; sha256: string } }) => {
      for (const id of where.id.in) {
        const record = this.filesById.get(id)
        if (record && record.sha256 === where.sha256) return { id: record.id }
      }
      return null
    },
  }
}

class FakeFilesService {
  private seq = 1
  /** B1-6：记录 systemDelete() 的每次调用，供孤儿文件补偿删除测试断言真正调用发生且参数正确。 */
  readonly systemDeleteCalls: Array<{ fileId: string; reason: string }> = []

  constructor(private readonly prisma: FakePrisma) {}

  async upload(args: {
    buffer: Buffer
    filename: string
    mimeType: string
    purpose: string
    uploaderId?: string | null
    endUserId?: string | null
  }) {
    const id = `file_${this.seq++}`
    const record: StoredFileObject = {
      id,
      filename: args.filename,
      sizeBytes: args.buffer.length,
      mimeType: args.mimeType,
      // B1-11：真实 FilesService.upload() 对直传 buffer 就地计算 sha256（见 files.service.ts
      // 顶部注释 "直传路径就 buffer 计算"）。这里必须镜像同一行为（而不是用一个和内容无关的
      // 占位符），否则 deliverScanFile() 新增的内容级去重逻辑（比对 contentHash 与
      // FileObject.sha256）在假 Prisma 环境下永远测不出真实效果。
      sha256: createHash('sha256').update(args.buffer).digest('hex'),
      purpose: args.purpose,
      endUserId: args.endUserId ?? null,
      deletedAt: null,
      expiresAt: new Date(
        Date.now() + (args.purpose === 'contract_upload' ? 2 * 60 * 60 * 1000 : 60 * 60 * 1000)
      ),
    }
    this.prisma.filesById.set(id, record)
    return {
      fileId: id,
      filename: record.filename,
      sizeBytes: record.sizeBytes,
      mimeType: record.mimeType,
      sha256: record.sha256,
      signedUrl: `https://files.local/${id}`,
      signedUrlExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      fileExpiresAt: record.expiresAt.toISOString(),
    }
  }

  /** B1-6：镜像真实 FilesService.systemDelete() 的最小行为——软删记录、返回 metadata。 */
  async systemDelete(fileId: string, reason: string) {
    this.systemDeleteCalls.push({ fileId, reason })
    const record = this.prisma.filesById.get(fileId)
    if (!record || record.deletedAt) {
      throw new NotFoundException({
        error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' },
      })
    }
    record.deletedAt = new Date()
    this.prisma.filesById.set(fileId, record)
    return { fileId, deletedAt: record.deletedAt }
  }
}

function wrapServiceForTest(service: ScanTasksService): ScanTasksService {
  const originalDeliver = service.deliverScanFile.bind(service)
  service.deliverScanFile = async (args: any) => {
    if (args.scanTaskId === undefined && args.deliveryLease === undefined) {
      const lease = await service.getScanDeliveryLease(args.terminalId)
      return await originalDeliver({
        ...args,
        scanTaskId: lease.scanTaskId,
        deliveryLease: lease.deliveryLease,
      })
    }
    return await originalDeliver(args)
  }
  return service
}

function makeService(): { service: ScanTasksService; prisma: FakePrisma; files: FakeFilesService } {
  const prisma = new FakePrisma()
  const files = new FakeFilesService(prisma)
  return {
    service: wrapServiceForTest(new ScanTasksService(prisma as never, files as never, passthroughCapabilities)),
    prisma,
    files,
  }
}

async function expectRejects<T extends Error>(
  action: () => Promise<unknown>,
  errorType: new (...args: never[]) => T,
  label: string
): Promise<void> {
  let rejected = false
  try {
    await action()
  } catch (error) {
    rejected = true
    assert.ok(
      error instanceof errorType,
      `${label}: expected ${errorType.name}, got ${(error as Error).constructor.name}`
    )
  }
  assert.equal(rejected, true, `${label}: expected rejection`)
}

async function expectRejectCode(
  action: () => Promise<unknown>,
  errorType: new (...args: never[]) => Error,
  code: string,
  label: string
): Promise<void> {
  let caught: unknown
  try {
    await action()
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof errorType, `${label}: expected ${errorType.name}`)
  const response = (caught as { getResponse: () => unknown }).getResponse() as {
    error?: { code?: string }
  }
  assert.equal(response.error?.code, code, `${label}: expected error code ${code}`)
}

function makeRetryAuthority(
  prisma: FakePrisma,
  scanTaskId: string,
  content: Buffer,
  overrides: Partial<StoredScanTask> = {}
): StoredScanTask {
  const task = prisma.scanTasksById.get(scanTaskId)
  assert.ok(task, `retry authority ${scanTaskId} must exist`)
  const authority: StoredScanTask = {
    ...task,
    status: 'failed',
    lastAttemptHash: createHash('sha256').update(content).digest('hex'),
    retryAuthorityExpiresAt: new Date(Date.now() + SCAN_RETRY_AUTHORITY_TTL_MS),
    updatedAt: new Date(),
    ...overrides,
  }
  prisma.scanTasksById.set(scanTaskId, authority)
  return authority
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 访问 ScanTasksService 的 private startMatchedHeartbeat()——TS 的 private 只是编译期限制，B1-10 测试需要直接调用/替换它。 */
type HeartbeatTestAccess = {
  startMatchedHeartbeat: (id: string, intervalMs?: number) => NodeJS.Timeout
}

/**
 * B1-10：对着一个真实迁移过的数据库、真实 `ScanTaskReaperTask`（不改它的 3 分钟阈值）、
 * 真实 `ScanTasksService.startMatchedHeartbeat()`，直接证明本次修复关闭的竞态：
 *
 *   - Row A（模拟"进程真的崩了，没有心跳"）：updatedAt 手工回拨到 4 分钟前，什么都不碰，
 *     直接跑真实 reaper——必须被收敛成 failed/SCAN_MATCHED_TIMEOUT（证明本次修复没有
 *     削弱 reaper 对"真正卡死"任务的收敛能力）。
 *   - Row B（模拟"上传其实还在真实进行中，只是恰好超过 3 分钟没完成"）：updatedAt 同样
 *     先回拨到 4 分钟前，然后启动真实心跳跑几个真实 tick（tick 间隔仅用于让测试在几十
 *     毫秒内看到多次真实 tick，不代表生产间隔改了——生产间隔仍是 60s），停掉心跳后
 *     updatedAt 必然已经被刷新成"刚刚"——再跑同一个真实 reaper，Row B 必须保持
 *     'matched'，不能被误杀。
 *
 * 不需要真的等 3 分钟：updatedAt 是显式回拨出来的（本任务已用真实 SQLite 单独验证过
 * Prisma 会原样接受 data 里的显式值，不会被 `@updatedAt` 自动机制覆盖），心跳和 reaper
 * 全程用的都是生产代码里真实、未经修改的常量与逻辑。
 */
async function assertRealDbMatchedHeartbeatClosesRace(dbUrl: string): Promise<void> {
  const { client } = createPrismaClient(dbUrl)
  await client.$connect()
  // 两个独立终端各挂一条 'matched' 行：B1-2 的 partial unique index 约束同一 terminalId
  // 同时只能有一条 waiting/matched 活跃记录，Row A/Row B 必须分属不同终端，否则第二条
  // create() 会先撞上那条无关的约束，测不到本测试真正要验证的心跳/reaper 行为。
  const terminalIdA = `realdb_hb_a_${randomBytes(4).toString('hex')}`
  const terminalIdB = `realdb_hb_b_${randomBytes(4).toString('hex')}`
  try {
    for (const terminalId of [terminalIdA, terminalIdB]) {
      await client.terminal.create({
        data: {
          id: terminalId,
          terminalCode: `RDB-HB-${randomBytes(3).toString('hex')}`,
          agentToken: randomBytes(16).toString('hex'),
          deviceFingerprint: 'verify-scan-tasks-realdb-heartbeat-fixture',
          enabled: true,
        },
      })
    }

    const realPrisma = { scanTask: client.scanTask } as never
    const service = new ScanTasksService(realPrisma, {} as never, passthroughCapabilities)
    const reaper = new ScanTaskReaperTask(client as never)

    const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000)

    const rowA = await client.scanTask.create({
      data: {
        terminalId: terminalIdA,
        scanType: 'document',
        status: 'matched',
        expiresAt: new Date(Date.now() + 60_000),
      },
      select: { id: true },
    })
    await client.scanTask.updateMany({
      where: { id: rowA.id },
      data: { updatedAt: fourMinutesAgo },
    })

    const rowB = await client.scanTask.create({
      data: {
        terminalId: terminalIdB,
        scanType: 'document',
        status: 'matched',
        expiresAt: new Date(Date.now() + 60_000),
      },
      select: { id: true },
    })
    await client.scanTask.updateMany({
      where: { id: rowB.id },
      data: { updatedAt: fourMinutesAgo },
    })

    // Row B：启动真实的（未 mock 的）心跳方法，跑几个真实 tick，然后停掉。
    const heartbeat = (service as unknown as HeartbeatTestAccess).startMatchedHeartbeat(rowB.id, 20)
    await sleep(90)
    clearInterval(heartbeat)

    const rowBAfterHeartbeat = await client.scanTask.findUnique({
      where: { id: rowB.id },
      select: { updatedAt: true },
    })
    assert.ok(
      rowBAfterHeartbeat!.updatedAt.getTime() > fourMinutesAgo.getTime() + 3 * 60 * 1000,
      'real heartbeat ticks must have refreshed updatedAt back to "now" against the real database'
    )

    // 真实 reaper，未经任何修改，跑一次。
    await reaper.reapStuckMatched()

    const rowAAfter = await client.scanTask.findUnique({ where: { id: rowA.id } })
    assert.equal(
      rowAAfter?.status,
      'failed',
      'real DB: a genuinely stuck matched row (no heartbeat, stale updatedAt) must still be correctly reaped by the unmodified real reaper'
    )
    assert.equal(rowAAfter?.errorCode, 'SCAN_MATCHED_TIMEOUT')

    const rowBAfter = await client.scanTask.findUnique({ where: { id: rowB.id } })
    assert.equal(
      rowBAfter?.status,
      'matched',
      'real DB: the SAME unmodified real reaper must NOT reap a matched row whose heartbeat kept updatedAt fresh — this is the race the fix closes'
    )
  } finally {
    await client.scanTask.deleteMany({ where: { terminalId: { in: [terminalIdA, terminalIdB] } } })
    await client.terminal.deleteMany({ where: { id: { in: [terminalIdA, terminalIdB] } } })
    await client.$disconnect()
  }
}

/**
 * B1-9 共享断言体：对一个真实迁移过的数据库（SQLite 或 Postgres 皆可）连接，
 * 端到端跑一遍 B1-2 partial unique index 的完整行为断言——create() 成功、
 * 'waiting' 状态下第二次 create() 命中真实 P2002 并映射为 SCAN_TERMINAL_BUSY、
 * 'matched' 状态同样被挡、四种终态（completed/cancelled/expired/failed）依次
 * 验证均不再挡后续创建。SQLite 块与 Postgres 块（见 main() 内两个独立 `{}` 块）
 * 共用同一套断言，避免"两个数据库各测各的、悄悄漂移出不一致覆盖"。
 *
 * `label` 仅用于失败消息里标注是哪个数据库跑出的断言失败，方便排障。
 */
async function assertRealDbPartialUniqueIndex(
  dbUrl: string,
  label: 'sqlite' | 'postgres'
): Promise<void> {
  const { client } = createPrismaClient(dbUrl)
  await client.$connect()
  try {
    // ScanTasksService.create 以真实事务 + Terminal no-op CAS 与退役串行；这里必须传
    // 完整真实 client，不能再用只摘 terminal/scanTask 的旧局部 mock。
    const realPrisma = client as never
    // create() 本身不触碰 this.files，真实 FilesService 在这里没有必要。
    const service = new ScanTasksService(realPrisma, {} as never, passthroughCapabilities)

    const terminalId = `realdb_t_${label}_${randomBytes(4).toString('hex')}`
    try {
      await client.terminal.create({
        data: {
          id: terminalId,
          terminalCode: `RDB-${label}-${randomBytes(3).toString('hex')}`,
          agentToken: randomBytes(16).toString('hex'),
          deviceFingerprint: 'verify-scan-tasks-realdb-fixture',
          enabled: true,
        },
      })

      const first = await service.create({ scanType: 'document', terminalId }, null)
      assert.ok(first.scanTaskId, `real DB (${label}): first create() must succeed`)

      let caughtWaiting: unknown
      try {
        await service.create({ scanType: 'document', terminalId }, null)
      } catch (error) {
        caughtWaiting = error
      }
      assert.ok(
        caughtWaiting instanceof ConflictException,
        `real DB (${label}): second create() while first is still 'waiting' must hit the real partial unique index and be mapped to ConflictException, got ${(caughtWaiting as Error)?.constructor?.name}`
      )
      assert.equal(
        ((caughtWaiting as ConflictException).getResponse() as { error?: { code?: string } }).error
          ?.code,
        'SCAN_TERMINAL_BUSY',
        `real DB (${label}): real P2002 from the actual migration-created index must map to SCAN_TERMINAL_BUSY`
      )

      // 约束的 WHERE 子句是 status IN ('waiting','matched')——单独验证 'matched' 分支也真的
      // 挡住新建，不能只测 'waiting'（否则如果约束被误写成只覆盖 'waiting'，这里测不出来）。
      await client.scanTask.updateMany({
        where: { id: first.scanTaskId },
        data: { status: 'matched' },
      })
      let caughtMatched: unknown
      try {
        await service.create({ scanType: 'document', terminalId }, null)
      } catch (error) {
        caughtMatched = error
      }
      assert.ok(
        caughtMatched instanceof ConflictException,
        `real DB (${label}): a 'matched' (not just 'waiting') active task must also block new create(), got ${(caughtMatched as Error)?.constructor?.name}`
      )

      // 四种终态依次验证：每种都必须真的不再挡后续创建（证明约束只覆盖 waiting/matched，
      // 不是全状态生效，也不是压根没生效导致"看起来放行"其实是约束整体失效）。
      let activeTaskId = first.scanTaskId
      for (const terminalState of ['completed', 'cancelled', 'expired', 'failed'] as const) {
        await client.scanTask.updateMany({
          where: { id: activeTaskId },
          data: { status: terminalState },
        })
        const created = await service.create({ scanType: 'document', terminalId }, null)
        assert.ok(
          created.scanTaskId,
          `real DB (${label}): after prior task transitions to '${terminalState}', same terminal must be able to create again`
        )
        activeTaskId = created.scanTaskId
      }
    } finally {
      // 无论断言是否失败都尝试清理，避免污染共享的 Postgres 开发库/CI 库
      // （SQLite 分支额外靠外层临时目录整体删除兜底，这里的清理对它是锦上添花）。
      await client.scanTask.deleteMany({ where: { terminalId } })
      await client.terminal.deleteMany({ where: { id: terminalId } })
    }
  } finally {
    await client.$disconnect()
  }
}

async function assertRealDbRetryAuthorityCas(
  dbUrl: string,
  label: 'sqlite' | 'postgres'
): Promise<void> {
  const { client: clientA } = createPrismaClient(dbUrl)
  const { client: clientB } = createPrismaClient(dbUrl)
  await Promise.all([clientA.$connect(), clientB.$connect()])

  const terminalId = `realdb_retry_cas_${label}_${randomBytes(4).toString('hex')}`
  const taskId = `realdb_retry_authority_${label}_${randomBytes(4).toString('hex')}`
  const tokenHash = createHash('sha256').update('real-db-retry-token').digest('hex')
  const contentHash = createHash('sha256').update(tinyPdf()).digest('hex')
  const retryAuthorityExpiresAt = new Date(Date.now() + SCAN_RETRY_AUTHORITY_TTL_MS)

  try {
    await clientA.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `RDB-RETRY-${label}-${randomBytes(3).toString('hex')}`,
        agentToken: randomBytes(16).toString('hex'),
        deviceFingerprint: 'verify-scan-retry-cas',
        enabled: true,
      },
    })
    await clientA.scanTask.create({
      data: {
        id: taskId,
        terminalId,
        scanType: 'document',
        status: 'failed',
        controlTokenHash: tokenHash,
        lastAttemptHash: contentHash,
        retryAuthorityExpiresAt,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })

    const consume = (client: typeof clientA) =>
      client.scanTask.updateMany({
        where: {
          id: taskId,
          terminalId,
          scanType: 'document',
          endUserId: null,
          status: { in: ['failed', 'cancelled', 'expired'] },
          controlTokenHash: tokenHash,
          fileId: null,
          lastAttemptHash: contentHash,
          retryConsumedAt: null,
          retryAuthorityExpiresAt: { gt: new Date() },
        },
        data: { retryConsumedAt: new Date() },
      })
    const results = await Promise.allSettled([consume(clientA), consume(clientB)])
    const successfulCounts = results
      .filter((result): result is PromiseFulfilledResult<{ count: number }> => result.status === 'fulfilled')
      .map((result) => result.value.count)
    assert.equal(
      successfulCounts.filter((count) => count === 1).length,
      1,
      `real DB (${label}): concurrent retry-authority CAS must yield exactly one winner`
    )
    if (label === 'postgres') {
      assert.deepEqual(
        successfulCounts.sort(),
        [0, 1],
        'real DB (postgres): the losing concurrent CAS must complete with count=0'
      )
    } else {
      for (const result of results) {
        if (result.status === 'rejected') {
          assert.equal(
            (result.reason as { code?: string }).code,
            'P1008',
            'real DB (sqlite): a rejected parallel writer may only be the known database lock timeout'
          )
        }
      }
      const afterLockRelease = await consume(clientA)
      assert.equal(
        afterLockRelease.count,
        0,
        'real DB (sqlite): after the writer lock releases, replay of the consumed CAS must return count=0'
      )
    }
    assert.ok(
      (await clientA.scanTask.findUnique({ where: { id: taskId } }))?.retryConsumedAt,
      `real DB (${label}): winning CAS must persist retryConsumedAt`
    )
  } finally {
    await clientA.scanTask.deleteMany({ where: { id: taskId } }).catch(() => undefined)
    await clientA.terminal.deleteMany({ where: { id: terminalId } }).catch(() => undefined)
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()])
  }
}

async function assertRealDbRetryLineageIndexes(
  dbUrl: string,
  label: 'sqlite' | 'postgres'
): Promise<void> {
  const { client } = createPrismaClient(dbUrl)
  await client.$connect()
  const terminalId = `realdb_retry_lineage_${label}_${randomBytes(4).toString('hex')}`
  try {
    await client.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `RDB-LINEAGE-${label}-${randomBytes(3).toString('hex')}`,
        agentToken: randomBytes(16).toString('hex'),
        deviceFingerprint: 'verify-scan-retry-lineage-indexes',
        enabled: true,
      },
    })

    const sourceA = await client.scanTask.create({
      data: {
        terminalId,
        scanType: 'document',
        status: 'failed',
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    const sourceB = await client.scanTask.create({
      data: {
        terminalId,
        scanType: 'document',
        status: 'failed',
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    const childA = await client.scanTask.create({
      data: {
        terminalId,
        scanType: 'document',
        status: 'failed',
        retryOfScanTaskId: sourceA.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })

    await assert.rejects(
      () =>
        client.scanTask.create({
          data: {
            terminalId,
            scanType: 'document',
            status: 'failed',
            retryOfScanTaskId: sourceA.id,
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
      `real DB (${label}): retryOfScanTaskId must be one-to-one`
    )

    await client.scanTask.update({
      where: { id: sourceA.id },
      data: { retryConsumedByScanTaskId: childA.id },
    })
    await assert.rejects(
      () =>
        client.scanTask.update({
          where: { id: sourceB.id },
          data: { retryConsumedByScanTaskId: childA.id },
        }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
      `real DB (${label}): retryConsumedByScanTaskId must be one-to-one`
    )
  } finally {
    await client.scanTask.deleteMany({ where: { terminalId } }).catch(() => undefined)
    await client.terminal.deleteMany({ where: { id: terminalId } }).catch(() => undefined)
    await client.$disconnect()
  }
}

function assertSqliteRetryHardeningUpgrade(apiRoot: string): void {
  const sourceMigrationsRoot = path.join(apiRoot, 'prisma', 'migrations')
  const sandbox = createMigrationSandbox(
    apiRoot,
    sourceMigrationsRoot,
    path.join(apiRoot, 'prisma', 'schema.prisma'),
    'sqlite'
  )
  const previousDbPath = path.join(sandbox.root, 'previous.db')
  const previousDbUrl = `file:${previousDbPath}`
  try {
    ensureSqliteFile(previousDbPath)
    runPrisma(apiRoot, ['migrate', 'deploy', '--config', sandbox.configPath], {
      ...process.env,
      DATABASE_URL: previousDbUrl,
    })
    assert.equal(
      sqliteQuery(
        previousDbPath,
        'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1;'
      ),
      RETRY_HARDENING_PREVIOUS_MIGRATION,
      'SQLite template must be at the immediately previous migration'
    )
    assertSqliteHardeningStructure(previousDbPath, 'previous', 'SQLite previous-version template')
    addHardeningMigrationToSandbox(sourceMigrationsRoot, sandbox.migrationsRoot)

    const cleanDbPath = path.join(sandbox.root, 'clean.db')
    cpSync(previousDbPath, cleanDbPath)
    runPrisma(apiRoot, ['migrate', 'deploy', '--config', sandbox.configPath], {
      ...process.env,
      DATABASE_URL: `file:${cleanDbPath}`,
    })
    assertSqliteHardeningStructure(cleanDbPath, 'hardened', 'SQLite clean upgrade')

    for (const field of ['retryOfScanTaskId', 'retryConsumedByScanTaskId'] as const) {
      const duplicateDbPath = path.join(sandbox.root, `duplicate-${field}.db`)
      cpSync(previousDbPath, duplicateDbPath)
      execFileSync('sqlite3', ['-bail', duplicateDbPath], {
        input: retryUpgradeSeedSql(field),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      runPrismaExpectFailure(
        apiRoot,
        ['migrate', 'deploy', '--config', sandbox.configPath],
        { ...process.env, DATABASE_URL: `file:${duplicateDbPath}` },
        `SQLite duplicate ${field}`
      )
      assertSqliteHardeningStructure(
        duplicateDbPath,
        'previous',
        `SQLite duplicate ${field} rejection`
      )
      assert.equal(
        sqliteQuery(
          duplicateDbPath,
          `SELECT COUNT(*) FROM "ScanTask" WHERE "${field}" IS NOT NULL;`
        ),
        '2',
        `SQLite duplicate ${field}: preflight must not delete or rewrite lineage rows`
      )
    }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

function postgresDatabaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}

function assertPostgresRetryHardeningUpgrade(apiRoot: string, pgUrl: string): void {
  const sourceMigrationsRoot = path.join(apiRoot, 'prisma', 'postgres', 'migrations')
  const sandbox = createMigrationSandbox(
    apiRoot,
    sourceMigrationsRoot,
    path.join(apiRoot, 'prisma', 'postgres', 'schema.prisma'),
    'postgresql'
  )
  const base = new URL(pgUrl)
  const maintenanceDatabase = base.pathname.slice(1) || 'postgres'
  const suffix = randomBytes(4).toString('hex')
  const templateName = `scan_retry_prev_${suffix}`
  const cleanName = `scan_retry_clean_${suffix}`
  const duplicateNames = {
    retryOfScanTaskId: `scan_retry_dup_of_${suffix}`,
    retryConsumedByScanTaskId: `scan_retry_dup_by_${suffix}`,
  } as const
  const connectionArgs = ['-h', base.hostname, '-p', base.port || '5432', '-U', base.username || 'postgres', '-w']
  const postgresCommandEnv = { ...process.env, ...(base.password ? { PGPASSWORD: base.password } : {}) }
  const createdDatabases: string[] = []

  const createDatabase = (name: string, template?: string): void => {
    execFileSync(
      'createdb',
      [...connectionArgs, '--maintenance-db', maintenanceDatabase, ...(template ? ['--template', template] : []), name],
      { env: postgresCommandEnv, stdio: 'pipe' }
    )
    createdDatabases.push(name)
  }

  try {
    createDatabase(templateName)
    const templateUrl = postgresDatabaseUrl(pgUrl, templateName)
    runPrisma(apiRoot, ['migrate', 'deploy', '--config', sandbox.configPath], {
      ...process.env,
      DATABASE_URL: templateUrl,
      POSTGRES_URL: templateUrl,
    })
    assert.equal(
      postgresQuery(
        templateUrl,
        'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1;'
      ),
      RETRY_HARDENING_PREVIOUS_MIGRATION,
      'PostgreSQL template must be at the immediately previous migration'
    )
    assertPostgresHardeningStructure(templateUrl, 'previous', 'PostgreSQL previous-version template')
    addHardeningMigrationToSandbox(sourceMigrationsRoot, sandbox.migrationsRoot)

    createDatabase(cleanName, templateName)
    const cleanUrl = postgresDatabaseUrl(pgUrl, cleanName)
    runPrisma(apiRoot, ['migrate', 'deploy', '--config', sandbox.configPath], {
      ...process.env,
      DATABASE_URL: cleanUrl,
      POSTGRES_URL: cleanUrl,
    })
    assertPostgresHardeningStructure(cleanUrl, 'hardened', 'PostgreSQL clean upgrade')

    for (const field of ['retryOfScanTaskId', 'retryConsumedByScanTaskId'] as const) {
      const databaseName = duplicateNames[field]
      createDatabase(databaseName, templateName)
      const duplicateUrl = postgresDatabaseUrl(pgUrl, databaseName)
      postgresQuery(duplicateUrl, retryUpgradeSeedSql(field))
      runPrismaExpectFailure(
        apiRoot,
        ['migrate', 'deploy', '--config', sandbox.configPath],
        { ...process.env, DATABASE_URL: duplicateUrl, POSTGRES_URL: duplicateUrl },
        `PostgreSQL duplicate ${field}`
      )
      assertPostgresHardeningStructure(
        duplicateUrl,
        'previous',
        `PostgreSQL duplicate ${field} rejection`
      )
      assert.equal(
        postgresQuery(
          duplicateUrl,
          `SELECT COUNT(*) FROM "ScanTask" WHERE "${field}" IS NOT NULL;`
        ),
        '2',
        `PostgreSQL duplicate ${field}: preflight must not delete or rewrite lineage rows`
      )
    }
  } finally {
    for (const databaseName of createdDatabases.reverse()) {
      execFileSync(
        'dropdb',
        [...connectionArgs, '--maintenance-db', maintenanceDatabase, '--if-exists', '--force', databaseName],
        { env: postgresCommandEnv, stdio: 'pipe' }
      )
    }
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

async function assertRealDbRetryCreateAtomicity(dbUrl: string): Promise<void> {
  const { client: setupClient } = createPrismaClient(dbUrl)
  const { client: clientA } = createPrismaClient(dbUrl)
  const { client: clientB } = createPrismaClient(dbUrl)
  await Promise.all([setupClient.$connect(), clientA.$connect(), clientB.$connect()])

  const terminalId = `realdb_retry_create_${randomBytes(4).toString('hex')}`
  const endUserId = `realdb_retry_member_${randomBytes(4).toString('hex')}`
  try {
    await setupClient.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `RDB-RETRY-CREATE-${randomBytes(3).toString('hex')}`,
        agentToken: randomBytes(16).toString('hex'),
        deviceFingerprint: 'verify-scan-retry-create',
        enabled: true,
      },
    })
    await setupClient.endUser.create({
      data: { id: endUserId, phoneHash: `hash_${endUserId}`, phoneEnc: 'enc' },
    })

    const serviceA = new ScanTasksService(clientA as never, {} as never, passthroughCapabilities)
    const serviceB = new ScanTasksService(clientB as never, {} as never, passthroughCapabilities)
    const prior = await serviceA.create({ scanType: 'document', terminalId }, endUserId)
    await setupClient.scanTask.update({
      where: { id: prior.scanTaskId },
      data: {
        status: 'failed',
        lastAttemptHash: createHash('sha256').update(tinyPdf()).digest('hex'),
        retryAuthorityExpiresAt: new Date(Date.now() + SCAN_RETRY_AUTHORITY_TTL_MS),
      },
    })

    const request = (service: ScanTasksService) =>
      service.create(
        { scanType: 'document', terminalId, retryOfScanTaskId: prior.scanTaskId },
        endUserId,
        prior.controlToken
      )
    const results = await Promise.allSettled([request(serviceA), request(serviceB)])
    const winners = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof serviceA.create>>> =>
        result.status === 'fulfilled'
    )
    assert.equal(winners.length, 1, 'real DB: two concurrent retry creates must have one winner')
    const loser = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    assert.ok(loser, 'real DB: two concurrent retry creates must have one rejected loser')
    assert.ok(
      loser.reason instanceof ForbiddenException || loser.reason instanceof ConflictException,
      'real DB: concurrent retry loser must be a controlled authorization/conflict response'
    )
    const rows = await setupClient.scanTask.findMany({ where: { terminalId } })
    assert.equal(rows.length, 2, 'real DB: authority plus exactly one retry task must persist')
    const authority = rows.find((row) => row.id === prior.scanTaskId)!
    assert.ok(authority.retryConsumedAt)
    assert.equal(authority.retryConsumedByScanTaskId, winners[0].value.scanTaskId)

    // Force the post-consumption create to fail on the active-session index. The transaction
    // must roll back the authority consumption instead of leaving a consumed orphan.
    await setupClient.scanTask.update({
      where: { id: winners[0].value.scanTaskId },
      data: { status: 'cancelled' },
    })
    const rollbackToken = randomBytes(24).toString('hex')
    const rollbackAuthorityId = `rollback_authority_${randomBytes(4).toString('hex')}`
    await setupClient.scanTask.create({
      data: {
        id: rollbackAuthorityId,
        terminalId,
        scanType: 'document',
        status: 'failed',
        endUserId,
        controlTokenHash: createHash('sha256').update(rollbackToken).digest('hex'),
        lastAttemptHash: createHash('sha256').update(tinyPdf()).digest('hex'),
        retryAuthorityExpiresAt: new Date(Date.now() + SCAN_RETRY_AUTHORITY_TTL_MS),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    await setupClient.scanTask.create({
      data: {
        id: `active_blocker_${randomBytes(4).toString('hex')}`,
        terminalId,
        scanType: 'document',
        status: 'waiting',
        endUserId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    await expectRejectCode(
      () =>
        serviceA.create(
          { scanType: 'document', terminalId, retryOfScanTaskId: rollbackAuthorityId },
          endUserId,
          rollbackToken
        ),
      ConflictException,
      'SCAN_TERMINAL_BUSY',
      'failed retry create transaction must remain atomic'
    )
    const rollbackAuthority = await setupClient.scanTask.findUnique({
      where: { id: rollbackAuthorityId },
    })
    assert.equal(
      rollbackAuthority?.retryConsumedAt,
      null,
      'real DB: failed retry create must roll back retryConsumedAt'
    )
    assert.equal(rollbackAuthority?.retryConsumedByScanTaskId, null)

    // Force the child insert to collide on retryOfScanTaskId. This is a lineage conflict,
    // not an active-session conflict, and the authority CAS must roll back with the insert.
    await setupClient.scanTask.deleteMany({
      where: { terminalId, status: { in: ['waiting', 'matched'] } },
    })
    const lineageToken = randomBytes(24).toString('hex')
    const lineageAuthorityId = `lineage_authority_${randomBytes(4).toString('hex')}`
    await setupClient.scanTask.create({
      data: {
        id: lineageAuthorityId,
        terminalId,
        scanType: 'document',
        status: 'failed',
        endUserId,
        controlTokenHash: createHash('sha256').update(lineageToken).digest('hex'),
        lastAttemptHash: createHash('sha256').update(tinyPdf()).digest('hex'),
        retryAuthorityExpiresAt: new Date(Date.now() + SCAN_RETRY_AUTHORITY_TTL_MS),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    await setupClient.scanTask.create({
      data: {
        id: `lineage_blocker_${randomBytes(4).toString('hex')}`,
        terminalId,
        scanType: 'document',
        status: 'cancelled',
        retryOfScanTaskId: lineageAuthorityId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    await expectRejectCode(
      () =>
        serviceA.create(
          { scanType: 'document', terminalId, retryOfScanTaskId: lineageAuthorityId },
          endUserId,
          lineageToken
        ),
      ConflictException,
      'SCAN_RETRY_CONFLICT',
      'retry lineage P2002 must not be misreported as terminal busy'
    )
    const lineageAuthority = await setupClient.scanTask.findUnique({
      where: { id: lineageAuthorityId },
    })
    assert.equal(
      lineageAuthority?.retryConsumedAt,
      null,
      'real DB: lineage-conflict retry create must roll back retryConsumedAt'
    )
    assert.equal(lineageAuthority?.retryConsumedByScanTaskId, null)
  } finally {
    await setupClient.scanTask.deleteMany({ where: { terminalId } }).catch(() => undefined)
    await setupClient.endUser.deleteMany({ where: { id: endUserId } }).catch(() => undefined)
    await setupClient.terminal.deleteMany({ where: { id: terminalId } }).catch(() => undefined)
    await Promise.all([
      setupClient.$disconnect(),
      clientA.$disconnect(),
      clientB.$disconnect(),
    ])
  }
}

/**
 * B1-11 follow-up：真实 DB 端到端验证 deliverScanFile() 的内容级去重护栏本体。
 *
 * 背景（诚实澄清，纠正 c325b2ff 提交信息里的失实表述）：该提交声称做过"a standalone
 * real-SQLite smoke check of the actual Prisma query shapes used by the dedup guard"，
 * 但实际diff里从来没有这项测试——本文件此前的两个 real-DB 函数
 * （assertRealDbMatchedHeartbeatClosesRace / assertRealDbPartialUniqueIndex）都不曾调用过
 * deliverScanFile()，B1-11 新增的全部 5 条去重测试（见 main() 里标注"B1-11"的几个代码块）
 * 只用了本文件顶部的 FakePrisma/makeService()。FakePrisma.scanTask.findMany /
 * FakePrisma.fileObject.findFirst 是手写的近似实现，只证明服务层判别逻辑本身通了，
 * 不能证明 deliverScanFile() 里实际写的这两条 Prisma 查询语法（`fileId: { not: null }`
 * 搭配 `updatedAt: { gt }`，以及 `id: { in: [...] }` 搭配 `sha256` 等值比较）对真实 Prisma
 * 查询引擎/真实数据库语义确实正确——这正是本函数要补的洞。
 *
 * 因此这里必须用真实 PrismaClient（隔离临时 SQLite，沿用 assertRealDbPartialUniqueIndex()
 * 的 mkdtempSync + migrate deploy 手法）+ 真实 AuditService + 真实 StorageService（local
 * 驱动，FILE_STORAGE_DIR 指向独立临时目录，绝不写入仓库真实 storage/）+ 真实 FilesService
 * + 真实（未 mock）ScanTasksService，完整跑一遍 deliverScanFile() 本体，而不是只测服务层
 * 判别函数。三条断言：
 *
 *   1) 跨用户场景（本次修复要关闭的真实威胁模型）：member_a 的投递真正建档完成
 *      （FileObject 落库、ScanTask.fileId 落库），随后同一物理终端出现属于 member_b 的
 *      全新等待任务；member_a 的同一份字节内容重试投递，必须被真实 Prisma 查询正确识别
 *      为重复并拒绝（SCAN_FILE_ALREADY_DELIVERED），member_b 的任务必须原封不动保持
 *      waiting、fileId 仍为 null——这就是"一个用户的身份证扫描件被错误地挂到另一个用户
 *      任务上"这条 PII 泄漏路径。
 *   2) 不同内容不得被误伤：紧接着用真正不同的字节再投递一次，必须正常成功匹配到 member_b
 *      的任务——证明真实 Prisma 的 sha256 等值比较是真的按内容甄别，不是"同终端有历史
 *      记录就全部拒绝"。
 *   3) 直接对着真实 DB，用与 deliverScanFile() 里完全相同的过滤形状单独重放一次
 *      scanTask.findMany({ where: { terminalId, fileId: { not: null }, updatedAt: { gt } } })
 *      与 fileObject.findFirst({ where: { id: { in: [...] }, sha256 } })，断言返回的行数/
 *      内容与预期精确一致——这是 FakePrisma 永远证明不了的一层：写的 Prisma 过滤语法本身
 *      对真实查询引擎是否语义正确。
 */
async function assertRealDbDedupGuardClosesCrossUserLeak(dbUrl: string): Promise<void> {
  const { client } = createPrismaClient(dbUrl)
  await client.$connect()

  const tmpStorageDir = mkdtempSync(path.join(tmpdir(), 'verify-scan-tasks-realdb-dedup-storage-'))
  const originalStorageDir = process.env['FILE_STORAGE_DIR']
  process.env['FILE_STORAGE_DIR'] = tmpStorageDir

  const terminalId = `realdb_dedup_${randomBytes(4).toString('hex')}`
  const endUserAId = `realdb_dedup_member_a_${randomBytes(4).toString('hex')}`
  const endUserBId = `realdb_dedup_member_b_${randomBytes(4).toString('hex')}`

  try {
    await client.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `RDB-DEDUP-${randomBytes(3).toString('hex')}`,
        agentToken: randomBytes(16).toString('hex'),
        deviceFingerprint: 'verify-scan-tasks-realdb-dedup-fixture',
        enabled: true,
      },
    })
    // 真实 EndUser 行（而不是任意字符串）：ScanTask.endUserId / FileObject.endUserId
    // 都有 FK → EndUser，且这样才能真实还原"两个不同用户"这条威胁模型的字面意思。
    await client.endUser.create({
      data: { id: endUserAId, phoneHash: `hash_${endUserAId}`, phoneEnc: 'enc_a' },
    })
    await client.endUser.create({
      data: { id: endUserBId, phoneHash: `hash_${endUserBId}`, phoneEnc: 'enc_b' },
    })

    const realPrisma = client as never
    const audit = new AuditService(realPrisma)
    const storage = new StorageService()
    const files = new FilesService(realPrisma, audit, storage)
    const service = wrapServiceForTest(new ScanTasksService(realPrisma, files, passthroughCapabilities))

    const bufferA = tinyPdf()
    const contentHashA = createHash('sha256').update(bufferA).digest('hex')

    // member_a 真实投递，真实建档完成（真实 upload() 写真实 FileObject 行）。
    const taskA = await service.create({ scanType: 'document', terminalId }, endUserAId)
    const deliveredA = await service.deliverScanFile({
      terminalId,
      buffer: bufferA,
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(
      deliveredA.scanTaskId,
      taskA.scanTaskId,
      'real DB: first delivery must match taskA'
    )

    const uploadedFileRow = await client.fileObject.findUnique({ where: { id: deliveredA.fileId } })
    assert.equal(
      uploadedFileRow?.sha256,
      contentHashA,
      'real DB sanity precondition: the real FilesService.upload() must have stored the true content sha256 (not a placeholder)'
    )

    // member_b 在同一物理终端开了一个全新等待任务——deliverScanFile() 匹配该终端唯一的 waiting 任务
    const taskB = await service.create({ scanType: 'document', terminalId }, endUserBId)

    let caught: unknown
    try {
      await service.deliverScanFile({
        terminalId,
        buffer: bufferA,
        filename: 'a-retry.pdf',
        mimeType: 'application/pdf',
        observedAt: new Date().toISOString(),
      })
    } catch (error) {
      caught = error
    }
    assert.ok(
      caught instanceof ConflictException,
      `real DB: duplicate-content retry must be rejected by the real Prisma dedup query, got ${(caught as Error)?.constructor?.name}`
    )
    const body = (caught as ConflictException).getResponse() as { error?: { code?: string } }
    assert.equal(
      body.error?.code,
      'SCAN_FILE_ALREADY_DELIVERED',
      'real DB: duplicate rejection must carry the specific SCAN_FILE_ALREADY_DELIVERED code'
    )

    const taskBAfterDuplicateAttempt = await client.scanTask.findUnique({
      where: { id: taskB.scanTaskId },
    })
    assert.equal(
      taskBAfterDuplicateAttempt?.status,
      'waiting',
      'real DB: member_b task must remain completely untouched — this is the cross-user PII leak the fix closes'
    )
    assert.equal(
      taskBAfterDuplicateAttempt?.fileId,
      null,
      'real DB: member_b task must never end up with member_a content attached'
    )

    // 不同内容不得被误伤：真实的 sha256 比对必须真的按字节甄别，不是"同终端有过成功
    // 投递就全部拒绝"。
    const differentBuffer = Buffer.from(
      '%PDF-1.4\nreal DB genuinely different content, not a duplicate\n%%EOF\n',
      'latin1'
    )
    const deliveredB = await service.deliverScanFile({
      terminalId,
      buffer: differentBuffer,
      filename: 'b.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(
      deliveredB.scanTaskId,
      taskB.scanTaskId,
      'real DB: genuinely different content must proceed to normal matching, not be blocked by the dedup guard'
    )

    // 直接对着真实 DB 单独重放一次与 deliverScanFile() 里逐字相同形状的查询——证明写的
    // Prisma 过滤语法本身对真实查询引擎语义正确，不只是"结构上能编译过"。
    const recentlyDeliveredForTerminal = await client.scanTask.findMany({
      where: {
        terminalId,
        fileId: { not: null },
        updatedAt: { gt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      },
      select: { fileId: true },
    })
    assert.equal(
      recentlyDeliveredForTerminal.length,
      2,
      `real DB: the exact findMany() filter shape used by deliverScanFile() must return exactly the 2 completed rows for this terminal (taskA + taskB), got ${recentlyDeliveredForTerminal.length}`
    )
    const candidateFileIds = recentlyDeliveredForTerminal
      .map((t) => t.fileId)
      .filter((id): id is string => id !== null)

    const dupMatch = await client.fileObject.findFirst({
      where: { id: { in: candidateFileIds }, sha256: contentHashA },
      select: { id: true },
    })
    assert.equal(
      dupMatch?.id,
      deliveredA.fileId,
      'real DB: fileObject.findFirst() with the exact filter shape must resolve back to the original member_a upload'
    )

    const noMatchForUnrelatedHash = await client.fileObject.findFirst({
      where: { id: { in: candidateFileIds }, sha256: 'f'.repeat(64) },
      select: { id: true },
    })
    assert.equal(
      noMatchForUnrelatedHash,
      null,
      'real DB: an unrelated sha256 must not match any candidate row'
    )

    // 真实 DB 下断言 SCAN_FILE_STALE_CAPTURE：观察时间早于任务创建边界时拒绝，任务保持 waiting 且无 FileObject
    const taskC = await service.create({ scanType: 'document', terminalId }, endUserAId)
    let caughtStaleRealDb: unknown
    try {
      await service.deliverScanFile({
        terminalId,
        buffer: Buffer.from('%PDF-1.4\nstale capture in real db\n%%EOF\n', 'latin1'),
        filename: 'stale.pdf',
        mimeType: 'application/pdf',
        observedAt: new Date(Date.now() - 60_000).toISOString(),
      })
    } catch (e) {
      caughtStaleRealDb = e
    }
    assert.ok(
      caughtStaleRealDb instanceof ConflictException,
      'real DB: stale capture must be rejected with ConflictException'
    )
    assert.equal(
      ((caughtStaleRealDb as ConflictException).getResponse() as { error?: { code?: string } }).error?.code,
      'SCAN_FILE_STALE_CAPTURE',
      'real DB: stale capture rejection code must be SCAN_FILE_STALE_CAPTURE'
    )
    const taskCAfterStale = await client.scanTask.findUnique({ where: { id: taskC.scanTaskId } })
    assert.equal(taskCAfterStale?.status, 'waiting', 'real DB: task C must remain waiting after stale delivery rejected')
    assert.equal(taskCAfterStale?.fileId, null, 'real DB: task C must have no file attached')

    // A failed task with an exact attempted hash and its prior control token can authorize one
    // real new task, and that new task can deliver the otherwise-deduplicated identical bytes.
    await client.scanTask.update({
      where: { id: taskC.scanTaskId },
      data: {
        status: 'failed',
        lastAttemptHash: createHash('sha256').update(tinyPdf()).digest('hex'),
        retryAuthorityExpiresAt: new Date(Date.now() + SCAN_RETRY_AUTHORITY_TTL_MS),
      },
    })
    const safeRetry = await service.create(
      {
        scanType: 'document',
        terminalId,
        retryOfScanTaskId: taskC.scanTaskId,
      },
      endUserAId,
      taskC.controlToken
    )
    const safeRetryDelivery = await service.deliverScanFile({
      terminalId,
      buffer: tinyPdf(),
      filename: 'safe-identical-rescan.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(
      safeRetryDelivery.scanTaskId,
      safeRetry.scanTaskId,
      'real DB: explicit one-time retry authority must permit its exact identical content'
    )
    const consumedAuthority = await client.scanTask.findUnique({
      where: { id: taskC.scanTaskId },
    })
    assert.ok(consumedAuthority?.retryConsumedAt)
    assert.equal(consumedAuthority?.retryConsumedByScanTaskId, safeRetry.scanTaskId)
  } finally {
    await client.scanTask.deleteMany({ where: { terminalId } }).catch(() => undefined)
    await client.fileObject
      .deleteMany({ where: { endUserId: { in: [endUserAId, endUserBId] } } })
      .catch(() => undefined)
    await client.endUser
      .deleteMany({ where: { id: { in: [endUserAId, endUserBId] } } })
      .catch(() => undefined)
    await client.terminal.deleteMany({ where: { id: terminalId } }).catch(() => undefined)
    await client.$disconnect()
    if (originalStorageDir === undefined) {
      delete process.env['FILE_STORAGE_DIR']
    } else {
      process.env['FILE_STORAGE_DIR'] = originalStorageDir
    }
    rmSync(tmpStorageDir, { recursive: true, force: true })
  }
}

/**
 * waiting 过期 reaper 必须用条件更新把 expiresAt<=now 的 waiting 行收敛为 expired，
 * 从而释放 B1-2 partial unique index，让同终端可以再 create()。getStatus() 的惰性过期
 * 在无人查询时不会落盘，所以这条路径不能只靠读接口。
 */
async function assertRealDbWaitingExpiryReaperUnblocksTerminal(dbUrl: string): Promise<void> {
  const { client } = createPrismaClient(dbUrl)
  await client.$connect()
  const terminalWaitingId = `realdb_wait_reap_w_${randomBytes(4).toString('hex')}`
  const terminalMatchedId = `realdb_wait_reap_m_${randomBytes(4).toString('hex')}`
  try {
    for (const [id, suffix] of [
      [terminalWaitingId, 'W'],
      [terminalMatchedId, 'M'],
    ] as const) {
      await client.terminal.create({
        data: {
          id,
          terminalCode: `RDB-WR-${suffix}-${randomBytes(3).toString('hex')}`,
          agentToken: randomBytes(16).toString('hex'),
          deviceFingerprint: 'verify-scan-tasks-realdb-waiting-reaper-fixture',
          enabled: true,
        },
      })
    }

    const service = new ScanTasksService(client as never, {} as never, passthroughCapabilities)
    const reaper = new ScanTaskReaperTask(client as never)

    const expiredWaiting = await service.create(
      { scanType: 'document', terminalId: terminalWaitingId },
      null
    )
    await client.scanTask.updateMany({
      where: { id: expiredWaiting.scanTaskId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const matchedPastExpiry = await client.scanTask.create({
      data: {
        terminalId: terminalMatchedId,
        scanType: 'document',
        status: 'matched',
        expiresAt: new Date(Date.now() - 1000),
      },
      select: { id: true, updatedAt: true },
    })

    let blocked: unknown
    try {
      await service.create({ scanType: 'document', terminalId: terminalWaitingId }, null)
    } catch (error) {
      blocked = error
    }
    assert.ok(
      blocked instanceof ConflictException,
      `real DB: an expired-but-still-waiting row must keep the partial unique index closed before the waiting reaper runs, got ${(blocked as Error)?.constructor?.name}`
    )
    assert.equal(
      ((blocked as ConflictException).getResponse() as { error?: { code?: string } }).error?.code,
      'SCAN_TERMINAL_BUSY',
      'real DB: same-terminal create before waiting reap must map to SCAN_TERMINAL_BUSY'
    )

    const reaped = await reaper.reapExpiredWaiting()
    assert.ok(
      reaped.count >= 1,
      `real DB: waiting reaper must converge at least the expired waiting row, got ${reaped.count}`
    )

    const waitingAfter = await client.scanTask.findUnique({
      where: { id: expiredWaiting.scanTaskId },
    })
    assert.equal(
      waitingAfter?.status,
      'expired',
      'real DB: expired waiting row must be conditionally updated to expired'
    )

    const matchedAfter = await client.scanTask.findUnique({
      where: { id: matchedPastExpiry.id },
    })
    assert.equal(
      matchedAfter?.status,
      'matched',
      'real DB: waiting reaper must not rewrite a matched row even when expiresAt is in the past'
    )

    const second = await service.create({ scanType: 'document', terminalId: terminalWaitingId }, null)
    assert.ok(
      second.scanTaskId,
      'real DB: same terminal must be able to create again after waiting expiry was reaped'
    )
    assert.notEqual(second.scanTaskId, expiredWaiting.scanTaskId)
  } finally {
    await client.scanTask.deleteMany({
      where: { terminalId: { in: [terminalWaitingId, terminalMatchedId] } },
    })
    await client.terminal.deleteMany({
      where: { id: { in: [terminalWaitingId, terminalMatchedId] } },
    })
    await client.$disconnect()
  }
}

/**
 * B1-11 follow-up（code review Important）：SCAN_CONTENT_DEDUP_WINDOW_MS（本包，
 * scan-tasks.service.ts）与 DELIVERY_RETRY_MAX_MS（apps/terminal-agent，
 * scan-watcher.ts）是两个独立部署包里各自声明的字面量常量，语义上必须相等——见
 * scan-tasks.service.ts 该常量上方注释：去重窗口的设计上限就是 Agent 理论上可能
 * 重试同一份文件的最大时间跨度。两个包之间没有可用的运行时 import 边界（Terminal
 * Agent 是独立部署的 Windows 二进制，package.json 未声明 @ai-job-print/shared 或
 * services/api 依赖，见其 tsconfig.json 的纯 commonjs 配置），所以无法像包内类型那样
 * 直接 import 同一个常量。
 *
 * 光靠两侧注释互相提醒是不够的——注释会腐化，未来有人改一侧数值而不动另一侧，不会
 * 有任何编译错误或运行时信号，直接重开本次修复要堵的跨用户 PII 误挂载窗口。这里改用
 * 源码文本解析兜底：直接读 scan-watcher.ts 的原始源码，正则提取
 * `DELIVERY_RETRY_MAX_MS = <表达式>` 字面量右侧，用严格白名单字符集
 * （只允许数字/空白/`*`/`+`/`-`）求值后与本包的 SCAN_CONTENT_DEDUP_WINDOW_MS 断言相等。
 * 两个常量任何一侧改动而未同步，本函数就会抛错，verify:scan-tasks 直接失败——不再是
 * 只有注释、没有强制力的约定。
 */
function assertDeliveryRetryMaxMsStaysInSyncWithDedupWindow(): void {
  const scanWatcherPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'apps',
    'terminal-agent',
    'src',
    'agent',
    'scan-watcher.ts'
  )
  const source = readFileSync(scanWatcherPath, 'utf8')

  const match = source.match(/export const DELIVERY_RETRY_MAX_MS\s*=\s*([^\n]+)/)
  assert.ok(
    match,
    `could not find "export const DELIVERY_RETRY_MAX_MS = ..." in ${scanWatcherPath} — the constant may have been renamed or removed without updating this sync check`
  )

  const rawExpr = match![1].trim()
  assert.match(
    rawExpr,
    /^[\d\s*+-]+$/,
    `DELIVERY_RETRY_MAX_MS expression "${rawExpr}" contains characters outside the safe-to-evaluate whitelist (digits, whitespace, *, +, -) — refusing to eval it; update this parser deliberately if the expression form legitimately changed`
  )

  // rawExpr is whitelisted to [\d\s*+-] above (not arbitrary source), so evaluating it here is safe.
  const agentDeliveryRetryMaxMs = new Function(`return (${rawExpr});`)() as number
  assert.equal(
    typeof agentDeliveryRetryMaxMs,
    'number',
    `parsed DELIVERY_RETRY_MAX_MS expression "${rawExpr}" did not evaluate to a number`
  )

  assert.equal(
    agentDeliveryRetryMaxMs,
    SCAN_CONTENT_DEDUP_WINDOW_MS,
    `apps/terminal-agent/src/agent/scan-watcher.ts DELIVERY_RETRY_MAX_MS (${agentDeliveryRetryMaxMs}ms) has drifted from ` +
      `services/api SCAN_CONTENT_DEDUP_WINDOW_MS (${SCAN_CONTENT_DEDUP_WINDOW_MS}ms). These two constants must stay equal: ` +
      `the server-side dedup window must cover the full span the Agent may retry a lost-response delivery, or a retry landing ` +
      `outside the (now too-narrow) dedup window will silently no-op and can re-match to a different user's waiting scan task ` +
      `— reopening the exact cross-user PII leak this fix closed. Update both constants together.`
  )
}

async function main(): Promise<void> {
  const apiRootForContracts = path.resolve(__dirname, '..')
  assertRetryHardeningMigrationContracts(apiRootForContracts)
  assertDeliverScanFileRequiresBidirectionalLineage(apiRootForContracts)

  const dto: CreateScanTaskDto = { scanType: 'document', terminalId: 't_1' }

  {
    // Explicit safe rescan: an eligible failed task plus its prior control token authorizes
    // exactly one new task for the same owner, terminal, scan type and content hash.
    const { service, prisma } = makeService()
    const bytes = tinyPdf()
    const prior = await service.create(dto, 'member_retry')
    makeRetryAuthority(prisma, prior.scanTaskId, bytes)

    const retry = await service.create(
      { ...dto, retryOfScanTaskId: prior.scanTaskId },
      'member_retry',
      prior.controlToken
    )
    const priorRow = prisma.scanTasksById.get(prior.scanTaskId)!
    const retryRow = prisma.scanTasksById.get(retry.scanTaskId)!
    assert.ok(priorRow.retryConsumedAt, 'prior retry authority must record consumption time')
    assert.equal(
      priorRow.retryConsumedByScanTaskId,
      retry.scanTaskId,
      'prior retry authority must link to the newly created task'
    )
    assert.equal(retryRow.retryOfScanTaskId, prior.scanTaskId)
    assert.equal(retryRow.retryContentHash, createHash('sha256').update(bytes).digest('hex'))

    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: bytes,
      filename: 'legitimate-identical-retry.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(delivered.scanTaskId, retry.scanTaskId)
  }

  {
    // Missing/wrong token, owner mismatch (including strict guest/null semantics), terminal,
    // type, completed state and expiry must all reject without consuming the authority.
    const cases: Array<{
      label: string
      priorOwner: string | null
      retryOwner: string | null
      retryDto?: CreateScanTaskDto
      token?: string
      mutate?: (task: StoredScanTask) => void
    }> = [
      { label: 'missing prior token', priorOwner: 'member_a', retryOwner: 'member_a' },
      {
        label: 'wrong prior token',
        priorOwner: 'member_a',
        retryOwner: 'member_a',
        token: 'wrong-token',
      },
      {
        label: 'member-to-member owner mismatch',
        priorOwner: 'member_a',
        retryOwner: 'member_b',
      },
      { label: 'guest authority used by member', priorOwner: null, retryOwner: 'member_a' },
      { label: 'member authority used as guest', priorOwner: 'member_a', retryOwner: null },
      {
        label: 'cross-terminal retry',
        priorOwner: 'member_a',
        retryOwner: 'member_a',
        retryDto: { scanType: 'document', terminalId: 't_2' },
      },
      {
        label: 'mismatched scan type',
        priorOwner: 'member_a',
        retryOwner: 'member_a',
        retryDto: { scanType: 'resume', terminalId: 't_1' },
      },
      {
        label: 'completed task denial',
        priorOwner: 'member_a',
        retryOwner: 'member_a',
        mutate: (task) => {
          task.status = 'completed'
        },
      },
      {
        label: 'delivered row cannot masquerade as failed authority',
        priorOwner: 'member_a',
        retryOwner: 'member_a',
        mutate: (task) => {
          task.fileId = 'already_delivered_file'
        },
      },
      {
        label: 'expired retry authority',
        priorOwner: 'member_a',
        retryOwner: 'member_a',
        mutate: (task) => {
          task.retryAuthorityExpiresAt = new Date(Date.now() - 1)
          task.updatedAt = new Date(Date.now() + SCAN_RETRY_AUTHORITY_TTL_MS)
        },
      },
    ]

    for (const testCase of cases) {
      const { service, prisma } = makeService()
      const prior = await service.create(dto, testCase.priorOwner)
      const priorRow = makeRetryAuthority(prisma, prior.scanTaskId, tinyPdf())
      testCase.mutate?.(priorRow)
      await expectRejectCode(
        () =>
          service.create(
            { ...(testCase.retryDto ?? dto), retryOfScanTaskId: prior.scanTaskId },
            testCase.retryOwner,
            testCase.token ?? (testCase.label === 'missing prior token' ? undefined : prior.controlToken)
          ),
        ForbiddenException,
        'SCAN_RETRY_NOT_AUTHORIZED',
        testCase.label
      )
      assert.equal(
        prisma.scanTasksById.get(prior.scanTaskId)?.retryConsumedAt,
        null,
        `${testCase.label}: rejected attempt must not consume authority`
      )
    }
  }

  {
    for (const eligibleStatus of ['cancelled', 'expired'] as const) {
      const { service, prisma } = makeService()
      const prior = await service.create(dto, 'member_terminal_state')
      makeRetryAuthority(prisma, prior.scanTaskId, tinyPdf(), { status: eligibleStatus })
      const retry = await service.create(
        { ...dto, retryOfScanTaskId: prior.scanTaskId },
        'member_terminal_state',
        prior.controlToken
      )
      assert.equal(
        prisma.scanTasksById.get(prior.scanTaskId)?.retryConsumedByScanTaskId,
        retry.scanTaskId,
        `${eligibleStatus} must be an explicitly eligible unsuccessful retry-authority state`
      )
    }
  }

  {
    const { service, prisma } = makeService()
    await expectRejectCode(
      () => service.create(dto, null, 'orphan-retry-token'),
      BadRequestException,
      'SCAN_RETRY_TASK_ID_MISSING',
      'retry token without retryOfScanTaskId'
    )

    const prior = await service.create(dto, null)
    makeRetryAuthority(prisma, prior.scanTaskId, tinyPdf())
    const firstRetry = await service.create(
      { ...dto, retryOfScanTaskId: prior.scanTaskId },
      null,
      prior.controlToken
    )
    prisma.scanTasksById.get(firstRetry.scanTaskId)!.status = 'cancelled'
    await expectRejectCode(
      () =>
        service.create(
          { ...dto, retryOfScanTaskId: prior.scanTaskId },
          null,
          prior.controlToken
        ),
      ForbiddenException,
      'SCAN_RETRY_NOT_AUTHORIZED',
      'consumed authority replay'
    )
  }

  {
    // Two parallel consumers of one authority: the CAS permits exactly one winner.
    const { service, prisma } = makeService()
    const prior = await service.create(dto, 'member_parallel')
    makeRetryAuthority(prisma, prior.scanTaskId, tinyPdf())
    const results = await Promise.allSettled([
      service.create(
        { ...dto, retryOfScanTaskId: prior.scanTaskId },
        'member_parallel',
        prior.controlToken
      ),
      service.create(
        { ...dto, retryOfScanTaskId: prior.scanTaskId },
        'member_parallel',
        prior.controlToken
      ),
    ])
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof service.create>>> =>
        result.status === 'fulfilled'
    )
    const rejected = results.filter((result) => result.status === 'rejected')
    assert.equal(fulfilled.length, 1, 'parallel retry authority consumption must have one winner')
    assert.equal(rejected.length, 1, 'parallel retry authority consumption must have one loser')
    assert.equal(
      prisma.scanTasksById.get(prior.scanTaskId)?.retryConsumedByScanTaskId,
      fulfilled[0].value.scanTaskId,
      'authority must link to the sole parallel winner'
    )
  }

  {
    // A retry authority for hash A is not a general terminal dedup exemption for hash B.
    const { service, prisma } = makeService()
    const hashABytes = tinyPdf()
    const hashBBytes = Buffer.from('%PDF-1.4\nalready delivered hash B\n%%EOF\n', 'latin1')
    const prior = await service.create(dto, 'member_scope')
    makeRetryAuthority(prisma, prior.scanTaskId, hashABytes)
    const retry = await service.create(
      { ...dto, retryOfScanTaskId: prior.scanTaskId },
      'member_scope',
      prior.controlToken
    )
    const historicalFileId = 'file_hash_b'
    prisma.filesById.set(historicalFileId, {
      id: historicalFileId,
      filename: 'hash-b.pdf',
      sizeBytes: hashBBytes.length,
      mimeType: 'application/pdf',
      sha256: createHash('sha256').update(hashBBytes).digest('hex'),
      purpose: 'print_doc',
      endUserId: 'member_scope',
      deletedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const retryRow = prisma.scanTasksById.get(retry.scanTaskId)!
    const historicalTask: StoredScanTask = {
      ...retryRow,
      id: 'historical_hash_b',
      terminalId: 't_1',
      status: 'completed',
      fileId: historicalFileId,
      endUserId: 'member_scope',
      lastAttemptHash: createHash('sha256').update(hashBBytes).digest('hex'),
      retryOfScanTaskId: null,
      retryContentHash: null,
      retryConsumedAt: null,
      retryConsumedByScanTaskId: null,
      updatedAt: new Date(),
    }
    prisma.scanTasksById.set(historicalTask.id, historicalTask)
    await expectRejectCode(
      () =>
        service.deliverScanFile({
          terminalId: 't_1',
          buffer: hashBBytes,
          filename: 'wrong-hash-for-authority.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      ConflictException,
      'SCAN_FILE_ALREADY_DELIVERED',
      'retry authorization must be scoped to its exact content hash'
    )
    assert.equal(prisma.scanTasksById.get(retry.scanTaskId)?.status, 'waiting')
  }

  {
    // The child row is not self-authenticating. Every dedup bypass must be proven by a matching,
    // consumed prior authority whose backlink points to this exact child.
    const mutations: Array<{
      label: string
      mutate: (prior: StoredScanTask, child: StoredScanTask, prisma: FakePrisma) => void
    }> = [
      {
        label: 'orphan child',
        mutate: (_prior, child) => {
          child.retryOfScanTaskId = 'missing-prior'
        },
      },
      {
        label: 'mismatched backlink',
        mutate: (prior) => {
          prior.retryConsumedByScanTaskId = 'different-child'
        },
      },
      {
        label: 'missing consumption time',
        mutate: (prior) => {
          prior.retryConsumedAt = null
        },
      },
      {
        label: 'missing authority expiry',
        mutate: (prior) => {
          prior.retryAuthorityExpiresAt = null
        },
      },
      {
        label: 'consumption after authority expiry',
        mutate: (prior) => {
          prior.retryAuthorityExpiresAt = new Date(prior.retryConsumedAt!.getTime() - 1)
        },
      },
      {
        label: 'ineligible prior status',
        mutate: (prior) => {
          prior.status = 'completed'
        },
      },
      {
        label: 'prior already has file',
        mutate: (prior) => {
          prior.fileId = 'forged-existing-file'
        },
      },
      {
        label: 'wrong owner',
        mutate: (prior) => {
          prior.endUserId = 'other-member'
        },
      },
      {
        label: 'wrong terminal',
        mutate: (prior) => {
          prior.terminalId = 't_2'
        },
      },
      {
        label: 'wrong scan type',
        mutate: (prior) => {
          prior.scanType = 'resume'
        },
      },
      {
        label: 'wrong content hash',
        mutate: (prior) => {
          prior.lastAttemptHash = 'f'.repeat(64)
        },
      },
    ]

    for (const mutation of mutations) {
      const { service, prisma } = makeService()
      const bytes = tinyPdf()
      const prior = await service.create(dto, 'member_lineage')
      makeRetryAuthority(prisma, prior.scanTaskId, bytes)
      const retry = await service.create(
        { ...dto, retryOfScanTaskId: prior.scanTaskId },
        'member_lineage',
        prior.controlToken
      )
      const priorRow = prisma.scanTasksById.get(prior.scanTaskId)!
      const retryRow = prisma.scanTasksById.get(retry.scanTaskId)!
      prisma.scanTasksById.set(`lineage-dedup-evidence-${mutation.label}`, {
        ...priorRow,
        id: `lineage-dedup-evidence-${mutation.label}`,
        retryConsumedAt: null,
        retryConsumedByScanTaskId: null,
        retryAuthorityExpiresAt: null,
        updatedAt: new Date(),
      })
      mutation.mutate(priorRow, retryRow, prisma)

      await expectRejectCode(
        () =>
          service.deliverScanFile({
            terminalId: 't_1',
            buffer: bytes,
            filename: `forged-${mutation.label}.pdf`,
            mimeType: 'application/pdf',
            observedAt: new Date().toISOString(),
          }),
        ConflictException,
        'SCAN_FILE_PREVIOUSLY_ATTEMPTED',
        `${mutation.label} lineage must not bypass dedup`
      )
      assert.equal(
        prisma.scanTasksById.get(retry.scanTaskId)?.status,
        'waiting',
        `${mutation.label}: forged lineage must leave the child waiting and unclaimed`
      )
    }
  }

  {
    // contract scan 必须贯通专用高敏短期 purpose，不能退化到通用 print_doc。
    const { service, prisma } = makeService()
    const created = await service.create({ scanType: 'contract', terminalId: 't_1' }, null)
    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: tinyPdf(),
      filename: 'contract.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(delivered.scanTaskId, created.scanTaskId)
    assert.equal(prisma.filesById.get(delivered.fileId)?.purpose, 'contract_upload')

    const task = prisma.scanTasksById.get(created.scanTaskId)!
    const storedFile = prisma.filesById.get(delivered.fileId)!
    task.expiresAt = new Date(Date.now() - 1)
    const taskWindowExpired = await service.getStatus(
      created.scanTaskId,
      null,
      created.controlToken
    )
    assert.equal(taskWindowExpired.status, 'completed')
    assert.equal(taskWindowExpired.file?.fileId, delivered.fileId)

    task.expiresAt = new Date(Date.now() + 60_000)
    storedFile.expiresAt = new Date(Date.now() - 1)
    const fileExpired = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(fileExpired.status, 'expired')
    assert.equal(fileExpired.file, null)

    storedFile.expiresAt = null
    const expiryMissing = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(expiryMissing.status, 'expired')
    assert.equal(expiryMissing.file, null)

    prisma.filesById.delete(delivered.fileId)
    const fileMissing = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(fileMissing.status, 'expired')
    assert.equal(fileMissing.file, null)
  }

  {
    // B1-11 follow-up：两个独立部署包（services/api、apps/terminal-agent）里各自声明的
    // 常量必须保持同步，见 assertDeliveryRetryMaxMsStaysInSyncWithDedupWindow() 顶部注释。
    assertDeliveryRetryMaxMsStaysInSyncWithDedupWindow()
  }

  {
    // 正常建会话 + 匹配投递 + 状态查询全链路
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    assert.ok(created.scanTaskId)
    assert.equal(created.instructions.length > 0, true, 'instructions must be non-empty')

    // B1-3: create() 铸造并返回明文 controlToken（24 random bytes = 48 hex chars），
    // DB 里只落它的 sha256 hash，绝不落明文。
    assert.match(
      created.controlToken,
      /^[0-9a-f]{48}$/,
      'controlToken must be a 24-byte hex string'
    )
    const storedTask = prisma.scanTasksById.get(created.scanTaskId)
    assert.notEqual(
      storedTask?.controlTokenHash,
      created.controlToken,
      'stored value must not be the plaintext token'
    )
    assert.equal(
      storedTask?.controlTokenHash,
      createHash('sha256').update(created.controlToken).digest('hex'),
      'stored controlTokenHash must be sha256(controlToken)'
    )

    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: Buffer.from('%PDF-1.4 scan'),
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(delivered.scanTaskId, created.scanTaskId)
    // scanType -> FilePurpose 映射:document 扫描必须落 print_doc（顺带覆盖，不单开一个测试块）
    assert.equal(prisma.filesById.get(delivered.fileId)?.purpose, 'print_doc')

    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(status.status, 'completed')
    assert.equal(status.file?.fileId, delivered.fileId)
    assert.match(
      status.file?.fileUrl ?? '',
      /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/
    )

    storedTask!.expiresAt = new Date(Date.now() - 1)
    const completedAfterTaskExpiry = await service.getStatus(
      created.scanTaskId,
      null,
      created.controlToken
    )
    assert.equal(
      completedAfterTaskExpiry.status,
      'completed',
      'non-contract completed scan status remains unchanged when only its task window expires'
    )
    assert.equal(completedAfterTaskExpiry.file?.fileId, delivered.fileId)
  }

  {
    // B1-3：create() 捕获数据库唯一约束冲突（B1-2 的 partial unique index，Prisma 抛 P2002）
    // 必须映射成 409 ConflictException + error.code === 'SCAN_TERMINAL_BUSY'，不能是未处理异常
    // 也不能被其它无关错误码顶替。FakePrisma 不建模真实唯一索引，这里 monkey-patch
    // scanTask.create 模拟命中约束，复现真实 Prisma 抛出的错误形状——isScanTaskActiveSessionConflict()
    // 用 `instanceof Prisma.PrismaClientKnownRequestError` 判别（而非鸭子类型 duck-typing 一个
    // `.code` 字段），因此这里必须构造一个真正的 PrismaClientKnownRequestError 实例，
    // 一个仅挂了 .code 属性的 plain Error 不再能通过该判别。
    // （real-DB 端到端复现见本任务 verification：against 真实 SQLite + 真实 partial unique index）。
    const { service, prisma } = makeService()
    const originalCreate = prisma.scanTask.create.bind(prisma.scanTask)
    prisma.scanTask.create = (async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`terminalId`)',
        {
          code: 'P2002',
          clientVersion: 'verify-scan-tasks-fixture',
          meta: { target: ['terminalId'] },
        }
      )
    }) as typeof originalCreate

    let caught: unknown
    try {
      await service.create(dto, null)
    } catch (error) {
      caught = error
    }
    assert.ok(
      caught instanceof ConflictException,
      `expected ConflictException, got ${(caught as Error)?.constructor?.name}`
    )
    const body = (caught as ConflictException).getResponse() as { error?: { code?: string } }
    assert.equal(
      body.error?.code,
      'SCAN_TERMINAL_BUSY',
      'P2002 on create() must map to SCAN_TERMINAL_BUSY, not a different/generic code'
    )

    prisma.scanTask.create = originalCreate as typeof prisma.scanTask.create
  }

  {
    for (const target of [['retryOfScanTaskId'], 'ScanTask_retryConsumedByScanTaskId_key'] as const) {
      const { service, prisma } = makeService()
      const prior = await service.create(dto, 'member_lineage_p2002')
      makeRetryAuthority(prisma, prior.scanTaskId, tinyPdf())
      const originalCreate = prisma.scanTask.create.bind(prisma.scanTask)
      prisma.scanTask.create = (async () => {
        throw new Prisma.PrismaClientKnownRequestError(
          `Unique constraint failed on ${String(target)}`,
          {
            code: 'P2002',
            clientVersion: 'verify-scan-tasks-fixture',
            meta: { target },
          }
        )
      }) as typeof originalCreate
      await expectRejectCode(
        () =>
          service.create(
            { ...dto, retryOfScanTaskId: prior.scanTaskId },
            'member_lineage_p2002',
            prior.controlToken
          ),
        ConflictException,
        'SCAN_RETRY_CONFLICT',
        `P2002 target ${String(target)} must map to SCAN_RETRY_CONFLICT, not SCAN_TERMINAL_BUSY`
      )
      prisma.scanTask.create = originalCreate as typeof prisma.scanTask.create
    }
  }

  {
    // create() 必须只把 P2002 映射成 SCAN_TERMINAL_BUSY；其它数据库错误码/未知错误必须原样透出
    // （不能被误吞成"终端繁忙"，否则会掩盖真实故障，误导排障方向）。
    //
    // 注意：光断言 `error instanceof Error` 是近乎空判断的——ConflictException 本身也
    // extends Error，如果 isScanTaskActiveSessionConflict() 被错误地改成对任意错误都
    // 返回 true（把这个非 P2002 错误也错判成活跃会话冲突），下面这条断言依然会通过，
    // 完全测不出判别逻辑坏了。因此必须同时证明：
    //   1) 抛出的不是 ConflictException（没有被误判成 SCAN_TERMINAL_BUSY 分支）；
    //   2) 抛出的就是原始那个 fake error 对象本身（严格 === 同一引用，证明是真正的
    //      原样透传 `throw e`，而不是换了个新错误但恰好还不是 ConflictException）。
    const { service, prisma } = makeService()
    const originalCreate = prisma.scanTask.create.bind(prisma.scanTask)
    const fakeError = new Error('ECONNRESET: simulated unrelated database failure')
    prisma.scanTask.create = (async () => {
      throw fakeError
    }) as typeof originalCreate

    let caught: unknown
    try {
      await service.create(dto, null)
    } catch (error) {
      caught = error
    }
    assert.ok(
      caught instanceof Error,
      'non-P2002 errors must not be swallowed as SCAN_TERMINAL_BUSY: expected an Error to be thrown'
    )
    assert.ok(
      !(caught instanceof ConflictException),
      `non-P2002 errors must NOT be remapped to ConflictException, got ${(caught as Error)?.constructor?.name}`
    )
    assert.equal(
      caught,
      fakeError,
      'non-P2002 errors must propagate as the exact same original error instance (true passthrough via `throw e`), not a new/different error'
    )

    prisma.scanTask.create = originalCreate as typeof prisma.scanTask.create
  }

  {
    // B1-9：真实 DB 端到端验证——B1-2 的 partial unique index 只写在 migration.sql 里
    // （Prisma schema.prisma 语法表达不了 WHERE 条件表达式，见 schema.prisma ScanTask 模型
    // 上方注释），上面两个 SCAN_TERMINAL_BUSY 测试全部是对着手工构造/monkey-patch 出来的
    // PrismaClientKnownRequestError 做的单元级判别测试（isScanTaskActiveSessionConflict()），
    // 从未真正跑过这条 migration.sql 本身，也没有验证过真实数据库真的会在正确的时机抛出
    // P2002、在正确的时机放行。
    //
    // 不能依赖 CI 共享的 dev.db：CI 的 "Prepare fresh SQLite db" 步骤用的是 `prisma db push`——
    // 它只按 schema.prisma 建表，schema.prisma 没有声明这条 partial unique index（只在
    // migration.sql 里），已本地验证 `db push` 后 sqlite_master 里确实没有
    // ScanTask_terminalId_active_unique 这条索引。也不能依赖当前进程的 DATABASE_URL：本脚本
    // 同时被 SQLite CI job 和 postgres-readiness job 调用（后者 DATABASE_URL 指向 Postgres，
    // 没有 prisma/dev.db）。因此这里起一个完全独立的临时 SQLite 文件，直接调用本地
    // node_modules/.bin/prisma 跑一遍真实 `migrate deploy`（应用完整迁移历史，含这条约束），
    // 全程不触碰进程当前的 DATABASE_URL / 共享 dev.db，跑完即删。
    const apiRoot = path.resolve(__dirname, '..')
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'verify-scan-tasks-realdb-'))
    const dbPath = path.join(tmpDir, 'verify.db')
    const dbUrl = `file:${dbPath}`

    try {
      assertSqliteRetryHardeningUpgrade(apiRoot)
      ensureSqliteFile(dbPath)
      runPrisma(apiRoot, ['migrate', 'deploy'], { ...process.env, DATABASE_URL: dbUrl })

      await assertRealDbPartialUniqueIndex(dbUrl, 'sqlite')
      await assertRealDbWaitingExpiryReaperUnblocksTerminal(dbUrl)
      await assertRealDbRetryAuthorityCas(dbUrl, 'sqlite')
      await assertRealDbRetryCreateAtomicity(dbUrl)
      await assertRealDbRetryLineageIndexes(dbUrl, 'sqlite')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  {
    // B1-9 follow-up：上面的 SQLite 块只证明了 prisma/migrations/ 下那份 migration.sql 真实
    // 生效——但 partial unique index 是手写 SQL，SQLite 版和 prisma/postgres/migrations/ 下的
    // Postgres 版是两份独立的 .sql 文件（Prisma 的 @@unique 语法表达不了 WHERE 条件，所以两边
    // 都得手写，天然就有"改了一份忘改另一份"的漂移风险）。CI 的 postgres-readiness job 会真的
    // 把 Postgres 版迁移部署到一个真实 Postgres 实例上，但在这个 B1-9 补丁之前，从没有任何测试
    // 真的对着那个连接跑两次 create() 去验证约束的 WHERE 子句在 Postgres 上语义正确——SQLite
    // 那半边测过不代表 Postgres 那半边也一定对（哪怕两份 .sql 文本几乎一样）。
    //
    // 普通行为断言继续复用 POSTGRES_URL 指向的专用库，并以随机 ID + finally 清理隔离。
    // 上一版本升级断言需要同时保留 clean / duplicate 两种独立结构，因此只在同一临时集群内
    // 创建随机测试数据库，验证完成后立即 drop；不会连接或修改 URL 指定集群之外的数据库。
    //
    // 没有配置 Postgres 环境时（例如本地开发者跑 `pnpm verify:scan-tasks` 没起 Postgres）优雅
    // 跳过，不失败——跟 scripts/verify-cos-live.ts 对未配置真实凭证时的处理方式一致（SKIPPED
    // + 说明如何补齐环境，而不是让本来就该用 SQLite 跑的日常验证因为缺 Postgres 而报红）。
    const pgUrl = process.env['POSTGRES_URL']?.trim() || process.env['DATABASE_URL']?.trim()
    let pgKind: ReturnType<typeof dbKindOf> | undefined
    try {
      pgKind = pgUrl ? dbKindOf(pgUrl) : undefined
    } catch {
      pgKind = undefined
    }

    if (!pgUrl || pgKind !== 'postgres') {
      console.log(
        'SKIPPED real DB (postgres) partial unique index check — 未检测到指向 PostgreSQL 的 POSTGRES_URL/DATABASE_URL，跳过。' +
          ' 本地要跑此项：export POSTGRES_URL="postgresql://user@localhost:5432/db" 后重试；' +
          ' postgres-readiness CI job 会用真实 Postgres 实例跑到这一段。'
      )
    } else {
      const apiRoot = path.resolve(__dirname, '..')
      assertPostgresRetryHardeningUpgrade(apiRoot, pgUrl)
      // 与 SQLite 块一致：不假设调用方已经在本进程之外部署过迁移，本块自己也跑一遍真实
      // `migrate deploy`（走 Postgres 专用配置/迁移目录，见 prisma.postgres.config.ts）。
      // migrate deploy 是幂等的，对已经部署过这条迁移的库（如 CI 提前 db:pg:deploy 过的库）
      // 重跑是安全的no-op。
      runPrisma(apiRoot, ['migrate', 'deploy', '--config', 'prisma.postgres.config.ts'], {
        ...process.env,
        DATABASE_URL: pgUrl,
        POSTGRES_URL: pgUrl,
      })

      await assertRealDbPartialUniqueIndex(pgUrl, 'postgres')
      await assertRealDbRetryAuthorityCas(pgUrl, 'postgres')
      await assertRealDbRetryCreateAtomicity(pgUrl)
      await assertRealDbRetryLineageIndexes(pgUrl, 'postgres')
    }
  }

  {
    // 禁用终端不能建会话
    const { service } = makeService()
    await expectRejects(
      () => service.create({ scanType: 'document', terminalId: 't_disabled' }, null),
      BadRequestException,
      'disabled terminal rejected'
    )
  }

  {
    // 不存在的终端不能建会话
    const { service } = makeService()
    await expectRejects(
      () => service.create({ scanType: 'document', terminalId: 't_missing' }, null),
      BadRequestException,
      'unknown terminal rejected'
    )
  }

  {
    // 没有等待中任务时投递必须 409 ConflictException（不得误建档，也不能静默吞掉文件）
    const { service } = makeService()
    await expectRejects(
      () =>
        service.deliverScanFile({
          terminalId: 't_1',
          buffer: tinyPdf(),
          filename: 'stray.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      ConflictException,
      'no waiting task rejected'
    )
  }

  {
    // 按终端唯一定位 waiting 任务（DB 层面已有单终端至多一条活跃任务约束，移除了 FIFO 排序与叙述）
    const { service } = makeService()
    const task = await service.create(dto, null)
    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: tinyPdf(),
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(
      delivered.scanTaskId,
      task.scanTaskId,
      'must match the unique waiting task for the terminal'
    )
  }

  {
    // 过期任务在查询时惰性转 expired，且不能再被投递匹配
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    const task = prisma.scanTasksById.get(created.scanTaskId)!
    prisma.scanTasksById.set(created.scanTaskId, {
      ...task,
      expiresAt: new Date(Date.now() - 1000),
    })
    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(status.status, 'expired')
    assert.equal(
      prisma.scanTasksById.get(created.scanTaskId)?.retryAuthorityExpiresAt,
      null,
      'waiting lazy expiry without lastAttemptHash must not mint retry authority'
    )
    await expectRejectCode(
      () =>
        service.create(
          { ...dto, retryOfScanTaskId: created.scanTaskId },
          null,
          created.controlToken
        ),
      ForbiddenException,
      'SCAN_RETRY_NOT_AUTHORIZED',
      'waiting expiry must not authorize a content-bound retry'
    )
    await expectRejects(
      () =>
        service.deliverScanFile({
          terminalId: 't_1',
          buffer: tinyPdf(),
          filename: 'late.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      ConflictException,
      'expired task must not be matched'
    )
  }

  {
    // getStatus() 的懒过期落盘必须 CAS（只在仍是 waiting 时才写 expired）。
    // 模拟竞态：读到 waiting + 已过期之后、落盘之前，另一个并发请求的 cancel() 抢先把
    // 任务改成了 cancelled——落盘时必须因为状态已不是 waiting 而放弃写入，
    // 不能无条件覆盖回 expired，抹掉真实的取消结果。
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    const task = prisma.scanTasksById.get(created.scanTaskId)!
    prisma.scanTasksById.set(created.scanTaskId, {
      ...task,
      expiresAt: new Date(Date.now() - 1000),
    })

    const originalUpdateMany = prisma.scanTask.updateMany.bind(prisma.scanTask)
    prisma.scanTask.updateMany = (async (args: Parameters<typeof originalUpdateMany>[0]) => {
      const current = prisma.scanTasksById.get(created.scanTaskId)!
      prisma.scanTasksById.set(created.scanTaskId, { ...current, status: 'cancelled' })
      return originalUpdateMany(args)
    }) as typeof originalUpdateMany

    const returned = await service.getStatus(created.scanTaskId, null, created.controlToken)

    assert.equal(
      prisma.scanTasksById.get(created.scanTaskId)?.status,
      'cancelled',
      'lazy-expire write must not clobber a concurrently cancelled task back to expired'
    )
    assert.equal(
      returned.status,
      'cancelled',
      'CAS loser must re-read and return the concurrently cancelled terminal state'
    )
  }

  {
    // matched 也受扫描会话 TTL 约束；惰性过期必须带 matched 状态条件落盘。
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    const task = prisma.scanTasksById.get(created.scanTaskId)!
    const attemptedHash = createHash('sha256').update(tinyPdf()).digest('hex')
    prisma.scanTasksById.set(created.scanTaskId, {
      ...task,
      status: 'matched',
      lastAttemptHash: attemptedHash,
      expiresAt: new Date(Date.now() - 1000),
    })

    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(status.status, 'expired')
    const expiredRow = prisma.scanTasksById.get(created.scanTaskId)!
    assert.equal(expiredRow.status, 'expired')
    assert.ok(
      expiredRow.retryAuthorityExpiresAt && expiredRow.retryAuthorityExpiresAt.getTime() > Date.now(),
      'matched lazy expiry with lastAttemptHash must atomically mint a dedicated retry authority'
    )
  }

  {
    // matched 过期与并发完成竞态时，CAS 失败不得覆盖已完成状态。
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    const task = prisma.scanTasksById.get(created.scanTaskId)!
    prisma.scanTasksById.set(created.scanTaskId, {
      ...task,
      status: 'matched',
      expiresAt: new Date(Date.now() - 1000),
    })
    prisma.filesById.set('file_concurrent_completed', {
      id: 'file_concurrent_completed',
      filename: 'race.pdf',
      sizeBytes: tinyPdf().length,
      mimeType: 'application/pdf',
      sha256: createHash('sha256').update(tinyPdf()).digest('hex'),
      purpose: 'print_doc',
      endUserId: null,
      deletedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const originalUpdateMany = prisma.scanTask.updateMany.bind(prisma.scanTask)
    prisma.scanTask.updateMany = (async (args: Parameters<typeof originalUpdateMany>[0]) => {
      const current = prisma.scanTasksById.get(created.scanTaskId)!
      prisma.scanTasksById.set(created.scanTaskId, {
        ...current,
        status: 'completed',
        fileId: 'file_concurrent_completed',
      })
      return originalUpdateMany(args)
    }) as typeof originalUpdateMany

    const returned = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(
      prisma.scanTasksById.get(created.scanTaskId)?.status,
      'completed',
      'matched expiry CAS must not clobber a concurrently completed task'
    )
    assert.equal(
      returned.status,
      'completed',
      'CAS loser must re-read and return the concurrently completed terminal state'
    )
    assert.equal(returned.file?.fileId, 'file_concurrent_completed')
  }

  {
    // 他人不能查看 / 取消绑定了 endUserId 的任务（这里全程带上正确 controlToken，
    // 证明 endUserId 归属校验在 B1-4 之后依然独立生效，不是被 controlToken 校验顶替掉）。
    const { service } = makeService()
    const created = await service.create(dto, 'member_1')
    await expectRejects(
      () => service.getStatus(created.scanTaskId, 'member_2', created.controlToken),
      ForbiddenException,
      'status forbidden for non-owner'
    )
    await expectRejects(
      () => service.cancel(created.scanTaskId, 'member_2', created.controlToken),
      ForbiddenException,
      'cancel forbidden for non-owner'
    )
    const cancelled = await service.cancel(created.scanTaskId, 'member_1', created.controlToken)
    assert.equal(cancelled.status, 'cancelled')
  }

  {
    // 登出/会话失效后 optional endUserId 为 null：正确 controlToken 必须仍能取消
    // waiting/matched 会员任务。getStatus 的会员归属校验不得一并放宽。
    for (const liveStatus of ['waiting', 'matched'] as const) {
      const { service, prisma } = makeService()
      const created = await service.create(dto, 'member_logout')
      if (liveStatus === 'matched') {
        const task = prisma.scanTasksById.get(created.scanTaskId)!
        prisma.scanTasksById.set(created.scanTaskId, { ...task, status: 'matched' })
      }

      await expectRejects(
        () => service.getStatus(created.scanTaskId, null, created.controlToken),
        ForbiddenException,
        `anonymous getStatus must still be forbidden for a member ${liveStatus} task`
      )
      assert.equal(
        prisma.scanTasksById.get(created.scanTaskId)?.status,
        liveStatus,
        `rejected anonymous status read must not mutate a member ${liveStatus} task`
      )
      assert.equal(
        prisma.scanTasksById.get(created.scanTaskId)?.endUserId,
        'member_logout',
        'rejected anonymous status read must not clear stored ownership'
      )

      const cancelled = await service.cancel(created.scanTaskId, null, created.controlToken)
      assert.equal(cancelled.status, 'cancelled')
      const stored = prisma.scanTasksById.get(created.scanTaskId)!
      assert.equal(stored.status, 'cancelled', `member ${liveStatus} task must cancel with a valid token after logout`)
      assert.equal(
        stored.endUserId,
        'member_logout',
        'token-authenticated anonymous cancel must not clear stored ownership'
      )

      await expectRejects(
        () => service.getStatus(created.scanTaskId, null, created.controlToken),
        ForbiddenException,
        'anonymous getStatus must remain forbidden after token-authenticated cancel'
      )
      const ownerStatus = await service.getStatus(
        created.scanTaskId,
        'member_logout',
        created.controlToken
      )
      assert.equal(ownerStatus.status, 'cancelled')
    }
  }

  {
    // 错/缺 controlToken 在 endUserId 为 null 时仍 403，不得取消会员任务，状态与读归属都不变。
    const { service, prisma } = makeService()
    const created = await service.create(dto, 'member_logout')
    const wrongToken = randomBytes(24).toString('hex')
    assert.notEqual(
      wrongToken,
      created.controlToken,
      'sanity: fixture must generate a genuinely different token'
    )

    await expectRejects(
      () => service.cancel(created.scanTaskId, null, wrongToken),
      ForbiddenException,
      'wrong controlToken must not cancel a member task after logout'
    )
    await expectRejects(
      () => service.cancel(created.scanTaskId, null, undefined),
      ForbiddenException,
      'missing controlToken must not cancel a member task after logout'
    )

    const stored = prisma.scanTasksById.get(created.scanTaskId)!
    assert.equal(stored.status, 'waiting', 'rejected anonymous cancel must leave status unchanged')
    assert.equal(
      stored.endUserId,
      'member_logout',
      'rejected anonymous cancel must leave stored ownership unchanged'
    )

    await expectRejects(
      () => service.getStatus(created.scanTaskId, null, created.controlToken),
      ForbiddenException,
      'read ownership must stay closed to anonymous callers after a rejected cancel'
    )
    const ownerStatus = await service.getStatus(
      created.scanTaskId,
      'member_logout',
      created.controlToken
    )
    assert.equal(ownerStatus.status, 'waiting')
  }

  {
    // B1-4 案例(a)：正确 controlToken → 放行。会员任务（不只游客任务）也必须过 controlToken
    // 校验——即便 endUserId 完全匹配本人，缺了/错了 controlToken 依然要 403。
    const { service } = makeService()
    const created = await service.create(dto, 'member_1')
    const status = await service.getStatus(created.scanTaskId, 'member_1', created.controlToken)
    assert.equal(status.status, 'waiting', 'correct token + correct owner must be granted access')
  }

  {
    // B1-4 案例(b)：缺失 controlToken（undefined）→ 403，即便 endUserId 完全匹配本人
    // （纵深防御：不能因为 JWT 归属校验通过了就跳过 token 校验）。同时覆盖 getStatus 与 cancel。
    const { service } = makeService()
    const createdMember = await service.create(dto, 'member_1')
    await expectRejects(
      () => service.getStatus(createdMember.scanTaskId, 'member_1', undefined),
      ForbiddenException,
      'missing controlToken must be rejected even for the correct member owner (status)'
    )
    await expectRejects(
      () => service.cancel(createdMember.scanTaskId, 'member_1', undefined),
      ForbiddenException,
      'missing controlToken must be rejected even for the correct member owner (cancel)'
    )

    const createdGuest = await service.create(dto, null)
    await expectRejects(
      () => service.getStatus(createdGuest.scanTaskId, null, undefined),
      ForbiddenException,
      'missing controlToken must be rejected for guest tasks too (status)'
    )
    await expectRejects(
      () => service.cancel(createdGuest.scanTaskId, null, undefined),
      ForbiddenException,
      'missing controlToken must be rejected for guest tasks too (cancel)'
    )
  }

  {
    // B1-4 案例(c)：错误 controlToken（格式合法但不匹配该任务的 hash）→ 403。
    // 这条断言真正锁定 timingSafeEqualHex() 的哈希比对逻辑本身——如果实现被错误地改成
    // 无条件 `return true`（或退化成只判断 truthy），这里会因为没有抛出 ForbiddenException
    // 而失败，不是空判断。
    const { service } = makeService()
    const created = await service.create(dto, null)
    const wrongToken = randomBytes(24).toString('hex')
    assert.notEqual(
      wrongToken,
      created.controlToken,
      'sanity: fixture must generate a genuinely different token'
    )
    await expectRejects(
      () => service.getStatus(created.scanTaskId, null, wrongToken),
      ForbiddenException,
      'wrong controlToken must be rejected (status)'
    )
    await expectRejects(
      () => service.cancel(created.scanTaskId, null, wrongToken),
      ForbiddenException,
      'wrong controlToken must be rejected (cancel)'
    )
    // 用正确 token 复核同一条任务确实还活着、还能正常访问——证明上面两次 403
    // 是 wrongToken 造成的，不是任务本身已经被别的路径弄坏了。
    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(status.status, 'waiting')
  }

  {
    // B1-4 案例(d)：token 属于另一个任务（跨任务）→ 403。证明比对是"逐任务哈希比对"，
    // 不是拿去跟某个全局密钥/常量比。如果实现退化成"只要 token 是任意合法已铸造的
    // token 就放行"，这里会因为没有抛出而失败。
    const { service } = makeService()
    const taskA = await service.create(dto, null)
    const taskB = await service.create(dto, null)
    assert.notEqual(
      taskA.controlToken,
      taskB.controlToken,
      'sanity: two sessions must mint different tokens'
    )
    await expectRejects(
      () => service.getStatus(taskB.scanTaskId, null, taskA.controlToken),
      ForbiddenException,
      'taskA token must not unlock taskB (status)'
    )
    await expectRejects(
      () => service.cancel(taskB.scanTaskId, null, taskA.controlToken),
      ForbiddenException,
      'taskA token must not unlock taskB (cancel)'
    )
    // taskA 自己的 token 依然能访问 taskA，证明上面失败确实是"跨任务"导致，不是 token 整体失效。
    const statusA = await service.getStatus(taskA.scanTaskId, null, taskA.controlToken)
    assert.equal(statusA.status, 'waiting')
  }

  {
    // B1-4 历史行兼容：controlTokenHash 为 null（B1-1 迁移前创建的旧行）必须一律拒绝，
    // 即便调用方带了某个格式合法的 token——不能因为"看起来像是没设防"就放行，
    // 这类旧行应该在几分钟内自然过期，拒绝比放行更安全。
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    const task = prisma.scanTasksById.get(created.scanTaskId)!
    prisma.scanTasksById.set(created.scanTaskId, { ...task, controlTokenHash: null })

    await expectRejects(
      () => service.getStatus(created.scanTaskId, null, created.controlToken),
      ForbiddenException,
      'legacy row with null controlTokenHash must be rejected even with the (no-longer-verifiable) original token (status)'
    )
    await expectRejects(
      () => service.cancel(created.scanTaskId, null, created.controlToken),
      ForbiddenException,
      'legacy row with null controlTokenHash must be rejected even with the (no-longer-verifiable) original token (cancel)'
    )
    // 再用一个完全无关的随机 token 试一次，确认不是"刚好这个 token 不对"，而是 null hash 本身就全拒。
    await expectRejects(
      () => service.getStatus(created.scanTaskId, null, randomBytes(24).toString('hex')),
      ForbiddenException,
      'legacy row with null controlTokenHash must reject an unrelated token too (status)'
    )
  }

  {
    // 已完成任务不能取消（cancel() 在 CAS 之前就做了 completed 前置检查）
    const { service } = makeService()
    const created = await service.create(dto, null)
    await service.deliverScanFile({
      terminalId: 't_1',
      buffer: tinyPdf(),
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    await expectRejects(
      () => service.cancel(created.scanTaskId, null, created.controlToken),
      BadRequestException,
      'completed task cannot be cancelled'
    )
  }

  {
    // 不存在的任务查询 / 取消都应 404（404 判定必须先于 controlToken 校验：
    // 这里刻意不传 controlToken，证明缺 token 不会把本该是 404 的响应变成别的错误码）。
    const { service } = makeService()
    await expectRejects(
      () => service.getStatus('missing', null, undefined),
      NotFoundException,
      'status not found'
    )
    await expectRejects(
      () => service.cancel('missing', null, undefined),
      NotFoundException,
      'cancel not found'
    )
  }

  {
    // scanType -> FilePurpose 映射正确（id 扫描必须落 id_scan，不能落成通用 print_doc）
    const { service, prisma } = makeService()
    const created = await service.create({ scanType: 'id', terminalId: 't_1' }, null)
    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: tinyPdf(),
      filename: 'id.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    const file = prisma.filesById.get(delivered.fileId)
    assert.equal(file?.purpose, 'id_scan')
    void created
  }

  {
    // scanType -> FilePurpose 映射正确（resume 扫描必须落 resume_scan）
    const { service, prisma } = makeService()
    const created = await service.create({ scanType: 'resume', terminalId: 't_1' }, null)
    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: tinyPdf(),
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    const file = prisma.filesById.get(delivered.fileId)
    assert.equal(file?.purpose, 'resume_scan')
    void created
  }

  {
    // create() 的终端查找同时支持传内部 id 或人类可读的 terminalCode（如 'T-001'）。
    const { service, prisma } = makeService()
    const created = await service.create({ scanType: 'document', terminalId: 'T-001' }, null)
    assert.ok(created.scanTaskId, 'must succeed when terminalId is actually a terminalCode')
    const task = prisma.scanTasksById.get(created.scanTaskId)
    assert.equal(
      task?.terminalId,
      't_1',
      'resolved terminalId must be the internal id, not the raw terminalCode'
    )
  }

  {
    // deliverScanFile 的 catch 分支:this.files.upload() 抛错时，任务落 failed +
    // errorCode: 'SCAN_UPLOAD_FAILED'。原始错误只 rethrow 给 Agent，DB 与 getStatus()
    // 都只保留 USER_FACING_SCAN_ERROR 白名单文案，绝不能把原始错误信息透出给用户。
    const prisma = new FakePrisma()
    const throwingFiles = {
      upload: async (): Promise<never> => {
        throw new Error('ENOSPC: disk full — this raw detail must never reach the user')
      },
    }
    const service = wrapServiceForTest(
      new ScanTasksService(
        prisma as never,
        throwingFiles as never,
        passthroughCapabilities
      )
    )
    const created = await service.create(dto, null)

    await expectRejects(
      () =>
        service.deliverScanFile({
          terminalId: 't_1',
          buffer: tinyPdf(),
          filename: 'broken.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      Error,
      'deliverScanFile must rethrow the original upload error'
    )

    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(status.status, 'failed')
    assert.equal(status.errorCode, 'SCAN_UPLOAD_FAILED')
    assert.equal(
      status.errorMessage,
      '扫描文件处理失败，请重新扫描',
      'errorMessage must be the whitelisted user-facing string, not the raw thrown error message'
    )
    const failedRow = prisma.scanTasksById.get(created.scanTaskId)!
    assert.equal(
      failedRow.errorMessage,
      '扫描文件处理失败，请重新扫描',
      'DB errorMessage must store the whitelist text, not the raw upload error'
    )
    assert.ok(
      failedRow.retryAuthorityExpiresAt && failedRow.retryAuthorityExpiresAt.getTime() > Date.now(),
      'upload failure after matching must atomically mint retry authority'
    )
    const retryAfterUploadFailure = await service.create(
      { ...dto, retryOfScanTaskId: created.scanTaskId },
      null,
      created.controlToken
    )
    assert.equal(
      prisma.scanTasksById.get(created.scanTaskId)?.retryConsumedByScanTaskId,
      retryAfterUploadFailure.scanTaskId,
      'matched upload failure must authorize exactly one identical-content retry'
    )
    const fixedAuthorityExpiry = failedRow.retryAuthorityExpiresAt!.getTime()
    await prisma.scanTask.updateMany({
      where: { id: created.scanTaskId, status: 'failed' },
      data: { errorMessage: 'unrelated follow-up write' },
    })
    assert.equal(
      prisma.scanTasksById.get(created.scanTaskId)?.retryAuthorityExpiresAt?.getTime(),
      fixedAuthorityExpiry,
      'an unrelated update that bumps updatedAt must not extend retry authority expiry'
    )
  }

  {
    // cancel() only admits waiting/matched. Its CAS pins the exact state and hash snapshot,
    // so a matched task remains cancellable without allowing terminal states to be rewritten.
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    const task = prisma.scanTasksById.get(created.scanTaskId)!
    prisma.scanTasksById.set(created.scanTaskId, {
      ...task,
      status: 'matched',
      lastAttemptHash: createHash('sha256').update(tinyPdf()).digest('hex'),
    })
    const cancelled = await service.cancel(created.scanTaskId, null, created.controlToken)
    assert.equal(cancelled.status, 'cancelled')
    assert.ok(
      prisma.scanTasksById.get(created.scanTaskId)?.retryAuthorityExpiresAt,
      'cancelling a matched task with lastAttemptHash must atomically mint retry authority'
    )
    const retryAfterMatchedCancel = await service.create(
      { ...dto, retryOfScanTaskId: created.scanTaskId },
      null,
      created.controlToken
    )
    assert.equal(
      prisma.scanTasksById.get(created.scanTaskId)?.retryConsumedByScanTaskId,
      retryAfterMatchedCancel.scanTaskId,
      'matched cancellation with lastAttemptHash must authorize exactly one retry'
    )
  }

  {
    for (const terminalStatus of ['failed', 'expired', 'cancelled'] as const) {
      const { service, prisma } = makeService()
      const created = await service.create(dto, null)
      const task = prisma.scanTasksById.get(created.scanTaskId)!
      prisma.scanTasksById.set(created.scanTaskId, { ...task, status: terminalStatus })
      await expectRejectCode(
        () => service.cancel(created.scanTaskId, null, created.controlToken),
        ConflictException,
        'SCAN_TASK_CANCEL_CONFLICT',
        `${terminalStatus} task must not be rewritten by cancel()`
      )
      assert.equal(prisma.scanTasksById.get(created.scanTaskId)?.status, terminalStatus)
    }
  }

  {
    // 取消后的任务不再是 waiting，不能被后续投递误撞；投递必须匹配到之后新建的会话。
    const { service, prisma } = makeService()
    const first = await service.create(dto, null)
    const cancelled = await service.cancel(first.scanTaskId, null, first.controlToken)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(
      prisma.scanTasksById.get(first.scanTaskId)?.retryAuthorityExpiresAt,
      null,
      'waiting cancellation without lastAttemptHash must not mint retry authority'
    )
    await expectRejectCode(
      () =>
        service.create(
          { ...dto, retryOfScanTaskId: first.scanTaskId },
          null,
          first.controlToken
        ),
      ForbiddenException,
      'SCAN_RETRY_NOT_AUTHORIZED',
      'waiting cancellation must not authorize a content-bound retry'
    )
    const second = await service.create(dto, null)
    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: tinyPdf(),
      filename: 'fresh.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(
      delivered.scanTaskId,
      second.scanTaskId,
      'delivery must match the fresh session, not the cancelled one'
    )
  }

  {
    // deliverScanFile 完成 CAS：文件上传成功后如果任务在此期间被并发取消（模拟：upload 回调里
    // 直接把任务状态改成 cancelled），完成写入 `updateMany({where:{status:'matched'}})` 必须命中 0 行，
    // 诚实抛 409 ConflictException（SCAN_TASK_STATE_CHANGED），不得静默把文件挂到一个已取消的任务上，
    // 也不能假装投递成功。
    //
    // B1-6：既然文件已经真实上传成功却挂不上任务，deliverScanFile() 必须调用
    // FilesService.systemDelete() 补偿删除这个孤儿文件——断言 systemDelete 真的被调用，
    // 且传入的 fileId 正是刚上传出来的那个（不是随便一个值），并且文件在存储层真的被标记删除了
    // （不是只调用了方法但没有实际效果）。
    const prisma = new FakePrisma()
    const baseFiles = new FakeFilesService(prisma)
    let raceScanTaskId = ''
    const racyFiles = {
      upload: async (args: Parameters<FakeFilesService['upload']>[0]) => {
        const result = await baseFiles.upload(args)
        const task = prisma.scanTasksById.get(raceScanTaskId)!
        prisma.scanTasksById.set(raceScanTaskId, { ...task, status: 'cancelled' })
        return result
      },
      systemDelete: (fileId: string, reason: string) => baseFiles.systemDelete(fileId, reason),
    }
    const service = wrapServiceForTest(
      new ScanTasksService(
        prisma as never,
        racyFiles as never,
        passthroughCapabilities
      )
    )
    const created = await service.create(dto, null)
    raceScanTaskId = created.scanTaskId

    await expectRejects(
      () =>
        service.deliverScanFile({
          terminalId: 't_1',
          buffer: tinyPdf(),
          filename: 'race.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      ConflictException,
      'deliver must refuse to complete a task cancelled during upload'
    )

    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(
      status.status,
      'cancelled',
      'task must remain cancelled, not silently marked completed'
    )

    assert.equal(
      baseFiles.systemDeleteCalls.length,
      1,
      'orphaned file must be compensating-deleted exactly once via FilesService.systemDelete()'
    )
    const orphanedFileId = baseFiles.systemDeleteCalls[0]!.fileId
    assert.ok(
      orphanedFileId.startsWith('file_'),
      'systemDelete must be called with the real uploaded fileId, not a placeholder'
    )
    assert.equal(
      baseFiles.systemDeleteCalls[0]!.reason,
      'ScanTask cancelled during upload, compensating orphaned file',
      'reason string must be diagnostic, not empty/generic'
    )
    const orphanedFileRecord = prisma.filesById.get(orphanedFileId)
    assert.ok(
      orphanedFileRecord?.deletedAt,
      'orphaned FileObject must actually be marked deleted, not just have systemDelete() invoked without effect'
    )
  }

  {
    // B1-6：补偿删除本身失败时（例如文件已经被其它路径清理掉，systemDelete() 内部
    // requireAlive() 抛 NotFoundException），deliverScanFile() 原本要走的 409
    // SCAN_TASK_STATE_CHANGED 取消响应流程绝不能被 systemDelete 的异常打断或替换掉——
    // 调用方必须依然看到 ConflictException，而不是 systemDelete 抛出的 NotFoundException
    // 泄漏出来变成一个未预期的错误类型。
    const prisma = new FakePrisma()
    const baseFiles = new FakeFilesService(prisma)
    let raceScanTaskId = ''
    let systemDeleteCallCount = 0
    const racyFiles = {
      upload: async (args: Parameters<FakeFilesService['upload']>[0]) => {
        const result = await baseFiles.upload(args)
        const task = prisma.scanTasksById.get(raceScanTaskId)!
        prisma.scanTasksById.set(raceScanTaskId, { ...task, status: 'cancelled' })
        return result
      },
      systemDelete: async (): Promise<never> => {
        systemDeleteCallCount += 1
        throw new NotFoundException({
          error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' },
        })
      },
    }
    const service = wrapServiceForTest(
      new ScanTasksService(
        prisma as never,
        racyFiles as never,
        passthroughCapabilities
      )
    )
    const created = await service.create(dto, null)
    raceScanTaskId = created.scanTaskId

    await expectRejects(
      () =>
        service.deliverScanFile({
          terminalId: 't_1',
          buffer: tinyPdf(),
          filename: 'race-cleanup-fails.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      ConflictException,
      'original SCAN_TASK_STATE_CHANGED conflict must still surface even when compensating systemDelete() itself throws'
    )

    assert.equal(
      systemDeleteCallCount,
      1,
      'systemDelete must have actually been attempted (not skipped)'
    )

    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(
      status.status,
      'cancelled',
      'original cancel-response flow must proceed normally (task stays cancelled) despite the compensating delete failing'
    )
  }

  {
    // cancel() 自身的 CAS 竞态分支：读取时任务还是 waiting/matched（早前检查全部放行），
    // 但在 CAS 的 updateMany 落地前状态被并发改成了 CAS 不认的值（例如刚好过期/被其它路径终结），
    // 导致 updateMany 命中 0 行——此时 cancel() 必须重新读取真实状态，
    // 由于它不是 completed，应诚实抛 409 SCAN_TASK_CANCEL_CONFLICT，而不是谎称取消成功。
    //
    // 模拟手法：monkey-patch FakePrisma.scanTask.updateMany，让它的第一次调用无条件返回
    // { count: 0 }（相当于"别人刚好赢了这场竞态"），同时底层任务真实状态仍是 waiting，
    // 之后的调用恢复原始实现。这样断言真正依赖 cancel() 自己的重读分支，
    // 而不是复用 create()/deliverScanFile() 的其它 CAS 路径。
    const prisma = new FakePrisma()
    const files = new FakeFilesService(prisma)
    const originalUpdateMany = prisma.scanTask.updateMany.bind(prisma.scanTask)
    let updateManyCallCount = 0
    prisma.scanTask.updateMany = (async (args: Parameters<typeof originalUpdateMany>[0]) => {
      updateManyCallCount += 1
      if (updateManyCallCount === 1) {
        return { count: 0 }
      }
      return originalUpdateMany(args)
    }) as typeof originalUpdateMany

    const service = new ScanTasksService(prisma as never, files as never, passthroughCapabilities)
    const created = await service.create(dto, null)
    assert.equal(prisma.scanTasksById.get(created.scanTaskId)?.status, 'waiting')

    let caught: unknown
    try {
      await service.cancel(created.scanTaskId, null, created.controlToken)
    } catch (error) {
      caught = error
    }
    assert.ok(
      caught instanceof ConflictException,
      `cancel CAS conflict: expected ConflictException, got ${(caught as Error)?.constructor.name}`
    )
    const responseBody = (caught as ConflictException).getResponse() as {
      error?: { code?: string }
    }
    assert.equal(
      responseBody.error?.code,
      'SCAN_TASK_CANCEL_CONFLICT',
      'cancel CAS conflict must report SCAN_TASK_CANCEL_CONFLICT, not silently succeed or report a different code'
    )
  }

  {
    // B1-5：ScanTaskReaperTask 收敛卡在 'matched' 状态太久的任务。
    // 三条互相制衡的断言，专门防"看起来在跑但其实什么都没测出来"：
    //   1) 超过阈值(3min)的 'matched' 任务必须被 reap 成 failed + SCAN_MATCHED_TIMEOUT
    //      ——防"reaper 是个空实现/永远不生效"；
    //   2) 未超过阈值的 'matched' 任务必须原样保留
    //      ——防"reaper 不看 updatedAt，把所有 matched 任务不分青红皂白全部 reap"；
    //   3) 同样很旧但状态是 'waiting' 的任务必须原样保留
    //      ——防"reaper 的 where 条件漏掉了 status 过滤，把不相干状态也一起扫了"。
    const { service, prisma } = makeService()
    const reaper = new ScanTaskReaperTask(prisma as never)

    const stale = await service.create(dto, null)
    await prisma.scanTask.updateMany({
      where: { id: stale.scanTaskId, status: 'waiting' },
      data: { status: 'matched' },
    })
    const staleStored = prisma.scanTasksById.get(stale.scanTaskId)!
    // 4 分钟前——超过 reaper 的 3 分钟阈值。
    prisma.scanTasksById.set(stale.scanTaskId, {
      ...staleStored,
      lastAttemptHash: createHash('sha256').update(tinyPdf()).digest('hex'),
      updatedAt: new Date(Date.now() - 4 * 60 * 1000),
    })

    const fresh = await service.create(dto, null)
    await prisma.scanTask.updateMany({
      where: { id: fresh.scanTaskId, status: 'waiting' },
      data: { status: 'matched' },
    })
    // fresh 保持刚更新的 updatedAt（现在），在阈值内。

    const oldWaiting = await service.create(dto, null)
    const oldWaitingStored = prisma.scanTasksById.get(oldWaiting.scanTaskId)!
    // 同样很旧（早于阈值），但状态仍是 'waiting'，不应被这个 reaper 触碰
    // （'waiting' 的过期收敛是另一条既有的惰性过期路径，不归 B1-5 管）。
    prisma.scanTasksById.set(oldWaiting.scanTaskId, {
      ...oldWaitingStored,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    })

    await reaper.reapStuckMatched()

    const staleAfter = prisma.scanTasksById.get(stale.scanTaskId)!
    assert.equal(staleAfter.status, 'failed', 'stale matched task (>3min) must be reaped to failed')
    assert.equal(
      staleAfter.errorCode,
      'SCAN_MATCHED_TIMEOUT',
      'reaped task must carry errorCode SCAN_MATCHED_TIMEOUT'
    )
    assert.ok(
      staleAfter.retryAuthorityExpiresAt && staleAfter.retryAuthorityExpiresAt.getTime() > Date.now(),
      'matched timeout with lastAttemptHash must atomically mint retry authority'
    )

    // errorMessage 必须经 service.getStatus() 校验，而不是直接读裸 Prisma 行：getStatus() 会把
    // errorCode 映射过 USER_FACING_SCAN_ERROR 白名单，raw DB 行只是 reaper 自己写入的中间态，
    // 不代表用户最终能看到什么。这里镜像既有 SCAN_UPLOAD_FAILED 用例的写法（本文件上方
    // "deliverScanFile 的 catch 分支" 那个测试块），是唯一真正锁定"reaper 写的 errorCode
    // 必须在白名单里登记"这条要求的断言——如果 SCAN_MATCHED_TIMEOUT 没有登记进
    // USER_FACING_SCAN_ERROR，getStatus() 会 fallback 成通用文案，这里就会失败。
    const staleStatus = await service.getStatus(stale.scanTaskId, null, stale.controlToken)
    assert.equal(staleStatus.status, 'failed')
    assert.equal(staleStatus.errorCode, 'SCAN_MATCHED_TIMEOUT')
    assert.equal(
      staleStatus.errorMessage,
      '扫描处理超时未完成',
      'getStatus() must return the whitelisted user-facing errorMessage for a reaped task, not the generic fallback'
    )

    const freshAfter = prisma.scanTasksById.get(fresh.scanTaskId)!
    assert.equal(
      freshAfter.status,
      'matched',
      'fresh matched task (<3min) must NOT be touched by the reaper'
    )

    const oldWaitingAfter = prisma.scanTasksById.get(oldWaiting.scanTaskId)!
    assert.equal(
      oldWaitingAfter.status,
      'waiting',
      "old 'waiting' task must NOT be touched by the matched-state reaper"
    )

    // 再跑一次：此时已经没有符合条件的任务了，必须是稳定的 no-op（不重复收敛、不抛错），
    // 防止 reaper 对已经是 failed 的任务重复计数或异常。
    const staleAfterFirstRun = { ...staleAfter }
    await reaper.reapStuckMatched()
    const staleAfterSecondRun = prisma.scanTasksById.get(stale.scanTaskId)!
    assert.equal(
      staleAfterSecondRun.status,
      'failed',
      'already-reaped task must remain failed on a second run'
    )
    assert.equal(
      staleAfterSecondRun.errorCode,
      staleAfterFirstRun.errorCode,
      'second no-op run must not mutate an already-reaped task again'
    )
    assert.equal(
      staleAfterSecondRun.retryAuthorityExpiresAt?.getTime(),
      staleAfterFirstRun.retryAuthorityExpiresAt?.getTime(),
      'a later reaper pass must not extend an already minted retry authority'
    )

    const noHash = await service.create(dto, null)
    const noHashStored = prisma.scanTasksById.get(noHash.scanTaskId)!
    prisma.scanTasksById.set(noHash.scanTaskId, {
      ...noHashStored,
      status: 'matched',
      lastAttemptHash: null,
      updatedAt: new Date(Date.now() - 4 * 60 * 1000),
    })
    await reaper.reapStuckMatched()
    const noHashAfter = prisma.scanTasksById.get(noHash.scanTaskId)!
    assert.equal(noHashAfter.status, 'failed')
    assert.equal(
      noHashAfter.retryAuthorityExpiresAt,
      null,
      'matched timeout without lastAttemptHash must not mint usable retry authority'
    )
  }

  {
    // B1-5 补充：同一 tick 内、跨不同终端的多条卡死 'matched' 任务必须被一次 reapStuckMatched()
    // 调用全部收敛（而不是只处理其中一条就停手，或者需要多次调用才能收敛干净）。
    // 用两个不同终端（t_1 / t_2）分别制造一条陈旧 'matched' 行，证明 reaper 的 updateMany 是
    // 批量 WHERE 匹配，不是逐条处理后提前 return。
    const { service, prisma } = makeService()
    const reaper = new ScanTaskReaperTask(prisma as never)

    const staleA = await service.create({ scanType: 'document', terminalId: 't_1' }, null)
    await prisma.scanTask.updateMany({
      where: { id: staleA.scanTaskId, status: 'waiting' },
      data: { status: 'matched' },
    })
    const staleAStored = prisma.scanTasksById.get(staleA.scanTaskId)!
    prisma.scanTasksById.set(staleA.scanTaskId, {
      ...staleAStored,
      updatedAt: new Date(Date.now() - 4 * 60 * 1000),
    })

    const staleB = await service.create({ scanType: 'document', terminalId: 't_2' }, null)
    await prisma.scanTask.updateMany({
      where: { id: staleB.scanTaskId, status: 'waiting' },
      data: { status: 'matched' },
    })
    const staleBStored = prisma.scanTasksById.get(staleB.scanTaskId)!
    prisma.scanTasksById.set(staleB.scanTaskId, {
      ...staleBStored,
      updatedAt: new Date(Date.now() - 5 * 60 * 1000),
    })

    const result = await reaper.reapStuckMatched()
    assert.equal(
      result.count,
      2,
      'a single reap tick must report reaping both independently-stale matched rows across two terminals'
    )

    const staleAAfter = prisma.scanTasksById.get(staleA.scanTaskId)!
    const staleBAfter = prisma.scanTasksById.get(staleB.scanTaskId)!
    assert.equal(
      staleAAfter.status,
      'failed',
      'terminal t_1 stale matched task must be reaped in the same tick'
    )
    assert.equal(
      staleBAfter.status,
      'failed',
      'terminal t_2 stale matched task must be reaped in the same tick'
    )
    assert.equal(staleAAfter.errorCode, 'SCAN_MATCHED_TIMEOUT')
    assert.equal(staleBAfter.errorCode, 'SCAN_MATCHED_TIMEOUT')
  }

  {
    // waiting 过期 reaper：只把 expiresAt<=now 的 waiting 条件更新为 expired；
    // 未到期 waiting、以及 matched/completed/cancelled/failed（即使 expiresAt 已过）都不得改写。
    // 跑完 waiting reaper 后，matched stale reaper 仍必须能独立收敛卡死的 matched 行。
    const { service, prisma } = makeService()
    const reaper = new ScanTaskReaperTask(prisma as never)
    const past = new Date(Date.now() - 1000)
    const future = new Date(Date.now() + 60_000)

    const expiredWaiting = await service.create({ scanType: 'document', terminalId: 't_1' }, null)
    prisma.scanTasksById.set(expiredWaiting.scanTaskId, {
      ...prisma.scanTasksById.get(expiredWaiting.scanTaskId)!,
      expiresAt: past,
    })

    const futureWaiting = await service.create({ scanType: 'document', terminalId: 't_2' }, null)
    prisma.scanTasksById.set(futureWaiting.scanTaskId, {
      ...prisma.scanTasksById.get(futureWaiting.scanTaskId)!,
      expiresAt: future,
    })

    const seed = async (
      status: 'matched' | 'completed' | 'cancelled' | 'failed',
      extra?: Partial<StoredScanTask>
    ): Promise<string> => {
      const created = await service.create({ scanType: 'document', terminalId: 't_1' }, null)
      prisma.scanTasksById.set(created.scanTaskId, {
        ...prisma.scanTasksById.get(created.scanTaskId)!,
        status,
        expiresAt: past,
        ...extra,
      })
      return created.scanTaskId
    }

    const matchedPastExpiryId = await seed('matched')
    const completedPastExpiryId = await seed('completed')
    const cancelledPastExpiryId = await seed('cancelled')
    const failedPastExpiryId = await seed('failed')
    const staleMatchedId = await seed('matched', {
      updatedAt: new Date(Date.now() - 4 * 60 * 1000),
      expiresAt: future,
    })

    const waitingResult = await reaper.reapExpiredWaiting()
    assert.equal(
      waitingResult.count,
      1,
      `waiting reaper must hit exactly the expired waiting row, got ${waitingResult.count}`
    )
    assert.equal(
      prisma.scanTasksById.get(expiredWaiting.scanTaskId)?.status,
      'expired',
      'expired waiting row must be reaped to expired'
    )
    assert.equal(
      prisma.scanTasksById.get(expiredWaiting.scanTaskId)?.retryAuthorityExpiresAt,
      null,
      'waiting expiry reaper must not mint retry authority'
    )
    await expectRejectCode(
      () =>
        service.create(
          { scanType: 'document', terminalId: 't_1', retryOfScanTaskId: expiredWaiting.scanTaskId },
          null,
          expiredWaiting.controlToken
        ),
      ForbiddenException,
      'SCAN_RETRY_NOT_AUTHORIZED',
      'waiting expiry reaper must not authorize a content-bound retry'
    )
    assert.equal(
      prisma.scanTasksById.get(futureWaiting.scanTaskId)?.status,
      'waiting',
      'future waiting row must not be touched by the waiting reaper'
    )
    assert.equal(
      prisma.scanTasksById.get(matchedPastExpiryId)?.status,
      'matched',
      'waiting reaper must not rewrite matched rows'
    )
    assert.equal(
      prisma.scanTasksById.get(completedPastExpiryId)?.status,
      'completed',
      'waiting reaper must not rewrite completed rows'
    )
    assert.equal(
      prisma.scanTasksById.get(cancelledPastExpiryId)?.status,
      'cancelled',
      'waiting reaper must not rewrite cancelled rows'
    )
    assert.equal(
      prisma.scanTasksById.get(failedPastExpiryId)?.status,
      'failed',
      'waiting reaper must not rewrite failed rows'
    )
    assert.equal(
      prisma.scanTasksById.get(staleMatchedId)?.status,
      'matched',
      'waiting reaper must leave stale matched rows for the matched reaper'
    )

    const secondOnSameTerminal = await service.create(
      { scanType: 'document', terminalId: 't_1' },
      null
    )
    assert.ok(
      secondOnSameTerminal.scanTaskId,
      'same terminal must be able to create after the expired waiting row was reaped'
    )
    assert.notEqual(secondOnSameTerminal.scanTaskId, expiredWaiting.scanTaskId)

    const matchedResult = await reaper.reapStuckMatched()
    assert.equal(
      matchedResult.count,
      1,
      'matched stale reaper must still converge the stale matched row after waiting reap'
    )
    assert.equal(
      prisma.scanTasksById.get(staleMatchedId)?.status,
      'failed',
      'stale matched row must still be reaped to failed'
    )
    assert.equal(
      prisma.scanTasksById.get(matchedPastExpiryId)?.status,
      'matched',
      'fresh matched row must remain unmatched by the matched stale reaper'
    )

    const waitingSecondRun = await reaper.reapExpiredWaiting()
    assert.equal(waitingSecondRun.count, 0, 'second waiting reap must be a stable no-op')
    assert.equal(
      prisma.scanTasksById.get(expiredWaiting.scanTaskId)?.status,
      'expired',
      'already-expired waiting row must stay expired on a second waiting reap'
    )
  }

  {
    // B1-10：deliverScanFile() 必须在 CAS-to-matched 成功后、上传真正开始前就武装
    // 'matched' 心跳，并且无论上传成功、还是抛异常，都必须在 finally 里清掉这个定时器——
    // 遗漏会让每一次扫描投递都泄漏一个 setInterval。
    //
    // 用 spy 替换 private startMatchedHeartbeat()（TS 的 private 只是编译期限制，运行时
    // 可以直接赋值覆盖）返回一个可辨识的哨兵句柄而不真的起定时器；spy 全局 clearInterval
    // 记录传入的句柄；upload 内部记录调用时刻心跳是否已经被武装——三者合起来断言"武装
    // 时机"（早于 upload）和"清除时机"（成功/失败都发生且恰好一次），不依赖真实定时器
    // 触发，跑得快且完全确定。
    const clearedHandles: unknown[] = []
    const originalClearInterval = global.clearInterval
    global.clearInterval = ((handle: unknown) => {
      clearedHandles.push(handle)
    }) as typeof global.clearInterval

    try {
      {
        // 成功路径
        const prisma = new FakePrisma()
        const baseFiles = new FakeFilesService(prisma)
        const heartbeatCalls: string[] = []
        let armedBeforeUploadStarted = false
        const sentinelHandle = { tag: 'heartbeat-success' } as unknown as NodeJS.Timeout
        const observingFiles = {
          upload: async (args: Parameters<FakeFilesService['upload']>[0]) => {
            armedBeforeUploadStarted = heartbeatCalls.length === 1
            return baseFiles.upload(args)
          },
        }
        const service = wrapServiceForTest(
          new ScanTasksService(
            prisma as never,
            observingFiles as never,
            passthroughCapabilities
          )
        )
        ;(service as unknown as HeartbeatTestAccess).startMatchedHeartbeat = (id: string) => {
          heartbeatCalls.push(id)
          return sentinelHandle
        }

        const created = await service.create(dto, null)
        await service.deliverScanFile({
          terminalId: 't_1',
          buffer: tinyPdf(),
          filename: 'heartbeat.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        })

        assert.equal(
          heartbeatCalls.length,
          1,
          'startMatchedHeartbeat must be called exactly once per deliverScanFile()'
        )
        assert.equal(
          heartbeatCalls[0],
          created.scanTaskId,
          'heartbeat must be armed for the matched task id'
        )
        assert.ok(
          armedBeforeUploadStarted,
          'heartbeat must be armed before FilesService.upload() begins, not after'
        )
        assert.equal(
          clearedHandles.length,
          1,
          'heartbeat handle must be cleared exactly once on the success path'
        )
        assert.equal(
          clearedHandles[0],
          sentinelHandle,
          'clearInterval must be called with the exact handle startMatchedHeartbeat returned'
        )
      }

      {
        // 失败路径（upload 抛异常）——finally 保证依然要清心跳，且原有的 SCAN_UPLOAD_FAILED
        // 标记流程不受影响。
        clearedHandles.length = 0
        const prisma = new FakePrisma()
        const sentinelHandle = { tag: 'heartbeat-failure' } as unknown as NodeJS.Timeout
        const throwingFiles = {
          upload: async (): Promise<never> => {
            throw new Error('simulated upload failure')
          },
        }
        const service = wrapServiceForTest(
          new ScanTasksService(
            prisma as never,
            throwingFiles as never,
            passthroughCapabilities
          )
        )
        ;(service as unknown as HeartbeatTestAccess).startMatchedHeartbeat = () => sentinelHandle

        await service.create(dto, null)
        await expectRejects(
          () =>
            service.deliverScanFile({
              terminalId: 't_1',
              buffer: tinyPdf(),
              filename: 'heartbeat-fail.pdf',
              mimeType: 'application/pdf',
              observedAt: new Date().toISOString(),
            }),
          Error,
          'upload failure must still propagate'
        )
        assert.equal(
          clearedHandles.length,
          1,
          'heartbeat handle must be cleared exactly once even when upload throws (finally guarantee)'
        )
        assert.equal(clearedHandles[0], sentinelHandle)
      }
    } finally {
      global.clearInterval = originalClearInterval
    }
  }

  {
    // B1-10 补充：心跳的真实实现（不是上面的 spy）必须满足两条设计约束：
    //   1) 单次心跳写入失败（例如瞬时 DB 抖动）不能抛出、不能让后续 tick 停摆——
    //      只降级为 warn 日志，继续下一次 tick；
    //   2) where 条件必须与 reaper 一致（status: 'matched'）：任务如果已经并发转移到
    //      其它终态，心跳只能安静 no-op，不能把它"复活"回 matched，也不能报错。
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    await prisma.scanTask.updateMany({
      where: { id: created.scanTaskId, status: 'waiting' },
      data: { status: 'matched' },
    })

    const originalUpdateMany = prisma.scanTask.updateMany.bind(prisma.scanTask)
    let tickCount = 0
    prisma.scanTask.updateMany = (async (args: Parameters<typeof originalUpdateMany>[0]) => {
      tickCount += 1
      if (tickCount === 1) {
        throw new Error('simulated transient DB hiccup on first heartbeat tick')
      }
      return originalUpdateMany(args)
    }) as typeof originalUpdateMany

    const beforeTicks = prisma.scanTasksById.get(created.scanTaskId)!.updatedAt.getTime()
    const heartbeat = (service as unknown as HeartbeatTestAccess).startMatchedHeartbeat(
      created.scanTaskId,
      15
    )
    // 生产间隔是 60s；这里用 15ms 只是为了在几十毫秒内验证机制本身会真的多次 tick，不用等 60s。
    await sleep(80)
    clearInterval(heartbeat)

    assert.ok(
      tickCount >= 2,
      `heartbeat must have ticked more than once within the wait window (got ${tickCount}); a single failed tick must not stop subsequent ticks`
    )
    const afterTicks = prisma.scanTasksById.get(created.scanTaskId)!
    assert.ok(
      afterTicks.updatedAt.getTime() > beforeTicks,
      'updatedAt must have been bumped by a later successful tick despite the first tick throwing'
    )
    assert.equal(afterTicks.status, 'matched', 'heartbeat must not alter status, only updatedAt')

    prisma.scanTask.updateMany = originalUpdateMany as typeof prisma.scanTask.updateMany

    // 并发把任务状态改成 'cancelled'（模拟用户在上传过程中取消），确认心跳下一轮 tick 是
    // 安静的 no-op：updatedAt 不再被心跳刷新，status 不被心跳篡改回 matched。
    prisma.scanTasksById.set(created.scanTaskId, { ...afterTicks, status: 'cancelled' })
    const cancelledSnapshotUpdatedAt = afterTicks.updatedAt.getTime()
    const heartbeat2 = (service as unknown as HeartbeatTestAccess).startMatchedHeartbeat(
      created.scanTaskId,
      15
    )
    await sleep(60)
    clearInterval(heartbeat2)

    const afterCancelledTicks = prisma.scanTasksById.get(created.scanTaskId)!
    assert.equal(
      afterCancelledTicks.status,
      'cancelled',
      'heartbeat must never resurrect a task that concurrently left the matched state'
    )
    assert.equal(
      afterCancelledTicks.updatedAt.getTime(),
      cancelledSnapshotUpdatedAt,
      "heartbeat's where:{status:'matched'} must make ticks a true no-op once the task is no longer matched — updatedAt must not move"
    )
  }

  {
    // B1-10：真实数据库验证——见 assertRealDbMatchedHeartbeatClosesRace() 顶部注释：
    // 真实 reaper（未改 3 分钟阈值）+ 真实 startMatchedHeartbeat()，证明本次修复关闭的
    // "慢但存活的上传被 reaper 误杀"竞态，同时证明"真正卡死的任务依然会被正确收敛"。
    const apiRoot = path.resolve(__dirname, '..')
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'verify-scan-tasks-realdb-heartbeat-'))
    const dbPath = path.join(tmpDir, 'verify.db')
    const dbUrl = `file:${dbPath}`
    try {
      ensureSqliteFile(dbPath)
      runPrisma(apiRoot, ['migrate', 'deploy'], { ...process.env, DATABASE_URL: dbUrl })
      await assertRealDbMatchedHeartbeatClosesRace(dbUrl)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  {
    // B1-11（点 4 边缘案例修复）：内容级去重必须真正拦住"同一份文件内容对同一终端重复
    // 投递"——模拟"投递其实已经在服务端成功，只是 HTTP 响应在回传给 Agent 途中丢失，
    // Agent 把它当成失败重试"的场景：第一次投递真正建档完成，第二次投递携带完全相同的
    // 字节，此时该终端已经有一条全新的（属于另一个用户的）waiting 任务在等——如果没有
    // 这层去重，第二次投递会被误判成"新的合法投递"，把第一个用户的内容错误挂到第二个
    // 用户的任务上。
    const { service, prisma } = makeService()
    const buffer = tinyPdf()

    const taskA = await service.create(dto, 'member_a')
    const deliveredA = await service.deliverScanFile({
      terminalId: 't_1',
      buffer,
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(deliveredA.scanTaskId, taskA.scanTaskId)

    // 模拟场景：另一个用户（member_b）在同一物理终端开了一个全新的等待中任务。
    const taskB = await service.create(dto, 'member_b')

    let caught: unknown
    try {
      await service.deliverScanFile({
        terminalId: 't_1',
        buffer,
        filename: 'a-retry.pdf',
        mimeType: 'application/pdf',
        observedAt: new Date().toISOString(),
      })
    } catch (error) {
      caught = error
    }
    assert.ok(
      caught instanceof ConflictException,
      `duplicate content delivery (same bytes, retried after original success) must be rejected, not silently matched to a new task — got ${(caught as Error)?.constructor?.name}`
    )
    const responseBody = (caught as ConflictException).getResponse() as {
      error?: { code?: string }
    }
    assert.equal(
      responseBody.error?.code,
      'SCAN_FILE_ALREADY_DELIVERED',
      'duplicate content rejection must report the specific SCAN_FILE_ALREADY_DELIVERED code, not a generic conflict'
    )

    // taskB 必须原封不动地保持 waiting——绝不能被这次重复投递偷走匹配、挂上别人的文件。
    const taskBAfter = prisma.scanTasksById.get(taskB.scanTaskId)!
    assert.equal(
      taskBAfter.status,
      'waiting',
      'the duplicate-content delivery must NOT consume/match an unrelated waiting task belonging to a different user'
    )
    assert.equal(
      taskBAfter.fileId,
      null,
      'the unrelated waiting task must not end up with any fileId attached'
    )
  }

  {
    // 回归护栏：内容去重绝不能变成"同一终端连续两次投递就一律拒绝"——必须精确按字节
    // 内容判断，两次内容不同的合法投递都必须正常成功，不能被误伤。
    const { service } = makeService()
    const taskA = await service.create(dto, null)
    const deliveredA = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: tinyPdf(),
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(deliveredA.scanTaskId, taskA.scanTaskId)

    const taskB = await service.create(dto, null)
    const differentBuffer = Buffer.from(
      '%PDF-1.4\ncompletely different content, not a duplicate\n%%EOF\n',
      'latin1'
    )
    const deliveredB = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: differentBuffer,
      filename: 'b.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(
      deliveredB.scanTaskId,
      taskB.scanTaskId,
      'a second delivery with genuinely different content must succeed normally, not be blocked by the dedup guard'
    )
  }

  {
    // 去重窗口边界：SCAN_CONTENT_DEDUP_WINDOW_MS（2 小时，刻意与 Agent 侧
    // DELIVERY_RETRY_MAX_MS 对齐——这是 Agent 理论上可能重试同一份文件的最大时间跨度）
    // 之外的历史投递不应该继续挡住"内容相同"的新投递：一是没必要无界查询更久以前的
    // 记录，二是 Agent 自己过了 2 小时就会放弃重试转入 _unclaimed，服务端理论上根本不会
    // 收到这么老的重试，窗口设计上没必要更长。
    const { service, prisma } = makeService()
    const buffer = tinyPdf()
    const taskA = await service.create(dto, null)
    await service.deliverScanFile({
      terminalId: 't_1',
      buffer,
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })

    // 把 taskA 的 updatedAt 手工回拨到去重窗口之外（2 小时 + 5 分钟前）。
    const taskAStored = prisma.scanTasksById.get(taskA.scanTaskId)!
    prisma.scanTasksById.set(taskA.scanTaskId, {
      ...taskAStored,
      updatedAt: new Date(Date.now() - (2 * 60 * 60 * 1000 + 5 * 60 * 1000)),
    })

    const taskB = await service.create(dto, null)
    const deliveredB = await service.deliverScanFile({
      terminalId: 't_1',
      buffer,
      filename: 'a-retry-old.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(
      deliveredB.scanTaskId,
      taskB.scanTaskId,
      'a delivery whose matching historical content falls outside the dedup window must proceed to normal matching, not be blocked forever'
    )
  }

  {
    // 去重必须按终端隔离：终端 t_1 上一次成功投递的内容，不能拿去挡终端 t_2 上一次完全
    // 独立的合法投递（哪怕字节恰好相同）——两个不同物理终端之间没有跨用户误挂载风险，
    // 不应该被误伤（本次修复的威胁模型是"同一终端、不同用户的先后两个会话"）。
    const { service } = makeService()
    const buffer = tinyPdf()
    await service.create({ scanType: 'document', terminalId: 't_1' }, null)
    await service.deliverScanFile({
      terminalId: 't_1',
      buffer,
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })

    const taskT2 = await service.create({ scanType: 'document', terminalId: 't_2' }, null)
    const deliveredT2 = await service.deliverScanFile({
      terminalId: 't_2',
      buffer,
      filename: 'a-on-t2.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(
      deliveredT2.scanTaskId,
      taskT2.scanTaskId,
      'dedup must be scoped per terminal — the same bytes delivered to a different terminal must not be blocked'
    )
  }

  {
    // 失败重试防御（codex/scan-binding-20260911）：SCAN_TASK_STATE_CHANGED 分支（任务在上传期间被并发取消）
    // 虽然不会写入 fileId，但 CAS-to-matched 阶段已在 DB 中记录了 lastAttemptHash。
    // 如果 Agent 或攻击者尝试将该失败文件重新投递，服务端 lastAttemptHash 防线将精准拦截，
    // 抛出 409 SCAN_FILE_PREVIOUSLY_ATTEMPTED，绝不允许其误挂到后续新用户的 waiting 任务上。
    const prisma = new FakePrisma()
    const baseFiles = new FakeFilesService(prisma)
    let raceScanTaskId = ''
    const racyFiles = {
      upload: async (args: Parameters<FakeFilesService['upload']>[0]) => {
        const result = await baseFiles.upload(args)
        const task = prisma.scanTasksById.get(raceScanTaskId)!
        prisma.scanTasksById.set(raceScanTaskId, { ...task, status: 'cancelled' })
        return result
      },
      systemDelete: (fileId: string, reason: string) => baseFiles.systemDelete(fileId, reason),
    }
    const service = wrapServiceForTest(
      new ScanTasksService(
        prisma as never,
        racyFiles as never,
        passthroughCapabilities
      )
    )
    const created = await service.create(dto, null)
    raceScanTaskId = created.scanTaskId
    const buffer = tinyPdf()

    await expectRejects(
      () =>
        service.deliverScanFile({
          terminalId: 't_1',
          buffer,
          filename: 'race.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      ConflictException,
      'first attempt must hit SCAN_TASK_STATE_CHANGED as before'
    )
    assert.equal(
      prisma.scanTasksById.get(raceScanTaskId)?.fileId,
      null,
      'sanity precondition: the state-changed task must never have fileId populated'
    )
    assert.ok(
      prisma.scanTasksById.get(raceScanTaskId)?.lastAttemptHash,
      'matched CAS must have recorded lastAttemptHash'
    )

    // 新用户在同一终端开立新会话
    const taskB = await service.create(dto, null)
    let caughtRetry: unknown
    try {
      await service.deliverScanFile({
        terminalId: 't_1',
        buffer,
        filename: 'race-retry.pdf',
        mimeType: 'application/pdf',
        observedAt: new Date().toISOString(),
      })
    } catch (e) {
      caughtRetry = e
    }
    assert.ok(
      caughtRetry instanceof ConflictException,
      'previously attempted delivery must be rejected with ConflictException'
    )
    assert.equal(
      ((caughtRetry as ConflictException).getResponse() as { error?: { code?: string } }).error?.code,
      'SCAN_FILE_PREVIOUSLY_ATTEMPTED',
      'previously attempted delivery must report SCAN_FILE_PREVIOUSLY_ATTEMPTED'
    )
    const taskBAfter = prisma.scanTasksById.get(taskB.scanTaskId)!
    assert.equal(
      taskBAfter.status,
      'waiting',
      'task B must remain waiting when previously attempted content is rejected'
    )
    assert.equal(
      taskBAfter.fileId,
      null,
      'task B must not have any file attached'
    )
  }

  {
    // B1-11 follow-up：真实 DB 端到端验证 deliverScanFile() 的内容级去重护栏本体
    // （见 assertRealDbDedupGuardClosesCrossUserLeak() 顶部注释——原提交声称做过这项验证，
    // 实际从未落地，这里补上真正的）。沿用 assertRealDbPartialUniqueIndex() 同款手法：
    // 独立临时 SQLite 文件 + 真实 `prisma migrate deploy`，全程不触碰进程当前的
    // DATABASE_URL / 共享 dev.db，跑完即删。
    const apiRoot = path.resolve(__dirname, '..')
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'verify-scan-tasks-realdb-dedup-'))
    const dbPath = path.join(tmpDir, 'verify.db')
    const dbUrl = `file:${dbPath}`

    try {
      ensureSqliteFile(dbPath)
      runPrisma(apiRoot, ['migrate', 'deploy'], { ...process.env, DATABASE_URL: dbUrl })

      await assertRealDbDedupGuardClosesCrossUserLeak(dbUrl)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  {
    // 门禁护栏 1 校验：POST /scan/sessions 必须挂载 TerminalIdentityGuard，且严格校验 x-terminal-id
    const { ScanTasksController } = await import('../src/scan-tasks/scan-tasks.controller')
    const { TerminalIdentityGuard } = await import('../src/terminals/terminal-identity.guard')
    const guards = Reflect.getMetadata('__guards__', ScanTasksController.prototype.create) || []
    assert.ok(
      Array.isArray(guards) && guards.includes(TerminalIdentityGuard),
      'ScanTasksController.create must be guarded with TerminalIdentityGuard'
    )

    const createCalls: unknown[][] = []
    const fakeScanTasksService = {
      create: async (...args: unknown[]) => {
        createCalls.push(args)
        return {
        scanTaskId: 'st_ok',
        controlToken: 'token',
        expiresAt: new Date().toISOString(),
        instructions: [],
        }
      },
    }
    const fakeTerminalsService = {}
    const fakeJwt = {}
    const fakeRedis = {}
    const fakePrisma = {}
    const controller = new ScanTasksController(
      fakeScanTasksService as any,
      fakeTerminalsService as any,
      fakeJwt as any,
      fakeRedis as any,
      fakePrisma as any
    )

    const dummyReq = {
      headers: {},
      header: () => undefined,
    } as any

    // 1) 匹配 terminalId：通过头部检查并进入创建流程
    const okResult = await controller.create(
      { scanType: 'document', terminalId: 't_1', retryOfScanTaskId: 'prior_scan' },
      dummyReq,
      't_1',
      'prior-control-token'
    )
    assert.equal((okResult as any).data.scanTaskId, 'st_ok')
    assert.deepEqual(
      createCalls[0],
      [
        { scanType: 'document', terminalId: 't_1', retryOfScanTaskId: 'prior_scan' },
        null,
        'prior-control-token',
      ],
      'controller must pass retryOfScanTaskId in the DTO and prior control token separately from X-Scan-Retry-Control'
    )

    // 2) 终端 ID 不匹配：401 UnauthorizedException
    await expectRejects(
      () =>
        controller.create(
          { scanType: 'document', terminalId: 't_1' },
          dummyReq,
          't_2'
        ),
      UnauthorizedException,
      'mismatched terminalId between header and body must throw UnauthorizedException'
    )

    // 3) 缺失 x-terminal-id 头部：401 UnauthorizedException
    await expectRejects(
      () =>
        controller.create(
          { scanType: 'document', terminalId: 't_1' },
          dummyReq,
          undefined
        ),
      UnauthorizedException,
      'missing x-terminal-id header must throw UnauthorizedException'
    )
  }

  // 门禁护栏：委托至 scan-lease-contract.helper 进行租约生命周期、精确任务绑定、陈旧捕获与契约核验
  await runScanLeaseContractTests()

  console.log('PASS scan tasks verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
