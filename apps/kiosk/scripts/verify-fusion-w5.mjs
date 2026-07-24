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
  '/login', '/member/qr-login', '/upload/phone', '/legal/:doc',
  '/screensaver', '/session-timeout', '/error-offline', '/profile',
  '/me/resumes', '/me/print-orders', '/me/documents', '/me/favorites',
  '/me/ai-records', '/me/benefits', '/me/activity', '/me/activity/:id',
  '/me/notifications', '/me/feedback', '/me/settings', '/help',
  '/activities', '/activities/:id', '/toolbox', '/notifications',
]

const FROZEN = new Map([
  ['src/pages/auth/hooks/useMemberPhoneLogin.ts', '4b7b2acd2e26075720af72461f1326978e822ca23818e76e72402ee33d52e128'],
  ['src/pages/profile/assets/useMemberProfileOverview.ts', '3679de500e38d9d84b5f77680090997dc27eabca861af58c3d407eeb9e420395'],
  ['src/pages/profile/profileEntries.ts', 'ee82813c97673da21e06656d01fca3ee9016f53c41f8a35a7b2dda16afb28aab'],
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
const owned = routes.filter((route) => W5_ROUTES.includes(route))
assert.deepEqual(owned, W5_ROUTES, 'W5 must own exactly the ordered 24 route patterns')
assert.equal(new Set(owned).size, 24, 'W5 route inventory must be unique')

for (const [path, expected] of FROZEN) {
  assert.equal(sha256(path), expected, `frozen W5 dependency changed: ${path}`)
}

const notifications = read('src/pages/placeholders/NotificationsPage.tsx')
const activityDetail = read('src/pages/placeholders/MeActivityDetailPage.tsx')
const meShell = read('src/pages/profile/me/MeListShell.tsx')
const detailCss = read('src/pages/profile/me/me-detail-inkpaper.css')

assert.match(notifications, /MyNotificationsPage/, '/notifications reuses the canonical member capability')
assert.doesNotMatch(notifications, /services\//, '/notifications adds no second data source')
assert.match(activityDetail, /getMyBrowseLogs/, 'activity detail reads the member browse feed')
assert.match(activityDetail, /getMyJumpLogs/, 'activity detail reads the member jump feed')
assert.match(activityDetail, /nextCursor/, 'activity detail follows cursor pagination')
assert.doesNotMatch(activityDetail, /benefitActivities|claimBenefitActivity/, 'activity detail stays separate from benefits')
assert.match(meShell, /KioskPageFrame/, 'member list shell uses the frozen W1 frame')
assert.match(meShell, /KioskStatePanel/, 'member list shell uses the frozen W1 state panel')

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
