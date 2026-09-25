/**
 * GET /admin/screen/snapshot 与 GET /partner/screen/snapshot 契约。
 *
 * 始终自建 OS 临时 SQLite + prisma migrate deploy，不读写 prisma/dev.db。
 *
 * Run: pnpm --filter @ai-job-print/api verify:console-screen-snapshot
 */
import 'reflect-metadata'
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BadRequestException, ForbiddenException, Module, NotFoundException, ValidationPipe } from '@nestjs/common'
import { NestFactory, type INestApplicationContext } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import {
  ADMIN_GOV_METRIC_KEYS,
  ADMIN_OPS_METRIC_KEYS,
  PARTNER_METRIC_KEYS,
  SCREEN_CACHE_TTL_SECONDS,
  SCREEN_JUMP_COPY,
  SCREEN_MIN_AGGREGATE_SAMPLE,
  SCREEN_ONLINE_WINDOW_SECONDS,
  SCREEN_UNAVAILABLE_REASON,
  type ScreenTimelineState,
} from '../src/console-screen/console-screen.types'
import {
  SCREEN_CACHE_TTL_SECONDS as SHARED_CACHE_TTL_SECONDS,
  SCREEN_JUMP_COPY as SHARED_JUMP_COPY,
  SCREEN_MIN_AGGREGATE_SAMPLE as SHARED_MIN_AGGREGATE_SAMPLE,
} from '../../../packages/shared/src/types/consoleScreen'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminOpsService } from '../src/admin-ops/admin-ops.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { AdminScreenController } from '../src/console-screen/console-screen.admin.controller'
import { PartnerScreenController } from '../src/console-screen/console-screen.partner.controller'
import { ConsoleScreenService } from '../src/console-screen/console-screen.service'
import { ScreenSnapshotCache, SCREEN_CACHE_MAX_KEYS, containsFailedLoaded } from '../src/console-screen/console-screen.cache'
import {
  filterSourceEntryOpens,
  FLEET_SAMPLE_TAKE,
  JUMP_SOURCE_GROUP_TAKE,
  PARTNER_FLEET_TAKE,
  shanghaiDayKey,
  shanghaiDayStart,
  snapshotLoadStatus,
} from '../src/console-screen/console-screen.metric'
import { metricKeysFor } from '../src/console-screen/console-screen.assemble'
import {
  loadAdminFleet,
  loadContentSlice,
  loadPartnerFleet,
  loadPrintCumulativeSlice,
  loadPrintLiveSlice,
} from '../src/console-screen/console-screen.queries'
import { PartnerOrgRequiredError, requirePartnerOrgId } from '../src/console-screen/console-screen.org'
import { offlineAlertTitle } from '../src/console-screen/console-screen.fleet'
import { CHINA_LAT_MIN, CHINA_LNG_MAX, terminalPlacementPatch } from '../src/terminals/terminal-placement'
import {
  TIMELINE_HEARTBEAT_ROW_CAP,
  TIMELINE_SEGMENT_CAP,
  deriveTerminalTimeline,
  type TimelineDeriveResult,
  type TimelineHeartbeat,
  type TimelinePrintInterval,
} from '../src/console-screen/console-screen.timeline'
import { isHealthyPrinterStatus } from '../src/terminals/printer-status'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

let passed = 0
let failed = 0

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed += 1
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failed += 1
  }
}

function readSrc(relative: string): string {
  return readFileSync(join(__dirname, '..', relative), 'utf8')
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n')
}

function contractBody(source: string): string {
  return source.replace(/^\/\*\*[\s\S]*?\*\//, '').replace(/^\s+/, '')
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
    return keys
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      collectKeys(child, keys)
    }
  }
  return keys
}

