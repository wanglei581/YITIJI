import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const KIOSK_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACE_ROOT = join(KIOSK_ROOT, '..', '..')
const W4_ROUTES = [
  '/jobs', '/jobs/:id', '/jobs/:id/offline', '/offline-agencies', '/offline-agencies/:id',
  '/companies', '/companies/:id', '/job-fairs', '/job-fairs/checkin',
  '/job-fairs/:id', '/job-fairs/:id/companies',
  '/job-fairs/:id/companies/:companyId', '/job-fairs/:id/map',
  '/job-fairs/:id/materials', '/job-fairs/:id/visit-plan',
  '/job-fairs/:id/stats', '/campus', '/campus/welcome',
  '/campus/freshman-insights', '/smart-campus', '/smart-campus/welcome',
  '/smart-campus/service/:key', '/renshi',
  '/jobs/online-platforms',
]

const OWNED_PREFIX = /^(jobs(?:\/|$)|offline-agencies(?:\/|$)|companies(?:\/|$)|job-fairs(?:\/|$)|campus(?:\/|$)|smart-campus(?:\/|$)|renshi$)/
// G1 二次合规（2026-08-03）：后端 hardcode '营业中' / 机构临时休息 文案，属于
// 运营状态声明且 verify-fusion-w4 反向闸门原则要求只能收敛到中性语。
// 唯一允许修改的后端 service 文件；变更前必须确认：
//   1. 文案仅为中性兜底（如 '请到店咨询'），不再硬编码运营状态
//   2. 不得新增 jobs/stats/todayOpen 等聚合字段
//   3. 修改须配套 docs/progress 日志
const OFFLINE_AGENCY_BACKEND_SERVICE = 'services/api/src/offline-agencies/offline-agencies.service.ts'

let failed = 0
function pass(message) { console.log(`  PASS ${message}`) }
function fail(message) { failed += 1; console.error(`  FAIL ${message}`) }
function check(label, run) {
  try { run(); pass(label) } catch (error) { fail(`${label}: ${error.message}`) }
}
function read(rel) { return readFileSync(join(KIOSK_ROOT, rel), 'utf8') }

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

function cssRuleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = stripCssComments(source).match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `missing CSS rule: ${selector}`)
  return match[1]
}

function collectRoutePaths() {
  const sourceText = read('src/routes/index.tsx')
  const source = ts.createSourceFile('routes.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const paths = []
  let routerArray = null
  function findRouter(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'createBrowserRouter'
      && node.arguments.length > 0
      && ts.isArrayLiteralExpression(node.arguments[0])
    ) routerArray = node.arguments[0]
    ts.forEachChild(node, findRouter)
  }
  findRouter(source)
  assert.ok(routerArray, 'createBrowserRouter([...]) not found')
  function visitRouteNode(node) {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (
          ts.isPropertyAssignment(property)
          && property.name.getText(source) === 'path'
          && ts.isStringLiteral(property.initializer)
        ) paths.push(`/${property.initializer.text.replace(/^\//, '')}`)
      }
    }
    ts.forEachChild(node, visitRouteNode)
  }
  visitRouteNode(routerArray)
  return paths.filter((path) => OWNED_PREFIX.test(path.slice(1)))
}

function collectTsx(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collectTsx(path)
    if (!entry.isFile() || !entry.name.endsWith('.tsx')) return []
    return [path]
  })
}

