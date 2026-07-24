/**
 * 阶段1F 防回退验证 — 招聘会/校园招聘新版 UI 守卫。
 *
 * 背景:6月8日的新版 UI(feature/fair-detail-5tab)曾长期未合入 main,导致前台回退旧页面
 * 而无人察觉(阶段1F 已恢复,main `2c85d3e`)。本脚本把新版 UI 的关键结构钉死为断言,
 * 任何分支合并/回滚/误改导致 /job-fairs、/job-fairs/:id、/campus 退回旧页面,
 * 或重新引入虚拟 PDF / LOCAL_FAIRS mock / 违规文案,本脚本立即 FAIL。
 *
 * 检查维度:
 *   A. 新版组件文件存在(RegionPicker / FairCalendarPopover / FairDataScreen / MapBlock / regions / url)
 *   B. /job-fairs 列表页:渐变大卡 + 省市区筛选 + 日历 + 合规按钮文案
 *   C. /job-fairs/:id 详情页:3 Tab(详情与特色/参展企业与岗位/数据大屏) + 导航深链
 *   D. /campus 校园页:沉浸式 5 Tab(overview/companies/map/ai/print) + 真实 API 取数
 *   E. 路由绑定:/job-fairs → JobFairsPage,/campus → CampusPage
 *   F. (已移除)/qingdao 专区 2026-06-14 物理下线,原 mock 回退校验随页面删除
 *   G. 首页:补贴文案保持 info-only(不得回退「补贴快申/补贴申请」)
 *   H. 合规红线:页面不得出现虚拟 PDF 构造、示例打印行、招聘闭环禁词
 *
 * 运行:pnpm --filter @ai-job-print/kiosk verify:jobfair-ui
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
function pass(msg) { console.log(`  PASS ${msg}`) }
function fail(msg) { console.error(`  FAIL ${msg}`); failed++ }

function read(rel) {
  const p = join(ROOT, rel)
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf8')
}

/** 文件必须存在且包含全部 markers。 */
function mustContain(rel, markers, label) {
  const src = read(rel)
  if (src === null) {
    fail(`${label} — 文件缺失: ${rel}`)
    return
  }
  const missing = markers.filter((m) => !src.includes(m))
  if (missing.length > 0) {
    fail(`${label} — ${rel} 缺少新版 UI 标记: ${missing.join(' | ')}`)
  } else {
    pass(label)
  }
}

/** 文件(若存在)必须不含任何 markers。 */
function mustNotContain(rel, markers, label) {
  const src = read(rel)
  if (src === null) {
    fail(`${label} — 文件缺失: ${rel}`)
    return
  }
  const hits = markers.filter((m) => src.includes(m))
  if (hits.length > 0) {
    fail(`${label} — ${rel} 出现回退/违规标记: ${hits.join(' | ')}`)
  } else {
    pass(label)
  }
}

function readImportedCss(entryRel, expectedImports, label) {
  const entry = read(entryRel)
  if (entry === null) {
    fail(`${label} — 文件缺失: ${entryRel}`)
    return ''
  }
  const imports = [...entry.matchAll(/^@import\s+['"]([^'"]+)['"];\s*$/gm)].map((match) => match[1])
  if (JSON.stringify(imports) !== JSON.stringify(expectedImports)) {
    fail(`${label} — ${entryRel} 的显式 CSS imports 已变化: ${imports.join(' | ')}`)
    return ''
  }
  const entryDir = dirname(entryRel)
  const sources = imports.map((importPath) => read(join(entryDir, importPath)))
  if (sources.some((source) => source === null)) {
    const missing = imports.filter((_, index) => sources[index] === null)
    fail(`${label} — 显式导入的 CSS 文件缺失: ${missing.join(' | ')}`)
    return ''
  }
  pass(`${label} — 仅拼接聚合入口显式导入的 CSS`)
  return sources.join('\n')
}

console.log('\n=== 阶段1F 招聘会/校园招聘新版 UI 防回退验证 ===')

// ── A. 新版组件文件存在 ────────────────────────────────────────────────────
{
  const files = [
    'src/pages/job-fairs/components/RegionPicker.tsx',
    'src/pages/job-fairs/components/FairCalendarPopover.tsx',
    'src/pages/job-fairs/components/FairDataScreen.tsx',
    'src/pages/job-fairs/components/MapBlock.tsx',
    'src/lib/regions.ts',
    'src/lib/url.ts',
  ]
  const missing = files.filter((f) => !existsSync(join(ROOT, f)))
  if (missing.length > 0) fail(`A. 新版组件文件缺失: ${missing.join(', ')}`)
  else pass('A. 新版组件文件齐全(RegionPicker/Calendar/DataScreen/MapBlock/regions/url)')
}