function prepareIsolatedScreenDatabase(): { databasePath: string; cleanup: () => void } {
  if (process.env['NODE_ENV']?.trim().toLowerCase() === 'production') {
    throw new Error('VERIFICATION_DATABASE_PRODUCTION_FORBIDDEN')
  }
  const previousDatabaseUrl = process.env['DATABASE_URL']
  const previousTarget = process.env['VERIFICATION_DATABASE_TARGET']
  const tempDirectory = mkdtempSync(join(tmpdir(), 'verify-console-screen-'))
  const databasePath = join(tempDirectory, 'verify.db')
  closeSync(openSync(databasePath, 'a'))
  process.env['DATABASE_URL'] = `file:${databasePath}`
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  assertIsolatedVerificationDatabase()
  const apiRoot = join(__dirname, '..')
  const prismaCli = join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js')
  if (!existsSync(prismaCli)) {
    rmSync(tempDirectory, { recursive: true, force: true })
    throw new Error(`Missing Prisma CLI: ${prismaCli}`)
  }
  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    rmSync(tempDirectory, { recursive: true, force: true })
    const err = error as { stderr?: string; stdout?: string; message?: string }
    throw new Error(`prisma migrate deploy failed: ${(err.stderr || err.stdout || err.message || 'unknown error').trim()}`)
  }
  return {
    databasePath,
    cleanup: () => {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = previousDatabaseUrl
      if (previousTarget === undefined) delete process.env['VERIFICATION_DATABASE_TARGET']
      else process.env['VERIFICATION_DATABASE_TARGET'] = previousTarget
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

function assertSourceContract(): void {
  const sharedTypes = readFileSync(join(__dirname, '..', '..', '..', 'packages/shared/src/types/consoleScreen.ts'), 'utf8')
  const apiTypes = readSrc('src/console-screen/console-screen.types.ts')
  assert(
    '1z. shared 真源与 API 副本去掉文件头注释后逐字节相同',
    contractBody(sharedTypes) === contractBody(apiTypes),
  )
  assert(
    '1z2. 运行时常量与 shared 一致（API 无法 import 该包，见 tsc TS2307/TS6059）',
    SHARED_MIN_AGGREGATE_SAMPLE === SCREEN_MIN_AGGREGATE_SAMPLE
      && SHARED_JUMP_COPY === SCREEN_JUMP_COPY
      && SHARED_CACHE_TTL_SECONDS.realtime === SCREEN_CACHE_TTL_SECONDS.realtime
      && SHARED_CACHE_TTL_SECONDS.counts === SCREEN_CACHE_TTL_SECONDS.counts
      && SHARED_CACHE_TTL_SECONDS.cumulative === SCREEN_CACHE_TTL_SECONDS.cumulative
      && SCREEN_MIN_AGGREGATE_SAMPLE === 5,
  )
  const adminController = stripComments(readSrc('src/console-screen/console-screen.admin.controller.ts'))
  const partnerController = stripComments(readSrc('src/console-screen/console-screen.partner.controller.ts'))
  const dto = stripComments(readSrc('src/console-screen/console-screen.dto.ts'))
  const service = stripComments(readSrc('src/console-screen/console-screen.service.ts'))
  const queries = stripComments(readSrc('src/console-screen/console-screen.queries.ts'))
  const moduleDir = [
    'console-screen.admin.controller.ts',
    'console-screen.partner.controller.ts',
    'console-screen.service.ts',
    'console-screen.queries.ts',
    'console-screen.assemble.ts',
    'console-screen.cache.ts',
    'console-screen.dto.ts',
    'console-screen.metric.ts',
    'console-screen.module.ts',
    'console-screen.org.ts',
    'console-screen.fleet.ts',
    'console-screen.timeline.ts',
    'console-screen.twin.ts',
  ].map((name) => stripComments(readSrc(`src/console-screen/${name}`))).join('\n')

  assert(
    '1a. Admin 端点有 JwtAuthGuard + RolesGuard + @Roles(admin)',
    /@UseGuards\(JwtAuthGuard, RolesGuard\)/.test(adminController)
      && /@Roles\('admin'\)/.test(adminController)
      && /@Get\('admin\/screen\/snapshot'\)/.test(adminController)
      && !/@Roles\('partner'\)/.test(adminController),
  )
  assert(
    '1b. Partner 端点有 JwtAuthGuard + RolesGuard + @Roles(partner)',
    /@Roles\('partner'\)/.test(partnerController)
      && /@Get\('partner\/screen\/snapshot'\)/.test(partnerController)
      && !/@Roles\('admin'\)/.test(partnerController),
  )
  assert(
    '1c. Partner orgId 只从 CurrentUser 取，不读 query.orgId',
    /user\.orgId/.test(partnerController)
      && !/query\.orgId|_query\.orgId/.test(partnerController)
      && /class PartnerScreenQueryDto \{\s*\}/.test(dto),
  )
  assert(
    '1d. Admin DTO 只白名单 profile=gov|ops',
    /@IsIn\(\['gov', 'ops'\]\)/.test(dto) && !/orgId/.test(dto),
  )
  assert(
    '1e. 不签发只读展示令牌，展示只允许已登录后台',
    !/BindCode|terminals\/:id\/config/.test(moduleDir)
      && !/@Get\([^)]*printer-status/.test(moduleDir)
      && /displayToken: 'not_issued'/.test(readSrc('src/console-screen/console-screen.metric.ts'))
      && /access: 'authenticated_console'/.test(readSrc('src/console-screen/console-screen.metric.ts'))
      && !/@Get\('.*screen\/token/.test(adminController)
      && !/@Get\('.*screen\/token/.test(partnerController),
  )
  assert(
    '1f. 大屏模块不扫 JobApplication，不复用 take:10000 的 AI usage',
    !/jobApplication|JobApplication/.test(moduleDir)
      && !/take:\s*10_000|take:\s*10000/.test(moduleDir)
      && !/ai-log\.service/.test(moduleDir)
      && !/files\.service/.test(moduleDir),
  )
  assert(
    '1g. 聚合走 count/groupBy/aggregate，打印趋势与机队有 take 上限',
    /groupBy\(/.test(queries)
      && /aggregate\(/.test(queries)
      && /take:\s*trendRowCap\s*\+\s*1/.test(queries)
      && /trendRowCap \?\? PRINT_TREND_ROW_CAP/.test(queries)
      && /orderBy:\s*\[\s*\{\s*paidAt:\s*'asc'\s*\},\s*\{\s*id:\s*'asc'\s*\}/.test(queries)
      && /take:\s*FLEET_SAMPLE_TAKE/.test(queries)
      && /take:\s*JUMP_SOURCE_GROUP_TAKE/.test(queries)
      && /orderBy:\s*\{\s*_count:\s*\{\s*sourceName:\s*'desc'\s*\}/.test(queries)
      && /prisma\.terminal\.count\(\{\s*where\s*\}/.test(queries)
      && (queries.match(/prisma\.terminal\.findMany/g) ?? []).length === 1
      && /loadAdminFleet/.test(queries)
      && /loadPartnerFleet/.test(queries)
      && /prisma\.jobFair\.count/.test(queries)
      && !/prisma\.jobFair\.findMany/.test(queries)
      && !/this\.fleet\.getOverview/.test(service)
      && !/DeviceFleetModule/.test(readSrc('src/console-screen/console-screen.module.ts'))
      && !/findMany\(\s*\{[^}]*where:\s*\{\s*deletedAt:\s*null/.test(queries),
  )
  assert(
    '1h. 在线窗口复用 device-fleet 180 秒投影，不走无界 getOverview',
    queries.includes('DEVICE_FLEET_ONLINE_WINDOW_SECONDS')
      && queries.includes('buildDeviceFleetOverview')
      && !service.includes('DeviceFleetService')
      && SCREEN_ONLINE_WINDOW_SECONDS === 180,
  )
  assert(
    '1k. Partner 机构范围 fail-closed，空 orgId 不得退化成全局查询',
    /partnerSourceOrgWhere\(orgId\)/.test(queries)
      && /partnerOrgIdWhere\(/.test(queries)
      && /requirePartnerOrgId/.test(service)
      && /requirePartnerOrgId\(user\.orgId\)/.test(partnerController)
      && /PartnerOrgRequiredError/.test(partnerController)
      && !/orgId \? \{ sourceOrgId: orgId \}/.test(queries)
      && !/orgId \? \{ orgId \}/.test(queries)
      && !/orgId \? \{\.\.\.\}/.test(queries),
  )
  assert(
    '1i. 缓存三档 15/60/300、有 key 上限、Partner 缓存键含 orgId',
    SCREEN_CACHE_TTL_SECONDS.realtime === 15
      && SCREEN_CACHE_TTL_SECONDS.counts === 60
      && SCREEN_CACHE_TTL_SECONDS.cumulative === 300
      && SCREEN_CACHE_MAX_KEYS === 256
      && /pruneExpired/.test(readSrc('src/console-screen/console-screen.cache.ts'))
      && /evictOldestIfNeeded/.test(readSrc('src/console-screen/console-screen.cache.ts'))
      && /inflight/.test(readSrc('src/console-screen/console-screen.cache.ts'))
      && /containsFailedLoaded/.test(readSrc('src/console-screen/console-screen.cache.ts'))
      && /partner:\$\{scopedOrgId\}:realtime/.test(service)
      && PARTNER_FLEET_TAKE === FLEET_SAMPLE_TAKE
      && FLEET_SAMPLE_TAKE === 200
      && JUMP_SOURCE_GROUP_TAKE === 32,
  )
  assert(
    '1j. 外部跳转文案是打开来源平台入口',
    SCREEN_JUMP_COPY === '打开来源平台入口'
      && !/投递成功|一键投递|立即投递/.test(moduleDir),
  )
  assert(
    '1l. API 源码不 import @ai-job-print/shared（当前 tsc 解析不了）',
    !/@ai-job-print\/shared/.test(moduleDir)
      && !/from ['"]@ai-job-print\/shared['"]/.test(stripComments(apiTypes)),
  )
  const apiPkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  const ciYml = readFileSync(join(__dirname, '..', '..', '..', '.github/workflows/ci.yml'), 'utf8')
  assert(
    '1m. CI 直接执行 verify:console-screen-snapshot，不挂在 admin-ops 后面',
    apiPkg.scripts['verify:admin-ops'] === 'node -r @swc-node/register scripts/verify-admin-ops.ts'
      && /pnpm --filter @ai-job-print\/api verify:console-screen-snapshot/.test(ciYml),
  )
  const sqliteSchema = readSrc('prisma/schema.prisma')
  const pgSchema = readSrc('prisma/postgres/schema.prisma')
  const sqliteIndexMigration = readSrc('prisma/migrations/20260917120000_add_console_screen_query_indexes/migration.sql')
  const pgIndexMigration = readSrc('prisma/postgres/migrations/20260917120000_add_console_screen_query_indexes/migration.sql')
  const sqliteGeoMigration = readSrc('prisma/migrations/20260925143000_add_terminal_area_geo/migration.sql')
  const pgGeoMigration = readSrc('prisma/postgres/migrations/20260925143000_add_terminal_area_geo/migration.sql')
  assert(
    '1n. SQLite/PG schema 与双迁移都声明 toStatus+createdAt、createdAt+sourceName 索引',
    /@@index\(\[toStatus, createdAt\]\)/.test(sqliteSchema)
      && /@@index\(\[toStatus, createdAt\]\)/.test(pgSchema)
      && /@@index\(\[createdAt, sourceName\]\)/.test(sqliteSchema)
      && /@@index\(\[createdAt, sourceName\]\)/.test(pgSchema)
      && sqliteIndexMigration.includes('PrintTaskStatusLog_toStatus_createdAt_idx')
      && sqliteIndexMigration.includes('ExternalJumpLog_createdAt_sourceName_idx')
      && pgIndexMigration.includes('PrintTaskStatusLog_toStatus_createdAt_idx')
      && pgIndexMigration.includes('ExternalJumpLog_createdAt_sourceName_idx')
      && sqliteIndexMigration.includes('CREATE INDEX')
      && pgIndexMigration.includes('CREATE INDEX')
      && !/DROP INDEX/.test(sqliteIndexMigration)
      && !/DROP INDEX/.test(pgIndexMigration),
  )
  assert(
    '1o. 累计只计 paid 内容页，趋势按 paidAt，今日失败按状态日志 createdAt',
    /payStatus:\s*'paid'/.test(queries)
      && /select:\s*\{\s*paidAt:\s*true,\s*billablePages:\s*true/.test(queries)
      && /printTaskStatusLog\.count/.test(queries)
      && /toStatus:\s*'failed'/.test(queries)
      && !/status:\s*'failed',\s*updatedAt/.test(queries)
      && !/select:\s*\{\s*createdAt:\s*true,\s*billablePages:\s*true/.test(queries)
      && !/\bcopies\b/.test(queries)
      && /PartnerOrgRequiredError/.test(service),
  )
  assert(
    '1q. gov 不加载 derived alerts；ops 才打 admin:alerts',
    /includeAlerts = profile === 'ops'/.test(service)
      && /'admin:alerts'/.test(service)
      && /loadAdminRealtimeCore/.test(service)
      && /listDerivedAlerts/.test(service),
  )
  const cacheSrc = readSrc('src/console-screen/console-screen.cache.ts')
  const moduleSrc = readSrc('src/console-screen/console-screen.module.ts')
  assert(
    '1p. ScreenSnapshotCache 无 constructor 注入；ConsoleScreenModule 用 class provider 登记',
    !/constructor\s*\([^)]*clock/.test(cacheSrc)
      && /static forTest\(/.test(cacheSrc)
      && /providers:\s*\[\s*ConsoleScreenService,\s*ScreenSnapshotCache\s*\]/.test(moduleSrc)
      && !/useValue|useFactory/.test(moduleSrc),
  )
  assert(
    '1r. 单台孪生沿用 admin/screen 与 partner/screen，机构 id 只来自当前用户，缓存键含机构',
    /@Get\('admin\/screen\/terminals\/:terminalId'\)/.test(adminController)
      && /@Get\('partner\/screen\/terminals\/:terminalId'\)/.test(partnerController)
      && /getPartnerTerminalTwin\(requirePartnerOrgId\(user\.orgId\)/.test(partnerController)
      && /admin:twin:/.test(service)
      && /partner:\$\{scopedOrgId\}:twin:/.test(service)
      && !/query\.orgId/.test(partnerController),
  )
  assert(
    '1s. Terminal 所在区与经纬度写入两份 schema，SQLite REAL / PostgreSQL DOUBLE PRECISION',
    /areaLabel\s+String\?/.test(sqliteSchema)
      && /geoLat\s+Float\?/.test(sqliteSchema)
      && /geoLng\s+Float\?/.test(sqliteSchema)
      && /areaLabel\s+String\?/.test(pgSchema)
      && /geoLat\s+Float\?/.test(pgSchema)
      && /geoLng\s+Float\?/.test(pgSchema)
      && sqliteGeoMigration.includes('"areaLabel" TEXT')
      && sqliteGeoMigration.includes('"geoLat" REAL')
      && sqliteGeoMigration.includes('"geoLng" REAL')
      && pgGeoMigration.includes('"geoLat" DOUBLE PRECISION')
      && pgGeoMigration.includes('"geoLng" DOUBLE PRECISION')
      && !/DROP COLUMN/.test(sqliteGeoMigration)
      && !/DROP COLUMN/.test(pgGeoMigration),
  )
}

type TimelineSample = {
  now: Date
  heartbeats: readonly TimelineHeartbeat[]
  prints: readonly TimelinePrintInterval[]
  heartbeatRowCapExceeded?: boolean
  printRowCapExceeded?: boolean
  segmentCap?: number
  onlineWindowMs?: number
}

/**
 * deriveTerminalTimeline 改成单遍扫描之前的 O(n²) 实现。
 * 只留在 verify 里做逐段差分，生产路径不再走这里。
 */
function deriveTerminalTimelineQuadratic(input: TimelineSample): TimelineDeriveResult {
  if (input.heartbeatRowCapExceeded || input.printRowCapExceeded) {
    return { ok: false, reason: SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded }
  }
  const nowMs = input.now.getTime()
  const windowStart = nowMs - 24 * 60 * 60 * 1000
  const onlineWindowMs = input.onlineWindowMs ?? SCREEN_ONLINE_WINDOW_SECONDS * 1000
  const segmentCap = input.segmentCap ?? TIMELINE_SEGMENT_CAP
  const rank: Record<ScreenTimelineState, number> = { unknown: 0, offline: 1, idle: 2, alert: 3, printing: 4 }
  const heartbeats = input.heartbeats
    .filter((row) => row.at instanceof Date && Number.isFinite(row.at.getTime()) && row.at.getTime() <= nowMs)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  type Seg = { from: number; to: number; state: ScreenTimelineState }
  const overlay = (segments: Seg[], from: number, to: number, state: ScreenTimelineState): Seg[] => {
    if (to <= from) return segments
    const next: Seg[] = []
    for (const seg of segments) {
      if (seg.to <= from || seg.from >= to) {
        next.push(seg)
        continue
      }
      if (seg.from < from) next.push({ from: seg.from, to: from, state: seg.state })
      next.push({
        from: Math.max(seg.from, from),
        to: Math.min(seg.to, to),
        state: rank[seg.state] > rank[state] ? seg.state : state,
      })
      if (seg.to > to) next.push({ from: to, to: seg.to, state: seg.state })
    }
    return next
  }
  let segments: Seg[] = [{
    from: windowStart,
    to: nowMs,
    state: heartbeats.length > 0 ? 'offline' : 'unknown',
  }]
  for (const heartbeat of heartbeats) {
    const at = heartbeat.at.getTime()
    const from = Math.max(at, windowStart)
    const to = Math.min(at + onlineWindowMs, nowMs)
    const status = heartbeat.printerStatus
    const alert = Boolean(status) && status !== 'unknown' && !isHealthyPrinterStatus(status)
    segments = overlay(segments, from, to, alert ? 'alert' : 'idle')
  }
  for (const print of input.prints) {
    if (!(print.from instanceof Date) || !(print.to instanceof Date)) continue
    segments = overlay(
      segments,
      Math.max(print.from.getTime(), windowStart),
      Math.min(print.to.getTime(), nowMs),
      'printing',
    )
  }
  const sorted = segments.filter((seg) => seg.to > seg.from).sort((a, b) => a.from - b.from || a.to - b.to)
  const merged: Seg[] = []
  for (const seg of sorted) {
    const last = merged[merged.length - 1]
    if (last && last.state === seg.state && last.to === seg.from) last.to = seg.to
    else merged.push({ ...seg })
  }
  if (merged.length > segmentCap) return { ok: false, reason: SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded }
  return {
    ok: true,
    segments: merged.map((seg) => ({
      from: new Date(seg.from).toISOString(),
      to: new Date(seg.to).toISOString(),
      state: seg.state,
    })),
  }
}

function timelineSampleDiff(label: string, sample: TimelineSample): string | null {
  const next = deriveTerminalTimeline(sample)
  const previous = deriveTerminalTimelineQuadratic(sample)
  if (JSON.stringify(next) === JSON.stringify(previous)) return null
  return `${label}: new=${JSON.stringify(next).slice(0, 320)} old=${JSON.stringify(previous).slice(0, 320)}`
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function diffTimelineSamples(now: Date): string[] {
  const failures: string[] = []
  const collect = (label: string, sample: TimelineSample) => {
    const diff = timelineSampleDiff(label, sample)
    if (diff) failures.push(diff)
  }
  collect('no-heartbeat', { now, heartbeats: [], prints: [] })
  collect('stale-heartbeat', {
    now,
    heartbeats: [{ at: new Date(now.getTime() - 48 * 60 * 60 * 1000), printerStatus: 'ready' }],
    prints: [],
  })
  collect('print-on-unknown', {
    now,
    heartbeats: [],
    prints: [{ from: new Date(now.getTime() - 60_000), to: new Date(now.getTime() - 30_000) }],
  })
  const statuses = [null, 'ready', 'ok', 'idle', 'unknown', 'paper_empty', 'offline', 'toner_low', '']
  for (let index = 0; index < 50; index += 1) {
    const rand = mulberry32(0xC0FFEE + index)
    const sampleNow = new Date(now.getTime() - Math.floor(rand() * 3_600_000))
    const heartbeatCount = Math.floor(rand() * 240)
    const heartbeats: TimelineHeartbeat[] = Array.from({ length: heartbeatCount }, () => ({
      at: new Date(sampleNow.getTime() - (rand() * 28 - 1) * 3_600_000),
      printerStatus: statuses[Math.floor(rand() * statuses.length)] ?? null,
    }))
    if (index % 7 === 0) heartbeats.push({ at: new Date(Number.NaN), printerStatus: 'ready' })
    const prints: TimelinePrintInterval[] = Array.from({ length: Math.floor(rand() * 12) }, () => {
      const start = sampleNow.getTime() - rand() * 26 * 3_600_000
      const end = start + (rand() - 0.1) * 3_600_000
      return { from: new Date(Math.min(start, end)), to: new Date(Math.max(start, end)) }
    })
    collect(`random-${index}`, {
      now: sampleNow,
      heartbeats,
      prints,
      onlineWindowMs: [60_000, 180_000, 300_000][Math.floor(rand() * 3)] ?? 180_000,
      heartbeatRowCapExceeded: index === 3,
      printRowCapExceeded: index === 11,
      segmentCap: index === 17 ? 2 : undefined,
    })
    if (failures.length > 0) break
  }
  return failures
}

async function createOnlineHeartbeats(
  prisma: PrismaService,
  terminalId: string,
  times: readonly Date[],
  printerStatus: string,
): Promise<void> {
  const chunkSize = 200
  for (let offset = 0; offset < times.length; offset += chunkSize) {
    await prisma.terminalHeartbeat.createMany({
      data: times.slice(offset, offset + chunkSize).map((createdAt) => ({
        terminalId,
        status: 'online',
        printerStatus,
        createdAt,
      })),
    })
  }
}

async function assertPureHelpers(): Promise<void> {
  const filtered = filterSourceEntryOpens([
    { sourceName: '大源', count: 12 },
    { sourceName: '小源', count: 4 },
    { sourceName: '中源', count: 5 },
  ])
  assert(
    '2a. N<5 的来源不进 Top',
    filtered.belowThreshold === false
      && filtered.items.length === 2
      && filtered.items.every((item) => item.count >= SCREEN_MIN_AGGREGATE_SAMPLE)
      && !filtered.items.some((item) => item.sourceName === '小源'),
  )
  const allSmall = filterSourceEntryOpens([
    { sourceName: 'A', count: 2 },
    { sourceName: 'B', count: 4 },
  ])
  assert(
    '2b. 全部 N<5 时 belowThreshold=true 且 items 为空',
    allSmall.belowThreshold && allSmall.items.length === 0,
  )
  assert(
    '2c. gov/ops/partner 指标键集合互不相同且含未接入槽位',
    metricKeysFor('admin', 'gov').includes('visitCount')
      && !metricKeysFor('admin', 'gov').includes('alertsRealtime')
      && metricKeysFor('admin', 'ops').includes('alertsRealtime')
      && !metricKeysFor('admin', 'ops').includes('visitCount')
      && metricKeysFor('partner').includes('sourceEntryOpensTop')
      && ADMIN_GOV_METRIC_KEYS.length === 10
      && ADMIN_OPS_METRIC_KEYS.length === 12
      && PARTNER_METRIC_KEYS.length > 10,
  )

  let now = 1_000
  const cache = ScreenSnapshotCache.forTest(() => now)
  let loads = 0
  const load = async () => {
    loads += 1
    return loads
  }
  await cache.getOrLoad('k', 15, load)
  await cache.getOrLoad('k', 15, load)
  assert('2d. 缓存命中不重复加载', loads === 1)
  now += 16_000
  await cache.getOrLoad('k', 15, load)
  assert('2e. TTL 过期后重新加载', loads === 2)
  assert('2f. 全失败/局部失败状态机', snapshotLoadStatus(4, 4) === 'ok' && snapshotLoadStatus(2, 4) === 'degraded' && snapshotLoadStatus(0, 4) === 'unavailable')
  const capped = ScreenSnapshotCache.forTest(() => 2_000, 3)
  for (let i = 0; i < 5; i += 1) {
    await capped.getOrLoad(`k${i}`, 15, async () => i)
  }
  assert('2g. 缓存活 key 不超过上限', capped.size() === 3, `size=${capped.size()}`)
  let clock = 3_000
  const expiring = ScreenSnapshotCache.forTest(() => clock, 10)
  await expiring.getOrLoad('old', 15, async () => 1)
  clock += 16_000
  await expiring.getOrLoad('new', 15, async () => 2)
  assert('2h. 过期 key 被清理', expiring.size() === 1)

  let flightLoads = 0
  let releaseFlight!: () => void
  const flightGate = new Promise<void>((resolve) => {
    releaseFlight = resolve
  })
  const flightCache = ScreenSnapshotCache.forTest(() => 4_000)
  const sharedLoad = async () => {
    flightLoads += 1
    await flightGate
    return 77
  }
  const firstFlight = flightCache.getOrLoad('same', 15, sharedLoad)
  while (flightLoads < 1) await Promise.resolve()
  const secondFlight = flightCache.getOrLoad('same', 15, sharedLoad)
  releaseFlight()
  const [left, right] = await Promise.all([firstFlight, secondFlight])
  assert(
    '2i. 同一 key 并发 miss 只 load 一次且结果一致',
    flightLoads === 1 && left.value === 77 && right.value === 77 && left.storedAt === right.storedAt,
    `loads=${flightLoads}`,
  )

  let blocked = false
  let releaseSlow!: () => void
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve
  })
  const isolated = ScreenSnapshotCache.forTest(() => 5_000)
  const slow = isolated.getOrLoad('slow', 15, async () => {
    await slowGate
    return 'slow'
  })
  const fast = await isolated.getOrLoad('fast', 15, async () => 'fast')
  blocked = fast.value !== 'fast'
  releaseSlow()
  await slow
  assert('2j. 不同 key 不互相阻塞', !blocked && fast.value === 'fast')

  let boomLoads = 0
  let releaseBoom!: () => void
  const boomGate = new Promise<void>((resolve) => {
    releaseBoom = resolve
  })
  const boomCache = ScreenSnapshotCache.forTest(() => 6_000)
  const boom = async () => {
    boomLoads += 1
    await boomGate
    throw new Error('loader-reject')
  }
  const boomOne = boomCache.getOrLoad('boom', 15, boom)
  while (boomLoads < 1) await Promise.resolve()
  const boomTwo = boomCache.getOrLoad('boom', 15, boom)
  releaseBoom()
  const boomSettled = await Promise.allSettled([boomOne, boomTwo])
  assert(
    '2k. loader reject 后 in-flight 清理且只跑一次',
    boomLoads === 1
      && boomSettled.every((item) => item.status === 'rejected')
      && boomCache.inflightSize() === 0,
    `loads=${boomLoads} inflight=${boomCache.inflightSize()}`,
  )
  let retryLoads = 0
  const retried = await boomCache.getOrLoad('boom', 15, async () => {
    retryLoads += 1
    return 9
  })
  assert('2l. reject 之后可以重试', retryLoads === 1 && retried.value === 9)

  assert('2m. 含 ok:false 的聚合判定为失败切片', containsFailedLoaded({ fleet: { ok: false, reason: 'source_query_failed' } }))

  const rejectedOrgIds: unknown[] = [null, undefined, '', '   ', '\n\t', 0, {}, []]
  assert(
    '2n. Partner orgId 空/空白/不可解析一律 throw，不得当成全局',
    rejectedOrgIds.every((value) => {
      try {
        requirePartnerOrgId(value)
        return false
      } catch (error) {
        return error instanceof PartnerOrgRequiredError
      }
    })
      && requirePartnerOrgId(' org_ok ') === 'org_ok',
  )

  const timelineNow = new Date('2026-09-25T04:00:00.000Z')
  const timelineStart = new Date(timelineNow.getTime() - 24 * 60 * 60 * 1000)
  const beatAt = new Date(timelineNow.getTime() - 400_000)
  const mergedTimeline = deriveTerminalTimeline({
    now: timelineNow,
    heartbeats: [
      { at: beatAt, printerStatus: 'ready' },
      { at: new Date(beatAt.getTime() + 10_000), printerStatus: 'ok' },
    ],
    prints: [],
    onlineWindowMs: 180_000,
  })
  assert(
    '2p. 重叠在线心跳合并成一段 idle，缺口记 offline，且铺满 24 小时',
    mergedTimeline.ok
      && mergedTimeline.segments.filter((segment) => segment.state === 'idle').length === 1
      && mergedTimeline.segments[0]?.from === timelineStart.toISOString()
      && mergedTimeline.segments[mergedTimeline.segments.length - 1]?.to === timelineNow.toISOString()
      && mergedTimeline.segments.every((segment, index) => index === 0 || segment.from === mergedTimeline.segments[index - 1]?.to)
      && mergedTimeline.segments.every((segment, index) => index === mergedTimeline.segments.length - 1 || segment.state !== mergedTimeline.segments[index + 1]?.state),
  )
  const printedTimeline = deriveTerminalTimeline({
    now: timelineNow,
    heartbeats: [{ at: beatAt, printerStatus: null }],
    prints: [{ from: new Date(timelineNow.getTime() - 300_000), to: new Date(timelineNow.getTime() - 200_000) }],
    onlineWindowMs: 180_000,
  })
  const alertTimeline = deriveTerminalTimeline({
    now: timelineNow,
    heartbeats: [{ at: new Date(timelineNow.getTime() - 60_000), printerStatus: 'paper_empty' }],
    prints: [],
    onlineWindowMs: 180_000,
  })
  const unknownTimeline = deriveTerminalTimeline({ now: timelineNow, heartbeats: [], prints: [] })
  const cappedTimeline = deriveTerminalTimeline({
    now: timelineNow,
    heartbeats: [{ at: beatAt, printerStatus: null }],
    prints: [],
    onlineWindowMs: 180_000,
    segmentCap: 1,
  })
  const rowCapTimeline = deriveTerminalTimeline({
    now: timelineNow,
    heartbeats: [],
    prints: [],
    heartbeatRowCapExceeded: true,
  })
  assert(
    '2q. printing 盖在心跳上；缺纸标 alert；没有心跳是 unknown；超上限整段不可用',
    printedTimeline.ok
      && printedTimeline.segments.some((segment) => segment.state === 'printing')
      && alertTimeline.ok
      && alertTimeline.segments.some((segment) => segment.state === 'alert')
      && !alertTimeline.segments.some((segment) => segment.state === 'idle')
      && unknownTimeline.ok
      && unknownTimeline.segments.length === 1
      && unknownTimeline.segments[0]?.state === 'unknown'
      && !cappedTimeline.ok
      && cappedTimeline.reason === SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded
      && !rowCapTimeline.ok
      && rowCapTimeline.reason === SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded
      && TIMELINE_SEGMENT_CAP >= 480,
  )
  const tenSecondCount = (24 * 60 * 60 * 1000) / 10_000
  const tenSecondBeats: TimelineHeartbeat[] = Array.from({ length: tenSecondCount }, (_, index) => ({
    at: new Date(timelineNow.getTime() - 24 * 60 * 60 * 1000 + index * 10_000),
    printerStatus: 'ready',
  }))
  const timelineStarted = performance.now()
  const tenSecondTimeline = deriveTerminalTimeline({ now: timelineNow, heartbeats: tenSecondBeats, prints: [] })
  const tenSecondMs = performance.now() - timelineStarted
  const tenSecondReferenceStarted = performance.now()
  const tenSecondReference = deriveTerminalTimelineQuadratic({ now: timelineNow, heartbeats: tenSecondBeats, prints: [] })
  const tenSecondReferenceMs = performance.now() - tenSecondReferenceStarted
  console.log(
    `  timeline 10s×24h: new ${tenSecondMs.toFixed(2)} ms, quadratic reference ${tenSecondReferenceMs.toFixed(2)} ms, segments ${tenSecondTimeline.ok ? tenSecondTimeline.segments.length : 'unavailable'}`,
  )
  assert(
    '2s. 10 秒一次、24 小时心跳推导 < 100ms，且与旧算法逐段一致、合并为 1 段 idle',
    tenSecondMs < 100
      && JSON.stringify(tenSecondTimeline) === JSON.stringify(tenSecondReference)
      && tenSecondTimeline.ok
      && tenSecondTimeline.segments.length === 1
      && tenSecondTimeline.segments[0]?.state === 'idle'
      && TIMELINE_HEARTBEAT_ROW_CAP >= 8_640,
    `new=${tenSecondMs.toFixed(2)} ms reference=${tenSecondReferenceMs.toFixed(2)} ms cap=${TIMELINE_HEARTBEAT_ROW_CAP}`,
  )
  const timelineDiffs = diffTimelineSamples(timelineNow)
  assert(
    '2t. 50 组随机心跳和打印区间与旧算法逐段一致',
    timelineDiffs.length === 0,
    timelineDiffs[0],
  )

  assert(
    '2r. 离线文案按分钟/小时给领导短句',
    offlineAlertTitle(34 * 60_000) === '离线 34 分钟'
      && offlineAlertTitle(2 * 60 * 60_000) === '离线 2 小时'
      && offlineAlertTitle(3 * 24 * 60 * 60_000) === '离线 3 天',
  )

  await assertNestConstructsCache()
}

async function assertNestConstructsCache(): Promise<void> {
  const paramtypes = (Reflect.getMetadata('design:paramtypes', ScreenSnapshotCache) ?? []) as unknown[]
  const injectableTypes = paramtypes.filter((item) => item === Function || item === Number)

  @Module({ providers: [ScreenSnapshotCache] })
  class ScreenCacheNestProbeModule {}

  let app: INestApplicationContext | undefined
  try {
    app = await NestFactory.createApplicationContext(ScreenCacheNestProbeModule, {
      logger: false,
      abortOnError: false,
    })
    const cache = app.get(ScreenSnapshotCache)
    const loaded = await cache.getOrLoad('nest-boot', 15, async () => 7)
    assert(
      '2o. Nest class provider 能构造 ScreenSnapshotCache，不依赖 Function/Number token',
      injectableTypes.length === 0
        && loaded.value === 7
        && loaded.hit === false
        && cache.size() === 1,
      `paramtypes=${paramtypes.map((item) => (typeof item === 'function' ? item.name : String(item))).join(',') || '(empty)'}`,
    )
  } catch (error) {
    assert(
      '2o. Nest class provider 能构造 ScreenSnapshotCache，不依赖 Function/Number token',
      false,
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    await app?.close()
  }
}

async function assertServiceContract(): Promise<void> {
  const isolated = prepareIsolatedScreenDatabase()
  assert(
    '0a. 数据库安全：NODE_ENV 不是 production',
    process.env['NODE_ENV'] !== 'production',
  )
  assert(
    '0b. 数据库安全：跑在本地 SQLite（DATABASE_URL=file:）',
    Boolean(process.env['DATABASE_URL']?.startsWith('file:')),
    `DATABASE_URL=${process.env['DATABASE_URL'] ?? '(unset)'}`,
  )
  assert(
    '0c. 隔离库在 OS 临时目录，不写 prisma/dev.db',
    isolated.databasePath.startsWith(tmpdir())
      && isolated.databasePath.endsWith('verify.db')
      && !isolated.databasePath.includes(`${join('prisma', 'dev.db')}`)
      && process.env['VERIFICATION_DATABASE_TARGET'] === 'isolated',
    isolated.databasePath,
  )

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const cache = new ScreenSnapshotCache()
  const opsService = new AdminOpsService(prisma)
  let alertCalls = 0
  const originalListDerivedAlerts = opsService.listDerivedAlerts.bind(opsService)
  opsService.listDerivedAlerts = (async (view, limit) => {
    alertCalls += 1
    return originalListDerivedAlerts(view, limit)
  }) as AdminOpsService['listDerivedAlerts']
  const screen = new ConsoleScreenService(prisma, opsService, cache)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const orgA = `org_scrn_a_${suffix}`
  const orgB = `org_scrn_b_${suffix}`
  const srcA = `src_scrn_a_${suffix}`
  const srcB = `src_scrn_b_${suffix}`
  const termA = `term_scrn_a_${suffix}`
  const termB = `term_scrn_b_${suffix}`
  const userA = `user_scrn_pa_${suffix}`
  const userB = `user_scrn_pb_${suffix}`
  const adminId = `user_scrn_ad_${suffix}`
  const memberId = `eu_scrn_${suffix}`
  const taskA = `pt_scrn_a_${suffix}`
  const taskHist1 = `pt_scrn_h1_${suffix}`
  const taskHist2 = `pt_scrn_h2_${suffix}`
  const taskHist3 = `pt_scrn_h3_${suffix}`
  const taskRecovered = `pt_scrn_ok_${suffix}`
  const userBlank = `user_scrn_nb_${suffix}`
  const printTaskIds = [taskA, taskHist1, taskHist2, taskHist3, taskRecovered]
  const resumeFileName = `求职简历-张三-${suffix}.pdf`
  const ids = { orgA, orgB, srcA, srcB, termA, termB, userA, userB, adminId, memberId, taskA, userBlank, suffix, resumeFileName }

  const cleanup = async () => {
    await prisma.auditLog.deleteMany({ where: { targetType: 'terminal' } })
    await prisma.scanTask.deleteMany({ where: { terminal: { orgId: { in: [orgA, orgB] } } } })
    await prisma.terminalCapability.deleteMany({ where: { terminal: { orgId: { in: [orgA, orgB] } } } })
    await prisma.externalJumpLog.deleteMany({ where: { endUserId: memberId } })
    await prisma.aiServiceLog.deleteMany({ where: { terminalId: { in: [termA, termB] } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { task: { terminal: { orgId: { in: [orgA, orgB] } } } } })
    await prisma.printTask.deleteMany({ where: { terminal: { orgId: { in: [orgA, orgB] } } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: printTaskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: printTaskIds } } })
    await prisma.order.deleteMany({ where: { terminalId: { in: [termA, termB] } } })
    await prisma.syncLog.deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
    await prisma.job.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.jobFair.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.companyProfile.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.jobSource.deleteMany({ where: { id: { in: [srcA, srcB] } } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminal: { orgId: { in: [orgA, orgB] } } } })
    await prisma.terminal.deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB, adminId, userBlank] } } })
    await prisma.endUser.deleteMany({ where: { id: memberId } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  }

  try {
    await cleanup()
    const now = new Date()
    await prisma.organization.createMany({
      data: [
        { id: orgA, name: '大屏机构A', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
        { id: orgB, name: '大屏机构B', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
      ],
    })
    await prisma.jobSource.createMany({
      data: [
        { id: srcA, orgId: orgA, name: 'A源', sourceKind: 'manual', accessMode: 'manual', enabled: true },
        { id: srcB, orgId: orgB, name: 'B源', sourceKind: 'manual', accessMode: 'manual', enabled: true },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: adminId, username: `scrn_admin_${suffix}`, name: 'scrn admin', passwordHash: 'hash', role: 'admin', enabled: true, tokenVersion: 0 },
        { id: userA, username: `scrn_pa_${suffix}`, name: 'scrn partner a', passwordHash: 'hash', role: 'partner', orgId: orgA, enabled: true, tokenVersion: 0 },
        { id: userB, username: `scrn_pb_${suffix}`, name: 'scrn partner b', passwordHash: 'hash', role: 'partner', orgId: orgB, enabled: true, tokenVersion: 0 },
        { id: userBlank, username: `scrn_nb_${suffix}`, name: 'scrn partner blank', passwordHash: 'hash', role: 'partner', orgId: null, enabled: true, tokenVersion: 0 },
      ],
    })
    const phoneEnc = `penc_${suffix}`
    const pickupCode = `pck_${suffix}`
    await prisma.endUser.create({
      data: { id: memberId, phoneHash: `ph_${suffix}`, phoneEnc },
    })
    await prisma.terminal.createMany({
      data: [
        { id: termA, terminalCode: `SCRN-A-${suffix}`, agentToken: `tok_a_${suffix}`, deviceFingerprint: `fp_a_${suffix}`, orgId: orgA, enabled: true, displayName: '天河一体机', areaLabel: '天河区', locationLabel: '体育中心', geoLat: 23.125, geoLng: 113.5 },
        { id: termB, terminalCode: `SCRN-B-${suffix}`, agentToken: `tok_b_${suffix}`, deviceFingerprint: `fp_b_${suffix}`, orgId: orgB, enabled: true },
      ],
    })
    await prisma.terminalHeartbeat.createMany({
      data: [
        { terminalId: termA, status: 'online', createdAt: now },
        { terminalId: termB, status: 'online', printerStatus: 'paper_empty', createdAt: now },
      ],
    })
    await prisma.job.createMany({
      data: [
        { sourceOrgId: orgA, sourceId: srcA, externalId: `a1-${suffix}`, sourceName: 'A源', sourceUrl: 'https://example.com/a1', title: 'A岗1', company: 'A公司', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
        { sourceOrgId: orgA, sourceId: srcA, externalId: `a2-${suffix}`, sourceName: 'A源', sourceUrl: 'https://example.com/a2', title: 'A岗2', company: 'A公司', city: '青岛', reviewStatus: 'pending', publishStatus: 'draft' },
        { sourceOrgId: orgB, sourceId: srcB, externalId: `b1-${suffix}`, sourceName: 'B源', sourceUrl: 'https://example.com/b1', title: 'B岗1', company: 'B公司', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
        { sourceOrgId: orgB, sourceId: srcB, externalId: `b2-${suffix}`, sourceName: 'B源', sourceUrl: 'https://example.com/b2', title: 'B岗2', company: 'B公司', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
      ],
    })
    await prisma.syncLog.createMany({
      data: [
        { sourceId: srcA, orgId: orgA, dataType: 'job', syncMode: 'manual', result: 'success', addedCount: 1, createdAt: now },
        { sourceId: srcB, orgId: orgB, dataType: 'job', syncMode: 'manual', result: 'success', addedCount: 99, createdAt: now },
        { sourceId: srcB, orgId: orgB, dataType: 'job', syncMode: 'manual', result: 'failed', addedCount: 0, createdAt: now },
      ],
    })
    const yesterdayInstant = new Date(shanghaiDayStart(now).getTime() - 60_000)
    const todayKey = shanghaiDayKey(now)
    const yesterdayKey = shanghaiDayKey(yesterdayInstant)
    const taskStarted = new Date(now.getTime() - 5 * 60_000)
    await prisma.printTask.create({
      data: {
        id: taskA,
        terminalId: termA,
        endUserId: memberId,
        fileUrl: 'https://internal/secret',
        fileMd5: 'md5',
        paramsJson: JSON.stringify({ fileName: resumeFileName, billablePages: 6, colorMode: 'black_white', copies: 2 }),
        status: 'printing',
        claimedAt: taskStarted,
        createdAt: taskStarted,
      },
    })
    await prisma.printTask.createMany({
      data: [
        { id: taskHist1, terminalId: termA, fileUrl: 'https://internal/hist1', fileMd5: 'md5h1', paramsJson: '{}', status: 'failed', createdAt: yesterdayInstant },
        { id: taskHist2, terminalId: termA, fileUrl: 'https://internal/hist2', fileMd5: 'md5h2', paramsJson: '{}', status: 'failed', createdAt: yesterdayInstant },
        { id: taskHist3, terminalId: termA, fileUrl: 'https://internal/hist3', fileMd5: 'md5h3', paramsJson: '{}', status: 'failed', createdAt: yesterdayInstant },
        { id: taskRecovered, terminalId: termA, fileUrl: 'https://internal/ok', fileMd5: 'md5ok', paramsJson: '{}', status: 'completed', createdAt: now },
      ],
    })
    await prisma.printTaskStatusLog.createMany({
      data: [
        { taskId: taskHist1, fromStatus: 'printing', toStatus: 'failed', createdAt: yesterdayInstant },
        { taskId: taskHist2, fromStatus: 'printing', toStatus: 'failed', createdAt: yesterdayInstant },
        { taskId: taskHist3, fromStatus: 'printing', toStatus: 'failed', createdAt: yesterdayInstant },
        { taskId: taskRecovered, fromStatus: 'printing', toStatus: 'failed', createdAt: now },
      ],
    })
    const paidSeed = await prisma.order.create({
      data: {
        orderNo: `SCRN-${suffix}`,
        type: 'print',
        terminalId: termA,
        amountCents: 50,
        billablePages: 3,
        payStatus: 'paid',
        taskStatus: 'printing',
        paidAt: now,
        pickupCode,
        printParamsJson: JSON.stringify({ copies: 9 }),
      },
    })
    await prisma.orderItem.create({
      data: {
        orderId: paidSeed.id,
        seq: 1,
        fileId: `file_scrn_${suffix}`,
        colorMode: 'bw',
        duplex: 'one_sided',
        copies: 9,
        billablePages: 3,
        amountCents: 50,
      },
    })
    await prisma.order.createMany({
      data: [
        {
          orderNo: `SCRN-Y-${suffix}`,
          type: 'print',
          terminalId: termA,
          amountCents: 10,
          billablePages: 5,
          payStatus: 'paid',
          taskStatus: 'completed',
          createdAt: now,
          paidAt: yesterdayInstant,
          printParamsJson: JSON.stringify({ copies: 13 }),
        },
        {
          orderNo: `SCRN-T-${suffix}`,
          type: 'print',
          terminalId: termA,
          amountCents: 10,
          billablePages: 7,
          payStatus: 'paid',
          taskStatus: 'completed',
          createdAt: yesterdayInstant,
          paidAt: now,
          printParamsJson: JSON.stringify({ copies: 11 }),
        },
        {
          orderNo: `SCRN-U-${suffix}`,
          type: 'print',
          terminalId: termA,
          amountCents: 10,
          billablePages: 100,
          payStatus: 'unpaid',
          taskStatus: 'pending',
          printParamsJson: JSON.stringify({ copies: 2 }),
        },
        {
          orderNo: `SCRN-R-${suffix}`,
          type: 'print',
          terminalId: termA,
          amountCents: 10,
          billablePages: 80,
          payStatus: 'refunded',
          taskStatus: 'completed',
          paidAt: now,
          printParamsJson: JSON.stringify({ copies: 4 }),
        },
        {
          orderNo: `SCRN-P-${suffix}`,
          type: 'print',
          terminalId: termA,
          amountCents: 10,
          billablePages: 40,
          payStatus: 'paying',
          taskStatus: 'pending',
          printParamsJson: JSON.stringify({ copies: 3 }),
        },
      ],
    })
    await prisma.aiServiceLog.createMany({
      data: [
        { operation: 'parseResume', status: 'success', latencyMs: 100, estimatedCostCny: 0.2, terminalId: termA, createdAt: now },
        { operation: 'parseResume', status: 'failed', latencyMs: 20, terminalId: termA, createdAt: now },
      ],
    })
    const jumpQualified = `公共就业-${suffix}`
    const jumpSmall = `小样本-${suffix}`
    await prisma.externalJumpLog.createMany({
      data: [
        ...Array.from({ length: 20 }, (_, i) => ({
          endUserId: memberId, targetType: 'job', targetId: `job-big-${suffix}-${i}`, action: 'external_apply',
          sourceName: jumpQualified, createdAt: now, expiresAt: new Date(now.getTime() + 86400000),
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          endUserId: memberId, targetType: 'job', targetId: `job-small-${suffix}-${i}`, action: 'external_apply',
          sourceName: jumpSmall, createdAt: now, expiresAt: new Date(now.getTime() + 86400000),
        })),
      ],
    })

    const gov = await screen.getAdminSnapshot('gov')
    assert('3a2. gov 不调用 listDerivedAlerts', alertCalls === 0, `alertCalls=${alertCalls}`)
    const ops = await screen.getAdminSnapshot('ops')
    assert('3a3. ops 才加载 derived alerts', alertCalls === 1, `alertCalls=${alertCalls}`)
    const partnerA = await screen.getPartnerSnapshot(orgA)
    const partnerB = await screen.getPartnerSnapshot(orgB)

    assert('3a. gov 含 visitCount 未接入且不含 alerts', Boolean(gov.metrics.visitCount && gov.metrics.visitCount.available === false && !gov.metrics.alertsRealtime))
    assert('3b. ops 含 alerts 且不含 visitCount', Boolean(ops.metrics.alertsRealtime && !ops.metrics.visitCount))
    assert(
      '3c. 未接入不用 0 冒充',
      gov.metrics.visitCount?.available === false
        && gov.metrics.visitCount.reason === SCREEN_UNAVAILABLE_REASON.kioskSessionUnwritten
        && !('value' in gov.metrics.visitCount),
    )
    assert(
      '3d. Partner A 只看到本机构在架岗位 1，不含 B 的 2',
      partnerA.metrics.jobsOnShelf?.available === true
        && partnerA.metrics.jobsOnShelf.value.published === 1,
      partnerA.metrics.jobsOnShelf?.available ? `published=${partnerA.metrics.jobsOnShelf.value.published}` : 'unavailable',
    )
    assert(
      '3d2. Partner A 机队不含 B 的终端',
      partnerA.metrics.terminalsOnline?.available === true
        && partnerB.metrics.terminalsOnline?.available === true
        && partnerA.metrics.terminalsOnline.value.matchedCount === 1
        && partnerA.metrics.terminalsOnline.value.sampledCount === 1
        && partnerB.metrics.terminalsOnline.value.matchedCount === 1
        && partnerB.metrics.terminalsOnline.value.sampledCount === 1
        && partnerA.metrics.terminalsOnline.value.matchedCount !== 2,
      partnerA.metrics.terminalsOnline?.available && partnerB.metrics.terminalsOnline?.available
        ? `A matched=${partnerA.metrics.terminalsOnline.value.matchedCount} B matched=${partnerB.metrics.terminalsOnline.value.matchedCount}`
        : 'unavailable',
    )
    const wallA = partnerA.metrics.fleetWall
    const cellA = wallA?.available === true ? wallA.value.cells[0] : undefined
    const wallB = partnerB.metrics.fleetWall
    const cellB = wallB?.available === true ? wallB.value.cells[0] : undefined
    const govCells = gov.metrics.fleetWall?.available === true ? gov.metrics.fleetWall.value.cells : []
    assert(
      '5a. Partner A 格子带落点且正在打印，响应不含机构 B 的 terminalId',
      wallA?.available === true
        && wallA.value.cells.length === 1
        && cellA?.health === 'healthy'
        && cellA.terminalId === termA
        && cellA.terminalCode === `SCRN-A-${suffix}`
        && cellA.displayName === '天河一体机'
        && cellA.areaLabel === '天河区'
        && cellA.geo?.lat === 23.125
        && cellA.geo.lng === 113.5
        && cellA.activity === 'printing'
        && cellA.alert === null
        && !JSON.stringify(wallA).includes(termB),
    )
    assert(
      '5b. Partner B 格子是缺纸告警、活动空闲，未设坐标为 null',
      wallB?.available === true
        && cellB?.terminalId === termB
        && cellB.activity === 'idle'
        && cellB.alert?.kind === 'printer_issue'
        && cellB.alert.title === '打印机缺纸'
        && cellB.areaLabel === null
        && cellB.geo === null
        && !JSON.stringify(wallB).includes(termA),
    )
    assert(
      '5c. Admin 机队同时有两台，health 仍在',
      govCells.some((cell) => cell.terminalId === termA && cell.health === 'healthy' && cell.activity === 'printing')
        && govCells.some((cell) => cell.terminalId === termB && cell.alert?.title === '打印机缺纸'),
    )
    assert(
      '3e. Partner B 同步成功率按本机构聚合（1 成功 1 失败）',
      partnerB.metrics.syncSuccessRate24h?.available === true
        && partnerB.metrics.syncSuccessRate24h.value.total === 2
        && partnerB.metrics.syncSuccessRate24h.value.success === 1,
    )
    assert(
      '3f. Partner 打印/AI/跳转因缺 orgId 未接入，不给数字',
      partnerA.metrics.printPagesCumulative?.available === false
        && partnerA.metrics.aiCallsCumulative?.available === false
        && partnerA.metrics.sourceEntryOpensTop?.available === false
        && partnerA.metrics.sourceEntryOpensTop?.reason === SCREEN_UNAVAILABLE_REASON.missingImmutableSourceOrg,
    )
    assert(
      '3g. N<5 的来源不出现在 Top，文案是打开来源平台入口',
      ops.metrics.sourceEntryOpensTop?.available === true
        && ops.metrics.sourceEntryOpensTop.value.copy === SCREEN_JUMP_COPY
        && ops.metrics.sourceEntryOpensTop.value.items.some((item) => item.sourceName === jumpQualified && item.count >= 20)
        && !ops.metrics.sourceEntryOpensTop.value.items.some((item) => item.sourceName === jumpSmall),
    )
    const trendDays = gov.metrics.printTrend14d?.available === true
      ? gov.metrics.printTrend14d.value.days
      : []
    const todayPages = trendDays.find((day) => day.date === todayKey)?.pages
    const yesterdayPages = trendDays.find((day) => day.date === yesterdayKey)?.pages
    const copiesProduct = 3 * 9 + 5 * 13 + 7 * 11
    assert(
      '3h. 累计只计当前 paid 的内容页，不乘 copies，unpaid/refunded/paying 不计',
      gov.metrics.printPagesCumulative?.available === true
        && gov.metrics.printPagesCumulative.value.totalPages === 15
        && gov.metrics.printPagesCumulative.value.totalPages !== copiesProduct
        && gov.metrics.printPagesCumulative.value.byColor.available === false,
      gov.metrics.printPagesCumulative?.available
        ? `totalPages=${gov.metrics.printPagesCumulative.value.totalPages}`
        : 'unavailable',
    )
    assert(
      '3h2. 趋势按 paidAt 落入上海自然日，不按 createdAt',
      gov.metrics.printTrend14d?.available === true
        && todayPages === 10
        && yesterdayPages === 5,
      `today=${String(todayPages)} yesterday=${String(yesterdayPages)} key=${todayKey}/${yesterdayKey}`,
    )
    assert(
      '3h3. 今日失败按状态日志 createdAt，历史失败不因 updatedAt 复活',
      ops.metrics.printFailedToday?.available === true
        && ops.metrics.printFailedToday.value.failed === 1,
      ops.metrics.printFailedToday?.available
        ? `failed=${ops.metrics.printFailedToday.value.failed}`
        : 'unavailable',
    )

    let blankCaught: unknown
    try {
      await screen.getPartnerSnapshot('   ')
    } catch (error) {
      blankCaught = error
    }
    let emptySliceCaught: unknown
    try {
      await loadContentSlice(prisma, now, '' as never)
    } catch (error) {
      emptySliceCaught = error
    }
    let emptyFleetCaught: unknown
    try {
      await loadPartnerFleet(prisma, now, '\t')
    } catch (error) {
      emptyFleetCaught = error
    }
    const partnerController = new PartnerScreenController(screen)
    let controllerBlank: unknown
    try {
      await partnerController.getPartnerSnapshot({ userId: userA, role: 'partner', orgId: null }, {})
    } catch (error) {
      controllerBlank = error
    }
    let controllerWhitespace: unknown
    try {
      await partnerController.getPartnerSnapshot({ userId: userA, role: 'partner', orgId: '  ' }, {})
    } catch (error) {
      controllerWhitespace = error
    }
    assert(
      '3h4. 空白/空 orgId fail-closed，不泄露跨机构数据',
      blankCaught instanceof PartnerOrgRequiredError
        && emptySliceCaught instanceof PartnerOrgRequiredError
        && emptyFleetCaught instanceof PartnerOrgRequiredError
        && controllerBlank instanceof ForbiddenException
        && controllerWhitespace instanceof ForbiddenException
        && JSON.stringify((controllerBlank as ForbiddenException).getResponse()).includes('ORG_REQUIRED')
        && JSON.stringify((controllerWhitespace as ForbiddenException).getResponse()).includes('ORG_REQUIRED'),
    )

    const live = await loadPrintLiveSlice(prisma, now)
    const cumulative = await loadPrintCumulativeSlice(prisma, now)
    const cumulativeDays = cumulative.trend === 'capped' ? [] : cumulative.trend.days
    assert(
      '3h5. 查询函数与快照口径一致：paid 内容页=15、今日失败日志=1',
      live.failedToday === 1
        && cumulative.pages.totalPages === 15
        && cumulative.trend !== 'capped'
        && cumulativeDays.some((day) => day.date === todayKey && day.pages === 10)
        && cumulativeDays.some((day) => day.date === yesterdayKey && day.pages === 5),
    )
    const overflow = await loadPrintCumulativeSlice(prisma, now, { trendRowCap: 2 })
    const atCap = await loadPrintCumulativeSlice(prisma, now, { trendRowCap: 3 })
    const atCapDays = atCap.trend === 'capped' ? [] : atCap.trend.days
    assert(
      '3h6. 趋势 take=cap+1 溢出则 capped，未溢出则仍按 paidAt 窗口可算',
      overflow.trend === 'capped'
        && overflow.pages.totalPages === 15
        && atCap.trend !== 'capped'
        && atCap.pages.totalPages === 15
        && atCapDays.some((day) => day.date === todayKey && day.pages === 10)
        && atCapDays.some((day) => day.date === yesterdayKey && day.pages === 5),
      overflow.trend === 'capped'
        ? `overflow=capped atCapToday=${String(atCapDays.find((day) => day.date === todayKey)?.pages)}`
        : 'overflow-not-capped',
    )
    assert(
      '3i. 窗口、登录展示 LIMIT、freshness 写在响应里',
      gov.window.onlineWindowSeconds === 180
        && gov.window.realtimeTtlSeconds === 15
        && gov.window.countsTtlSeconds === 60
        && gov.window.cumulativeTtlSeconds === 300
        && gov.window.timezone === 'Asia/Shanghai'
        && gov.limits.displayToken === 'not_issued'
        && gov.limits.access === 'authenticated_console'
        && gov.status === 'ok'
        && gov.degraded === false
        && gov.freshness.realtime === 'miss'
        && /\d{4}-\d{2}-\d{2}T/.test(gov.generatedAt),
    )
    const payloadKeys = collectKeys({ gov, ops, partnerA, partnerB })
    const banned = [
      'endUserId', 'pickupCode', 'pickupCodeEnc', 'jobApplication', 'candidate',
      'funnel', 'fileUrl', 'fileMd5', 'phoneHash', 'phoneEnc', 'paramsJson',
    ]
    assert(
      '3j. 响应不含求职者身份或招聘闭环字段',
      !banned.some((key) => payloadKeys.has(key)),
      `命中 ${banned.filter((key) => payloadKeys.has(key)).join(',')}`,
    )
    const secrets = [
      'https://internal/secret',
      'https://internal/hist1',
      'https://internal/hist2',
      'https://internal/hist3',
      'https://internal/ok',
      `tok_a_${suffix}`,
      `tok_b_${suffix}`,
      `ph_${suffix}`,
      phoneEnc,
      pickupCode,
      memberId,
      userA,
      userB,
      adminId,
      userBlank,
      `fp_a_${suffix}`,
      `fp_b_${suffix}`,
      `file_scrn_${suffix}`,
      resumeFileName,
      'md5h1',
      'md5h2',
      'md5h3',
      'md5ok',
    ]
    const asText = JSON.stringify({ gov, ops, partnerA, partnerB })
    const leaked = secrets.filter((secret) => asText.includes(secret))
    assert(
      '3j2. 序列化快照不含敏感种子值',
      leaked.length === 0,
      `命中 ${leaked.join(',')}`,
    )
    assert('3k. 响应不含投递成功等违禁文案', !/投递成功|一键投递|立即投递|平台投递/.test(asText))
    assert('3l. Partner 响应 audience=partner 且 generatedAt 为 ISO', partnerA.audience === 'partner' && /\d{4}-\d{2}-\d{2}T/.test(partnerA.generatedAt))

    let fleetCalls = 0
    let seenFleetTake: unknown
    const originalFindMany = prisma.terminal.findMany.bind(prisma.terminal)
    prisma.terminal.findMany = (async (args?: unknown) => {
      fleetCalls += 1
      seenFleetTake = args && typeof args === 'object' ? (args as { take?: unknown }).take : undefined
      return originalFindMany(args as never)
    }) as typeof prisma.terminal.findMany
    cache.clear()
    const firstGov = await screen.getAdminSnapshot('gov')
    const secondOps = await screen.getAdminSnapshot('ops')
    assert(
      '3m. gov/ops 共享 realtime 缓存，fleet 只打一次且 take 有界',
      fleetCalls === 1 && seenFleetTake === FLEET_SAMPLE_TAKE,
      `calls=${fleetCalls} take=${String(seenFleetTake)}`,
    )
    assert('3n. 第二次命中 realtime 缓存', firstGov.freshness.realtime === 'miss' && secondOps.freshness.realtime === 'hit')
    prisma.terminal.findMany = originalFindMany

    const orgEmpty = `org_scrn_empty_${suffix}`
    await prisma.organization.create({
      data: { id: orgEmpty, name: '大屏空机构', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
    })
    const emptyPartner = await screen.getPartnerSnapshot(orgEmpty)
    assert(
      '3o. 空机构在架岗位 available:true 且 published=0，不是未接入',
      emptyPartner.status === 'ok'
        && emptyPartner.metrics.jobsOnShelf?.available === true
        && emptyPartner.metrics.jobsOnShelf.value.published === 0,
    )
    await prisma.organization.delete({ where: { id: orgEmpty } })

    cache.clear()
    prisma.terminal.findMany = (async () => {
      throw new Error('fleet slice down')
    }) as typeof prisma.terminal.findMany
    const degradedGov = await screen.getAdminSnapshot('gov')
    prisma.terminal.findMany = originalFindMany
    assert(
      '3p. 局部失败：机队 unavailable，其它计数仍在，status=degraded',
      degradedGov.status === 'degraded'
        && degradedGov.degraded
        && degradedGov.metrics.terminalsOnline?.available === false
        && degradedGov.metrics.terminalsOnline.reason === SCREEN_UNAVAILABLE_REASON.sourceQueryFailed
        && degradedGov.metrics.jobsOnShelf?.available === true,
    )

    cache.clear()
    let fleetAttempts = 0
    prisma.terminal.findMany = (async (args?: unknown) => {
      fleetAttempts += 1
      if (fleetAttempts === 1) throw new Error('transient fleet down')
      return originalFindMany(args as never)
    }) as typeof prisma.terminal.findMany
    const failedThen = await screen.getAdminSnapshot('gov')
    const recovered = await screen.getAdminSnapshot('gov')
    prisma.terminal.findMany = originalFindMany
    assert(
      '3r. 失败切片不入缓存，第二次会重新 load 且成功才缓存',
      failedThen.metrics.terminalsOnline?.available === false
        && recovered.metrics.terminalsOnline?.available === true
        && fleetAttempts === 2
        && recovered.freshness.realtime === 'miss',
      `attempts=${fleetAttempts}`,
    )
    cache.clear()
    const cachedOk = await screen.getAdminSnapshot('gov')
    const cachedOk2 = await screen.getAdminSnapshot('ops')
    assert(
      '3s. 成功结果才缓存',
      cachedOk.freshness.realtime === 'miss' && cachedOk2.freshness.realtime === 'hit',
    )

    cache.clear()
    opsService.listDerivedAlerts = (async () => {
      throw new Error('alerts slice down')
    }) as AdminOpsService['listDerivedAlerts']
    const govAlertsDown = await screen.getAdminSnapshot('gov')
    const opsAlertsDown = await screen.getAdminSnapshot('ops')
    opsService.listDerivedAlerts = (async (view, limit) => {
      alertCalls += 1
      return originalListDerivedAlerts(view, limit)
    }) as AdminOpsService['listDerivedAlerts']
    assert(
      '3v. gov 不因未加载的告警源降级；ops 告警失败才 degraded',
      govAlertsDown.status === 'ok'
        && govAlertsDown.degraded === false
        && !govAlertsDown.metrics.alertsRealtime
        && opsAlertsDown.status === 'degraded'
        && opsAlertsDown.metrics.alertsRealtime?.available === false
        && opsAlertsDown.metrics.alertsRealtime?.reason === SCREEN_UNAVAILABLE_REASON.sourceQueryFailed
        && opsAlertsDown.metrics.terminalsOnline?.available === true,
      `gov=${govAlertsDown.status} ops=${opsAlertsDown.status}`,
    )

    const extra = Array.from({ length: PARTNER_FLEET_TAKE }, (_, i) => ({
      id: `term_scrn_cap_${suffix}_${i}`,
      terminalCode: `SCRN-CAP-${suffix}-${String(i).padStart(3, '0')}`,
      agentToken: `tok_cap_${suffix}_${i}`,
      deviceFingerprint: `fp_cap_${suffix}_${i}`,
      orgId: orgA,
      enabled: true,
    }))
    await prisma.terminal.createMany({ data: extra })
    await prisma.terminalHeartbeat.createMany({
      data: extra.map((row) => ({ terminalId: row.id, status: 'online', createdAt: now })),
    })
    cache.clear()
    const cappedPartner = await screen.getPartnerSnapshot(orgA)
    const online = cappedPartner.metrics.terminalsOnline
    const wall = cappedPartner.metrics.fleetWall
    const sampleSum = online?.available === true
      ? online.value.healthy + online.value.degraded + online.value.offline + online.value.unknown
      : -1
    assert(
      '3q. Partner>200 时 total 是样本、matchedCount 是全量、分类加总等于样本',
      online?.available === true
        && wall?.available === true
        && online.value.truncated
        && wall.value.truncated
        && online.value.sampledCount === PARTNER_FLEET_TAKE
        && wall.value.sampledCount === PARTNER_FLEET_TAKE
        && wall.value.cells.length === PARTNER_FLEET_TAKE
        && online.value.total === online.value.sampledCount
        && sampleSum === online.value.total
        && online.value.matchedCount === PARTNER_FLEET_TAKE + 1
        && wall.value.matchedCount === PARTNER_FLEET_TAKE + 1
        && online.value.sampleCap === PARTNER_FLEET_TAKE
        && online.value.matchedCount !== sampleSum,
      online?.available === true
        ? `total=${online.value.total} sampled=${online.value.sampledCount} matched=${online.value.matchedCount} sum=${sampleSum}`
        : 'unavailable',
    )
    assert(
      '3j3. 截断机队快照仍不含 agentToken 种子',
      !JSON.stringify(cappedPartner).includes(`tok_cap_${suffix}`),
    )

    cache.clear()
    const adminFleet = await loadAdminFleet(prisma, now)
    const adminMapped = await screen.getAdminSnapshot('ops')
    const adminOnline = adminMapped.metrics.terminalsOnline
    assert(
      '3t. Admin 机队同样 count + 有界 sample，禁止无界 findMany',
      adminFleet.truncated
        && adminFleet.matchedCount === PARTNER_FLEET_TAKE + 2
        && adminFleet.overview.summary.total === FLEET_SAMPLE_TAKE
        && adminOnline?.available === true
        && adminOnline.value.truncated
        && adminOnline.value.sampledCount === FLEET_SAMPLE_TAKE
        && adminOnline.value.matchedCount === PARTNER_FLEET_TAKE + 2
        && adminOnline.value.sampleCap === FLEET_SAMPLE_TAKE,
      adminOnline?.available
        ? `sampled=${adminOnline.value.sampledCount} matched=${adminOnline.value.matchedCount}`
        : `slice matched=${adminFleet.matchedCount} total=${adminFleet.overview.summary.total}`,
    )

    cache.clear()
    let inflightFleetLoads = 0
    let releaseFleet!: () => void
    const fleetGate = new Promise<void>((resolve) => {
      releaseFleet = resolve
    })
    prisma.terminal.findMany = (async (args?: unknown) => {
      inflightFleetLoads += 1
      await fleetGate
      return originalFindMany(args as never)
    }) as typeof prisma.terminal.findMany
    const inflightGov = screen.getAdminSnapshot('gov')
    while (inflightFleetLoads < 1) await Promise.resolve()
    const inflightOps = screen.getAdminSnapshot('ops')
    releaseFleet()
    const [leftSnap, rightSnap] = await Promise.all([inflightGov, inflightOps])
    prisma.terminal.findMany = originalFindMany
    assert(
      '3u. 服务层同一 realtime key 并发 miss 只 load 机队一次',
      inflightFleetLoads === 1
        && leftSnap.metrics.terminalsOnline?.available === true
        && rightSnap.metrics.terminalsOnline?.available === true,
      `loads=${inflightFleetLoads}`,
    )

    await assertTwinCases(prisma, screen, cache, ids)
    await assertHttp(prisma, ids)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
    isolated.cleanup()
  }
}

async function assertTwinCases(
  prisma: PrismaService,
  screen: ConsoleScreenService,
  cache: ScreenSnapshotCache,
  ids: {
    orgA: string
    orgB: string
    termA: string
    termB: string
    adminId: string
    memberId: string
    taskA: string
    suffix: string
    resumeFileName: string
  },
): Promise<void> {
  cache.clear()
  const adminTwin = await screen.getAdminTerminalTwin(ids.termA)
  const storedTask = await prisma.printTask.findUnique({ where: { id: ids.taskA }, select: { claimedAt: true } })
  const adminText = JSON.stringify(adminTwin)
  const current = adminTwin.currentTask.available ? adminTwin.currentTask.value : undefined
  assert(
    '5d. 管理员孪生给出设备块，今日按上海日，访问和耗材不可用，且不含文件名',
    adminTwin.audience === 'admin'
      && adminTwin.terminal.id === ids.termA
      && adminTwin.terminal.areaLabel === '天河区'
      && adminTwin.terminal.locationLabel === '体育中心'
      && adminTwin.terminal.geo?.lat === 23.125
      && adminTwin.terminal.geo?.lng === 113.5
      && adminTwin.status.health === 'healthy'
      && adminTwin.status.onlineWindowSeconds === SCREEN_ONLINE_WINDOW_SECONDS
      && adminTwin.printer.available === true
      && adminTwin.printer.value.name === null
      && adminTwin.printer.value.state === 'printing'
      && adminTwin.printer.value.colorEnabled === false
      && adminTwin.printer.value.duplexEnabled === false
      && adminTwin.scanner.available === true
      && adminTwin.scanner.value.state === 'unknown'
      && adminTwin.currentTask.available === true
      && current !== null
      && current?.pages === 6
      && current?.colorMode === 'bw'
      && current?.startedAt === storedTask?.claimedAt?.toISOString()
      && adminTwin.today.printPages === 10
      && adminTwin.today.printTasks === 2
      && adminTwin.today.scans === 0
      && adminTwin.today.failed === 1
      && adminTwin.today.visits.available === false
      && adminTwin.today.visits.reason === SCREEN_UNAVAILABLE_REASON.kioskSessionUnwritten
      && !('value' in adminTwin.today.visits)
      && adminTwin.consumables.available === false
      && adminTwin.consumables.reason === SCREEN_UNAVAILABLE_REASON.noConsumableOrGeo
      && !('value' in adminTwin.consumables)
      && adminTwin.timeline24h.available === true
      && !adminText.includes(ids.resumeFileName)
      && !adminText.includes('fileName')
      && !adminText.includes('black_white')
      && !adminText.includes('https://internal/secret')
      && !adminText.includes(ids.memberId)
      && !adminText.includes('"copies"'),
  )
  const segments = adminTwin.timeline24h.available ? adminTwin.timeline24h.value : []
  assert(
    '5e. 孪生时间轴升序、首尾相接、相邻不同状态，且含 printing',
    segments.length > 0
      && segments.length <= TIMELINE_SEGMENT_CAP
      && segments.some((segment) => segment.state === 'printing')
      && segments.every((segment, index) => index === 0 || segment.from === segments[index - 1]?.to)
      && segments.every((segment, index) => index === segments.length - 1 || segment.state !== segments[index + 1]?.state),
  )
  const partnerTwin = await screen.getPartnerTerminalTwin(ids.orgA, ids.termA)
  assert(
    '5f. 机构 A 可读自己的终端孪生',
    partnerTwin.audience === 'partner' && partnerTwin.terminal.id === ids.termA && !JSON.stringify(partnerTwin).includes(ids.resumeFileName),
  )
  let foreign: unknown
  let missing: unknown
  try {
    await screen.getPartnerTerminalTwin(ids.orgA, ids.termB)
  } catch (error) {
    foreign = error
  }
  try {
    await screen.getPartnerTerminalTwin(ids.orgA, `missing_${ids.suffix}`)
  } catch (error) {
    missing = error
  }
  const foreignBody = foreign instanceof NotFoundException ? foreign.getResponse() : null
  const missingBody = missing instanceof NotFoundException ? missing.getResponse() : null
  const foreignText = JSON.stringify(foreignBody)
  assert(
    '5g. 别家终端与不存在是同一 404，响应不含对方编号或机构名',
    foreign instanceof NotFoundException
      && missing instanceof NotFoundException
      && foreignText === JSON.stringify(missingBody)
      && foreignText.includes('TERMINAL_NOT_FOUND')
      && !foreignText.includes(ids.termB)
      && !foreignText.includes(`SCRN-B-${ids.suffix}`)
      && !foreignText.includes('大屏机构B'),
  )
  const paperTwin = await screen.getAdminTerminalTwin(ids.termB)
  assert(
    '5h. 缺纸终端打印机为 error，没有当前任务时 value 为 null',
    paperTwin.printer.available === true
      && paperTwin.printer.value.state === 'error'
      && paperTwin.printer.value.errorLabel === '打印机缺纸'
      && paperTwin.currentTask.available === true
      && paperTwin.currentTask.value === null
      && paperTwin.scanner.available === true
      && paperTwin.scanner.value.state === 'unknown',
  )
  await prisma.scanTask.create({
    data: {
      id: `scan_${ids.suffix}`,
      terminalId: ids.termA,
      scanType: 'document',
      status: 'matched',
      expiresAt: new Date(Date.now() + 60_000),
    },
  })
  cache.clear()
  const busy = await screen.getAdminTerminalTwin(ids.termA)
  const busyFleet = await loadPartnerFleet(prisma, new Date(), ids.orgA)
  const busyCell = busyFleet.cells.find((cell) => cell.terminalId === ids.termA)
  assert(
    '5i. 进行中扫描为 busy，今日扫描 +1，打印状态仍优先',
    busy.scanner.available === true
      && busy.scanner.value.state === 'busy'
      && busy.scanner.value.label === null
      && busy.today.scans === 1
      && busy.printer.available === true
      && busy.printer.value.state === 'printing'
      && busyCell?.activity === 'printing',
  )
  await prisma.terminalCapability.create({
    data: { terminalId: ids.termA, capabilityKey: 'color_print', status: 'available' },
  })
  cache.clear()
  const colorTwin = await screen.getAdminTerminalTwin(ids.termA)
  assert(
    '5j. 只有 available 的 color_print 打开彩色，未登记双面仍关闭',
    colorTwin.printer.available === true
      && colorTwin.printer.value.colorEnabled === true
      && colorTwin.printer.value.duplexEnabled === false,
  )
  let uniqueCalls = 0
  const originalUnique = prisma.terminal.findUnique.bind(prisma.terminal)
  prisma.terminal.findUnique = (async (args?: unknown) => {
    uniqueCalls += 1
    return originalUnique(args as never)
  }) as typeof prisma.terminal.findUnique
  cache.clear()
  uniqueCalls = 0
  await screen.getAdminTerminalTwin(ids.termA)
  const firstCalls = uniqueCalls
  await screen.getAdminTerminalTwin(ids.termA)
  prisma.terminal.findUnique = originalUnique
  assert(
    '5k. 孪生第二次命中 15 秒缓存，不再装载终端行',
    firstCalls >= 2 && uniqueCalls === firstCalls + 1,
    `first=${firstCalls} second=${uniqueCalls}`,
  )
  const offAt = new Date(Date.now() - 34 * 60_000)
  const offId = `term_scrn_off_${ids.suffix}`
  const neverId = `term_scrn_never_${ids.suffix}`
  const claimId = `term_scrn_claim_${ids.suffix}`
  await prisma.terminal.createMany({
    data: [
      { id: offId, terminalCode: `000-OFF-${ids.suffix}`, agentToken: `tok_off_${ids.suffix}`, deviceFingerprint: `fp_off_${ids.suffix}`, orgId: ids.orgA, enabled: true },
      { id: neverId, terminalCode: `000-NEVER-${ids.suffix}`, agentToken: `tok_nv_${ids.suffix}`, deviceFingerprint: `fp_nv_${ids.suffix}`, orgId: ids.orgA, enabled: true },
      { id: claimId, terminalCode: `000-CLAIM-${ids.suffix}`, agentToken: `tok_cl_${ids.suffix}`, deviceFingerprint: `fp_cl_${ids.suffix}`, orgId: ids.orgA, enabled: true },
    ],
  })
  await prisma.terminalHeartbeat.create({
    data: { terminalId: offId, status: 'online', printerStatus: 'paper_empty', createdAt: offAt },
  })
  await prisma.printTask.create({
    data: {
      id: `pt_claim_${ids.suffix}`,
      terminalId: claimId,
      fileUrl: 'https://internal/claim-secret',
      fileMd5: 'md5claim',
      paramsJson: JSON.stringify({ fileName: ids.resumeFileName, billablePages: 3, colorMode: 'color' }),
      status: 'claimed',
      claimedAt: new Date(),
    },
  })
  const fleet = await loadPartnerFleet(prisma, new Date(), ids.orgA)
  const fleetText = JSON.stringify(fleet)
  const offCell = fleet.cells.find((cell) => cell.terminalId === offId)
  const neverCell = fleet.cells.find((cell) => cell.terminalId === neverId)
  const claimCell = fleet.cells.find((cell) => cell.terminalId === claimId)
  assert(
    '5l. 离线 34 分钟、从未上报、已领取算打印中，机构墙不含别家 terminalId 和文件名',
    offCell?.alert?.kind === 'offline'
      && offCell.alert.title === '离线 34 分钟'
      && offCell.alert.since === offAt.toISOString()
      && offCell.activity === null
      && neverCell?.alert?.kind === 'never_reported'
      && neverCell.alert.title === '从未上报'
      && neverCell.alert.since === null
      && neverCell.health === 'unknown'
      && claimCell?.activity === 'printing'
      && claimCell.alert?.kind === 'never_reported'
      && fleet.cells.every((cell) => cell.terminalId !== ids.termB)
      && !fleetText.includes(ids.termB)
      && !fleetText.includes(ids.resumeFileName)
      && !fleetText.includes('https://internal/claim-secret'),
  )
  process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-terminal-admin-secret-not-production'
  process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-terminal-action-secret-not-production'
  const [{ AuditService }, { AdminTerminalsController }, { TerminalToolboxService }, { TerminalAdminService }, { TerminalAgentService }, { TerminalsService }] = await Promise.all([
    import('../src/audit/audit.service'),
    import('../src/terminals/admin-terminals.controller'),
    import('../src/terminals/terminal-toolbox.service'),
    import('../src/terminals/terminals-admin.service'),
    import('../src/terminals/terminals-agent.service'),
    import('../src/terminals/terminals.service'),
  ])
  const audit = new AuditService(prisma)
  const agent = new TerminalAgentService(prisma, audit)
  const adminSvc = new TerminalAdminService(prisma, agent, new TerminalToolboxService(prisma), undefined as never)
  const terminals = new TerminalsService(agent, adminSvc)
  const controller = new AdminTerminalsController(terminals, undefined as never, audit)
  const actor = { userId: ids.adminId, role: 'admin' as const, orgId: null }
  const req = { headers: {} }
  const auditWhere = { action: 'terminal.profile.update', targetId: `SCRN-B-${ids.suffix}` }
  const before = await prisma.auditLog.count({ where: auditWhere })
  let areaError: unknown
  let pairError: unknown
  let rangeError: unknown
  try {
    await controller.updateProfile(ids.termB, { areaLabel: '一二三四五六七八九十一二三四五六七八九十一' }, actor, req)
  } catch (error) {
    areaError = error
  }
  try {
    await controller.updateProfile(ids.termB, { geoLat: 23.1 }, actor, req)
  } catch (error) {
    pairError = error
  }
  try {
    await controller.updateProfile(ids.termB, { geoLat: 0, geoLng: 0 }, actor, req)
  } catch (error) {
    rangeError = error
  }
  const afterReject = await prisma.auditLog.count({ where: auditWhere })
  const saved = await controller.updateProfile(ids.termB, { areaLabel: ' 越秀区 ', geoLat: 23.125, geoLng: 113.5 }, actor, req)
  const inclusive = terminalPlacementPatch({ geoLat: CHINA_LAT_MIN, geoLng: CHINA_LNG_MAX })
  let belowRange: unknown
  try {
    terminalPlacementPatch({ geoLat: CHINA_LAT_MIN - 0.01, geoLng: CHINA_LNG_MAX })
  } catch (error) {
    belowRange = error
  }
  const auditRow = await prisma.auditLog.findFirst({ where: auditWhere, orderBy: { createdAt: 'desc' } })
  const payload = JSON.parse(auditRow?.payloadJson ?? '{}') as { areaLabel?: string; geoLat?: number; geoLng?: number }
  const kept = await controller.updateProfile(ids.termB, { displayName: '只改名称' }, actor, req)
  const cleared = await controller.updateProfile(ids.termB, { geoLat: null, geoLng: null }, actor, req)
  assert(
    '5m. 所在区超过 20 字、经纬度不成对或越界被拒绝且不写审计；成功写入有审计；局部更新不抹坐标',
    areaError instanceof BadRequestException
      && JSON.stringify((areaError as BadRequestException).getResponse()).includes('TERMINAL_AREA_LABEL_INVALID')
      && pairError instanceof BadRequestException
      && JSON.stringify((pairError as BadRequestException).getResponse()).includes('TERMINAL_GEO_INVALID')
      && rangeError instanceof BadRequestException
      && JSON.stringify((rangeError as BadRequestException).getResponse()).includes('TERMINAL_GEO_INVALID')
      && afterReject === before
      && saved.data.areaLabel === '越秀区'
      && saved.data.geoLat === 23.125
      && saved.data.geoLng === 113.5
      && inclusive.geoLat === CHINA_LAT_MIN
      && inclusive.geoLng === CHINA_LNG_MAX
      && belowRange instanceof BadRequestException
      && payload.areaLabel === '越秀区'
      && payload.geoLat === 23.125
      && payload.geoLng === 113.5
      && kept.data.displayName === '只改名称'
      && kept.data.areaLabel === '越秀区'
      && kept.data.geoLat === 23.125
      && cleared.data.geoLat === null
      && cleared.data.geoLng === null
      && cleared.data.areaLabel === '越秀区',
  )

  const steadyId = `term_scrn_steady_${ids.suffix}`
  const floodId = `term_scrn_flood_${ids.suffix}`
  const retryId = `term_scrn_retry_${ids.suffix}`
  await prisma.terminal.createMany({
    data: [
      { id: steadyId, terminalCode: `SCRN-STD-${ids.suffix}`, agentToken: `tok_std_${ids.suffix}`, deviceFingerprint: `fp_std_${ids.suffix}`, orgId: ids.orgA, enabled: true },
      { id: floodId, terminalCode: `SCRN-FLD-${ids.suffix}`, agentToken: `tok_fld_${ids.suffix}`, deviceFingerprint: `fp_fld_${ids.suffix}`, orgId: ids.orgA, enabled: true },
      { id: retryId, terminalCode: `SCRN-RTY-${ids.suffix}`, agentToken: `tok_rty_${ids.suffix}`, deviceFingerprint: `fp_rty_${ids.suffix}`, orgId: ids.orgA, enabled: true },
    ],
  })
  const steadyAnchor = new Date()
  const steadyTimes: Date[] = []
  for (let at = steadyAnchor.getTime() - 24 * 60 * 60 * 1000; at <= steadyAnchor.getTime(); at += 30_000) {
    steadyTimes.push(new Date(at))
  }
  await createOnlineHeartbeats(prisma, steadyId, steadyTimes, 'ready')
  await prisma.terminalHeartbeat.create({
    data: { terminalId: steadyId, status: 'online', printerStatus: 'ready', createdAt: new Date() },
  })
  cache.clear()
  const steadyTwin = await screen.getAdminTerminalTwin(steadyId)
  const steadySegments = steadyTwin.timeline24h.available ? steadyTwin.timeline24h.value : []
  const steadyIdle = steadySegments.filter((segment) => segment.state === 'idle').length
  assert(
    '5s. 30 秒一次、全天在线的终端 timeline24h 可用，合并后只有 1 段 idle',
    steadyTwin.timeline24h.available === true
      && steadySegments.length === 1
      && steadyIdle === 1
      && steadySegments[0]?.state === 'idle',
    `available=${String(steadyTwin.timeline24h.available)} segments=${steadySegments.length} idle=${steadyIdle} rows=${steadyTimes.length + 1} cap=${TIMELINE_HEARTBEAT_ROW_CAP}`,
  )

  const floodAt = Date.now()
  await createOnlineHeartbeats(
    prisma,
    floodId,
    Array.from({ length: TIMELINE_HEARTBEAT_ROW_CAP + 1 }, () => new Date(floodAt)),
    'ready',
  )
  cache.clear()
  const floodTwin = await screen.getAdminTerminalTwin(floodId)
  assert(
    '5t. 心跳行数超过上限时 timeline24h 仍如实不可用',
    floodTwin.timeline24h.available === false
      && floodTwin.timeline24h.reason === SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded,
    floodTwin.timeline24h.available ? 'available' : floodTwin.timeline24h.reason,
  )

  const retryDone = new Date(Date.now() - 30 * 60_000)
  const retryStart = new Date(retryDone.getTime() - 24_000)
  const retryTaskId = `pt_scrn_retry_${ids.suffix}`
  await prisma.printTask.create({
    data: {
      id: retryTaskId,
      terminalId: retryId,
      fileUrl: 'https://internal/retry-secret',
      fileMd5: 'md5retry',
      paramsJson: '{}',
      status: 'completed',
      claimedAt: retryStart,
      completedAt: retryDone,
      createdAt: retryStart,
    },
  })
  await prisma.printTaskStatusLog.createMany({
    data: [
      ...Array.from({ length: 24 }, (_, index) => ({
        taskId: retryTaskId,
        fromStatus: index === 0 ? 'claimed' : 'printing',
        toStatus: 'printing',
        createdAt: new Date(retryStart.getTime() + index * 1_000),
      })),
      { taskId: retryTaskId, fromStatus: 'printing', toStatus: 'completed', createdAt: retryDone },
    ],
  })
  await prisma.terminalHeartbeat.create({
    data: { terminalId: retryId, status: 'online', printerStatus: 'ready', createdAt: new Date() },
  })
  cache.clear()
  const retryTwin = await screen.getAdminTerminalTwin(retryId)
  const retrySegments = retryTwin.timeline24h.available ? retryTwin.timeline24h.value : []
  const timelineEnd = retrySegments[retrySegments.length - 1]?.to
  const printing = retrySegments.filter((segment) => segment.state === 'printing')
  assert(
    '5u. 25 次流转后已完成的任务不会被画成打印到现在',
    retryTwin.timeline24h.available === true
      && printing.length >= 1
      && timelineEnd !== undefined
      && printing.every((segment) => segment.to !== timelineEnd && Date.parse(segment.to) <= retryDone.getTime()),
    `end=${timelineEnd ?? 'none'} printing=${printing.map((segment) => `${segment.from}->${segment.to}`).join(',') || 'none'}`,
  )
}

async function assertHttp(
  prisma: PrismaService,
  ids: {
    adminId: string
    userA: string
    orgA: string
    orgB: string
    userBlank: string
    termA: string
    termB: string
    suffix: string
    resumeFileName: string
  },
): Promise<void> {
  if (process.env['CONSOLE_SCREEN_SKIP_HTTP'] === '1') {
    console.log('  SKIP HTTP（CONSOLE_SCREEN_SKIP_HTTP=1）')
    return
  }
  process.env['JWT_SECRET'] ||= 'dev-only-secret-please-replace-in-prod-min-16-chars'
  const jwtSecret = process.env['JWT_SECRET']
  const redisStub = {
    get: async () => null,
    del: async () => 0,
    setJsonIfVersionNotOlder: async () => 'stored' as const,
  }
  const cache = new ScreenSnapshotCache()
  @Module({
    imports: [JwtModule.register({ secret: jwtSecret, signOptions: { expiresIn: '30m' } })],
    controllers: [AdminScreenController, PartnerScreenController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AdminOpsService,
      ConsoleScreenService,
      { provide: ScreenSnapshotCache, useValue: cache },
      JwtAuthGuard,
      RolesGuard,
      Reflector,
      { provide: RedisService, useValue: redisStub },
    ],
  })
  class ScreenHttpModule {}

  const app = await NestFactory.create<NestExpressApplication>(ScreenHttpModule, { logger: ['error'] })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' },
    }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  try {
    const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`
    const jwt = app.get(JwtService)
    const adminToken = jwt.sign({ sub: ids.adminId, ver: 0, jti: randomUUID() })
    const partnerToken = jwt.sign({ sub: ids.userA, ver: 0, jti: randomUUID() })
    const adminAuth = { Authorization: `Bearer ${adminToken}`, Accept: 'application/json' }
    const partnerAuth = { Authorization: `Bearer ${partnerToken}`, Accept: 'application/json' }

    const unauth = await fetch(`${base}/admin/screen/snapshot?profile=gov`)
    assert('4a. 无 token 访问 admin snapshot 为 401', unauth.status === 401, `status=${unauth.status}`)

    const badProfile = await fetch(`${base}/admin/screen/snapshot?profile=public`, { headers: adminAuth })
    assert('4b. 非法 profile 为 400', badProfile.status === 400, `status=${badProfile.status}`)

    const partnerOnAdmin = await fetch(`${base}/admin/screen/snapshot?profile=gov`, { headers: partnerAuth })
    assert('4c. partner 调 admin snapshot 为 403', partnerOnAdmin.status === 403, `status=${partnerOnAdmin.status}`)

    const adminOnPartner = await fetch(`${base}/partner/screen/snapshot`, { headers: adminAuth })
    assert('4d. admin 调 partner snapshot 为 403', adminOnPartner.status === 403, `status=${adminOnPartner.status}`)

    const orgQuery = await fetch(`${base}/partner/screen/snapshot?orgId=${ids.orgA}`, { headers: partnerAuth })
    assert('4e. Partner 传 orgId 查询参数被拒绝', orgQuery.status === 400, `status=${orgQuery.status}`)

    const govRes = await fetch(`${base}/admin/screen/snapshot?profile=gov`, { headers: adminAuth })
    const govBody = await govRes.json() as { success?: boolean; data?: { profile?: string } }
    assert('4f. Admin gov 信封为 ApiResponse.ok', govRes.status === 200 && govBody.success === true && govBody.data?.profile === 'gov', JSON.stringify(govBody).slice(0, 200))

    const partnerRes = await fetch(`${base}/partner/screen/snapshot`, { headers: partnerAuth })
    const partnerBody = await partnerRes.json() as {
      audience?: string
      profile?: string
      success?: boolean
      metrics?: { jobsOnShelf?: { available?: boolean; value?: { published?: number } } }
    }
    assert(
      '4g. Partner snapshot 为裸对象且 audience=partner',
      partnerRes.status === 200 && partnerBody.audience === 'partner' && partnerBody.profile === 'partner' && partnerBody.success === undefined,
      JSON.stringify(partnerBody).slice(0, 200),
    )

    const missingProfile = await fetch(`${base}/admin/screen/snapshot`, { headers: adminAuth })
    assert('4i. 缺 profile 为 400', missingProfile.status === 400, `status=${missingProfile.status}`)

    const displayMode = await fetch(`${base}/admin/screen/snapshot?profile=gov&mode=display`, { headers: adminAuth })
    assert('4j. mode=display 不在白名单，400 fail-closed', displayMode.status === 400, `status=${displayMode.status}`)

    const spoofToken = jwt.sign({
      sub: ids.userA,
      ver: 0,
      jti: randomUUID(),
      orgId: 'org_spoof_from_jwt',
      role: 'admin',
    })
    const spoofRes = await fetch(`${base}/partner/screen/snapshot`, {
      headers: { Authorization: `Bearer ${spoofToken}`, Accept: 'application/json' },
    })
    const spoofBody = await spoofRes.json() as {
      audience?: string
      metrics?: { jobsOnShelf?: { available?: boolean; value?: { published?: number } } }
    }
    assert(
      '4h. JWT 内 orgId/role 声明不被采信，仍按 User 表机构隔离',
      spoofRes.status === 200
        && spoofBody.audience === 'partner'
        && spoofBody.metrics?.jobsOnShelf?.available === true
        && spoofBody.metrics.jobsOnShelf.value?.published === 1,
      JSON.stringify(spoofBody).slice(0, 240),
    )

    const blankToken = jwt.sign({ sub: ids.userBlank, ver: 0, jti: randomUUID() })
    const blankRes = await fetch(`${base}/partner/screen/snapshot`, {
      headers: { Authorization: `Bearer ${blankToken}`, Accept: 'application/json' },
    })
    const blankText = await blankRes.text()
    assert(
      '4k. 未绑定机构的 partner 请求 fail-closed，响应不含跨机构岗位',
      blankRes.status === 401
        && !blankText.includes('A岗1')
        && !blankText.includes('B岗1')
        && !/"published":\s*[1-9]/.test(blankText),
      `status=${blankRes.status} body=${blankText.slice(0, 200)}`,
    )

    const twinUnauth = await fetch(`${base}/admin/screen/terminals/${ids.termA}`)
    assert('5n. 无 token 访问终端孪生为 401', twinUnauth.status === 401, `status=${twinUnauth.status}`)
    const twinRole = await fetch(`${base}/admin/screen/terminals/${ids.termA}`, { headers: partnerAuth })
    assert('5o. partner 调 admin 孪生为 403', twinRole.status === 403, `status=${twinRole.status}`)
    const adminTwinRes = await fetch(`${base}/admin/screen/terminals/${ids.termA}`, { headers: adminAuth })
    const adminTwinBody = await adminTwinRes.json() as { success?: boolean; data?: { terminal?: { id?: string }; printer?: { value?: { colorEnabled?: boolean } } } }
    const adminTwinText = JSON.stringify(adminTwinBody)
    assert(
      '5p. Admin 孪生走 ApiResponse，且响应 JSON 不含中文文件名',
      adminTwinRes.status === 200
        && adminTwinBody.success === true
        && adminTwinBody.data?.terminal?.id === ids.termA
        && adminTwinBody.data?.printer?.value?.colorEnabled === true
        && !adminTwinText.includes(ids.resumeFileName)
        && !adminTwinText.includes('fileName'),
      adminTwinText.slice(0, 240),
    )
    const partnerTwinRes = await fetch(`${base}/partner/screen/terminals/${ids.termA}`, { headers: partnerAuth })
    const partnerTwinBody = await partnerTwinRes.json() as { audience?: string; success?: boolean; terminal?: { id?: string } }
    assert(
      '5q. Partner 孪生是裸对象',
      partnerTwinRes.status === 200
        && partnerTwinBody.audience === 'partner'
        && partnerTwinBody.success === undefined
        && partnerTwinBody.terminal?.id === ids.termA,
    )
    const foreignRes = await fetch(`${base}/partner/screen/terminals/${ids.termB}?orgId=${ids.orgB}`, { headers: partnerAuth })
    const missingRes = await fetch(`${base}/partner/screen/terminals/missing_${ids.suffix}`, { headers: partnerAuth })
    const foreignHttp = await foreignRes.text()
    const missingHttp = await missingRes.text()
    const normalize404 = (text: string) => {
      const body = JSON.parse(text) as { requestId?: string }
      delete body.requestId
      return JSON.stringify(body)
    }
    assert(
      '5r. HTTP 上别家终端与不存在同一 404，query orgId 不能改范围',
      foreignRes.status === 404
        && missingRes.status === 404
        && normalize404(foreignHttp) === normalize404(missingHttp)
        && !foreignHttp.includes(`SCRN-B-${ids.suffix}`)
        && !foreignHttp.includes('大屏机构B')
        && !foreignHttp.includes(ids.resumeFileName),
      `foreign=${foreignRes.status} ${foreignHttp.slice(0, 180)} missing=${missingRes.status}`,
    )
  } finally {
    await app.close()
  }
}

async function main(): Promise<void> {
  console.log('\n=== console screen snapshot 契约 ===\n')
  assertSourceContract()
  await assertPureHelpers()
  await assertServiceContract()
  console.log(`\n${'─'.repeat(52)}`)
  console.log(`PASS: ${passed}  FAIL: ${failed}  TOTAL: ${passed + failed}`)
  if (failed > 0) {
    console.error('\n❌ verify:console-screen-snapshot FAILED')
    process.exit(1)
  }
  console.log('\n✅ verify:console-screen-snapshot PASSED')
}

main().catch((error: unknown) => {
  console.error('\n❌ verify:console-screen-snapshot 执行异常')
  console.error(error)
  process.exit(1)
})
