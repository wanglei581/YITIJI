/**
 * 招聘会三入口商用闭环防回退验证。
 *
 * 覆盖:
 * 1. 招聘会/校园招聘页面不得展示 aiMatchScore / AI 百分比 / AI 匹配度。
 * 2. 商用页面不得展示平台内投递、签到结果等招聘闭环文案。
 * 3. 数据大屏遇 isMockData 必须真实空态，不得在生产或普通页面展示模拟统计。
 * 4. 活动资料打印必须由后端按需生成内部 printFileUrl，不消费外部签名 URL。
 * 5. 扫码签到首页入口必须只进入真实 checkinUrl 来源签到列表。
 * 6. 【2026-08-11 新增】活动资料不得宣称「免费」——后端并未对其免费：
 *    purpose 在建单时只用于安全门禁（contract 拒绝 / PII 扫描判定），完全不参与计价；
 *    quotePrint 只按 colorMode 选 serviceKey，活动资料照样按 PriceConfig 建付费订单。
 *    恢复条件：服务端可信 scenarioKey + FundingProgram/SubsidyRule 落地，
 *    且该场景确实被配置为免费后，才能重新出现「免费」字样。
 *
 * 运行: pnpm --filter @ai-job-print/kiosk verify:jobfair-commercial-closure
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
function pass(message) { console.log(`  PASS ${message}`) }
function fail(message) { failed += 1; console.error(`  FAIL ${message}`) }

function read(rel) {
  const p = join(ROOT, rel)
  if (!existsSync(p)) {
    fail(`文件缺失: ${rel}`)
    return ''
  }
  return readFileSync(p, 'utf8')
}

function stripAllowedPhrases(src) {
  return src
    .split('去来源平台投递').join('')
    .split('扫码投递').join('')
    .split('去来源平台预约').join('')
    .split('扫码预约').join('')
    .split('扫码前往来源平台签到').join('')
    .split('来源平台签到').join('')
}

console.log('\n=== 招聘会三入口商用闭环防回退验证 ===')

{
  const files = [
    'src/pages/job-fairs/JobFairsPage.tsx',
    'src/pages/job-fairs/JobFairDetailPage.tsx',
    'src/pages/job-fairs/components/JobFairDetailTabs.tsx',
    'src/pages/job-fairs/FairCompaniesPage.tsx',
    'src/pages/job-fairs/FairCompanyDetailPage.tsx',
    'src/pages/job-fairs/FairVisitPlanPage.tsx',
    'src/pages/campus/CampusPage.tsx',
    'src/pages/campus/components/CampusTabs.tsx',
  ]
  const hits = []
  const banned = [
    /\baiMatchScore\b/,
    /AI\s*\{[^}]*\}\s*%/,
    /AI\s*\d{1,3}\s*%/,
    /AI匹配|AI 匹配|匹配度|匹配率|录用概率|录用率/,
  ]
  for (const rel of files) {
    const src = read(rel)
    for (const re of banned) {
      if (re.test(src)) hits.push(`${rel}:${re}`)
    }
  }
  if (hits.length > 0) fail(`不得展示 AI 匹配分/百分比: ${hits.join(' | ')}`)
  else pass('招聘会/校园页面不展示 AI 匹配分或百分比')
}

{
  const files = [
    'src/pages/job-fairs/JobFairsPage.tsx',
    'src/pages/job-fairs/JobFairDetailPage.tsx',
    'src/pages/job-fairs/FairCompanyDetailPage.tsx',
    'src/pages/job-fairs/components/FairCompanyDetailSections.tsx',
    'src/pages/job-fairs/FairVisitPlanPage.tsx',
    'src/pages/campus/CampusPage.tsx',
    'src/pages/campus/components/CampusTabs.tsx',
  ]
  const banned = ['一键投递', '立即投递', '平台投递', '投递简历', '候选人管理', '签到成功', '确认签到', '平台内签到']
  const hits = []
  for (const rel of files) {
    const src = stripAllowedPhrases(read(rel))
    for (const word of banned) {
      if (src.includes(word)) hits.push(`${rel}:${word}`)
    }
  }
  if (hits.length > 0) fail(`出现招聘闭环/签到结果文案: ${hits.join(' | ')}`)
  else pass('招聘会相关页面无平台内投递/签到结果文案')
}

{
  const statsPage = read('src/pages/job-fairs/FairStatsPage.tsx')
  const dataScreen = read('src/pages/job-fairs/components/FairDataScreen.tsx')
  const detailPage = read('src/pages/job-fairs/JobFairDetailPage.tsx')
  const hasDevOnlyMockCard = /stats\.isMockData\s*&&\s*import\.meta\.env\.DEV/.test(statsPage)
  const statsBlocksMock = /stats\.isMockData/.test(statsPage) && /真实数据正在接入|暂无真实统计/.test(statsPage)
  const detailBlocksMock = /stats\?\.isMockData/.test(detailPage) || /!stats\.isMockData/.test(detailPage) || /stats\.isMockData/.test(dataScreen)
  if (hasDevOnlyMockCard || !statsBlocksMock || !detailBlocksMock) {
    fail('isMockData 不能只做 DEV 提示，必须在详情 Tab 与统计页降级为空态')
  } else {
    pass('isMockData 在招聘会详情与统计页均降级为真实空态')
  }
}

{
  const materialsPage = read('src/pages/job-fairs/FairMaterialsPage.tsx')
  const handlePrintBlock = materialsPage.match(/const handlePrint[\s\S]*?(?=\n\s*if \(loading\))/)?.[0] ?? ''
  const usesInternalPrintUrl =
    handlePrintBlock.includes('prepareFairMaterialPrint(fairId, material.id)') &&
    handlePrintBlock.includes('if (!printable.printFileUrl)') &&
    handlePrintBlock.includes('fileUrl: printable.printFileUrl') &&
    !handlePrintBlock.includes('material.fileUrl')
  if (!usesInternalPrintUrl) {
    fail('活动资料打印必须按需生成并只消费后端内部 printFileUrl')
  } else {
    pass('活动资料打印按需生成并只消费后端内部 printFileUrl')
  }
}

{
  const detailPage = read('src/pages/job-fairs/JobFairDetailPage.tsx')
  const routeFile = read('src/routes/index.tsx')
  const apiFile = read('src/services/api/fairVisitPlan.ts')
  const pageFile = read('src/pages/job-fairs/FairVisitPlanPage.tsx')
  const ok =
    detailPage.includes('/visit-plan') &&
    routeFile.includes('FairVisitPlanPage') &&
    apiFile.includes('/visit-plan/') &&
    apiFile.includes('演示模式不提供参会准备单') &&
    pageFile.includes('generateFairVisitPlan') &&
    pageFile.includes('printFairVisitPlan')
  if (!ok) {
    fail('AI 参会准备单必须有详情入口、路由、真实 http API、生成与打印链路，mock 模式诚实拒绝')
  } else {
    pass('AI 参会准备单入口、路由、真实 API 与打印链路已接通')
  }
}

{
  const homeServiceGroups = read('src/pages/home/serviceGroups.ts')
  const checkinEntry = homeServiceGroups.match(/扫码签到[\s\S]{0,800}/)?.[0] ?? ''
  if (!checkinEntry.includes("to: '/job-fairs/checkin'") || /disabled:\s*true/.test(checkinEntry)) {
    fail('扫码签到入口必须进入 /job-fairs/checkin，且不得继续使用禁用占位')
  } else {
    pass('扫码签到入口进入真实来源签到列表，未伪造签到二维码')
  }
}

// ── 6. 活动资料不得宣称「免费」（2026-08-11 新增） ─────────────────────────
// 只检查用户可见文案；注释中保留原文用于说明修正原因，故排除注释行。
function visibleTextOf(rel) {
  const src = read(rel)
  if (src === null) return null
  // 先整块剥离 JSX 注释 {/* ... */} 与块注释 /* ... */（可跨行），
  // 再按行剥离 // 与 * 开头的行注释。
  // 注释中常保留被修正的原文用于说明理由与恢复条件，属有价值上下文，不应触发 FAIL。
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')
}

