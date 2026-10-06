import { readFileSync, closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { shanghaiDayStart } from '../src/console-screen/console-screen.metric'
import { type ScreenMetric, ADMIN_USAGE_METRIC_KEYS, PARTNER_USAGE_METRIC_KEYS, SCREEN_UNAVAILABLE_REASON } from '../src/console-screen/console-screen.types'
import { USAGE_ADMIN_CACHE_ORG, usageCacheKey } from '../src/console-screen/console-screen.usage.service'
import { USAGE_EVENT_ROW_CAP, USAGE_SERVICE_NODES, usageProviderLabel } from '../src/console-screen/console-screen.usage.queries'
import { EXPECTED_NODES, AiSeed, PrintSeed } from './console-screen-usage-cases-07'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'



export let passed = 0

export let failed = 0

export function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed += 1
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failed += 1
  }
}


export function readSrc(relative: string): string {
  return readFileSync(join(__dirname, '..', relative), 'utf8')
}


export function contractBody(source: string): string {
  return source.replace(/^\/\*\*[\s\S]*?\*\//, '').replace(/^\s+/, '')
}


export function inWindow(at: Date, from: Date, to: Date): boolean {
  const time = at.getTime()
  return time >= from.getTime() && (time < to.getTime() || (time === to.getTime() && from.getTime() === shanghaiDayStart(to).getTime()))
}


export function opened<T>(metric: ScreenMetric<T> | undefined): T | null {
  return metric && metric.available === true ? metric.value : null
}


export function assertSourceContract(): void {
  const shared = readFileSync(join(__dirname, '..', '..', '..', 'packages/shared/src/types/consoleScreen.ts'), 'utf8')
  const local = readSrc('src/console-screen/console-screen.types.ts')
  const usageSrc = [
    'console-screen.usage.queries.ts',
    'console-screen.usage.service.ts',
    'console-screen.usage.controller.ts',
  ].map((name) => readSrc(`src/console-screen/${name}`)).join('\n')
  const controller = readSrc('src/console-screen/console-screen.usage.controller.ts')
  const service = readSrc('src/console-screen/console-screen.usage.service.ts')
  const queries = readSrc('src/console-screen/console-screen.usage.queries.ts')
  const ci = readFileSync(join(__dirname, '..', '..', '..', '.github/workflows/ci.yml'), 'utf8')
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> }

  const sharedTwin = readFileSync(join(__dirname, '..', '..', '..', 'packages/shared/src/types/console-screen.twin.types.ts'), 'utf8').split('\n').slice(1).join('\n')
  const localTwin = readSrc('src/console-screen/console-screen.twin.types.ts').split('\n').slice(1).join('\n')
  assert('u1. shared 与 API 主契约和拆出的孪生契约逐字节相同', contractBody(shared) === contractBody(local) && sharedTwin === localTwin)
  assert(
    'u2. 两个未写入计数器原因已追加',
    SCREEN_UNAVAILABLE_REASON.uploadCounterUnwritten === 'upload_counter_unwritten'
      && SCREEN_UNAVAILABLE_REASON.inspectionCounterUnwritten === 'inspection_counter_unwritten'
      && shared.includes("uploadCounterUnwritten: 'upload_counter_unwritten'")
      && shared.includes("inspectionCounterUnwritten: 'inspection_counter_unwritten'"),
  )
  assert(
    'u3. 服务节点常量表与口径逐项一致，classifyIntent 不进节点',
    JSON.stringify(USAGE_SERVICE_NODES) === JSON.stringify(EXPECTED_NODES)
      && !JSON.stringify(USAGE_SERVICE_NODES).includes('classifyIntent')
      && !JSON.stringify(USAGE_SERVICE_NODES).includes('voiceTranscribe')
      && !JSON.stringify(USAGE_SERVICE_NODES).includes('voiceSynthesize')
      && !JSON.stringify(USAGE_SERVICE_NODES).includes('contractReview'),
  )
  assert(
    'u4. 管理员与机构指标键、行数上限、提供者标签',
    JSON.stringify(ADMIN_USAGE_METRIC_KEYS) === JSON.stringify(['channels', 'visits', 'services', 'outcomes', 'heat7d', 'pulse2h', 'printSteps', 'resumeSteps', 'ai', 'jobs', 'topSources30d', 'content'])
      && JSON.stringify(PARTNER_USAGE_METRIC_KEYS) === JSON.stringify(['partnerContent', 'partnerDaily', 'partnerTop', 'visits'])
      && USAGE_EVENT_ROW_CAP === 60_000
      && usageProviderLabel('llm:deepseek') === 'DeepSeek'
      && usageProviderLabel('llm:qwen') === '千问'
      && usageProviderLabel('mock') === '未就绪兜底'
      && usageProviderLabel('stub') === '未就绪兜底'
      && usageProviderLabel('llm:other') === 'llm:other',
  )
  assert(
    'u5. 守卫与 snapshot 一致，机构 orgId 只取当前用户，DTO 不收 orgId',
    /@UseGuards\(JwtAuthGuard, RolesGuard\)/.test(controller)
      && /@Roles\('admin'\)/.test(controller)
      && /@Roles\('partner'\)/.test(controller)
      && /@Get\('admin\/screen\/usage'\)/.test(controller)
      && /@Get\('partner\/screen\/usage'\)/.test(controller)
      && /requirePartnerOrgId\(user\.orgId\)/.test(controller)
      && !/query\.orgId/.test(controller)
      && !/orgId\?:/.test(controller)
      && /getAdminUsage\(query\.range \?\? 'today'\)/.test(controller)
      && !/getAdminUsage\([^)]*rowCap/.test(controller),
  )
  assert(
    'u6. 缓存键含 audience、orgId、range，counts 档 60 秒',
    usageCacheKey('admin', USAGE_ADMIN_CACHE_ORG, 'today') === 'usage:admin:platform:today'
      && usageCacheKey('partner', 'org_a', '7d') === 'usage:partner:org_a:7d'
      && /usage:\$\{audience\}:\$\{orgId\}:\$\{range\}/.test(service)
      && /SCREEN_CACHE_TTL_SECONDS\.counts/.test(service),
  )
  assert(
    'u7. usage 文件不读求职进度、不记搜索词、不把外跳说成投递结果',
    !/jobApplication|JobApplication/.test(usageSrc)
      && !/搜索词|searchKeyword|hotSearch/.test(usageSrc)
      && !/投递成功|一键投递|立即投递|平台投递/.test(usageSrc)
      && /打开来源平台入口/.test(service)
      && !/terminalId|phoneEnc|sourceFileName|orderNo|ipAddress|payloadJson|fileUrl/.test(usageSrc),
  )
  assert(
    'u8. 时间线只取 createdAt；企业展示名用 name；CI 两个 job 都执行本门禁',
    /select: \{ createdAt: true \}/.test(queries)
      && /title: row\.name/.test(queries)
      && /loadUsageTimeline\(this\.prisma, heatFrom, now, rowCap\)/.test(service)
      && pkg.scripts['verify:console-screen-usage'] === 'node -r @swc-node/register scripts/verify-console-screen-usage.ts'
      && ci.split('pnpm --filter @ai-job-print/api verify:console-screen-usage').length === 3,
  )
}


