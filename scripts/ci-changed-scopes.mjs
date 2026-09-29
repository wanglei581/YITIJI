#!/usr/bin/env node
// ============================================================
// CI 改动范围判定（N3 省 CI 分钟，2026-09-29）
//
// 只在 pull_request 上用：按 PR 改了哪些文件，决定两个大作业要不要跑。
//   - browser（kiosk-browser-smoke，约 47 分钟）：一体机、后台、机构后台的浏览器用例，全用模拟数据；
//   - postgres（postgres-readiness，约 9 分钟）：服务端在 PostgreSQL 上的门禁。
// build-and-verify 不受影响，每次都跑。
//
// 判定是「白名单式跳过」：只有**每一个**改动文件都落在该作业的可跳过范围里，才输出 false；
// 其余一律 true。推送到 main、手动触发、拿不到改动清单、清单为空，全部输出 true（fail-open：
// 宁可多跑，不能漏跑）。
//
// 可跳过范围的依据（2026-09-29 逐条查过作业里的门禁读哪些文件）：
//   - browser 作业里读文档的只有稿件目录 docs/design/**；三套浏览器用例都不连真实服务端。
//   - postgres 作业里读文档的只有下面 POSTGRES_DOC_TRIGGERS 两个文件；它独有的门禁不读前端源码。
// 以后给这两个作业加门禁、而门禁要读新的目录时，必须同步改这里。
// 浏览器作业实际执行的脚本，由 verify:ci-changed-scopes 从 ci.yml 展开后逐个核对，漏了会点名文件。
// 根目录 package.json 与根目录 scripts 改了两个作业都跑（门禁头注释里的「根配置」）。
//
// 用法：node scripts/ci-changed-scopes.mjs --event <事件> [--base <基线 SHA> --head <HEAD SHA>]
//       或 --files <换行分隔的文件清单文件>（门禁自测用）
// 输出（写进 $GITHUB_OUTPUT）：browser=true|false、postgres=true|false，外加一行中文说明到 stderr。
// ============================================================

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const POSTGRES_DOC_TRIGGERS = new Set([
  'docs/compliance/member-personal-data-retention.md',
  'docs/operations/price-config-production.md',
])

/** 改这个文件时浏览器作业可以不跑。 */
export function browserCanSkip(file) {
  if (file.startsWith('docs/')) return !file.startsWith('docs/design/')
  // 各应用 package.json 会改工作区安装和浏览器用例脚本，不能跟着小程序/Agent 目录一起跳过。
  if (/^apps\/[^/]+\/package\.json$/.test(file)) return false
  return ['services/', 'apps/miniapp/', 'apps/terminal-agent/'].some((prefix) => file.startsWith(prefix))
}

/** 改这个文件时 PostgreSQL 作业可以不跑。 */
export function postgresCanSkip(file) {
  if (file.startsWith('docs/')) return !POSTGRES_DOC_TRIGGERS.has(file)
  return ['apps/kiosk/', 'apps/admin/', 'apps/partner/', 'apps/miniapp/', 'apps/terminal-agent/'].some((prefix) => file.startsWith(prefix))
}

// ── 第二层（2026-09-29 与主执行窗口对齐）：分路 PR 只在改到「高风险路径」时自动跑大作业 ──
// 分路 PR = base 不是 main 的 PR（合进候选分支的各窗口 PR）。整合 PR（base = main）与推送一律全跑。
// 高风险路径按作业分开：改页面、浏览器用例，或浏览器作业会执行的门禁脚本，自动跑浏览器作业；
// 改服务端数据层（含源码里带 Prisma 查询、但文件名不是 service / query 的文件）自动跑 PostgreSQL 作业。
// 根目录 package.json、根目录 scripts、workflow、依赖锁两个都跑。打 full-ci 标签时两个都跑。
const BROWSER_FULL = [
  /^apps\/kiosk\/src\//,
  /^apps\/kiosk\/tests\//,
  /^apps\/kiosk\/playwright[^/]*\.ts$/,
  // 浏览器作业直接执行的门禁。主作业不跑这些，改坏了却跳过浏览器作业，PR 仍是绿的。
  /^apps\/kiosk\/scripts\/verify-fusion-(?:baseline|home|shell|w2-print-scan|w[3-6])\.mjs$/,
  /^apps\/kiosk\/scripts\/verify-(?:qingxu-proto-geometry|scan-input-safety|kiosk-feedback-entry)\.mjs$/,
  /^apps\/kiosk\/scripts\/tests\/fusion-(?:baseline|w6)-contract\.test\.mjs$/,
  /^apps\/kiosk\/scripts\/lib\/(?:fusion-baseline-contract|shell-chrome-contract|sweep-copy-guards)\.mjs$/,
  /^apps\/kiosk\/scripts\/fixtures\/qingxu-proto-geometry-baseline\.json$/,
  /^apps\/(?:admin|partner)\/scripts\/run-e2e\.mjs$/,
  /^apps\/admin\/src\//,
  /^apps\/admin\/tests\//,
  /^apps\/partner\/src\//,
  /^apps\/partner\/tests\//,
  /^apps\/[^/]+\/playwright[^/]*\.config\.ts$/,
  /^apps\/[^/]+\/package\.json$/,
  /^apps\/[^/]+\/vite\.config\.ts$/,
  /^apps\/[^/]+\/index\.html$/,
  /^apps\/[^/]+\/public\//,
  // 一体机、后台、机构后台根目录的文件都会进浏览器构建（tsconfig、vite 插件，以及以后的 tailwind / postcss）。
  /^apps\/(?:kiosk|admin|partner)\/[^/]+$/,
  /^packages\//,
  /^\.github\/workflows\//,
  /^pnpm-lock\.yaml$/,
  /^package\.json$/,
  /^scripts\//,
  /^docs\/design\//,
]
const POSTGRES_FULL = [
  /^services\/api\/prisma\//,
  /^services\/api\/src\/.*\.service\.ts$/,
  /^services\/api\/src\/.*(repository|quer(y|ies))[^/]*\.ts$/,
  /^services\/api\/scripts\//,
  /^services\/api\/package\.json$/,
  /^packages\/shared\//,
  /^\.github\/workflows\//,
  /^pnpm-lock\.yaml$/,
  /^package\.json$/,
  /^scripts\//,
]
// this.prisma.model.findMany / prisma.$queryRaw / prisma.$queryRawUnsafe。不匹配只把客户端传下去的文件。
export const PRISMA_QUERY_RE = /\bprisma\s*\.\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?(?:findUnique|findFirst|findMany|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy|\$queryRaw(?:Unsafe)?|\$executeRaw(?:Unsafe)?|\$transaction)\b/