const FREE_CLAIMS = ['免费打印', '免费出纸', '可免费打印', '免费复印', '免费扫描']

// 6c：printCount 全后端无递增写路径（恒为 0），不得展示为真实打印次数
{
  const visible = visibleTextOf('src/pages/job-fairs/FairMaterialsPage.tsx')
  if (visible === null) fail('6c 活动资料页 — 文件缺失')
  else if (/已打印\s*\{?\s*mat\.printCount/.test(visible) || visible.includes('已打印 {mat.printCount}'))
    fail('6c 活动资料页不得展示 printCount — 该字段无递增写路径，恒为 0')
  else pass('6c 活动资料页不展示无写入方的 printCount')
}

for (const [rel, label] of [
  ['src/pages/job-fairs/FairMaterialsPage.tsx', '6a 活动资料页'],
  ['src/pages/job-fairs/components/JobFairDetailTabs.tsx', '6b 招聘会详情 Tab'],
]) {
  const visible = visibleTextOf(rel)
  if (visible === null) {
    fail(`${label} — 文件缺失: ${rel}`)
  } else {
    const hits = FREE_CLAIMS.filter((m) => visible.includes(m))
    if (hits.length > 0) {
      fail(`${label}不得宣称免费 — ${rel} 出现: ${hits.join(' | ')}（后端仍按 PriceConfig 收费）`)
    } else {
      pass(`${label}不宣称免费（与后端计价一致）`)
    }
  }
}

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 项) ===`)
  process.exit(1)
}

console.log('\n=== ALL PASS ===')
