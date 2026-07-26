import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const KIOSK_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACE_ROOT = join(KIOSK_ROOT, '..', '..')
const W4_ROUTES = [
  '/jobs', '/jobs/:id', '/jobs/:id/offline', '/offline-agencies',
  '/companies', '/companies/:id', '/job-fairs', '/job-fairs/checkin',
  '/job-fairs/:id', '/job-fairs/:id/companies',
  '/job-fairs/:id/companies/:companyId', '/job-fairs/:id/map',
  '/job-fairs/:id/materials', '/job-fairs/:id/visit-plan',
  '/job-fairs/:id/stats', '/campus', '/campus/welcome',
  '/campus/freshman-insights', '/smart-campus', '/smart-campus/welcome',
  '/smart-campus/freshman-insights', '/smart-campus/service/:key', '/renshi',
]

const OWNED_PREFIX = /^(jobs(?:\/|$)|offline-agencies(?:\/|$)|companies(?:\/|$)|job-fairs(?:\/|$)|campus(?:\/|$)|smart-campus(?:\/|$)|renshi$)/
const FORBIDDEN_PATHS = [
  /^services\//,
  /^packages\/shared\//,
  /^apps\/kiosk\/src\/services\//,
  /^apps\/kiosk\/src\/routes\//,
  /^apps\/kiosk\/package\.json$/,
  /^\.github\/workflows\/ci\.yml$/,
  /^apps\/kiosk\/src\/index\.css$/,
  /^apps\/kiosk\/src\/components\/ComingSoonNotice\.tsx$/,
  /^apps\/kiosk\/src\/pages\/home\/components\/(ToolboxLaunchModals|kioskAppLaunch)\.tsx?$/,
  /^apps\/kiosk\/src\/pages\/jobs\/utils\/jobDisplay\.ts$/,
  /^apps\/kiosk\/src\/pages\/renshi\/(builtinData|shared)\.ts$/,
]
const PLANNED_TEST_FILES = new Set([
  'docs/superpowers/plans/2026-07-24-kiosk-8177-5299-fusion-w4.md',
  'apps/kiosk/scripts/verify-fusion-w4.mjs',
  'apps/kiosk/playwright.w4.config.ts',
  'apps/kiosk/tests/fixtures/fusion-w4-api.ts',
  'apps/kiosk/tests/visual/fusion-w4.spec.ts',
])
const OFFLINE_AGENCY_SERVICE = 'apps/kiosk/src/services/api/offlineAgencies.ts'
const CURRENT_AUDIT_INTEGRATION_FILES = new Set([
  'apps/kiosk/src/components/kiosk-shell/KioskFullscreenShell.tsx',
  'apps/kiosk/src/routes/index.tsx',
  'apps/kiosk/src/layouts/KioskRoot.tsx',
  'apps/kiosk/src/main.tsx',
  'apps/kiosk/src/pages/errors/KioskRouteErrorPage.tsx',
  'apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs',
  'apps/kiosk/scripts/verify-fusion-shell.mjs',
])
const W6_INTEGRATION_FILES = new Set([
  '.github/workflows/ci.yml',
  'apps/kiosk/package.json',
  // W8+ visual-unity：service-desk 须在 kiosk-shell 之前，避免冰蓝盖住 fusion 青绿。
  'apps/kiosk/src/index.css',
  'docs/design/kiosk-proto-2026-07-migration-matrix.md',
  'docs/progress/current-progress.md',
  'docs/progress/next-tasks.md',
])
const ALLOWED_PRODUCTION_PATHS = [
  /^apps\/kiosk\/src\/pages\/(?:jobs|companies|offline-agencies|job-fairs|campus|smart-campus|renshi)\//,
  /^apps\/kiosk\/src\/pages\/jobs-fairs-prototype\.css$/,
  /^apps\/kiosk\/src\/pages\/styles\/(?:jobs-fairs-foundation|jobs-companies-fusion|job-fairs-fusion|campus-policy-fusion)\.css$/,
  /^apps\/kiosk\/src\/pages\/placeholders\/(?:CampusWelcomePage|FreshmanInsightsPage)\.tsx$/,
]
const OTHER_WAVE_PLAN = /^docs\/superpowers\/(?:plans|specs)\/2026-07-(?:24-kiosk-8177-5299-fusion-w(?:2|3|5|6)|25-kiosk-86-proto-visual-1to1(?:-design)?)\.md$/
const OTHER_WAVE_PATHS = [
  // W2: print/scan presentation and its isolated verification assets.
  /^apps\/kiosk\/src\/pages\/(?:print|print-scan|scan)\//,
  /^apps\/kiosk\/scripts\/verify-fusion-w2-print-scan\.mjs$/,
  /^apps\/kiosk\/(?:playwright\.w2\.config\.ts|tests\/visual\/fusion-w2(?:|-print|-scan|-tools)\.spec\.ts)$/,
  // W3: resume, AI assistant and interview authoring surfaces.
  /^apps\/kiosk\/src\/pages\/(?:resume|assistant|interview)\//,
  /^apps\/kiosk\/scripts\/(?:tests\/fusion-w3-contract\.test|verify-fusion-w3|verify-job-fit-m1-5-ui|verify-lightflow-k2a-ai-career|verify-lightflow-k2c-interview)\.mjs$/,
  /^apps\/kiosk\/(?:playwright\.w3\.config\.ts|tests\/visual\/(?:fixtures\/fusion-w3-states\.ts|fusion-w3\.spec\.ts))$/,
  // W5: system, profile, account, help and benefit surfaces.
  /^apps\/kiosk\/src\/pages\/(?:activities|auth|help|legal|profile|screensaver|toolbox|upload)\//,
  /^apps\/kiosk\/src\/pages\/placeholders\/(?:ErrorOfflinePage|MeActivityDetailPage|NotificationsPage|SessionTimeoutPage)\.tsx$/,
  /^apps\/kiosk\/src\/pages\/placeholders\/system-pages-batch8\.css$/,
  /^apps\/kiosk\/scripts\/(?:verify-fusion-w5|verify-profile-activity-inkpaper)\.mjs$/,
  /^apps\/kiosk\/scripts\/(?:verify-lightflow-profile-entry|verify-profile-commercial-first-batch|verify-profile-inkpaper-home|verify-profile-resumes-notifications-inkpaper)\.mjs$/,
  /^apps\/kiosk\/(?:playwright\.w5\.config\.ts|tests\/visual\/(?:fusion-w5\.spec|fixtures\/fusion-w5-pagination-route)\.ts)$/,
  // W6: integration verifier and its contract test are owned by the integration wave.
  /^apps\/kiosk\/scripts\/(?:verify-fusion-w6|tests\/fusion-w6-contract\.test)\.mjs$/,
  /^apps\/kiosk\/(?:playwright\.w6\.config\.ts|tests\/visual\/(?:fusion-w6-routes\.spec|fixtures\/fusion-w6-(?:api|route-cases))\.ts)$/,
  // Visual unity / 方案 B 细对齐（跨域壳、门禁与 allowlist，非 W4 业务路由所有权变更）
  /^apps\/kiosk\/scripts\/verify-fusion-home\.mjs$/,
  /^apps\/kiosk\/scripts\/verify-kiosk-visual-unity\.mjs$/,
  /^apps\/kiosk\/src\/styles\/prototype-v1\.css$/,
  /^packages\/ui\/src\/styles\/kiosk-shell\.css$/,
  /^packages\/ui\/scripts\/verify-fusion-youth-foundation\.mjs$/,
]

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

