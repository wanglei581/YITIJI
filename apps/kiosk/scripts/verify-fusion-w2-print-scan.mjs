import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(kioskRoot, path), 'utf8')
const sha256 = (path) => createHash('sha256').update(read(path)).digest('hex')

const directRoutes = new Map([
  ['/print-scan', 'PrintScanHomePage'],
  ['/print-scan/feature/:key', 'PrintScanFeatureInfoPage'],
  ['/print-scan/convert', 'ConvertImagesPage'],
  ['/print-scan/sign', 'SignStampPage'],
  ['/print/upload', 'PrintUploadPage'],
  ['/print/material-check', 'PrintMaterialCheckPage'],
  ['/print/preview', 'PrintPreviewPage'],
  ['/print/params', 'PrintParamsPage'],
  ['/print/confirm', 'PrintConfirmPage'],
  ['/print/cashier', 'PrintCashierPage'],
  ['/print/progress', 'PrintProgressPage'],
  ['/print/done', 'PrintDonePage'],
  ['/scan/start', 'ScanStartPage'],
  ['/scan/settings', 'ScanSettingsPage'],
  ['/scan/progress', 'ScanProgressPage'],
  ['/scan/result', 'ScanResultPage'],
])
const redirects = new Map([
  ['/print/scan-convert', '/print-scan/convert'],
  ['/print/scan-sign', '/print-scan/sign'],
  ['/print/scan-feature', '/print-scan/feature/id-photo'],
])
const frozenHashes = new Map([
  [
    'src/pages/upload/components/UploadSessionQrPanel.tsx',
    'c7757306daa80f82ce58adb188dce73b68ea9840e9cff8312f54a2af63b72f50',
  ],
  [
    'src/pages/print/DevSandboxControls.tsx',
    'f8798286863c8e78043f06d51f9e11cb887df937bdd7991cd953fd2599a2324b',
  ],
  [
    'src/pages/print/cashierStatus.ts',
    '24523dad9d5641105e21c5d4d9bd2b12b6eea9cd6ad5ef831dcc514d74a5fd40',
  ],
  [
    // 2026-08-09 重新冻结:MaterialCheckSummary.redaction 换成 claim 契约摘要
    // (docs/product/pii-redaction-decision-2026-08.md §3.4)。原快照
    // c222592c… 对应旧的 resultFileCreated 形状,已随该缺陷一并作废。
    'src/pages/print/printMaterialSession.ts',
    '0d6478abf52f20901d2887b616e3dfa1cf74cbf791fed277dfe2211885731c54',
  ],
])

const property = (object, name) =>
  object.properties.find(
    (item) =>
      ts.isPropertyAssignment(item) &&
      ((ts.isIdentifier(item.name) && item.name.text === name) ||
        (ts.isStringLiteral(item.name) && item.name.text === name))
  )

const stringValue = (object, name) => {
  const item = property(object, name)
  return item && ts.isStringLiteralLike(item.initializer) ? item.initializer.text : null
}

const jsxName = (node) => {
  if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return null
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
  return ts.isIdentifier(tag) ? tag.text : null
}

const jsxAttribute = (node, name) => {
  if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return null
  const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes
  const attribute = attributes.properties.find(
    (item) => ts.isJsxAttribute(item) && item.name.text === name
  )
  if (!attribute || !ts.isJsxAttribute(attribute)) return null
  if (!attribute.initializer) return true
  return ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : null
}