function interfaceShape(sourceText, interfaceName) {
  const source = ts.createSourceFile('shape.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let declaration
  function visit(node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) declaration = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(declaration, `${interfaceName} missing`)
  return declaration.members.map((member) => {
    assert.ok(ts.isPropertySignature(member), `${interfaceName} contains non-property member`)
    return {
      name: member.name.getText(source),
      optional: Boolean(member.questionToken),
      type: member.type?.getText(source).replace(/\s+/g, '') ?? 'unknown',
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

console.log('\n=== Kiosk Fusion W4 contract ===')

check('exact 24-route ownership', () => {
  const owned = collectRoutePaths()
  assert.equal(owned.length, 24)
  assert.equal(new Set(owned).size, 24)
  assert.deepEqual([...owned].sort(), [...W4_ROUTES].sort())
  assert.ok(!owned.includes('/notifications'))
})

const kioskRoot = read('src/layouts/KioskRoot.tsx')
const jobsPage = read('src/pages/jobs/JobsPage.tsx')
const jobDetail = read('src/pages/jobs/JobDetailPage.tsx')
const offlineAgencies = read('src/pages/offline-agencies/OfflineAgenciesPage.tsx')
const offlineAgencyDetail = read('src/pages/offline-agencies/OfflineAgencyDetailPage.tsx')
const offlineJobDetail = read('src/pages/offline-agencies/OfflineJobDetailPage.tsx')
// 3.14：稿 45 的运行时宿主从 jobs/OnlinePlatformsPage.tsx（已停放、不注册路由）换成本机构官方渠道页。
// 下面原先钉在旧页上的判据（青序壳、只给扫码出口、不说代投）原样改钉活页面，不钉停放的死代码。
const officialChannels = read('src/pages/official-channels/OfficialChannelsPage.tsx')
const fairCompanyDetail = read('src/pages/job-fairs/FairCompanyDetailPage.tsx')
const offlineAgencyService = read('src/services/api/offlineAgencies.ts')
const offlineAgencyBackendService = readFileSync(join(WORKSPACE_ROOT, OFFLINE_AGENCY_BACKEND_SERVICE), 'utf8')
const companyDetail = read('src/pages/companies/CompanyDetailPage.tsx')
const companiesPage = read('src/pages/companies/CompaniesPage.tsx')
const fairDetail = read('src/pages/job-fairs/JobFairDetailPage.tsx')
const fairMaterials = read('src/pages/job-fairs/FairMaterialsPage.tsx')
const fairStats = read('src/pages/job-fairs/FairStatsPage.tsx')
const campusPage = read('src/pages/campus/CampusPage.tsx')
const campusPolicyCss = read('src/pages/styles/campus-policy-fusion.css')
const jobsFairsFoundationCss = read('src/pages/styles/jobs-fairs-foundation.css')
const jobsCompaniesCss = read('src/pages/styles/jobs-companies-fusion.css')
const fairCompanyDetailSections = read('src/pages/job-fairs/components/FairCompanyDetailSections.tsx')
const campusWelcome = read('src/pages/placeholders/CampusWelcomePage.tsx')
const campusInsights = read('src/pages/campus/FreshmanInsightsPage.tsx')
const smartHome = read('src/pages/smart-campus/SmartCampusHomePage.tsx')
const smartInsights = read('src/pages/smart-campus/FreshmanInsightsPage.tsx')
const routesSource = read('src/routes/index.tsx')
const renshi = read('src/pages/renshi/RenshiPage.tsx')
const jobsCss = read('src/pages/jobs-fairs-prototype.css')
const jobsListQxCss = read('src/pages/jobs/styles/jobs-list-qx.css')
const jobDetailQxCss = read('src/pages/jobs/styles/job-detail-qx.css')
const w4Presentation = read('src/pages/jobs/components/W4Presentation.tsx')

check('W4 shared frame keeps one shell-owned main landmark', () => {
  assert.match(w4Presentation, /<section className=\{`jf-content w4-page-content\$\{tight \? ' tight' : ''\}`\}>\{children\}<\/section>/)
  assert.doesNotMatch(w4Presentation, /<\/?main\b/)
})

check('jobs preserve source-only application contract', () => {
  assert.throws(() => {
  assert.match(jobsPage, /KioskPageFrame/)
  }, 'jobs page must reject the frozen V6 frame contract')
  assert.match(jobsPage, /RecruitTouchFrame/)
  assert.doesNotMatch(jobsPage, /\bKioskPageFrame\b/)
  assert.match(jobDetail, /RecruitTouchFrame/)
  assert.doesNotMatch(jobDetail, /\bKioskPageFrame\b/)
  assert.match(jobDetail, /recordBrowse[\s\S]*'job'/)
  assert.match(jobDetail, /recordExternalJump[\s\S]*'external_apply'/)
  assert.match(jobDetail, /扫码投递/)
  assert.match(jobDetail, /去来源平台投递/)
  assert.match(jobDetail, /if \(!sourceCanApply\) return/)
  assert.match(jobDetail, /window\.open\(currentJob\.sourceUrl/)
  assert.doesNotMatch(jobDetail, /resumeId|documentId/)
  assert.match(read('src/pages/jobs/components/JobDetailSections.tsx'), /投递怎么走[\s\S]*先核对岗位原文与来源四要素[\s\S]*去来源平台自行操作[\s\S]*结果以来源平台为准/)
  assert.match(read('src/pages/jobs/components/JobDetailSections.tsx'), /数据来源说明：/)
  assert.match(jobsListQxCss, /--qx-tap-min/)
  assert.match(jobDetailQxCss, /--qx-tap-min/)
  assert.match(
    jobsFairsFoundationCss,
    /\.jf-searchbox input\s*\{[\s\S]*?min-height:\s*48px;/,
    'job search input keeps the kiosk 48px touch target',
  )
})
check('offline agency list navigates to real detail route', () => {
  // G1 #482: /offline-agencies/:id 已作为真实路由注册，列表页须提供导航入口
  assert.match(offlineAgencies, /offline-agencies\/\$\{agency\.id\}/)
})
check('offline agency presentation does not invent unavailable metrics or live status', () => {
  // 青序 42 号稿：没有可核对的资质项就不展示「已核验 / 正常收录」。
  // 仍禁止把服务端没有的距离、营业中、全部区域写进目录。
  assert.doesNotMatch(offlineAgencies, /distanceKm|按直线距离/)
  assert.doesNotMatch(offlineAgencies, /'营业中'|"营业中"/)
  assert.match(offlineAgencies, /服务时间以机构公示为准/)
  assert.doesNotMatch(offlineJobDetail, /agencyServices as string|Array\.isArray\(job\.agencyServices\)/)
  // JOB-12：徽章读服务端 status；假「全部区域」chip 不得写死。
  assert.match(offlineAgencies, /agencyStatusBadge\(agency\.status\)/)
  assert.doesNotMatch(offlineAgencies, /全部区域/)
  assert.match(offlineAgencies, /district: district \|\| undefined/)
  assert.doesNotMatch(offlineAgencies, /正常收录|已核验/)
  assert.match(offlineAgencies, /service: service \|\| undefined/)
  assert.match(offlineAgencies, /orgType: orgType \|\| undefined/)
})
check('directory pages have left the V6 frame for the touch shell', () => {
  assert.match(offlineAgencies, /RecruitTouchFrame/)
  assert.doesNotMatch(offlineAgencies, /KioskPageFrame/, 'offline agencies list has left the V6 frame')
  assert.match(offlineAgencyDetail, /RecruitTouchFrame/)
  assert.doesNotMatch(offlineAgencyDetail, /KioskPageFrame/, 'offline agency detail has left the V6 frame')
  assert.match(offlineJobDetail, /RecruitTouchFrame/)
  assert.doesNotMatch(offlineJobDetail, /KioskPageFrame/, 'offline job detail has left the V6 frame')
  assert.match(companiesPage, /RecruitTouchFrame/)
  assert.doesNotMatch(companiesPage, /KioskPageFrame/, 'companies list has left the V6 frame')
  assert.match(companyDetail, /RecruitTouchFrame/)
  assert.doesNotMatch(companyDetail, /KioskPageFrame/, 'company detail has left the V6 frame')
  assert.match(officialChannels, /QxPageFrame/)
  assert.doesNotMatch(officialChannels, /KioskPageFrame/, 'official channels (稿 45 宿主) stays on the Qingxu frame')
  assert.match(fairCompanyDetail, /RecruitTouchFrame/)
  assert.doesNotMatch(fairCompanyDetail, /KioskPageFrame/, 'fair company detail has left the V6 frame')
  assert.match(kioskRoot, /['"]\/offline-agencies['"]/)
  assert.match(kioskRoot, /['"]\/companies['"]/)
  assert.match(kioskRoot, /['"]\/jobs\/online-platforms['"]/)
  assert.match(kioskRoot, /['"]\/official-channels['"]/)
  assert.match(kioskRoot, /\/offline-agencies\//)
  assert.match(kioskRoot, /\/companies\//)
  assert.match(kioskRoot, /\/jobs\\\/\[\^\/\]\+\\\/offline/)
  assert.match(kioskRoot, /\/job-fairs\\\/\[\^\/\]\+\\\/companies\\\/\[\^\/\]\+/)
  assert.doesNotMatch(kioskRoot, /QX_MIGRATED_PREFIXES = \[[^\]]*['"]\/jobs\//)
  assert.doesNotMatch(kioskRoot, /QX_MIGRATED_PREFIXES = \[[^\]]*['"]\/job-fairs\//)
})
check('company directory does not rank companies by the user resume', () => {
  assert.doesNotMatch(companiesPage, /screen="company-directory"/)
  assert.doesNotMatch(companyDetail, /screen="company-directory"/)
  assert.doesNotMatch(companiesPage, /按本人简历排出/)
  assert.doesNotMatch(companyDetail, /按本人简历排出/)
  assert.match(companiesPage, /问小青：怎么挑企业？/)
  assert.match(companyDetail, /问小青：这家企业怎么看？/)
  assert.match(companiesPage, /RecruitTouchFrame/)
  assert.match(companyDetail, /RecruitTouchFrame/)
})
// 第 11 包页面只在托管打开（客户私有化部署）时挂载；两个壳（RtFrame 与招聘会八屏的 QxFairWorkbench）
// 一律在最上面挂私有化版标识条，文字逐字照稿，防止被当成我方云上的页面拿去演示或宣传。
check('recruitment touch frames wear the private-deployment ribbon word for word', () => {
  const ribbon = read('src/pages/recruitment-touch/RtRibbon.tsx')
  assert.ok(
    ribbon.includes('私有化部署版 · 仅供持有人力资源服务许可证的客户自行运营 · 我方云上不出现 · 不得用于对外宣传'),
    'ribbon text must stay verbatim',
  )
  assert.match(read('src/pages/recruitment-touch/RtFrame.tsx'), /<RtRibbon\s*\/>/)
  assert.match(read('src/pages/job-fairs/QxFairWorkbench.tsx'), /<RtRibbon\s*\/>/)
})
// 现场无人值守：5xx 的通用说法带「联系现场工作人员」。招聘页的接口错误一律经 recruitErrorText，
// 命中无人值守禁用说法就换成当前操作的那句；状态屏求助只给服务电话（RtHelpLine 读后台号码）。
check('recruitment pages never print the generic 5xx staff handoff and carry a service-phone help line', () => {
  const guarded = [
    'src/pages/jobs/JobsPage.tsx',
    'src/pages/jobs/JobDetailPage.tsx',
    'src/pages/job-fairs/FairCompanyDetailPage.tsx',
    'src/pages/job-fairs/FairVisitPlanPage.tsx',
    'src/pages/job-fairs/FairMaterialsPage.tsx',
  ]
  for (const rel of guarded) {
    const source = read(rel)
    assert.doesNotMatch(source, /\buserMessageOf\b/, `${rel} must route API errors through recruitErrorText`)
    assert.match(source, /recruitErrorText\(/, `${rel} must call recruitErrorText`)
  }
  assert.match(read('src/pages/recruitment-touch/recruitErrorText.ts'), /containsStaffHandoff\(text\) \? fallback : text/)
  assert.match(read('src/pages/job-fairs/QxFairWorkbench.tsx'), /fairIsCentered\(screen, state\) \? <RtHelpLine \/> : null/)
  const help = read('src/pages/recruitment-touch/RtHelpLine.tsx')
  assert.match(help, /useSupportContact\(\)/)
  assert.match(help, /helpNeededLine\(contact\)/)
})
// 第 11 包文案照稿：机构电话缺省、企业查询说法、意图带小标题、预约按钮白名单原句、筛选说明、
// 「去帮助中心」卡的说明（帮助中心实际给的是常见问题和服务电话）、校招数据页去招聘会的去向。
check('recruitment copy follows the draft', () => {
  for (const [name, source] of [['offline agency detail', offlineAgencyDetail], ['offline job detail', offlineJobDetail]]) {
    assert.ok(source.includes('来源未提供电话'), `${name}: 机构电话缺省写「来源未提供电话」`)
    assert.ok(!source.includes('请到帮助中心查看服务电话'), `${name}: 不把本机的服务电话说成机构电话`)
  }
  assert.ok(companiesPage.includes('行业、地区、招聘类型、来源种类都对应真实查询'), 'companies filter hint stays in user words')
  assert.ok(!companiesPage.includes('CompanyQuery 的') && !/所有条件均对应真实 CompanyQuery/.test(companiesPage), 'no code type name on the screen')
  for (const rel of ['src/pages/recruitment-touch/RecruitTouchFrame.tsx', 'src/pages/job-fairs/QxFairWorkbench.tsx']) {
    assert.ok(!read(rel).includes('私有化版 ·'), `${rel}: 意图带小标题不统一加「私有化版 ·」，逐屏照稿`)
  }
  const campusTabs = read('src/pages/campus/components/CampusTabs.tsx')
  assert.ok(!campusTabs.includes('扫码预约 · 去来源平台办理'), '预约按钮只用白名单原句「扫码预约」')
  assert.ok(read('src/pages/job-fairs/JobFairsPage.tsx').includes('地区、日期、收藏和场次范围'), 'fair list filter note wording')
  for (const rel of ['FairMapPage', 'JobFairCheckinPage', 'FairCompanyDetailPage']) {
    const source = read(`src/pages/job-fairs/${rel}.tsx`)
    assert.ok(source.includes('title="去帮助中心" desc="常见问题和服务电话"'), `${rel}: 帮助中心卡说帮助中心实际给的东西`)
    assert.ok(!source.includes('入口一般有纸质导览和指示牌') && !source.includes('手上有主办方纸质名单时，以现场公示为准'), `${rel}: 帮助中心卡不讲现场纸质物`)
  }
  assert.match(campusInsights, /navigate\('\/job-fairs\?audience=campus'\)/, '校招数据页的「查看招聘会」去校园场次')
})
// 产品负责人 10/28：「AI 和这些功能结合在一起」。稿上本包每屏的 AI 元素一个不许少：
// 底栏问小青（逐屏文字由 recruit-touch-metrics.spec.ts 钉）、岗位 AI 入口与登录提示、AI 底句、
// 校园 AI 求职页签、AI 参会准备 / 回顾、AI 参会准备单；AI 整条不可用时结果区写「AI 暂时无法使用」且不再给重试。
check('recruitment screens keep the draft AI elements and handle AI-down honestly', () => {
  const social = read('src/pages/recruitment-touch/SocialHubPage.tsx')
  assert.ok(social.includes("title: '岗位匹配参考'") && social.includes("title: '问 AI 顾问'"), '社会招聘台两扇 AI 门')
  const jobsChrome = read('src/pages/jobs/components/JobsQxChrome.tsx')
  assert.ok(jobsChrome.includes('用我的简历智能推荐') && jobsChrome.includes('开始推荐') && jobsChrome.includes('要先登录'), '岗位列表 AI 推荐入口与登录提示')
  const jobSections = read('src/pages/jobs/components/JobDetailSections.tsx')
  assert.ok(jobSections.includes('AI岗位解读') && jobSections.includes('岗位匹配参考'), '岗位详情两个 AI 入口')
  assert.ok(jobSections.includes("hint={needLogin ? '要先登录' : '看懂职责与准备点'}"), '岗位详情「AI岗位解读」登录前写「要先登录」')
  assert.ok(jobSections.includes("hint={needLogin ? '要先登录' : '用本人简历做准备'}"), '岗位详情「岗位匹配参考」登录前写「要先登录」')
  assert.ok(jobSections.includes('AI_LABEL_COPY.BASE'), '岗位详情 AI 段用标准底句')
  const campusTabs = read('src/pages/campus/components/CampusTabs.tsx')
  assert.ok(campusTabs.includes('AI_LABEL_COPY.BASE') && campusTabs.includes('先看这几家再决定练什么'), '校园 AI 求职页签：AI 底句与先看参展企业')
  for (const title of ['AI简历诊断', 'AI模拟面试', 'AI简历优化', '岗位信息参考']) {
    assert.ok(campusTabs.includes(`title="${title}"`), `校园 AI 求职页签入口：${title}`)
  }
  const detailSections = read('src/pages/job-fairs/components/FairDetailSections.tsx')
  assert.ok(detailSections.includes("'AI参会回顾'") && detailSections.includes("'AI 参会准备清单'"), '招聘会详情：AI 参会准备 / 回顾入口')
  const visitPlan = read('src/pages/job-fairs/FairVisitPlanPage.tsx')
  assert.ok(visitPlan.includes("title: 'AI参会准备单'") && visitPlan.includes('isAiOutage('), 'AI 参会准备单与能力级不可用判定')
  for (const [rel, constant] of [['src/pages/jobs/JobsPage.tsx', 'JOBS_AI_OUTAGE_TEXT'], ['src/pages/jobs/JobDetailPage.tsx', 'JOB_AI_OUTAGE_TEXT']]) {
    const source = read(rel)
    assert.ok(source.includes('isAiOutage(err)') && source.includes(`'AI 暂时无法使用。`), `${rel}: AI 整条不可用写「AI 暂时无法使用」`)
    assert.ok(source.includes(`onRetry={aiError === ${constant} ? undefined :`), `${rel}: AI 整条不可用时不再给重试`)
  }
})
// 第二轮审查 A2：校园专区「扫码预约」缺项照样出码。二维码一旦出屏，用户就已经离开本机了，事后没有补救手段，
// 所以来源四要素守卫必须在 setQr 之前；原来自带的 QrModal 没有 dialog 语义、二维码只有 180px，换成招聘会工作台的共享弹层。
check('campus booking QR is guarded by the source four elements and uses the shared overlay', () => {
  const campusPage = read('src/pages/campus/CampusPage.tsx')
  assert.doesNotMatch(campusPage, /function QrModal/, '校园页不再自带 QrModal')
  assert.match(campusPage, /<FairQrOverlay/, '预约码与导航码都用共享弹层')
  const open = campusPage.match(/const openBookingQr = \(\) => \{([\s\S]*?)\n  \}\n/)
  assert.ok(open, '找不到 openBookingQr')
  const guard = open[1].indexOf('if (!fair || !evaluateJobSourceTrust(fair).ok) return')
  assert.ok(guard >= 0, 'openBookingQr 必须先过来源四要素守卫')
  assert.ok(open[1].indexOf('setQr(') > guard, '守卫必须在 setQr 之前：缺项时不出码')
  assert.ok(open[1].indexOf('recordExternalJump(') > guard, '记外部跳转也在守卫之后')
  const campusTabs = read('src/pages/campus/components/CampusTabs.tsx')
  assert.ok(campusTabs.includes("aria-disabled={bookBlockedReason ? true : undefined}") && campusTabs.includes("aria-describedby={bookBlockedReason ? 'campus-book-blocked' : undefined}"), '「扫码预约」缺项时 aria-disabled 并指向常显的原因')
})
// 旧页的正向锚点是按钮文案「扫码打开来源平台」；新页不再有「先点再出码」这一步，出口就是二维码本身，
// 正向锚点换成：二维码由 SourceUrlQr 按渠道网址生成 + 二维码下的来源说明逐字固定。反向判据一条不少，
// 另加一条：页面里不得出现任何打开外部网页的写法（一体机只给二维码，不给可点的外链）。
check('official channels keep scan-only exits and never claim apply-on-device', () => {
  assert.match(officialChannels, /<SourceUrlQr value=\{item\.url\}/)
  assert.ok(officialChannels.includes('`本渠道由${item.organizationName}提供，信息以其官网为准`'), 'caption must stay verbatim (中文排版，机构名两侧不留空格)')
  assert.doesNotMatch(officialChannels, /一键全网分发|授权代投|同步投递|一键投递|立即投递/)
  assert.doesNotMatch(officialChannels, /扫码投递|去来源平台投递/)
  assert.doesNotMatch(officialChannels, /window\.open|location\.(?:assign|href|replace)|<a\s|href=/, 'kiosk must not open external pages')
})
check('fair company detail keeps source fail-closed apply CTAs and print backend files', () => {
  assert.match(fairCompanyDetail, /prepareFairCompanyPrint/)
  assert.match(fairCompanyDetail, /printable\.printFileUrl/)
  assert.match(fairCompanyDetail, /SOURCE_APPLY_UNAVAILABLE_REASON/)
  assert.match(fairCompanyDetail, /扫码投递/)
  assert.match(fairCompanyDetail, /去来源平台投递/)
  assert.doesNotMatch(fairCompanyDetail, /投递企业|HR 30|候选人筛选|已收/)
})
check('fair subpages do not fake syncTime with activity startTime', () => {
  const fairCompaniesPage = read('src/pages/job-fairs/FairCompaniesPage.tsx')
  const fairMapPage = read('src/pages/job-fairs/FairMapPage.tsx')
  assert.doesNotMatch(fairCompaniesPage, /syncTime \?\? fair\.startTime/)
  assert.doesNotMatch(fairMapPage, /syncTime \?\? fair\.startTime/)
  assert.doesNotMatch(fairMaterials, /syncTime \?\? fair\.startTime/)
  assert.match(w4Presentation, /同步时间未知/)
})
check('company detail retains browse and external jump records', () => {
  assert.match(companiesPage, /className="min-h-12 min-w-0 flex-1 bg-transparent/, 'company search input keeps the kiosk 48px touch target')
  assert.match(companyDetail, /recordBrowse[\s\S]*'company_profile'/)
  assert.match(companyDetail, /recordExternalJump/)
})
check('fair source, mock-stat and print contracts remain intact', () => {
  assert.match(jobsFairsFoundationCss, /button\.jf-chip\s*\{[\s\S]*?min-height:\s*48px;/, 'interactive fair chips keep the kiosk 48px touch target')
  assert.match(fairCompanyDetailSections, /min-h-12 min-w-12 rounded-lg p-2 transition-colors/, 'fair company view toggles keep 48px touch targets')
  assert.match(fairDetail, /external_appointment/)
  assert.match(fairDetail, /external_checkin_open/)
  // 详情页必须**否定** isMockData 才能算「有真统计」。2026-09-20 起 stats 是子请求
  // 结果对象的一个字段（statsResult.stats），所以放开变量名，但保留「取反 .isMockData」
  // 这个核心判据——把 `!` 去掉、或改成 `stats.isMockData ? 真 : 假` 仍然会红。
  assert.match(fairDetail, /![A-Za-z_$][\w$]*(?:\.[\w$]+)*\.isMockData/)
  assert.match(fairMaterials, /printable\.printFileUrl/)
  assert.doesNotMatch(fairMaterials, /fileUrl:\s*material\.fileUrl/)
  // 页面写的是 `stats?.isMockData`（stats 可为 null），所以允许可选链。
  assert.match(fairStats, /stats\??\.isMockData/)
})

// Phase 0 S0-A A1b：招聘会统计 Kiosk 消费面诚实化（nullable metrics）
//
// 2026-09-20 招聘会八屏迁入青序流光后，「详情页内嵌数据大屏」组件
// （components/FairDataScreen.tsx）随四 Tab 壳一起退休，统计只剩
// /job-fairs/:id/stats 一个页面消费。原先把两个文件名钉死的写法会在
// 文件消失时直接 ENOENT 崩掉，而且第三个消费面长出来时它也发现不了。
// 改成扫描 src/pages 下**所有**引用 FairLiveStatsDTO 的页面：谁渲染了可空字段，
// 谁就必须自带显式 null 分支。这是收严不是放宽 —— 新消费面无需改门禁即被覆盖。
const FAIR_STATS_NULLABLE_FIELDS = [
  'checkedInCompanies',
  'browseCount',
  'scanCount',
  'printCount',
  'checkinCount',
]

/** src/pages 下引用 FairLiveStatsDTO 的页面与组件，[相对路径, 源码]。 */
function fairStatsConsumers() {
  return collectTsx(join(KIOSK_ROOT, 'src/pages'))
    .map((path) => [relative(KIOSK_ROOT, path), readFileSync(path, 'utf8')])
    .filter(([, source]) => source.includes('FairLiveStatsDTO'))
}

check('fair stats consumer scan actually sees the stats page', () => {
  // 阳性对照：读数为 0 既可能是「真的没有消费面」，也可能是扫描根本没扫到。
  // 没有这一条，下面两项会在扫描失效时静默全绿。
  const paths = fairStatsConsumers().map(([rel]) => rel)
  assert.ok(paths.length > 0, 'no FairLiveStatsDTO consumer found under src/pages')
  assert.ok(
    paths.includes('src/pages/job-fairs/FairStatsPage.tsx'),
    `FairStatsPage must be among the stats consumers, got: ${paths.join(', ')}`,
  )
})

check('fair stats kiosk surfaces reject misleading live/system-truth copy', () => {
  for (const [rel, source] of fairStatsConsumers()) {
    assert.doesNotMatch(source, /准实时数据|系统真实服务数据/, `${rel} must not claim live/system-truth stats`)
  }
})

check('fair stats nullable metrics have explicit null branches and are not rendered unconditionally', () => {
  for (const [rel, source] of fairStatsConsumers()) {
    for (const field of FAIR_STATS_NULLABLE_FIELDS) {
      if (!source.includes(`stats.${field}`)) continue
      assert.match(
        source,
        new RegExp(`${field}\\s*(?:!==|!=)\\s*null`),
        `${rel} must guard ${field} with explicit != null / !== null`,
      )
      // 禁止无条件把可空字段当数字插值进 JSX（须先经 null 分支）
      assert.doesNotMatch(
        source,
        new RegExp(`\\{stats\\.${field}\\}`),
        `${rel} must not unconditionally render {stats.${field}}`,
      )
    }
  }
})

check('fair checkinCount is labeled 现场签到, not 外部跳转', () => {
  // checkinCount 与「外部跳转」不得同块出现；正向标签须为现场签到
  assert.match(
    fairStats,
    /checkinCount\s*(?:!==|!=)\s*null[\s\S]*?现场签到/,
    'checkinCount tile must be labeled 现场签到',
  )
  assert.doesNotMatch(
    fairStats,
    /checkinCount\s*(?:!==|!=)\s*null[\s\S]{0,400}?外部跳转/,
    'checkinCount must not be mislabeled as 外部跳转',
  )
})

check('fair check-in progress UI requires checkedInCompanies != null and totalCompanies > 0', () => {
  assert.match(
    fairStats,
    /checkedInCompanies\s*(?:!==|!=)\s*null\s*&&\s*stats\.totalCompanies\s*>\s*0[\s\S]*?企业签到进度/,
    '企业签到进度 must gate on checkedInCompanies != null && totalCompanies > 0',
  )
  assert.doesNotMatch(
    fairStats,
    /已签到 \$\{stats\.checkedInCompanies\}/,
    'must not interpolate 已签到 N 家 from nullable checkedInCompanies unconditionally',
  )
})
check('campus and smart-campus stay honest and distinct', () => {
  assert.match(campusPage, /getJobFairs\(terminalId \? \{ terminalId \} : undefined\)/)
  assert.doesNotMatch(campusWelcome, /待开发/)
  assert.doesNotMatch(campusInsights, /待开发/)
  assert.match(campusInsights, /暂无经核验的校园招聘统计/)
  assert.match(campusInsights, /不会展示示例数据/)
  assert.match(campusInsights, /查看招聘会/)
  assert.doesNotMatch(campusInsights, /一键投递|立即投递|平台投递|候选人管理|录用率|签约率/)
  assert.match(routesSource, /pages\/campus\/FreshmanInsightsPage/)
  assert.doesNotMatch(
    routesSource,
    /path:\s*'campus\/freshman-insights'[\s\S]{0,220}placeholders\/FreshmanInsightsPage/,
  )
  assert.doesNotMatch(routesSource, /path:\s*'smart-campus\/freshman-insights'/)
  assert.doesNotMatch(routesSource, /pages\/smart-campus\/FreshmanInsightsPage/)
  assert.match(smartInsights, /FreshmanInsightsPage/)
  assert.match(smartHome, /ToolboxLaunchModals/)
  assert.match(smartHome, /placement="smart_campus"/)
  assert.match(smartInsights, /迎新服务导览/)
  assert.match(smartInsights, /本平台没有迎新报到数据/)
  assert.match(smartInsights, /\/print\/upload/)
  assert.match(smartInsights, /\/resume-service/)
  assert.match(smartInsights, /to: '\/campus'/)
  assert.match(smartInsights, /\/policy-service/)
  assert.match(smartInsights, /\/me\/documents/)
  assert.doesNotMatch(smartInsights, /校园大数据|聚合统计|报到人数|院系分布/)
  assert.doesNotMatch(smartInsights, /示例数据|MOCK_FRESHMAN|topMajors|ageDistribution/)
  assert.doesNotMatch(smartInsights, /\/smart-campus\/service\//)
  assert.match(
    cssRuleBody(campusPolicyCss, 'button.kproto-badge'),
    /min-height:\s*48px;/,
    'interactive campus badges keep the kiosk 48px touch target',
  )
  assert.match(
    cssRuleBody(jobsCompaniesCss, "[data-kiosk-presentation='fusion-youth'] .w4-page-frame > .ui-kiosk-page-content"),
    /padding:\s*0;/,
    'W4 frame neutralizes the shared content inset',
  )
  assert.match(
    cssRuleBody(jobsCompaniesCss, '.w4-page-content'),
    /--w4-page-inset:\s*clamp\(20px,\s*4\.45vw,\s*48px\);[^}]*padding:\s*0\s+var\(--w4-page-inset\);/,
    'W4 page content owns only the horizontal gutter without adding vertical shell gaps',
  )
  assert.match(
    cssRuleBody(campusPolicyCss, '.kproto-actionbar'),
    /margin-inline:\s*calc\(-1\s*\*\s*var\(--w4-page-inset\)\);/,
    'smart-campus action bars align with the W4 page inset',
  )
})

// Phase 0 S0-A A3：校园 AI 模拟面试错跳（须进 /interview/setup，禁止 /assistant）
const campusTabs = read('src/pages/campus/components/CampusTabs.tsx')
check('campus AI模拟面试 navigates to /interview/setup, not /assistant', () => {
  assert.match(
    campusTabs,
    /title="AI模拟面试"[^\n]*navigate\('\/interview\/setup'\)/,
    'AI模拟面试 must target /interview/setup',
  )
  assert.doesNotMatch(
    campusTabs,
    /title="AI模拟面试"[^\n]*navigate\('\/assistant'\)/,
    'AI模拟面试 must not target /assistant',
  )
})
check('policy builtin records remain server-safe', () => {
  assert.match(renshi, /if \(isBuiltin\(item\.id\)\) return/)
  assert.match(renshi, /if \(!isBuiltin\(item\.id\)\) recordExternalJump/)
})
check('renshi policy workspace uses the Qingxu frame', () => {
  assert.match(renshi, /QxPageFrame/)
  assert.doesNotMatch(renshi, /KioskPageFrame|KioskPageHeader/)
  assert.match(kioskRoot, /['"]\/renshi['"]/)
})
check('legacy CSS entry remains a compatibility aggregator', () => {
  for (const marker of [
    "@import './styles/jobs-fairs-foundation.css'",
    "@import './styles/jobs-companies-fusion.css'",
    "@import './styles/job-fairs-fusion.css'",
    "@import './styles/campus-policy-fusion.css'",
  ]) assert.ok(jobsCss.includes(marker), marker)
})

// official-channels：稿 45 的宿主（3.14 从 jobs/ 迁出），招聘闭环禁词照样要扫到它。
const w4Dirs = ['jobs', 'companies', 'offline-agencies', 'job-fairs', 'campus', 'smart-campus', 'renshi', 'official-channels']
const w4Files = w4Dirs.flatMap((dir) => collectTsx(join(KIOSK_ROOT, 'src/pages', dir)))
  .concat([
    join(KIOSK_ROOT, 'src/pages/placeholders/CampusWelcomePage.tsx'),
  ])
const w4Source = w4Files
  .filter((path) => !path.endsWith('jobs/utils/jobDisplay.ts'))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

check('W4 pages no longer depend on legacy presentation helpers', () => {
  assert.doesNotMatch(w4Source, /import ['"][^'"]*(?:jobs-fairs-prototype(?:\.css)?|prototype\/kiosk-prototype\.css)['"]/)
  assert.doesNotMatch(w4Source, /\b(?:Proto[A-Z]\w*|CardHead|SourceMetaChips)\b/)
})

check('ComingSoonNotice remains zero-consumer', () => {
  const consumers = collectTsx(join(KIOSK_ROOT, 'src'))
    .filter((path) => !path.endsWith('components/ComingSoonNotice.tsx'))
    .filter((path) => readFileSync(path, 'utf8').includes('ComingSoonNotice'))
    .map((path) => relative(KIOSK_ROOT, path))
  assert.deepEqual(consumers, [])
})

check('W4 visible copy avoids recruitment closure language', () => {
  const stripped = w4Source
    .replaceAll('去来源平台投递', '')
    .replaceAll('扫码投递', '')
    .replaceAll('去来源平台预约', '')
    .replaceAll('扫码预约', '')
    .replaceAll('扫码前往来源平台签到', '')
    .replaceAll('来源平台签到', '')
  assert.doesNotMatch(stripped, /一键投递|立即投递|(?<!来源)平台投递|投递简历|候选人管理|面试邀约|签到成功|确认签到|保证到账|免申即享/)
})

const fixturePath = join(KIOSK_ROOT, 'tests/fixtures/fusion-w4-api.ts')
check('W4 browser fixture and private fair wire mirrors exist', () => {
  assert.ok(existsSync(fixturePath), 'fusion-w4-api.ts missing')
  assert.ok(existsSync(join(KIOSK_ROOT, 'playwright.w4.config.ts')), 'playwright.w4.config.ts missing')
  assert.ok(existsSync(join(KIOSK_ROOT, 'tests/visual/fusion-w4.spec.ts')), 'fusion-w4.spec.ts missing')
})
check('private fair wire mirrors exactly match production adapter', () => {
  const production = read('src/services/api/httpAdapter.ts')
  const fixture = read('tests/fixtures/fusion-w4-api.ts')
  for (const name of ['WireFairPosition', 'WireFairCompany', 'WireFairZone']) {
    assert.deepEqual(interfaceShape(fixture, name), interfaceShape(production, name))
  }
})
check('offline agency fixture mirrors the production wire contract', () => {
  const fixture = read('tests/fixtures/fusion-w4-api.ts')
  const w6Fixture = read('tests/visual/fixtures/fusion-w6-api.ts')
  for (const name of ['WireOfflineAgency', 'WireOfflineJobAgency', 'WireOfflineJob']) {
    assert.deepEqual(interfaceShape(fixture, name), interfaceShape(offlineAgencyService, name))
  }
  assert.match(fixture, /offline-agencies['"], \{ data: \[agency\], total: 1, page: 1, pageSize: 10 \}/)
  assert.match(fixture, /offline-jobs\/offline-job-001['"], offlineJob/)
  assert.doesNotMatch(fixture, /agency:\s*\{[^}]*services:/s, 'detail fixture mirrors the real agency select')
  assert.match(w6Fixture, /salaryMin:/, 'W6 offline job fixture uses the raw wire contract')
  assert.doesNotMatch(w6Fixture, /success\(offlineJob\)/, 'W6 must not restore the obsolete detail envelope')
})
check('offline agency service maps raw list and detail responses centrally', () => {
  assert.match(offlineAgencyBackendService, /return \{\s*data: items,\s*total:/)
  assert.match(offlineAgencyBackendService, /async findOne\([\s\S]*?return data\s*\n\s*}/)
  assert.match(offlineAgencyBackendService, /async findOneJob\([\s\S]*?return job\s*\n\s*}/)
  assert.match(offlineAgencyService, /interface WireOfflineAgencyListResponse \{\s*data: WireOfflineAgency\[\]/)
  assert.match(offlineAgencyService, /function mapWireOfflineAgency\(/)
  assert.match(offlineAgencyService, /function mapWireOfflineJob\(/)
  assert.match(offlineAgencyService, /\.map\(mapWireOfflineAgency\)/)
  assert.match(offlineAgencyService, /mapWireOfflineJob\(/)
})

if (failed > 0) {
  console.error(`\n❌ ${failed} W4 contract check(s) failed\n`)
  process.exit(1)
}
console.log('\n✅ ALL PASS — Kiosk Fusion W4 contract\n')