function changedFiles() {
  // Earlier waves are frozen as commits before W4. Scope this guard to the
  // current integration worktree instead of reclassifying committed W2/W3
  // changes against the historical W1 baseline as W4 violations.
  const tracked = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  })
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  })
  return [...new Set(`${tracked}\n${untracked}`.split('\n').map((item) => item.trim()).filter(Boolean))]
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

check('exact 23-route ownership', () => {
  const owned = collectRoutePaths()
  assert.equal(owned.length, 23)
  assert.equal(new Set(owned).size, 23)
  assert.deepEqual([...owned].sort(), [...W4_ROUTES].sort())
  assert.ok(!owned.includes('/notifications'))
  assert.ok(!owned.includes('/offline-agencies/:id'))
})

check('changes stay inside W4 scope and hard-frozen files remain untouched', () => {
  const changes = changedFiles()
  const frozenHits = changes.filter((path) => path !== OFFLINE_AGENCY_SERVICE && !CURRENT_AUDIT_INTEGRATION_FILES.has(path) && !W6_INTEGRATION_FILES.has(path) && FORBIDDEN_PATHS.some((pattern) => pattern.test(path)))
  assert.deepEqual(frozenHits, [], `hard-frozen path changed: ${frozenHits.join(', ')}`)

  const scopeViolations = changes.filter((path) => {
    if (W6_INTEGRATION_FILES.has(path)) return false
    if (CURRENT_AUDIT_INTEGRATION_FILES.has(path)) return false
    if (OTHER_WAVE_PLAN.test(path)) return false
    if (OTHER_WAVE_PATHS.some((pattern) => pattern.test(path))) return false
    if (PLANNED_TEST_FILES.has(path)) return false
    if (path === OFFLINE_AGENCY_SERVICE) return false
    return !ALLOWED_PRODUCTION_PATHS.some((pattern) => pattern.test(path))
  })
  assert.deepEqual(scopeViolations, [], `W4 scope violation: ${scopeViolations.join(', ')}`)
})