// ── B. /job-fairs 列表页 ──────────────────────────────────────────────────
mustContain(
  'src/pages/job-fairs/JobFairsPage.tsx',
  ['RegionPicker', 'FairCalendarPopover', 'function FairRow(', 'className={`jf-row', '扫码预约'],
  'B1. 列表页保持新版结构(地区筛选+日历+招聘会行卡+合规按钮)',
)
const jobFairCss = readImportedCss(
  'src/pages/jobs-fairs-prototype.css',
  [
    './styles/jobs-fairs-foundation.css',
    './styles/jobs-companies-fusion.css',
    './styles/job-fairs-fusion.css',
    './styles/campus-policy-fusion.css',
  ],
  'B2. 招聘会样式聚合入口保持封闭',
)
if (/\.jf-row\s*\{/.test(jobFairCss)) pass('B3. 招聘会行卡保留 .jf-row 精确样式')
else fail('B3. 招聘会行卡缺少 .jf-row 精确样式')
mustNotContain(
  'src/pages/job-fairs/JobFairsPage.tsx',
  ["data/fairData"],
  'B4. 列表页不直接引用 fairData mock(mock 只允许进 mockAdapter)',
)

// ── C. /job-fairs/:id 详情页 ──────────────────────────────────────────────
mustContain(
  'src/pages/job-fairs/JobFairDetailPage.tsx',
  ['详情与特色', '参展企业与岗位', '场馆导览', '数据大屏', 'FairDataScreen', 'buildNavUrl', 'getFairVenueGuide'],
  'C1. 详情页保持 4 Tab(含场馆导览) + 数据大屏 + 场馆导航',
)
mustNotContain(
  'src/pages/job-fairs/JobFairDetailPage.tsx',
  ['活动资料.pdf', "data/fairData"],
  'C2. 详情页无虚拟 PDF 构造、不直引 mock',
)

// ── D. /campus 校园页 ─────────────────────────────────────────────────────
mustContain(
  'src/pages/campus/CampusPage.tsx',
  ["'overview'", "'companies'", "'map'", "'ai'", "'print'", 'MapBlock', 'getFairStats', 'getJobFairs', 'getTerminalId', '{ terminalId }'],
  'D1. 校园页保持沉浸式 5 Tab + 真实 API 取数',
)
mustNotContain(
  'src/pages/campus/CampusPage.tsx',
  ['活动资料.pdf', '（示例）', '一键打印', "data/fairData"],
  'D2. 校园页无虚拟 PDF/示例打印行/违规文案、不直引 mock',
)

// ── E. 路由绑定 ───────────────────────────────────────────────────────────
{
  const src = read('src/routes/index.tsx') ?? ''
  const ok =
    src.includes('JobFairsPage') &&
    src.includes('CampusPage') &&
    /['"]job-fairs['"]/.test(src) &&
    /['"]campus['"]/.test(src)
  if (ok) pass('E. 路由绑定保持 /job-fairs → JobFairsPage、/campus → CampusPage')
  else fail('E. routes/index.tsx 路由绑定被改动(JobFairsPage/CampusPage 未挂载)')
}

// ── F. /qingdao 专区已物理下线(2026-06-14)，原 mock 回退校验随页面删除 ──────────

// ── G. 首页补贴文案保持 info-only ─────────────────────────────────────────
mustNotContain(
  'src/pages/home/serviceGroups.ts',
  ['补贴快申', '补贴申请'],
  'G1. 首页无「补贴快申/补贴申请」承诺式文案(info-only)',
)
mustContain(
  'src/pages/home/serviceGroups.ts',
  ["'/job-fairs'", "'/campus'"],
  'G2. 首页保留招聘会/校园招聘会入口',
)

// ── H. 合规红线禁词 ───────────────────────────────────────────────────────
{
  const pages = [
    'src/pages/job-fairs/JobFairsPage.tsx',
    'src/pages/job-fairs/JobFairDetailPage.tsx',
    'src/pages/campus/CampusPage.tsx',
  ]
  const banned = ['一键投递', '立即投递', '平台投递', '企业收简历', '候选人管理']
  // 「去来源平台投递」是 CLAUDE.md §2 规定的合规标准文案,先剔除再查禁词,
  // 避免其「平台投递」子串造成误报。
  const COMPLIANT_PHRASES = ['去来源平台投递']
  const hits = []
  for (const rel of pages) {
    let src = read(rel) ?? ''
    for (const ok of COMPLIANT_PHRASES) src = src.split(ok).join('')
    for (const w of banned) if (src.includes(w)) hits.push(`${rel}:${w}`)
  }
  if (hits.length > 0) fail(`H. 招聘闭环禁词出现: ${hits.join(' | ')}`)
  else pass('H. 招聘会相关页面 0 招聘闭环禁词')
}

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 项) — 招聘会/校园招聘 UI 疑似回退,合入前必须修复 ===`)
  process.exit(1)
}
console.log('\n=== ALL PASS ===')
