import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const sha256 = (path) => createHash('sha256').update(read(path)).digest('hex')

const W5_ROUTES = [
  '/member/qr-login', '/upload/phone', '/login', '/legal/:doc',
  '/screensaver', '/session-timeout', '/error-offline', '/profile',
  '/me/resumes', '/me/print-orders', '/me/documents', '/me/favorites',
  '/me/ai-records', '/me/benefits', '/me/activity', '/me/activity/:id',
  '/me/notifications', '/me/feedback', '/me/settings', '/me/privacy-requests', '/help',
  '/activities', '/activities/:id', '/toolbox',   '/notifications',
]
const SELF_ASSESSMENT_V1_ROUTES = [
  '/resume/self-assessment/intro',
  '/resume/self-assessment/questions',
  '/resume/self-assessment/result',
  '/resume/self-assessment/history',
]
const W5_ROUTES_EXPANDED = [...W5_ROUTES, ...SELF_ASSESSMENT_V1_ROUTES]

const FROZEN = new Map([
  ['src/pages/auth/hooks/useMemberPhoneLogin.ts', '3181319ca52796ba6687991297a1319fea38f481fa382f36ce98146d85a8dae5'],
  ['src/pages/profile/assets/useMemberProfileOverview.ts', '3679de500e38d9d84b5f77680090997dc27eabca861af58c3d407eeb9e420395'],
  ['src/pages/profile/profileEntries.ts', 'dad0e5fbf3d7ea3e22ffa852750158d5ee1af50e028a7b8df9fc01c0a3a2b0ae'],
  ['src/pages/profile/profileTypes.ts', 'a97ea090c8c691f4873255fe4258813d37344371159d54dba89f8c251b46c89f'],
  ['src/pages/profile/assets/format.ts', '84f96614592bbcb611eeec10351435f661dd817e14cd3637e5d76f5e61451d04'],
  ['src/pages/profile/me/feedback/types.ts', 'a54e706d069dfff939b65d6714a1bbfa032b49cda974f14507362b00a11a048f'],
  ['src/pages/profile/me/printOrders/paymentCopy.ts', '1adb30c98603ef45cc5fd065e9c28d0905b4a02e902ba741f4ff8dd4b35800ed'],
  ['src/pages/profile/me/printOrders/statusRefresh.ts', '61c86d39d8a4c576ec9b9c2ca2b92d08ee463a6874737cc4a7df70e36103ad8f'],
  ['src/pages/home/components/ContinuePanel.tsx', 'd9fc437e98a25e9734494bbd6dece4d0c3649ea5fa616d57d4e97451c111eff3'],
  ['src/pages/home/components/kioskAppLaunch.ts', '5bb684513182d680b91c6f086d17d27e26caed8b6cf616eba79ea1fa3c0a3b6b'],
  ['src/pages/home/components/ToolboxLaunchModals.tsx', 'bb79f207e4e1fbb22cdfc33239dbefc58cbdcd18f7df89adf08e4061354fe99c'],
  ['src/pages/upload/components/UploadSessionQrPanel.tsx', '0c1606a0cab8bfe63fedeaa6dfa39676e80b9f5d4cf3c320ef27d629d5f885db'],
])

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
  return null
}

function directStringProperty(object, name) {
  const property = object.properties.find(
    (candidate) => ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === name,
  )
  return property && ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)
    ? property.initializer.text
    : null
}

function extractRoutes(source) {
  const file = ts.createSourceFile('routes.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const paths = []
  const visit = (node) => {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'createBrowserRouter'
      && node.arguments[0]
      && ts.isArrayLiteralExpression(node.arguments[0])) {
      const collect = (array) => {
        for (const element of array.elements) {
          if (!ts.isObjectLiteralExpression(element)) continue
          const path = directStringProperty(element, 'path')
          if (path !== null) paths.push(path === '' ? '/' : path.startsWith('/') ? path : `/${path}`)
          const children = element.properties.find(
            (candidate) => ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === 'children',
          )
          if (children && ts.isPropertyAssignment(children) && ts.isArrayLiteralExpression(children.initializer)) {
            collect(children.initializer)
          }
        }
      }
      collect(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return paths
}

function regularFiles(root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) return []
    if (entry.isDirectory()) return regularFiles(path)
    return entry.isFile() ? [path] : []
  })
}

const routes = extractRoutes(read('src/routes/index.tsx'))
const owned = W5_ROUTES_EXPANDED.filter((route) => routes.includes(route))
assert.deepEqual(owned, W5_ROUTES_EXPANDED, 'W5 must own exactly the ordered route patterns (incl. self-assessment v1)')
assert.equal(new Set(owned).size, W5_ROUTES_EXPANDED.length, 'W5 route inventory must be unique')

for (const [path, expected] of FROZEN) {
  assert.equal(sha256(path), expected, `frozen W5 dependency changed: ${path}`)
}

