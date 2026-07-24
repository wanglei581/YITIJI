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
  ['src/pages/upload/components/UploadSessionQrPanel.tsx', '0c1606a0cab8bfe63fedeaa6dfa39676e80b9f5d4cf3c320ef27d629d5f885db'],
  ['src/pages/print/DevSandboxControls.tsx', 'f8798286863c8e78043f06d51f9e11cb887df937bdd7991cd953fd2599a2324b'],
  ['src/pages/print/cashierStatus.ts', '24523dad9d5641105e21c5d4d9bd2b12b6eea9cd6ad5ef831dcc514d74a5fd40'],
  ['src/pages/print/printMaterialSession.ts', 'c222592ca559b5edb8f45e5f29b294ad01e264f6903e2436100d36a8e04a3c78'],
])

const property = (object, name) => object.properties.find((item) => (
  ts.isPropertyAssignment(item)
  && ((ts.isIdentifier(item.name) && item.name.text === name)
    || (ts.isStringLiteral(item.name) && item.name.text === name))
))

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
  const attribute = attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.text === name)
  if (!attribute || !ts.isJsxAttribute(attribute)) return null
  if (!attribute.initializer) return true
  return ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : null
}

const source = ts.createSourceFile('routes.tsx', read('src/routes/index.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let routerArray = null
const visit = (node) => {
  if (ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'createBrowserRouter'
    && node.arguments[0]
    && ts.isArrayLiteralExpression(node.arguments[0])) routerArray = node.arguments[0]
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(routerArray, 'createBrowserRouter array must exist')
const root = routerArray.elements.find((item) => (
  ts.isObjectLiteralExpression(item)
  && stringValue(item, 'path') === '/'
  && jsxName(property(item, 'element')?.initializer) === 'KioskRoot'
))
assert.ok(root && ts.isObjectLiteralExpression(root), 'KioskRoot route must exist')
const childrenProperty = property(root, 'children')
assert.ok(childrenProperty && ts.isArrayLiteralExpression(childrenProperty.initializer), 'KioskRoot children must be a direct array')

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
for (const [path, owner] of directRoutes) assert.equal(actualRoutes.get(path), owner, `${path} owner`)
for (const [path, target] of redirects) assert.equal(actualRedirects.get(path), target, `${path} redirect`)
assert.equal(directRoutes.size + redirects.size, 19)
for (const [path, hash] of frozenHashes) assert.equal(sha256(path), hash, `${path} remains frozen`)

assert.match(read('src/pages/print/PrintPrototypeLayout.tsx'), /KioskPageFrame/)
assert.match(read('src/pages/print/PrintPrototypeLayout.tsx'), /KioskPageHeader/)
assert.match(read('src/pages/print/PrintMaterialCheckPage.tsx'), /MaterialCheckPresentation/)
for (const css of [
  'print-upload.css', 'print-material-check.css', 'print-preview-params.css',
  'print-cashier.css', 'print-progress-result.css',
]) assert.match(read('src/pages/print/print-prototype.css'), new RegExp(`@import ["']\\./styles/${css}["']`))

const presentationFiles = [
  'src/pages/print/components/MaterialCheckPresentation.tsx',
]
const forbiddenPresentationMarkers = [
  '../../services', 'useAuth', 'useBusyLock', 'sessionStorage', 'localStorage',
  'useNavigate', 'useLocation', 'setInterval', 'setTimeout',
]
for (const path of presentationFiles) {
  if (!existsSync(join(kioskRoot, path))) continue
  const body = read(path)
  for (const marker of forbiddenPresentationMarkers) assert.ok(!body.includes(marker), `${path} must not contain ${marker}`)
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
  assert.match(body, /\.\/styles\/print-scan-fusion\.css/, `${path} imports the scoped W2 stylesheet`)
}
const printScanFusionCss = read('src/pages/print-scan/styles/print-scan-fusion.css')
assert.match(
  printScanFusionCss,
  /\.w2-print-scan-shell\s*>\s*:is\(main,\s*section\)\s*\{/,
  'print-scan shell isolation must support both main and section content roots',
)
assert.doesNotMatch(
  printScanFusionCss,
  /\.w2-print-scan-shell\s*>\s*main\s*\{/,
  'print-scan shell isolation must not drift back to a main-only selector',
)
const printScanHome = read('src/pages/print-scan/PrintScanHomePage.tsx')
for (const marker of ['getConfiguredCapabilities', 'CARD_CAPABILITY_KEY', 'CAPABILITY_STATUS_NOTES']) {
  assert.match(printScanHome, new RegExp(marker), `print-scan home retains ${marker}`)
}
const convertImages = read('src/pages/print-scan/ConvertImagesPage.tsx')
for (const marker of ['kioskUploadFile', 'convertImagesToPdf', 'UploadSessionQrPanel']) {
  assert.match(convertImages, new RegExp(marker), `convert-images retains ${marker}`)
}
const signStamp = read('src/pages/print-scan/SignStampPage.tsx')
for (const marker of ['signInspect', 'signCompose', 'AUTHORIZATION_LABEL', 'UploadSessionQrPanel']) {
  assert.match(signStamp, new RegExp(marker), `sign-stamp retains ${marker}`)
}

const printUpload = read('src/pages/print/PrintUploadPage.tsx')
assert.match(printUpload, /type UploadTab = 'file' \| 'qr' \| 'usb'/, 'print upload keeps exactly three selectable tabs')
assert.match(printUpload, /navigate\('\/scan\/start'\)/, 'print upload keeps scan as an independent CTA')
assert.match(printUpload, /data-w2-page=["']print-upload["']/, 'print upload exposes its W2 marker')
assert.match(printUpload, /w2-print-upload-source-grid/, 'print upload exposes the 2x2 source grid')
assert.match(read('src/pages/print/styles/print-upload.css'), /\.w2-print-upload-source-grid\b/, 'print upload stylesheet owns the live source grid selector')
assert.equal((printUpload.match(/<UploadSessionQrPanel\b/g) ?? []).length, 1, 'print upload renders one QR session panel')
const materialPresentation = read('src/pages/print/components/MaterialCheckPresentation.tsx')
assert.match(materialPresentation, /data-w2-page=["']print-material-check["']/, 'material presentation exposes its W2 marker')
assert.match(materialPresentation, /aria-pressed=\{finding\.selected === action\}/, 'material privacy decisions expose their selected state accessibly')
const materialContainer = read('src/pages/print/PrintMaterialCheckPage.tsx')
for (const marker of [
  'waitForCompletedTask', 'readPrintMaterialSession', 'patchPrintMaterialSession',
  'clearPrintMaterialSession', 'decidePiiFindings',
]) assert.match(materialContainer, new RegExp(marker), `material container retains ${marker}`)
for (const kind of ['inspection', 'normalize_a4', 'pii_scan', 'pii_redact']) {
  assert.match(materialContainer, new RegExp(`kind: ["']${kind}["']`), `material container retains ${kind}`)
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
for (const path of ['src/pages/print/PrintPreviewPage.tsx', 'src/pages/print/PrintParamsPage.tsx']) {
  const body = read(path)
  for (const marker of [
    'readPrintMaterialSession', 'printer-status', 'usePrintPriceConfig',
    'estimatePrintCents', 'pageRange', 'patchPrintMaterialSession',
  ]) assert.match(body, new RegExp(marker), `${path} retains ${marker}`)
}
const printConfirm = read('src/pages/print/PrintConfirmPage.tsx')
for (const marker of [
  'createPrintJob', 'fileUrl', 'fileMd5', 'paymentSessionToken', 'amountCents > 0',
  '/print/cashier', '/print/progress', 'clearPrintMaterialSession', 'printUploadPathForSource',
]) assert.match(printConfirm, new RegExp(marker.replaceAll('/', '\\/')), `print confirm retains ${marker}`)

const fulfillmentPages = new Map([
  ['src/pages/print/PrintCashierPage.tsx', 'print-cashier'],
  ['src/pages/print/PrintProgressPage.tsx', 'print-progress'],
  ['src/pages/print/PrintDonePage.tsx', 'print-done'],
])
for (const [path, marker] of fulfillmentPages) {
  assert.match(read(path), new RegExp(`data-w2-page=["']${marker}["']`), `${path} exposes ${marker}`)
}
const cashier = read('src/pages/print/PrintCashierPage.tsx')
for (const marker of ['deriveCashierView', 'fetchPaymentChannels', 'createPayAttempt', 'getPayStatus', 'reconcilePayment', 'createCodePayAttempt', 'paymentSessionToken', 'canProceed']) {
  assert.match(cashier, new RegExp(marker), `cashier retains ${marker}`)
}
const cashierPanel = read('src/pages/print/CashierPaymentPanel.tsx')
assert.match(cashierPanel, /import\.meta\.env\.DEV[\s\S]*sandbox/, 'cashier sandbox controls remain DEV-only')
assert.match(cashierPanel, /KioskStatePanel/, 'cashier terminal payment states use the frozen state panel')
for (const phase of ['failed', 'closed', 'expired', 'refunded']) {
  assert.match(cashierPanel, new RegExp(`["']${phase}["']`), `cashier panel maps ${phase}`)
}
const printProgress = read('src/pages/print/PrintProgressPage.tsx')
for (const marker of ['POLL_INTERVAL_MS = 3000', 'REAL_POLL_TIMEOUT_MS = 10 \* 60 \* 1000', 'API_MODE', 'taskId', 'failureReasonForUser']) {
  assert.match(printProgress, new RegExp(marker.replaceAll('*', '\\*')), `print progress retains ${marker}`)
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
assert.match(scanStart, /fetchScannerStatus/, 'scan start retains real scanner status loading')
assert.match(scanStart, /30_000/, 'scan start retains its 30 second device refresh')
for (const status of ['ready', 'busy', 'offline']) {
  assert.match(scanStart, new RegExp(`["']${status}["']`), `scan start retains normalized ${status} state`)
}
assert.match(scanStart, /KioskStatePanel[\s\S]*tone=["']offline["']/, 'scan start renders an honest offline state')

const assertNoStorageAccess = (path) => {
  const scanSource = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const forbidden = new Set(['sessionStorage', 'localStorage'])
  const hits = []
  const visitStorage = (node) => {
    if (ts.isIdentifier(node) && forbidden.has(node.text)) hits.push(node.text)
    ts.forEachChild(node, visitStorage)
  }
  visitStorage(scanSource)
  assert.deepEqual(hits, [], `${path} must not access browser storage`)
}

const scanSettings = read('src/pages/scan/ScanSettingsPage.tsx')
for (const marker of ['createScanSession', 'sessionPromiseRef', 'confirmedRef', 'controlToken', 'instructions']) {
  assert.match(scanSettings, new RegExp(marker), `scan settings retains ${marker}`)
}
assertNoStorageAccess('src/pages/scan/ScanSettingsPage.tsx')
assert.match(scanSettings, /navigate\(["']\/scan\/progress["'][\s\S]*scanTaskId[\s\S]*scanType[\s\S]*controlToken/, 'scan settings passes the control token through route state')

const scanProgress = read('src/pages/scan/ScanProgressPage.tsx')
assertNoStorageAccess('src/pages/scan/ScanProgressPage.tsx')
assert.match(scanProgress, /POLL_INTERVAL_MS = 3000/, 'scan progress retains its three second polling interval')
assert.match(scanProgress, /setTimeout\([\s\S]*poll\(\)[\s\S]*POLL_INTERVAL_MS/, 'scan progress retains self-scheduled non-overlapping polling')
assert.match(scanProgress, /getScanSessionStatus\(scanTaskId, controlToken, getToken\(\)\)/, 'scan progress sends the in-memory control token for status requests')
assert.match(scanProgress, /cancelScanSession\(scanTaskId, controlToken, getToken\(\)\)/, 'scan progress sends the in-memory control token for cancellation')
assert.match(scanProgress, /SCAN_TASK_ALREADY_COMPLETED/, 'scan progress recovers completion during cancellation')

const scanResult = read('src/pages/scan/ScanResultPage.tsx')
for (const target of ['/print/confirm', '/me/documents', '/resume/parse']) {
  assert.match(scanResult, new RegExp(target.replaceAll('/', '\\\/')), `scan result retains ${target} action`)
}
assert.match(scanResult, /state\.file/, 'scan result derives its file only from route state')
assert.ok(!/scan-result\.pdf/.test(scanResult), 'scan result never fabricates a local result file')

console.log('ALL PASS fusion W2 print/scan contract')
