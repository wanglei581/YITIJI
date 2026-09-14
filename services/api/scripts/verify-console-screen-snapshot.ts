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
import { BadRequestException, Module, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
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
} from '../src/console-screen/console-screen.types'
import {
  SCREEN_CACHE_TTL_SECONDS as SHARED_CACHE_TTL_SECONDS,
  SCREEN_JUMP_COPY as SHARED_JUMP_COPY,
  SCREEN_MIN_AGGREGATE_SAMPLE as SHARED_MIN_AGGREGATE_SAMPLE,
} from '../../../packages/shared/src/types/consoleScreen'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminOpsService } from '../src/admin-ops/admin-ops.service'
import { DeviceFleetService } from '../src/device-fleet/device-fleet.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { AdminScreenController, PartnerScreenController } from '../src/console-screen/console-screen.controller'
import { ConsoleScreenService } from '../src/console-screen/console-screen.service'
import { filterSourceEntryOpens } from '../src/console-screen/console-screen.metric'
import { metricKeysFor } from '../src/console-screen/console-screen.assemble'
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

function normalizeContractSource(source: string): string {
  return stripComments(source).replace(/\s+/g, '\n').trim()
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
    '1z. shared 与 API 类型副本去注释后正文一致',
    normalizeContractSource(sharedTypes) === normalizeContractSource(apiTypes),
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
  const controller = stripComments(readSrc('src/console-screen/console-screen.controller.ts'))
  const dto = stripComments(readSrc('src/console-screen/console-screen.dto.ts'))
  const service = stripComments(readSrc('src/console-screen/console-screen.service.ts'))
  const queries = stripComments(readSrc('src/console-screen/console-screen.queries.ts'))
  const moduleDir = [
    'console-screen.controller.ts',
    'console-screen.service.ts',
    'console-screen.queries.ts',
    'console-screen.assemble.ts',
    'console-screen.cache.ts',
    'console-screen.dto.ts',
    'console-screen.metric.ts',
    'console-screen.module.ts',
  ].map((name) => stripComments(readSrc(`src/console-screen/${name}`))).join('\n')

  assert(
    '1a. Admin 端点有 JwtAuthGuard + RolesGuard + @Roles(admin)',
    /@UseGuards\(JwtAuthGuard, RolesGuard\)/.test(controller)
      && /@Roles\('admin'\)/.test(controller)
      && /@Get\('admin\/screen\/snapshot'\)/.test(controller),
  )
  assert(
    '1b. Partner 端点有 JwtAuthGuard + RolesGuard + @Roles(partner)',
    /@Roles\('partner'\)/.test(controller) && /@Get\('partner\/screen\/snapshot'\)/.test(controller),
  )
  assert(
    '1c. Partner orgId 只从 CurrentUser 取，不读 query.orgId',
    /user\.orgId/.test(controller)
      && !/query\.orgId|_query\.orgId/.test(controller)
      && /class PartnerScreenQueryDto \{\s*\}/.test(dto),
  )
  assert(
    '1d. Admin DTO 只白名单 profile=gov|ops',
    /@IsIn\(\['gov', 'ops'\]\)/.test(dto) && !/orgId/.test(dto),
  )
  assert(
    '1e. 不签发只读展示令牌，不复用公开 terminal config',
    !/BindCode|printer-status|terminals\/:id\/config/.test(moduleDir)
      && /displayToken: 'not_issued'/.test(readSrc('src/console-screen/console-screen.metric.ts'))
      && !/@Get\('.*screen\/token/.test(controller),
  )
  assert(
    '1f. 大屏模块不扫 JobApplication，不复用 take:10000 的 AI usage',
    !/jobApplication|JobApplication/.test(moduleDir)
      && !/take:\s*10_000|take:\s*10000/.test(moduleDir)
      && !/ai-log\.service/.test(moduleDir)
      && !/files\.service/.test(moduleDir),
  )
  assert(
    '1g. 聚合走 count/groupBy/aggregate，打印趋势有行数上限，招聘会结构不 findMany',
    /groupBy\(/.test(queries)
      && /aggregate\(/.test(queries)
      && /take:\s*PRINT_TREND_ROW_CAP/.test(queries)
      && /prisma\.jobFair\.count/.test(queries)
      && !/prisma\.jobFair\.findMany/.test(queries)
      && !/findMany\(\s*\{[^}]*where:\s*\{\s*deletedAt:\s*null/.test(queries),
  )
  assert(
    '1h. 在线窗口复用 device-fleet 180 秒',
    service.includes('DeviceFleetService')
      && queries.includes('DEVICE_FLEET_ONLINE_WINDOW_SECONDS')
      && SCREEN_ONLINE_WINDOW_SECONDS === 180,
  )
  assert(
    '1k. Partner 内容聚合在 orgId 存在时下推 sourceOrgId',
    /buildPublishedJobWhere\(\{\s*sourceOrgId:\s*orgId/.test(queries)
      && /orgId \? \{ orgId \}/.test(queries)
      && /where:\s*\{\s*orgId\s*\}/.test(queries),
  )
  assert(
    '1i. 缓存三档 15/60/300 且 Partner 缓存键含 orgId',
    SCREEN_CACHE_TTL_SECONDS.realtime === 15
      && SCREEN_CACHE_TTL_SECONDS.counts === 60
      && SCREEN_CACHE_TTL_SECONDS.cumulative === 300
      && /partner:\$\{orgId\}:realtime/.test(service),
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
  const cache = new ScreenSnapshotCache(() => now)
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
  const fleet = new DeviceFleetService(prisma)
  const ops = new AdminOpsService(prisma)
  const screen = new ConsoleScreenService(prisma, fleet, ops, cache)

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
  const ids = { orgA, orgB, srcA, srcB, termA, termB, userA, userB, adminId, memberId, taskA }

  const cleanup = async () => {
    await prisma.externalJumpLog.deleteMany({ where: { endUserId: memberId } })
    await prisma.aiServiceLog.deleteMany({ where: { terminalId: { in: [termA, termB] } } })
    await prisma.printTask.deleteMany({ where: { id: taskA } })
    await prisma.order.deleteMany({ where: { terminalId: { in: [termA, termB] } } })
    await prisma.syncLog.deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
    await prisma.job.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.jobFair.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.companyProfile.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.jobSource.deleteMany({ where: { id: { in: [srcA, srcB] } } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: [termA, termB] } } })
    await prisma.terminal.deleteMany({ where: { id: { in: [termA, termB] } } })
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB, adminId] } } })
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
      ],
    })
    await prisma.endUser.create({
      data: { id: memberId, phoneHash: `ph_${suffix}`, phoneEnc: 'enc' },
    })
    await prisma.terminal.createMany({
      data: [
        { id: termA, terminalCode: `SCRN-A-${suffix}`, agentToken: `tok_a_${suffix}`, deviceFingerprint: `fp_a_${suffix}`, orgId: orgA, enabled: true },
        { id: termB, terminalCode: `SCRN-B-${suffix}`, agentToken: `tok_b_${suffix}`, deviceFingerprint: `fp_b_${suffix}`, orgId: orgB, enabled: true },
      ],
    })
    await prisma.terminalHeartbeat.createMany({
      data: [
        { terminalId: termA, status: 'online', createdAt: now },
        { terminalId: termB, status: 'online', createdAt: now },
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
    await prisma.printTask.create({
      data: { id: taskA, terminalId: termA, fileUrl: 'https://internal/secret', fileMd5: 'md5', paramsJson: '{}', status: 'printing' },
    })
    await prisma.order.create({
      data: { orderNo: `SCRN-${suffix}`, type: 'print', terminalId: termA, amountCents: 50, billablePages: 3, payStatus: 'paid', taskStatus: 'printing' },
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
    const ops = await screen.getAdminSnapshot('ops')
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
    assert(
      '3h. 累计打印页来自 Order.billablePages 聚合',
      gov.metrics.printPagesCumulative?.available === true
        && gov.metrics.printPagesCumulative.value.totalPages >= 3
        && gov.metrics.printPagesCumulative.value.byColor.available === false,
    )
    assert(
      '3i. 窗口与令牌 LIMIT 写在响应里',
      gov.window.onlineWindowSeconds === 180
        && gov.window.realtimeTtlSeconds === 15
        && gov.window.countsTtlSeconds === 60
        && gov.window.cumulativeTtlSeconds === 300
        && gov.window.timezone === 'Asia/Shanghai'
        && gov.limits.displayToken === 'not_issued'
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
    const asText = JSON.stringify({ gov, ops, partnerA, partnerB })
    assert('3k. 响应不含投递成功等违禁文案', !/投递成功|一键投递|立即投递|平台投递/.test(asText))
    assert('3l. Partner 响应 audience=partner 且 generatedAt 为 ISO', partnerA.audience === 'partner' && /\d{4}-\d{2}-\d{2}T/.test(partnerA.generatedAt))

    let fleetCalls = 0
    const original = fleet.getOverview.bind(fleet)
    fleet.getOverview = async () => {
      fleetCalls += 1
      return original()
    }
    cache.clear()
    await screen.getAdminSnapshot('gov')
    await screen.getAdminSnapshot('ops')
    assert('3m. gov/ops 共享 realtime 缓存，fleet 只打一次', fleetCalls === 1, `calls=${fleetCalls}`)

    await assertHttp(prisma, ids)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
    isolated.cleanup()
  }
}

async function assertHttp(
  prisma: PrismaService,
  ids: { adminId: string; userA: string; orgA: string },
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
      DeviceFleetService,
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