const notifications = read('src/pages/placeholders/NotificationsPage.tsx')
const activityDetail = read('src/pages/placeholders/MeActivityDetailPage.tsx')
const meShell = read('src/pages/profile/me/MeListShell.tsx')
const detailCss = read('src/pages/profile/me/me-detail-inkpaper.css')
const benefitActivityDetailCss = read('src/pages/activities/activities-detail-inkpaper.css')
const benefitActivityDetail = read('src/pages/activities/BenefitActivityDetailPage.tsx')
const mobileQrCss = read('src/pages/auth/mobile-qr-service-desk.css')
const phoneUploadCss = read('src/pages/upload/phone-upload-service-desk.css')
const legalDoc = read('src/pages/legal/LegalDocPage.tsx')
const legalDocCss = read('src/pages/legal/legal-service-desk.css')
const toolbox = read('src/pages/toolbox/ToolboxZonePage.tsx')
const toolboxCss = read('src/pages/toolbox/toolbox-zone.css')
const profileCss = [
  read('src/pages/profile/profile-lightflow-shell.css'),
  read('src/pages/profile/profile-lightflow-directory.css'),
  read('src/pages/profile/profile-lightflow-state.css'),
].join('\n')

function assertSharedPageShell(source, path) {
  assert.match(source, /<KioskPageFrame\b/, `${path} uses the shared KioskPageFrame`)
  assert.match(source, /<KioskPageHeader\b/, `${path} uses the shared KioskPageHeader`)
}

function assertSinglePaddingNeutralizer(source, path, scopePattern) {
  const blocks = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].includes('.ui-kiosk-page-content'))
  assert.equal(blocks.length, 1, `${path} declares exactly one shared-content padding neutralizer`)
  assert.match(blocks[0][1], scopePattern, `${path} scopes the shared-content padding neutralizer to its page`)
  assert.match(blocks[0][2], /\bpadding:\s*0(?:px)?\s*;/, `${path} neutralizes the shared content padding`)
}

