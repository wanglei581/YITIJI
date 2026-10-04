import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCREEN_CACHE_TTL_SECONDS, SCREEN_JUMP_COPY, SCREEN_MIN_AGGREGATE_SAMPLE, SCREEN_ONLINE_WINDOW_SECONDS, SCREEN_UNAVAILABLE_REASON } from '../src/console-screen/console-screen.types'
import { SCREEN_CACHE_TTL_SECONDS as SHARED_CACHE_TTL_SECONDS, SCREEN_JUMP_COPY as SHARED_JUMP_COPY, SCREEN_MIN_AGGREGATE_SAMPLE as SHARED_MIN_AGGREGATE_SAMPLE } from '../../../packages/shared/src/types/consoleScreen'
import { SCREEN_CACHE_MAX_KEYS } from '../src/console-screen/console-screen.cache'
import { FLEET_SAMPLE_TAKE, JUMP_SOURCE_GROUP_TAKE, PARTNER_FLEET_TAKE } from '../src/console-screen/console-screen.metric'
import { assert, readSrc, stripComments, contractBody, assertSourceContractSetup } from './console-screen-snapshot-cases-01'
import { carryContext } from './console-screen-snapshot-cases-18'



export function assertSourceContractPhase1(context: ReturnType<typeof assertSourceContractSetup>) {
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
assert(
    '1y. 招聘内容托管未开启是稳定原因码',
    SCREEN_UNAVAILABLE_REASON.recruitmentHostingDisabled === 'recruitment_hosting_disabled',
  )
const adminController = stripComments(readSrc('src/console-screen/console-screen.admin.controller.ts'))
const partnerController = stripComments(readSrc('src/console-screen/console-screen.partner.controller.ts'))
const dto = stripComments(readSrc('src/console-screen/console-screen.dto.ts'))
const service = stripComments(readSrc('src/console-screen/console-screen.service.ts'))
const queries = stripComments(readSrc('src/console-screen/console-screen.queries.ts'))
const printedPages = stripComments(readSrc('src/console-screen/console-screen.printed-pages.ts'))
const moduleDir = [
    'console-screen.admin.controller.ts',
    'console-screen.partner.controller.ts',
    'console-screen.service.ts',
    'console-screen.queries.ts',
    'console-screen.printed-pages.ts',
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
      && /loadPrintedPagesTrend\(/.test(queries)
      && /take:\s*rowCap\s*\+\s*1/.test(printedPages)
      && /rowCap \?\? PRINT_TREND_ROW_CAP/.test(printedPages)
      && /orderBy:\s*\[\s*\{\s*completedAt:\s*'asc'\s*\},\s*\{\s*id:\s*'asc'\s*\}/.test(printedPages)
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
return carryContext(context, { sharedTypes, apiTypes, adminController, partnerController, dto, service, queries, printedPages, moduleDir, apiPkg, ciYml, sqliteSchema, pgSchema, sqliteIndexMigration, pgIndexMigration, sqliteGeoMigration, pgGeoMigration })
}