const source = ts.createSourceFile(
  'routes.tsx',
  read('src/routes/index.tsx'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let routerArray = null
const visit = (node) => {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'createBrowserRouter' &&
    node.arguments[0] &&
    ts.isArrayLiteralExpression(node.arguments[0])
  )
    routerArray = node.arguments[0]
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(routerArray, 'createBrowserRouter array must exist')
const routeObjects = []
const collectRoutes = (array) => {
  for (const item of array.elements) {
    if (!ts.isObjectLiteralExpression(item)) continue
    routeObjects.push(item)
    const nestedChildren = property(item, 'children')?.initializer
    if (nestedChildren && ts.isArrayLiteralExpression(nestedChildren)) collectRoutes(nestedChildren)
  }
}
collectRoutes(routerArray)
const root = routeObjects.find(
  (item) =>
    ts.isObjectLiteralExpression(item) &&
    stringValue(item, 'path') === '/' &&
    jsxName(property(item, 'element')?.initializer) === 'KioskRoot'
)
assert.ok(root && ts.isObjectLiteralExpression(root), 'KioskRoot route must exist')
const childrenProperty = property(root, 'children')
assert.ok(
  childrenProperty && ts.isArrayLiteralExpression(childrenProperty.initializer),
  'KioskRoot children must be a direct array'
)

const actualRoutes = new Map()
const actualRedirects = new Map()
for (const item of childrenProperty.initializer.elements) {
  if (!ts.isObjectLiteralExpression(item)) continue
  const relativePath = stringValue(item, 'path')
  const element = property(item, 'element')?.initializer
  if (!relativePath || !element) continue
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`
  const name = jsxName(element)
  if (name === 'Navigate') {
    assert.equal(jsxAttribute(element, 'replace'), true, `${path} redirect must use replace`)
    actualRedirects.set(path, jsxAttribute(element, 'to'))
  } else if (name) actualRoutes.set(path, name)
}
for (const [path, owner] of directRoutes)
  assert.equal(actualRoutes.get(path), owner, `${path} owner`)
for (const [path, target] of redirects)
  assert.equal(actualRedirects.get(path), target, `${path} redirect`)
assert.equal(directRoutes.size + redirects.size, 19)
for (const [path, hash] of frozenHashes) assert.equal(sha256(path), hash, `${path} remains frozen`)

assert.match(read('src/pages/print/PrintPrototypeLayout.tsx'), /KioskPageFrame/)
assert.match(read('src/pages/print/PrintPrototypeLayout.tsx'), /KioskPageHeader/)
assert.match(read('src/pages/print/PrintMaterialCheckPage.tsx'), /MaterialCheckPresentation/)
for (const css of [
  'print-upload.css',
  'print-material-check.css',
  'print-preview-params.css',
  'print-cashier.css',
  'print-progress-result.css',
])
  assert.match(
    read('src/pages/print/print-prototype.css'),
    new RegExp(`@import ["']\\./styles/${css}["']`)
  )

const presentationFiles = [
  'src/pages/print/components/MaterialCheckPresentation.tsx',
  'src/pages/print/components/RedactionReviewPresentation.tsx',
]
const forbiddenPresentationMarkers = [
  '../../services',
  'useAuth',
  'useBusyLock',
  'sessionStorage',
  'localStorage',
  'useNavigate',
  'useLocation',
  'setInterval',
  'setTimeout',
]
for (const path of presentationFiles) {
  if (!existsSync(join(kioskRoot, path))) continue
  const body = read(path)
  for (const marker of forbiddenPresentationMarkers)
    assert.ok(!body.includes(marker), `${path} must not contain ${marker}`)
}

const printScanPages = new Map([
  ['src/pages/print-scan/PrintScanHomePage.tsx', 'print-scan-home'],
  ['src/pages/print-scan/PrintScanFeatureInfoPage.tsx', 'print-scan-feature'],
  ['src/pages/print-scan/ConvertImagesPage.tsx', 'print-scan-convert'],
  ['src/pages/print-scan/SignStampPage.tsx', 'print-scan-sign'],
])
for (const [path, marker] of printScanPages) {
  const body = read(path)
  assert.match(body, /KioskPageFrame/, `${path} uses the frozen page frame`)
  assert.match(body, new RegExp(`data-w2-page=["']${marker}["']`), `${path} exposes ${marker}`)
  assert.match(
    body,
    /\.\/styles\/print-scan-fusion\.css/,
    `${path} imports the scoped W2 stylesheet`
  )
}
const printScanFusionCss = read('src/pages/print-scan/styles/print-scan-fusion.css')
const frameContentPaddingContracts = new Map([
  ['src/pages/print-scan/styles/print-scan-fusion.css', 'w2-print-scan-page'],
  ['src/pages/scan/styles/scan-fusion.css', 'w2-scan-page'],
  ['src/pages/print/print-prototype.css', 'print-proto'],
])
for (const [path, frameClass] of frameContentPaddingContracts) {
  assert.match(
    read(path),
    new RegExp(
      `\\[data-kiosk-presentation=['"]fusion-youth['"]\\]\\s+\\.${frameClass}\\s*>\\s*\\.ui-kiosk-page-content\\s*\\{[^}]*padding:\\s*0\\s*;`
    ),
    `${frameClass} neutralizes direct kiosk page content padding`
  )
}
assert.match(
  printScanFusionCss,
  /\.w2-print-scan-shell\s*>\s*:is\(main,\s*section\)\s*\{/,
  'print-scan shell isolation must support both main and section content roots'
)
assert.doesNotMatch(
  printScanFusionCss,
  /\.w2-print-scan-shell\s*>\s*main\s*\{/,
  'print-scan shell isolation must not drift back to a main-only selector'
)
const printScanHome = read('src/pages/print-scan/PrintScanHomePage.tsx')
for (const marker of [
  'loadConfiguredCapabilities',
  'CARD_CAPABILITY_KEY',
  'CAPABILITY_STATUS_NOTES',
]) {
  assert.match(printScanHome, new RegExp(marker), `print-scan home retains ${marker}`)
}
assert.match(
  printScanHome,
  /<KioskPageHeader[\s\S]*?onBack=\{\(\) => navigate\('\/'\)\}[\s\S]*?backLabel=["']返回["'][\s\S]*?\/>/,
  'print-scan home exposes the prototype back button on the left of its page heading'
)
assert.doesNotMatch(
  printScanHome,
  /<KioskPageHeader[\s\S]*?aside=\{/,
  'print-scan home must not move its primary back action into a narrow heading aside'
)
assert.doesNotMatch(
  printScanHome,
  /<KioskActionBar\b/,
  'print-scan hub uses the prototype global navbar and must not render a second bottom action bar'
)
assert.match(
  printScanFusionCss,
  /\.w2-print-scan-shell\s*\{[^}]*padding:\s*0\s+48px\s+32px\s*;/,
  'print-scan shell uses the prototype 48px content gutter without adding top padding to the pagehead'
)
assert.match(
  printScanFusionCss,
  /\.w2-print-scan-shell\s*>\s*\.ui-kiosk-page-header\s*\{[^}]*margin-inline:\s*-48px\s*;/,
  'print-scan pagehead bleeds through the content gutter so its back button starts at 48px'
)
const convertImages = read('src/pages/print-scan/ConvertImagesPage.tsx')
for (const marker of ['kioskUploadFile', 'convertImagesToPdf', 'UploadSessionQrPanel']) {
  assert.match(convertImages, new RegExp(marker), `convert-images retains ${marker}`)
}
assert.match(
  convertImages,
  /<img[\s\S]*?src=\{img\.fileAccessUrl\}[\s\S]*?alt=\{`\$\{img\.name\} 缩略图`\}/,
  'convert-images renders each uploaded image instead of a paper skeleton'
)
const scanResultPreviewSource = read('src/pages/scan/ScanResultPage.tsx')
assert.match(scanResultPreviewSource, /<FileContentPreview[\s\S]*?fileUrl=\{file\.fileUrl\}/, 'scan result renders the real scanned file')
const signStamp = read('src/pages/print-scan/SignStampPage.tsx')
for (const marker of [
  'signInspect',
  'signCompose',
  'AUTHORIZATION_LABEL',
  'UploadSessionQrPanel',
]) {
  assert.match(signStamp, new RegExp(marker), `sign-stamp retains ${marker}`)
}

const printUpload = read('src/pages/print/PrintUploadPage.tsx')
assert.match(
  printUpload,
  /type UploadTab = 'file' \| 'qr' \| 'usb'/,
  'print upload keeps exactly three selectable tabs'
)
assert.match(
  printUpload,
  /navigate\('\/scan\/start'\)/,
  'print upload keeps scan as an independent CTA'
)
assert.match(printUpload, /data-w2-page=["']print-upload["']/, 'print upload exposes its W2 marker')
assert.match(printUpload, /w2-print-upload-source-grid/, 'print upload exposes the 2x2 source grid')
assert.match(printUpload, /print-upload-footer/, 'print upload exposes a semantic footer selector')
assert.match(
  read('src/pages/print/styles/print-upload.css'),
  /\.w2-print-upload-source-grid\b/,
  'print upload stylesheet owns the live source grid selector'
)
assert.equal(
  (printUpload.match(/<UploadSessionQrPanel\b/g) ?? []).length,
  1,
  'print upload renders one QR session panel'
)
const printPrototypeLayout = read('src/pages/print/PrintPrototypeLayout.tsx')
assert.match(
  printPrototypeLayout,
  /classNames\.includes\(["']p-6["']\)/,
  'shared print frame recognizes legacy p-6 callers that need the unified gutter'
)
assert.match(
  printPrototypeLayout,
  /className\s*!==\s*["']p-6["']/,
  'shared print frame removes legacy outer padding instead of stacking it around the pagehead'
)
assert.match(
  printPrototypeLayout,
  /contentClassName=\{usesUnifiedGutter\s*\?\s*["']print-proto-content--guttered["']\s*:\s*undefined\}/,
  'shared print frame moves legacy callers onto its content gutter contract'
)
const printPrototypeCss = read('src/pages/print/print-prototype.css')
assert.match(
  printPrototypeCss,
  /--print-page-gutter:\s*48px\s*;/,
  'print flow declares the prototype 48px gutter once'
)
assert.match(
  printPrototypeCss,
  /\.print-proto\s*>\s*\.ui-kiosk-page-content\.print-proto-content--guttered\s*\{[^}]*padding-inline:\s*var\(--print-page-gutter\)\s*;/,
  'legacy print callers receive the shared 48px content gutter'
)
assert.match(
  printPrototypeCss,
  /\.print-proto-content--guttered[\s\S]*?>\s*:is\(\.ui-kiosk-page-header,\s*\.ui-kiosk-steps,\s*\.ui-kiosk-action-bar\)\s*\{[^}]*margin-inline:\s*calc\(-1\s*\*\s*var\(--print-page-gutter\)\)\s*;/,
  'pagehead, steps and actionbar bleed through the content gutter without absolute positioning'
)
assert.match(
  printPrototypeCss,
  /\[data-w2-page=["']print-upload["']\]\s*>\s*\.print-upload-footer\s*\{[^}]*margin:\s*22px\s+calc\(-1\s*\*\s*var\(--print-page-gutter\)\)\s+0\s*;[^}]*padding:\s*26px\s+var\(--print-page-gutter\)\s+34px\s*;[^}]*border-top:\s*1px\s+solid\s+var\(--print-line\)\s*;/,
  'print upload ordinary footer buttons follow the prototype actionbar geometry'
)
const materialPresentation = read('src/pages/print/components/MaterialCheckPresentation.tsx')
assert.match(
  materialPresentation,
  /data-w2-page=["']print-material-check["']/,
  'material presentation exposes its W2 marker'
)
assert.match(
  materialPresentation,
  /aria-pressed=\{finding\.selected === action\}/,
  'material privacy decisions expose their selected state accessibly'
)
const materialContainer = read('src/pages/print/PrintMaterialCheckPage.tsx')
for (const marker of [
  'waitForCompletedTask',
  'readPrintMaterialSession',
  'patchPrintMaterialSession',
  'clearPrintMaterialSession',
  'decidePiiFindings',
])
  assert.match(materialContainer, new RegExp(marker), `material container retains ${marker}`)
for (const kind of ['inspection', 'normalize_a4', 'pii_scan', 'pii_redact']) {
  assert.match(
    materialContainer,
    new RegExp(`kind: ["']${kind}["']`),
    `material container retains ${kind}`
  )
}

const printSetupPages = new Map([
  ['src/pages/print/PrintPreviewPage.tsx', 'print-preview'],
  ['src/pages/print/PrintParamsPage.tsx', 'print-params'],
  ['src/pages/print/PrintConfirmPage.tsx', 'print-confirm'],
])
for (const [path, marker] of printSetupPages) {
  const body = read(path)
  assert.match(body, new RegExp(`data-w2-page=["']${marker}["']`), `${path} exposes ${marker}`)
  assert.match(body, /PrintPageFrame/, `${path} uses the shared print frame`)
  assert.match(body, /KioskActionBar/, `${path} uses the frozen action bar`)
}
for (const path of [
  'src/pages/print/PrintPreviewPage.tsx',
  'src/pages/print/PrintParamsPage.tsx',
]) {
  const body = read(path)
  const isPreview = path.includes('PrintPreviewPage')
  for (const marker of [
    'readPrintMaterialSession',
    'useTerminalDeviceStatus',
    'pageRange',
    'patchPrintMaterialSession',
    ...(isPreview ? [] : ['usePrintPriceConfig', 'estimatePrintCents']),
  ]) {
    assert.match(body, new RegExp(marker), `${path} retains ${marker}`)
  }
}
assert.match(
  read('src/pages/print/PrintParamsPage.tsx'),
  /countPagesInRange/,
  'PrintParamsPage estimates with pageRange'
)
assert.match(
  read('src/hooks/useTerminalDeviceStatus.ts'),
  /printer-status/,
  'device status hook hits printer-status'
)
assert.match(
  read('src/pages/print/PrintConfirmPage.tsx'),
  /quotePrintOrder/,
  'PrintConfirmPage quotes via backend'
)
const printConfirm = read('src/pages/print/PrintConfirmPage.tsx')
for (const marker of [
  'createPrintJob',
  'fileUrl',
  'fileMd5',
  'paymentSessionToken',
  'amountCents > 0',
  '/print/cashier',
  '/print/progress',
  'clearPrintMaterialSession',
  'printUploadPathForSource',
])
  assert.match(
    printConfirm,
    new RegExp(marker.replaceAll('/', '\\/')),
    `print confirm retains ${marker}`
  )

const fulfillmentPages = new Map([
  ['src/pages/print/PrintCashierPage.tsx', 'print-cashier'],
  ['src/pages/print/PrintProgressPage.tsx', 'print-progress'],
  ['src/pages/print/PrintDonePage.tsx', 'print-done'],
])
for (const [path, marker] of fulfillmentPages) {
  assert.match(
    read(path),
    new RegExp(`data-w2-page=["']${marker}["']`),
    `${path} exposes ${marker}`
  )
}
const cashier = read('src/pages/print/PrintCashierPage.tsx')
for (const marker of [
  'deriveCashierView',
  'fetchPaymentChannels',
  'createPayAttempt',
  'getPayStatus',
  'reconcilePayment',
  'createCodePayAttempt',
  'paymentSessionToken',
  'canProceed',
]) {
  assert.match(cashier, new RegExp(marker), `cashier retains ${marker}`)
}
const cashierPanel = read('src/pages/print/CashierPaymentPanel.tsx')
assert.match(
  cashierPanel,
  /import\.meta\.env\.DEV[\s\S]*sandbox/,
  'cashier sandbox controls remain DEV-only'
)
assert.match(
  cashierPanel,
  /KioskStatePanel/,
  'cashier terminal payment states use the frozen state panel'
)
for (const phase of ['failed', 'closed', 'expired', 'refunded']) {
  assert.match(cashierPanel, new RegExp(`["']${phase}["']`), `cashier panel maps ${phase}`)
}
const printProgress = read('src/pages/print/PrintProgressPage.tsx')
for (const marker of [
  'POLL_INTERVAL_MS = 3000',
  'REAL_POLL_TIMEOUT_MS = 10 \* 60 \* 1000',
  'API_MODE',
  'taskId',
  'failureReasonForUser',
]) {
  assert.match(
    printProgress,
    new RegExp(marker.replaceAll('*', '\\*')),
    `print progress retains ${marker}`
  )
}
const printDone = read('src/pages/print/PrintDonePage.tsx')
assert.match(printDone, /getPayStatus/, 'print done obtains pickup code from payment status')
assert.ok(!/Math\.random|randomUUID/.test(printDone), 'print done never fabricates a pickup code')

const scanPages = new Map([
  ['src/pages/scan/ScanStartPage.tsx', 'scan-start'],
  ['src/pages/scan/ScanSettingsPage.tsx', 'scan-settings'],
  ['src/pages/scan/ScanProgressPage.tsx', 'scan-progress'],
  ['src/pages/scan/ScanResultPage.tsx', 'scan-result'],
])
for (const [path, marker] of scanPages) {
  const body = read(path)
  assert.match(body, new RegExp(`data-w2-page=["']${marker}["']`), `${path} exposes ${marker}`)
  assert.match(body, /\.\/styles\/scan-fusion\.css/, `${path} imports the scoped W2 stylesheet`)
  assert.match(body, /KioskPageFrame/, `${path} uses the frozen page frame`)
  assert.match(body, /KioskPageHeader/, `${path} uses the frozen page header`)
}

const scanStart = read('src/pages/scan/ScanStartPage.tsx')
assert.doesNotMatch(
  scanStart,
  /fetchScannerStatus|\/kiosk\/device\/status|setInterval\s*\(/,
  'scan start must not pretend an unavailable scanner-status source exists'
)
assert.match(
  scanStart,
  /loadConfiguredCapabilities/,
  'scan start gates on terminal scan capability'
)
assert.match(
  scanStart,
  /下一步会创建真实扫描会话/,
  'scan start explains when the real session is created'
)
assert.match(
  scanStart,
  /可创建扫描任务/,
  'scan start uses task-creation copy instead of hardware ready'
)
assert.doesNotMatch(scanStart, /扫描仪就绪/, 'scan start must not claim scanner hardware ready')
assert.match(
  scanStart,
  /navigate\(["']\/scan\/settings["'][\s\S]*state:\s*\{\s*scanType:\s*selected\s*\}/,
  'scan start carries a validated scan type into settings'
)
const scanSettings = read('src/pages/scan/ScanSettingsPage.tsx')
assert.match(scanSettings, /function isScanType\(/, 'scan settings validates direct route state')
assert.match(
  scanSettings,
  /if\s*\(!scanType\)\s*return/,
  'invalid direct access cannot create a session'
)
assert.match(scanSettings, /instructions\.map\(/, 'success renders only server instructions')
assert.match(
  scanSettings,
  /const cancellationCredentials = getCancellationCredentials\(created\)[\s\S]*if \(!isValidCreatedSession\(created\)\)[\s\S]*cancelSessionOnce\(/,
  'malformed created sessions with usable credentials are not left active'
)
assert.doesNotMatch(
  scanSettings,
  /const GUIDE_STEPS|localStorage|sessionStorage/,
  'settings does not invent guides or persist control tokens'
)

const assertNoStorageAccess = (path) => {
  const scanSource = ts.createSourceFile(
    path,
    read(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const forbidden = new Set(['sessionStorage', 'localStorage'])
  const hits = []
  const visitStorage = (node) => {
    if (ts.isIdentifier(node) && forbidden.has(node.text)) hits.push(node.text)
    ts.forEachChild(node, visitStorage)
  }
  visitStorage(scanSource)
  assert.deepEqual(hits, [], `${path} must not access browser storage`)
}

for (const marker of [
  'createScanSession',
  'sessionPromiseRef',
  'confirmedRef',
  'controlToken',
  'instructions',
]) {
  assert.match(scanSettings, new RegExp(marker), `scan settings retains ${marker}`)
}
assertNoStorageAccess('src/pages/scan/ScanSettingsPage.tsx')
assert.match(
  scanSettings,
  /navigate\(["']\/scan\/progress["'][\s\S]*scanTaskId[\s\S]*scanType[\s\S]*controlToken/,
  'scan settings passes the control token through route state'
)

const scanProgress = read('src/pages/scan/ScanProgressPage.tsx')
assertNoStorageAccess('src/pages/scan/ScanProgressPage.tsx')
assert.match(
  scanProgress,
  /POLL_INTERVAL_MS = 3000/,
  'scan progress retains its three second polling interval'
)
assert.match(
  scanProgress,
  /setTimeout\([\s\S]*poll\(\)[\s\S]*POLL_INTERVAL_MS/,
  'scan progress retains self-scheduled non-overlapping polling'
)
assert.match(
  scanProgress,
  /getScanSessionStatus\(scanTaskId, controlToken, getToken\(\)\)/,
  'scan progress sends the in-memory control token for status requests'
)
assert.match(
  scanProgress,
  /cancelScanSession\(scanTaskId, controlToken, getToken\(\)\)/,
  'scan progress sends the in-memory control token for cancellation'
)
assert.match(
  scanProgress,
  /SCAN_TASK_ALREADY_COMPLETED/,
  'scan progress recovers completion during cancellation'
)

const scanResult = read('src/pages/scan/ScanResultPage.tsx')
for (const target of ['/print/confirm', '/me/documents', '/resume/parse']) {
  assert.match(
    scanResult,
    new RegExp(target.replaceAll('/', '\\\/')),
    `scan result retains ${target} action`
  )
}
assert.match(
  scanResult,
  /loginPathForCurrentLocation/,
  'scan result guides guests to login before documents'
)
assert.match(
  scanResult,
  /登录后管理文件|前往我的文档/,
  'scan result uses honest documents destination copy'
)
assert.match(scanResult, /state\.file/, 'scan result derives its file only from route state')
assert.ok(!/scan-result\.pdf/.test(scanResult), 'scan result never fabricates a local result file')
assert.doesNotMatch(
  scanResult,
  /保存到我的文档/,
  'scan result must not imply a completed save action'
)

const scanFusionCss = read('src/pages/scan/styles/scan-fusion.css')
assert.match(
  scanFusionCss,
  /\.w2-scan-two-column\s*,[\s\S]*?align-items:\s*stretch/,
  'scan dual columns stretch to equal height'
)
assert.match(
  scanFusionCss,
  /\.w2-scan-progress-list\s*>\s*div\s*\{[^}]*flex:\s*0\s+0\s+auto/,
  'scan progress rows do not vertically explode empty space'
)
assert.match(
  printScanFusionCss,
  /\.w2-print-scan-split\s*\{[^}]*align-items:\s*stretch/,
  'print-scan split columns stretch to equal height'
)
assert.match(
  printScanFusionCss,
  /\.w2-print-scan-preview-frame\s*\{[^}]*min-height:\s*360px/,
  'sign-stamp preview frame grows instead of a fixed short box'
)
assert.match(signStamp, /w2-print-scan-preview/, 'sign-stamp uses the densified preview shell')
assert.doesNotMatch(
  convertImages,
  /justify-around/,
  'convert rules must not space-around empty vertical room'
)

console.log('ALL PASS fusion W2 print/scan contract')