assert.match(notifications, /MyNotificationsPage/, '/notifications reuses the canonical member capability')
assert.doesNotMatch(notifications, /services\//, '/notifications adds no second data source')
assert.match(activityDetail, /getMyBrowseLogs/, 'activity detail reads the member browse feed')
assert.match(activityDetail, /getMyJumpLogs/, 'activity detail reads the member jump feed')
assert.match(activityDetail, /nextCursor/, 'activity detail follows cursor pagination')
assert.doesNotMatch(activityDetail, /benefitActivities|claimBenefitActivity/, 'activity detail stays separate from benefits')
assert.match(meShell, /KioskPageFrame/, 'member list shell uses the frozen W1 frame')
assert.match(meShell, /KioskStatePanel/, 'member list shell uses the frozen W1 state panel')
assert.match(meShell, /<section data-kiosk-domain="profile" data-kiosk-screen="member-list" className="flex min-h-0 flex-1 flex-col px-6">/, 'member list content keeps its exact neutral wrapper')
assert.doesNotMatch(meShell, /<\/?main\b/, 'member list shell leaves the main landmark to KioskLayout')
assert.match(activityDetail, /<section data-kiosk-domain="profile" data-kiosk-screen="activity-detail" className="me-detail-scroll">/, 'activity detail keeps its exact neutral wrapper')
assert.doesNotMatch(activityDetail, /<\/?main\b/, 'activity detail leaves the main landmark to KioskLayout')
assertSharedPageShell(benefitActivityDetail, 'BenefitActivityDetailPage')
assert.match(
  benefitActivityDetail,
  /<section\b(?=[^>]*\bdata-kiosk-domain="profile")(?=[^>]*\bdata-kiosk-screen="activity-detail")(?=[^>]*\bclassName="k8-act-scroll")[^>]*>/,
  'benefit activity detail keeps its profile/activity-detail marker on the real scroll section',
)
for (const marker of [
  'getBenefitActivity(id, getToken())',
  "state === 'loading'",
  "state === 'error' || !item",
  'claimBenefitActivity(id, getToken())',
  'BenefitActivitiesApiError',
  'message &&',
]) {
  assert.match(benefitActivityDetail, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `benefit activity detail keeps real branch ${marker}`)
}
assertSharedPageShell(toolbox, 'ToolboxZonePage')
assert.match(
  toolbox,
  /<section\b(?=[^>]*\bdata-kiosk-screen="toolbox")(?=[^>]*\bclassName="tb-content")[^>]*>/,
  'toolbox keeps its stable screen marker on the real content section',
)
for (const marker of ['config.enabled', 'items.length > 0', '<QrLaunchModal', '<ExternalLaunchModal']) {
  assert.match(toolbox, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `toolbox keeps real branch/modal ${marker}`)
}
assert.doesNotMatch(toolbox, /<\/?main\b/, 'toolbox leaves the main landmark to KioskLayout')
assertSharedPageShell(legalDoc, 'LegalDocPage')
assert.match(legalDoc, /data-kiosk-screen="legal-doc"/, 'legal document keeps its stable screen marker')
assert.match(legalDoc, /apiContent\s*\?\s*\(/, 'legal document keeps the real API-content branch')
assert.match(legalDoc, /!apiContent\s*&&\s*\(/, 'legal document keeps the audited fallback branch')
assertSinglePaddingNeutralizer(
  benefitActivityDetailCss,
  'activities-detail-inkpaper.css',
  /\.k8-act-detail\b/,
)
assertSinglePaddingNeutralizer(legalDocCss, 'legal-service-desk.css', /\.k1-legal-doc\b/)
assertSinglePaddingNeutralizer(toolboxCss, 'toolbox-zone.css', /\.kpv1\.ktoolbox\b/)
assert.match(
  profileCss,
  /\.fusion-w5--profile-entry\s*>\s*\.ui-kiosk-page-content\s*\{[^}]*padding:\s*0;/,
  'profile entry neutralizes shared content padding so prototype 48px gutters are not doubled',
)
assert.match(
  mobileQrCss,
  /\.k1-mobile-qr-login \.k1-mobile-qr-content\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/,
  'mobile QR shell includes padding and can shrink inside the 390px viewport width',
)
assert.match(
  mobileQrCss,
  /\.k1-mobile-qr-login \.k1-mobile-qr-input\s*\{[^}]*?min-height:\s*48px;/,
  'mobile QR inputs keep a 48px direct touch target',
)
assert.match(
  phoneUploadCss,
  /\.k1-phone-upload \.k1-phone-upload-content\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/,
  'phone upload shell includes padding and can shrink inside the 390px viewport width',
)
assert.match(
  phoneUploadCss,
  /\.k1-phone-upload \.ph-up-remove\s*\{[^}]*?width:\s*48px;[^}]*?height:\s*48px;/,
  'phone upload remove action keeps a 48px direct touch target',
)

for (const leaf of [
  'me-detail-base.css', 'me-assets.css', 'me-orders.css', 'me-records.css', 'me-settings-feedback.css',
]) {
  assert.match(detailCss, new RegExp(`@import ['"]\\./styles/${leaf.replace('.', '\\.')}['"]`), `detail CSS imports ${leaf}`)
}

const productionFiles = regularFiles(join(ROOT, 'src/pages'))
  .filter((path) => ['.ts', '.tsx'].includes(extname(path)))
for (const path of productionFiles) {
  const source = readFileSync(path, 'utf8')
  const label = relative(ROOT, path)
  assert.doesNotMatch(source, /\b(mock|demo)(Data|Items|Records|User)\b/i, `production placeholder identifier in ${label}`)
  assert.doesNotMatch(source, /一键投递|立即投递/, `forbidden recruitment copy in ${label}`)
}

const concretePages = [
  'src/pages/profile/ProfilePage.tsx',
  'src/pages/profile/me/MyResumesPage.tsx',
  'src/pages/profile/me/MyPrintOrdersPage.tsx',
  'src/pages/profile/me/MyDocumentsPage.tsx',
  'src/pages/profile/me/MyFavoritesPage.tsx',
  'src/pages/profile/me/MyAiRecordsPage.tsx',
  'src/pages/profile/me/MyBenefitsPage.tsx',
  'src/pages/profile/me/MyActivityPage.tsx',
  'src/pages/profile/me/MyNotificationsPage.tsx',
  'src/pages/profile/me/MyFeedbackPage.tsx',
  'src/pages/profile/me/MySettingsPage.tsx',
  'src/pages/profile/me/MyPrivacyRequestsPage.tsx',
  'src/pages/auth/LoginPage.tsx',
  'src/pages/auth/MobileQrLoginPage.tsx',
  'src/pages/upload/PhoneUploadPage.tsx',
  'src/pages/legal/LegalDocPage.tsx',
  'src/pages/screensaver/ScreensaverPage.tsx',
  'src/pages/placeholders/SessionTimeoutPage.tsx',
  'src/pages/placeholders/ErrorOfflinePage.tsx',
  'src/pages/help/HelpCenterPage.tsx',
  'src/pages/activities/BenefitActivitiesPage.tsx',
  'src/pages/activities/BenefitActivityDetailPage.tsx',
  'src/pages/toolbox/ToolboxZonePage.tsx',
]
for (const path of concretePages) {
  const source = read(path)
  assert.match(source, /fusion-w5|data-kiosk-presentation=["']fusion-youth["']|MeListShell/, `${path} exposes W5 fusion scope`)
}

console.log('ALL PASS fusion W5 route, boundary, and presentation contract')
