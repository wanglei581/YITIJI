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
// C3(2026-08-09 修复回归守卫):参会企业详情页的两个打印入口曾构造没有 fileId/fileUrl 的
// 假 PrintFile,页数还是 `Math.ceil(positions.length / 8)` 前端硬算 —— PrintPreviewPage
// 判定 `!file.fileUrl` 即 unavailable,按钮点了永远不出纸。打印文件必须由后端渲染后
// 返回真实签名 URL,页数/体积只能来自后端响应。
mustContain(
  'src/pages/job-fairs/FairCompanyDetailPage.tsx',
  ['prepareFairCompanyPrint', 'printable.printFileUrl', 'printable.fileId', 'printable.pageCount'],
  'C3. 企业详情页打印走后端真实文件(prepareFairCompanyPrint)',
)
mustNotContain(
  'src/pages/job-fairs/FairCompanyDetailPage.tsx',
  ['_企业资料.pdf', '_岗位清单.pdf', 'Math.ceil(company.positions.length'],
  'C4. 企业详情页无伪造 PrintFile / 前端硬算页数',
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

// ── I. 不伪造能力(CLAUDE.md §9):展位签到数不得把适配层占位 0 当真实指标 ──────
// 后端 FairZone 模型没有展位/签到字段,httpAdapter.mapWireZone 只能给 boothCount=0、
// checkedInCount=0 占位。FairMapPage 因此必须用 boothCount>0 过滤后才渲染签到区块,
// 否则真机上会恒显示「已签到 0」——把「没有这项数据」冒充成「真实统计为 0」。
// 这两件事对用户完全不同,本节把该守卫钉死,防止有人删掉过滤直接渲染。
{
  const mapRel = 'src/pages/job-fairs/FairMapPage.tsx'
  const src = read(mapRel)
  if (src === null) {
    fail(`I. 文件缺失: ${mapRel}`)
  } else {
    const guardDecl = 'const metricZones = zones.filter((zone) => zone.boothCount > 0)'
    const guardRender = '{metricZones.length > 0 && ('
    if (!src.includes(guardDecl)) {
      fail(`I-1. ${mapRel} 缺少展位签到守卫: ${guardDecl}`)
    } else pass('I-1. FairMapPage 保留 boothCount>0 过滤(适配层 0 占位不进统计区)')

    if (!src.includes(guardRender)) {
      fail(`I-2. ${mapRel} 签到统计区块未被 metricZones 守卫包裹`)
    } else pass('I-2. FairMapPage 签到统计区块由 metricZones 守卫')

    // 「已签到」必须只出现在守卫之后,即被守卫覆盖。
    const guardIdx = src.indexOf(guardRender)
    const occurrences = [...src.matchAll(/已签到/g)].map((m) => m.index)
    const unguarded = occurrences.filter((idx) => idx < guardIdx)
    if (unguarded.length > 0) {
      fail(`I-3. ${mapRel} 存在未被 metricZones 守卫覆盖的「已签到」渲染(${unguarded.length} 处)`)
    } else pass('I-3. FairMapPage「已签到」渲染全部落在守卫内')
  }

  // 适配层不得凭空造非零签到数(后端根本没有这个字段)。
  const adapterRel = 'src/services/api/httpAdapter.ts'
  const adapterSrc = read(adapterRel)
  if (adapterSrc === null) {
    fail(`I-4. 文件缺失: ${adapterRel}`)
  } else if (/checkedInCount:\s*(?!0\b)\d/.test(adapterSrc)) {
    fail(`I-4. ${adapterRel} 出现非零 checkedInCount 硬编码——后端无该字段,不得伪造`)
  } else pass('I-4. httpAdapter 未伪造非零展位签到数')
}

// ── J. 已结束招聘会 = 参会回顾，不是参会准备 ──────────────────────────────────
//
// 产品裁决（2026-08-18）：不隐藏 AI 入口，改语义。三层文案必须跟着状态走，
// 且回顾态的诚实声明**不是提示文案、是对用户的声明**，不得以「优化」为由删除。
// 服务端行为由 api 侧 verify:fair-visit-review 的 30 条断言守；这里只守 UI 三层。
{
  const planRel = 'src/pages/job-fairs/FairVisitPlanPage.tsx'
  const detailRel = 'src/pages/job-fairs/JobFairDetailPage.tsx'
  const tabsRel = 'src/pages/job-fairs/components/JobFairDetailTabs.tsx'
  const planSrc = read(planRel)
  const detailSrc = read(detailRel)
  const tabsSrc = read(tabsRel)

  if (planSrc === null || detailSrc === null || tabsSrc === null) {
    fail('J. 招聘会 AI 参会页三件套缺失')
  } else {
    // J-1 诚实声明必须在页面里逐字存在（钉死；删掉即红）
    const disclosure = '本系统不记录你是否到场，也不记录你在现场取得的材料'
    if (planSrc.includes(disclosure)) pass('J-1. 回顾态诚实声明存在（不记录是否到场 / 现场取得的材料）')
    else fail(`J-1. ${planRel} 必须逐字保留诚实声明：「${disclosure}…」——这是对用户的声明，不是可选文案`)

    // J-2 声明必须真的渲染出来，而不是只留在注释里
    const visible = /\{REVIEW_DISCLOSURE\}/.test(planSrc) && /export const REVIEW_DISCLOSURE/.test(planSrc)
    if (visible) pass('J-2. 诚实声明以常量形式被真实渲染（非注释残留）')
    else fail(`J-2. ${planRel} 的诚实声明必须作为 REVIEW_DISCLOSURE 常量渲染进页面`)

    // J-3 回顾态不得出现「出发前 / 现场提醒」这类已失效语义
    const reviewCopyOk = planSrc.includes("'后续可做的跟进动作'") && planSrc.includes('!isReview &&')
    if (reviewCopyOk) pass('J-3. 回顾态改用「后续跟进」，现场提醒仅在未结束场次渲染')
    else fail(`J-3. ${planRel} 回顾态必须换成后续跟进语义，且「现场提醒」需被 !isReview 守卫`)

    // J-4 页面必须真的读取招聘会状态（此前从头到尾不取 fair、不读 status）
    if (/getJobFairById/.test(planSrc) && /plan\?\.mode/.test(planSrc)) {
      pass('J-4. 参会页读取招聘会状态，并以服务端判定的 mode 为准')
    } else {
      fail(`J-4. ${planRel} 必须取招聘会状态且优先采用服务端 plan.mode`)
    }

    // J-5 详情页按钮与磁贴文案随状态变化
    if (/isEnded \? 'AI参会回顾'/.test(detailSrc)) pass('J-5. 详情页 AI 入口文案随已结束状态切换')
    else fail(`J-5. ${detailRel} 的 AI 入口在已结束场次必须显示「AI参会回顾」`)
    if (/fair\.status === 'ended' \? 'AI参会回顾'/.test(tabsSrc)) pass('J-6. 详情页磁贴文案随已结束状态切换')
    else fail(`J-6. ${tabsRel} 的 AI 磁贴在已结束场次必须显示「AI参会回顾」`)
  }
}

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 项) — 招聘会/校园招聘 UI 疑似回退,合入前必须修复 ===`)
  process.exit(1)
}
console.log('\n=== ALL PASS ===')