const jobsPage = read('src/pages/jobs/JobsPage.tsx')
const jobDetail = read('src/pages/jobs/JobDetailPage.tsx')
const offlineAgencies = read('src/pages/offline-agencies/OfflineAgenciesPage.tsx')
const offlineJobDetail = read('src/pages/offline-agencies/OfflineJobDetailPage.tsx')
const offlineAgencyService = read('src/services/api/offlineAgencies.ts')
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
const campusInsights = read('src/pages/placeholders/FreshmanInsightsPage.tsx')
const smartHome = read('src/pages/smart-campus/SmartCampusHomePage.tsx')
const smartInsights = read('src/pages/smart-campus/FreshmanInsightsPage.tsx')
const renshi = read('src/pages/renshi/RenshiPage.tsx')
const jobsCss = read('src/pages/jobs-fairs-prototype.css')
const w4Presentation = read('src/pages/jobs/components/W4Presentation.tsx')

check('W4 shared frame keeps one shell-owned main landmark', () => {
  assert.match(w4Presentation, /<section className=\{`jf-content w4-page-content\$\{tight \? ' tight' : ''\}`\}>\{children\}<\/section>/)
  assert.doesNotMatch(w4Presentation, /<\/?main\b/)
})

check('jobs preserve source-only application contract', () => {
  assert.match(jobsPage, /KioskPageFrame/)
  assert.match(jobDetail, /recordBrowse[\s\S]*'job'/)
  assert.match(jobDetail, /recordExternalJump[\s\S]*'external_apply'/)
  assert.match(jobDetail, /扫码投递/)
  assert.match(jobDetail, /去来源平台投递/)
  assert.match(
    jobsFairsFoundationCss,
    /\.jf-searchbox input\s*\{[\s\S]*?min-height:\s*48px;/,
    'job search input keeps the kiosk 48px touch target',
  )
})
check('offline agency list does not invent a detail route', () => {
  assert.doesNotMatch(offlineAgencies, /offline-agencies\/\$\{agency\.id\}/)
})
check('offline agency presentation does not invent unavailable metrics or live status', () => {
  assert.doesNotMatch(offlineAgencies, /data\.stats|jobCount|distanceKm|status === ['"]open['"]|oa-st open|营业中|今日服务|在招岗位|按直线距离/)
  assert.match(offlineAgencies, /服务时间以机构公示为准/)
  assert.doesNotMatch(offlineJobDetail, /agencyServices as string|Array\.isArray\(job\.agencyServices\)/)
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
  assert.match(fairDetail, /!stats\.isMockData/)
  assert.match(fairMaterials, /printable\.printFileUrl/)
  assert.doesNotMatch(fairMaterials, /fileUrl:\s*material\.fileUrl/)
  assert.match(fairStats, /stats\.isMockData/)
})
check('campus and smart-campus stay honest and distinct', () => {
  assert.match(campusPage, /getJobFairs\(terminalId \? \{ terminalId \} : undefined\)/)
  assert.doesNotMatch(campusWelcome, /待开发/)
  assert.doesNotMatch(campusInsights, /待开发/)
  assert.match(smartHome, /ToolboxLaunchModals/)
  assert.match(smartHome, /placement="smart_campus"/)
  assert.match(smartInsights, /学校书面授权/)
  assert.match(smartInsights, /数据处理协议/)
  assert.match(smartInsights, /聚合脱敏统计/)
  assert.doesNotMatch(smartInsights, /示例数据|MOCK_FRESHMAN|topMajors|ageDistribution/)
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
check('policy builtin records remain server-safe', () => {
  assert.match(renshi, /if \(isBuiltin\(item\.id\)\) return/)
  assert.match(renshi, /if \(!isBuiltin\(item\.id\)\) recordExternalJump/)
})
check('legacy CSS entry remains a compatibility aggregator', () => {
  for (const marker of [
    "@import './styles/jobs-fairs-foundation.css'",
    "@import './styles/jobs-companies-fusion.css'",
    "@import './styles/job-fairs-fusion.css'",
    "@import './styles/campus-policy-fusion.css'",
  ]) assert.ok(jobsCss.includes(marker), marker)
})

const w4Dirs = ['jobs', 'companies', 'offline-agencies', 'job-fairs', 'campus', 'smart-campus', 'renshi']
const w4Files = w4Dirs.flatMap((dir) => collectTsx(join(KIOSK_ROOT, 'src/pages', dir)))
  .concat([
    join(KIOSK_ROOT, 'src/pages/placeholders/CampusWelcomePage.tsx'),
    join(KIOSK_ROOT, 'src/pages/placeholders/FreshmanInsightsPage.tsx'),
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