export function prepareDatabase(): { databasePath: string; cleanup: () => void } {
  const previousDatabaseUrl = process.env['DATABASE_URL']
  const previousTarget = process.env['VERIFICATION_DATABASE_TARGET']
  const directory = mkdtempSync(join(tmpdir(), 'verify-console-usage-'))
  const databasePath = join(directory, 'verify-usage.db')
  closeSync(openSync(databasePath, 'a'))
  process.env['DATABASE_URL'] = `file:${databasePath}`
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  assertIsolatedVerificationDatabase()
  const apiRoot = join(__dirname, '..')
  const prismaCli = join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js')
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    databasePath,
    cleanup: () => {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = previousDatabaseUrl
      if (previousTarget === undefined) delete process.env['VERIFICATION_DATABASE_TARGET']
      else process.env['VERIFICATION_DATABASE_TARGET'] = previousTarget
      rmSync(directory, { recursive: true, force: true })
    },
  }
}


export function repeatAi(count: number, seed: Omit<AiSeed, 'estimatedCostCny' | 'latencyMs'> & Partial<AiSeed>): AiSeed[] {
  return Array.from({ length: count }, () => ({
    estimatedCostCny: null,
    latencyMs: null,
    ...seed,
  }))
}


export function isPrinted(row: PrintSeed, from: Date, to: Date): boolean {
  const completedIn = row.completedAt !== null && inWindow(row.completedAt, from, to)
  if (row.status === 'completed' && completedIn) return true
  if (row.printOutcome === 'printed' && completedIn) return true
  return row.printOutcome === 'printed' && row.completedAt === null && inWindow(row.updatedAt, from, to)
}