/** service / query 文件名之外、源码里实际发出 Prisma 查询的文件。测试不算。 */
function nonServicePrismaQuery(file) {
  if (!file.startsWith('services/api/src/') || !file.endsWith('.ts')) return false
  if (file.endsWith('.service.ts') || file.endsWith('.test.ts') || file.endsWith('.spec.ts')) return false
  if (file.includes('/__tests__/')) return false
  if (/(repository|quer(y|ies))[^/]*\.ts$/.test(file)) return false
  const abs = normalize(join(repoRoot, file))
  if (!abs.startsWith(`${normalize(repoRoot)}/`)) return false
  let text
  try {
    text = readFileSync(abs, 'utf8')
  } catch {
    // 这支 PR 可能删掉了该文件，读不到仍按「要跑」处理（宁可多跑，不能漏跑）。
    return true
  }
  return PRISMA_QUERY_RE.test(text)
}

const matchesAny = (patterns, file) => patterns.some((re) => re.test(file)) || (patterns === POSTGRES_FULL && POSTGRES_DOC_TRIGGERS.has(file))

export function classify({ event, files, baseRef = 'main', labels = [] }) {
  if (event !== 'pull_request') return { browser: true, postgres: true, reason: `事件 ${event || '未知'}：全跑` }
  if (!files || files.length === 0) return { browser: true, postgres: true, reason: '拿不到改动清单：全跑' }
  if (labels.includes('full-ci')) return { browser: true, postgres: true, reason: 'PR 带 full-ci 标签：全跑' }
  // 整合 PR（base = main）照旧全跑三作业，这条不动（与主执行窗口约定）
  if (baseRef === 'main') return { browser: true, postgres: true, reason: '整合 PR（base = main）：全跑' }
  // 第一层：与作业无关的改动不跑
  let browser = !files.every(browserCanSkip)
  let postgres = !files.every(postgresCanSkip)
  // 第二层：分路 PR 只在改到高风险路径时才跑
  browser = browser && files.some((f) => matchesAny(BROWSER_FULL, f))
  postgres = postgres && files.some((f) => matchesAny(POSTGRES_FULL, f) || nonServicePrismaQuery(f))
  return { browser, postgres, reason: `分路 PR，改动 ${files.length} 个文件：浏览器作业${browser ? '要跑' : '跳过'}，PostgreSQL 作业${postgres ? '要跑' : '跳过'}` }
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? '' : ''
}

function changedFiles() {
  const listFile = arg('--files')
  if (listFile) return readFileSync(listFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  const base = arg('--base')
  const head = arg('--head')
  if (!/^[0-9a-f]{7,40}$/.test(base) || !/^[0-9a-f]{7,40}$/.test(head)) return null
  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return null
  }
}

// 路径里有中文时 import.meta.url 是百分号编码的，必须同样转成 URL 再比
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const event = arg('--event')
  const files = event === 'pull_request' ? changedFiles() : []
  let labels = []
  try { labels = JSON.parse(arg('--labels') || '[]') } catch { labels = [] }
  // base 拿不到时按整合 PR 处理（全量判定），宁可多跑
  const result = classify({ event, files, baseRef: arg('--base-ref') || 'main', labels })
  console.log(`browser=${result.browser}`)
  console.log(`postgres=${result.postgres}`)
  console.error(result.reason)
}
