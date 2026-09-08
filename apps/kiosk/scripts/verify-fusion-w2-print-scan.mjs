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
  ['/print/confirm', 'PrintConfirmPage'],
  ['/print/cashier', 'PrintCashierPage'],
  ['/print/progress', 'PrintProgressPage'],
  ['/print/done', 'PrintDonePage'],
  ['/print/pickup-claim', 'PrintPickupClaimPage'],
  ['/scan/start', 'ScanStartPage'],
  ['/scan/settings', 'ScanSettingsPage'],
  ['/scan/progress', 'ScanProgressPage'],
  ['/scan/result', 'ScanResultPage'],
])
const redirects = new Map([
  ['/print/scan-convert', '/print-scan/convert'],
  ['/print/scan-sign', '/print-scan/sign'],
  ['/print/scan-feature', '/print-scan/feature/id-photo'],
  // 2026-08-18：打印参数页下线为兼容重定向（控件与预览页完全重复且全站零导航）。
  ['/print/params', '/print/preview'],
])
const frozenHashes = new Map([
  // 2026-08-18 重新冻结（PR #598 手机扫码上传公共界面收口）：刷新二维码时先 await 撤销
  // 旧会话再签发新码（旧码此前刷新后仍可被旁人用来上传），且「手机端已上传」状态下刷新
  // 按钮不可点（此前一次误触即丢弃已上传文件）。冻结契约不放宽，仍逐字节校验；新行为由
  // verify:resume-phone-upload-ui 的两条 AST 断言反向钉死。
  // 旧哈希 c7757306daa80f82ce58adb188dce73b68ea9840e9cff8312f54a2af63b72f50。
  [
    'src/pages/upload/components/UploadSessionQrPanel.tsx',
    '6e9fdb90b7a2876583598258f6e266f00acc093ec784ad794f5b2c9239f3f3c0',
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
    // 2026-09-03：隐私遮挡改为按后端 claim 持久化 MaterialRedactionSummary，
    // 不再存 resultFileCreated。冻结契约不放宽，仍逐字节校验。
    'src/pages/print/printMaterialSession.ts',
    '2e3dc36bc95ad4c48dfedc6d84957210de5e6115389f7cfe44da7cf771ad2f39',
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
assert.equal(directRoutes.size + redirects.size, 20)
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

const presentationFiles = ['src/pages/print/components/MaterialCheckPresentation.tsx']
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

// printScanPages 曾在这里断言这几页必须用 V6 的 KioskPageFrame。
// ConvertImagesPage（本 PR）与 SignStampPage（#918）都已迁到青序流光，
// 两页的 QX 断言在下方各自的段落里（含 doesNotMatch(/KioskPageFrame/) 防回退），
// 断言强度只增不减，故这张表连同它的循环一并移除。
const printScanFeature = read('src/pages/print-scan/PrintScanFeatureInfoPage.tsx')
assert.match(printScanFeature, /QxPageFrame/, 'feature info page uses Qingxu page frame')
assert.match(
  printScanFeature,
  /data-w2-page=["']print-scan-feature["']/,
  'feature info page retains the route ownership marker'
)
assert.match(
  printScanFeature,
  /print-hub-qx\.css/,
  'feature info page imports the Qingxu hub stylesheet'
)
assert.doesNotMatch(printScanFeature, /KioskPageFrame/, 'feature info page has left the V6 frame')
const printScanHome = read('src/pages/print-scan/PrintScanHomePage.tsx')
const printScanHomeView = read('src/pages/print-scan/components/QxPrintHubView.tsx')
const printHubQxCss = read('src/pages/print-scan/styles/print-hub-qx.css')
assert.match(printScanHome, /QxPageFrame/, 'print-scan hub uses Qingxu page frame')
assert.match(
  printScanHome,
  /QxPrintHubView/,
  'print-scan home delegates presentation to QxPrintHubView'
)
assert.match(
  printScanHome,
  /\.\/styles\/print-hub-qx\.css/,
  'print-scan home imports its Qingxu stylesheet'
)
assert.match(
  printScanHomeView,
  /data-w2-page=["']print-scan-home["']/,
  'print-scan view retains the route ownership marker'
)
assert.match(
  printScanHomeView,
  /data-qx-page=["']print-hub["']/,
  'print-scan view exposes its Qingxu design-language marker'
)
assert.match(printHubQxCss, /var\(--qx-ink\)/, 'hub CSS consumes Qingxu tokens')
assert.match(printHubQxCss, /--qx-tap-min/, 'hub CSS keeps the 48px touch floor token')
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
for (const marker of [
  'loadConfiguredCapabilities',
  'CARD_CAPABILITY_KEY',
  'CAPABILITY_STATUS_NOTES',
]) {
  assert.match(printScanHome, new RegExp(marker), `print-scan home retains ${marker}`)
}
assert.doesNotMatch(
  printScanHomeView,
  /KioskPageHeader/,
  'V6 print-scan home uses the shared V6 topbar and does not duplicate a page heading'
)
assert.doesNotMatch(
  printScanHomeView,
  /<KioskActionBar\b/,
  'print-scan hub uses the prototype global navbar and must not render a second bottom action bar'
)
// 到机码核销入口的防回归合同。
//
// 演进史（改断言时请连着读）：
//   · 最早是打印扫描首页上的独立按钮 .ps-pickup-entry；
//   · A0′ V6 运行时切片把它改成打印 Hub 的第 8 张能力卡；
//   · P39 迁移（V6 纵切第一刀）按原型 39-print-hub.html:585-627（PR #644）
//     把它移出「七件事」栅格 —— 那块栅格的标题写着「七件事」，塞进第 8 张卡
//     会让标题和卡数对不上；而且拿着码来的人要的不是第八件事，
//     是一条直接认领自己那一单的路，所以它在七张卡**之前**单独一行。
//
// 契约不变：入口必须存在、必须指向 /print/pickup-claim、必须不被本机能力探测关闭。
assert.match(
  printScanHome,
  /ARRIVAL_CODE_ENTRY\s*=\s*\{[\s\S]{0,600}?to:\s*['"]\/print\/pickup-claim['"]/,
  'print-scan home exposes a visible arrival-code (到机码) entry'
)
// 话术口径：后端与小程序下单页都把这个码叫「到机码」
// （pickup-order.service.ts 的「到机码无效或已过期」、小程序 print-pay 的
// 「提交并生成到机码」），它与付款后才生成的「取件凭证码」(Order.pickupCode)
// 是两个不同的码。原型据此要求卡面显式区分，避免两码同名继续互相污染。
assert.match(printScanHome, /到机码/, 'arrival-code entry uses the backend/miniapp name 到机码')
assert.match(
  printScanHome,
  /不是付款后的取件凭证码/,
  'arrival-code entry disambiguates itself from the post-payment 取件凭证码'
)
// 核销的是订单而非新建打印任务，不得被本机打印/扫描能力探测结果关闭。
// 只在 CARD_CAPABILITY_KEY 的字面量块内查找，避免正则跨越整个文件误报。
const cardCapabilityKeyBlock = /const CARD_CAPABILITY_KEY[^=]*=\s*\{([\s\S]*?)\n\}/.exec(printScanHome)
assert.ok(cardCapabilityKeyBlock, 'print-scan home still declares CARD_CAPABILITY_KEY')
assert.doesNotMatch(
  cardCapabilityKeyBlock[1],
  /['"](?:pickup-claim|arrival-code)['"]/,
  'arrival-code entry stays ungated by local print/scan capability probing'
)
assert.match(
  printHubQxCss,
  /\.ph-cap\s*\{[^}]*min-height:\s*196px/,
  'capability cards stay well above the 48px touch floor'
)
// 尾部允许再挂参数（2026-08-19 入口直达加了 &mode=transfer）。本断言要守的是两件事：
// 必须落到一体机自己的扫码会话 tab、不得指向手机 H5 路由 —— 这两条一个字没放松，
// 放开的只是「URL 到 tab=qr 就必须结束」这个与安全无关的字面量锚点。
assert.match(
  printScanHome,
  /to:\s*['"]\/print\/upload\?source=document&tab=qr(?:&[^'"]*)?['"]/,
  'phone upload opens the kiosk QR-session tab instead of the phone H5 page'
)
// 入口直达：该卡只声明了「通道」，落地页必须据此跳过通道选择，不能再问一遍。
assert.match(
  printScanHome,
  /to:\s*['"]\/print\/upload\?source=document&tab=qr&mode=transfer['"]/,
  'phone upload entry must carry mode=transfer so the landing page skips the channel grid'
)
assert.doesNotMatch(
  printScanHome,
  /to:\s*['"]\/upload\/phone/,
  'kiosk print hub never navigates directly to the phone-only route'
)
const convertImages =
  read('src/pages/print-scan/ConvertImagesPage.tsx') +
  read('src/pages/print-scan/ConvertImagesView.tsx') +
  read('src/pages/print-scan/ConvertImagesPanels.tsx') +
  read('src/pages/print-scan/convert-images-model.ts')
for (const marker of ['kioskUploadFile', 'convertImagesToPdf', 'UploadSessionQrPanel', 'QxPageFrame']) {
  assert.match(convertImages, new RegExp(marker), `convert-images retains ${marker}`)
}
assert.match(
  convertImages,
  /data-w2-page=["']print-scan-convert["']/,
  'convert-images keeps the W2 route ownership marker after qingxu migration'
)
assert.match(
  read('src/pages/print-scan/ConvertImagesPage.tsx'),
  /import '\.\/styles\/convert-images-qx\.css'/,
  'convert-images loads its qingxu stylesheet'
)
assert.match(
  read('src/layouts/KioskRoot.tsx'),
  /['"]\/print-scan\/convert['"]/,
  'convert-images is registered in QX_MIGRATED_ROUTES so it exits the old fusion-youth chrome'
)
assert.match(
  convertImages,
  /<img[\s\S]*?src=\{img\.fileAccessUrl\}[\s\S]*?alt=\{`\$\{img\.name\} 缩略图`\}/,
  'convert-images renders each uploaded image instead of a paper skeleton'
)
assert.match(
  convertImages,
  /sources:\s*sourceImages\.map\(\(img\) => \(\{\s*fileId:\s*img\.fileId,\s*fileAccessUrl:\s*img\.fileAccessUrl\s*\}\)\)/,
  'convert payload order is the visible list array order'
)
assert.match(
  read('src/pages/print-scan/styles/convert-images-qx.css'),
  /\.i2p-lrows\s*\{[^}]*overflow-y:\s*auto/,
  'many-image list actually scrolls instead of clipping to three cards'
)
assert.match(
  convertImages,
  /navigate\('\/print\/material-check'/,
  'successful convert continues to material-check, not cashier or progress'
)
assert.match(
  convertImages,
  /旋转 90°[\s\S]*当前不可用/,
  'rotate control stays visible and honestly disabled'
)
assert.match(
  convertImages,
  /U 盘图片导入尚未接到转换列表/,
  'USB entry is kept and explained as unwired, not deleted'
)
const scanResultPreviewSource = read('src/pages/scan/ScanResultPage.tsx')
assert.match(
  scanResultPreviewSource,
  /<FileContentPreview[\s\S]*?fileUrl=\{file\.fileUrl\}/,
  'scan result renders the real scanned file'
)
const signStamp = read('src/pages/print-scan/SignStampPage.tsx')
for (const marker of [
  'signInspect',
  'signCompose',
  'AUTHORIZATION_LABEL',
  'UploadSessionQrPanel',
]) {
  assert.match(signStamp, new RegExp(marker), `sign-stamp retains ${marker}`)
}
assert.match(signStamp, /stamp\.name/, 'sign-stamp shows the uploaded filename after stamp upload')
assert.doesNotMatch(
  signStamp,
  /<img[\s\S]{0,200}stamp\.(fileAccessUrl|fileUrl)/,
  'sign-stamp does not echo the signature/stamp image on the public screen',
)
assert.match(signStamp, /QxPageFrame/, 'SignStampPage uses the qingxu page frame')
assert.doesNotMatch(signStamp, /KioskPageFrame/, 'SignStampPage has left the V6 frame')
assert.match(
  signStamp,
  /data-w2-page=["']print-scan-sign["']/,
  'SignStampPage exposes print-scan-sign',
)
assert.match(
  signStamp,
  /sign-stamp-qx\.css/,
  'SignStampPage imports its qingxu stylesheet',
)
assert.match(
  read('src/pages/print-scan/sign-stamp/useSignStampFlow.ts'),
  /\/print\/material-check/,
  'sign-stamp primary exit is material-check, not a fabricated print success',
)
assert.match(
  read('src/layouts/KioskRoot.tsx'),
  /QX_MIGRATED_ROUTES[\s\S]*['"]\/print-scan\/sign['"]/,
  'sign-stamp is registered in QX_MIGRATED_ROUTES',
)
assert.match(
  read('src/pages/print-scan/sign-stamp/useSignStampFlow.ts'),
  /rate-limited/,
  'sign-stamp maps 429 to a visible rate-limited state instead of silently retrying',
)
assert.match(
  read('src/pages/print-scan/sign-stamp/useSignStampFlow.ts'),
  /mapComposeError/,
  'sign-stamp classifies compose failures without fabricating a completed result',
)

const printUploadPage = read('src/pages/print/PrintUploadPage.tsx')
const printUploadView = read('src/pages/print/file-source/FileSourceView.tsx')
const printUploadBits = read('src/pages/print/file-source/FileSourceBits.tsx')
const printUpload = `${printUploadPage}\n${printUploadView}\n${printUploadBits}`
assert.match(
  printUploadPage,
  /type UploadTab = 'file' \| 'qr' \| 'usb'/,
  'print upload keeps exactly three selectable tabs'
)
assert.match(
  printUploadPage,
  /navigate\('\/scan\/start'\)/,
  'print upload keeps scan as an independent CTA'
)
assert.match(printUpload, /data-w2-page=["']print-upload["']/, 'print upload exposes its W2 marker')
assert.match(printUpload, /w2-print-upload-source-grid/, 'print upload exposes the 2x2 source grid')
assert.match(printUpload, /print-upload-footer/, 'print upload exposes a semantic footer selector')
assert.match(printUploadView, /QxPageFrame/, 'print upload uses Qingxu page frame')
assert.match(
  read('src/layouts/KioskRoot.tsx'),
  /['"]\/print\/upload['"]/,
  'print upload is registered in QX_MIGRATED_ROUTES'
)
assert.match(
  read('src/pages/print/styles/print-upload.css'),
  /\.w2-print-upload-source-grid\b/,
  'print upload stylesheet owns the live source grid selector'
)
assert.match(
  read('src/pages/print/styles/file-source-qx.css'),
  /\.w2-print-upload-source-grid\b/,
  'qingxu file-source stylesheet owns the live source grid selector'
)
assert.equal(
  (printUpload.match(/useUploadSession\(/g) ?? []).length,
  1,
  'print upload uses one QR upload session hook'
)
assert.doesNotMatch(
  printUpload,
  /<UploadSessionQrPanel\b/,
  'print upload does not mount the frozen QR panel'
)
assert.doesNotMatch(
  printUploadPage,
  /KioskPageFrame/,
  'print upload page has left the V6 frame'
)
assert.doesNotMatch(
  printUploadView,
  /KioskPageFrame/,
  'print upload view has left the V6 frame'
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
])
for (const [path, marker] of printSetupPages) {
  const body = read(path)
  assert.match(body, new RegExp(`data-w2-page=["']${marker}["']`), `${path} exposes ${marker}`)
  assert.match(body, /PrintPageFrame/, `${path} uses the shared print frame`)
  assert.match(body, /KioskActionBar/, `${path} uses the frozen action bar`)
}
const printConfirmQx = read('src/pages/print/PrintConfirmPage.tsx')
const printConfirmView = read('src/pages/print/components/PrintConfirmView.tsx')
assert.match(
  printConfirmView,
  /data-w2-page=["']print-confirm["']/,
  'src/pages/print/PrintConfirmPage.tsx exposes print-confirm',
)
assert.match(printConfirmQx, /QxPageFrame/, 'PrintConfirmPage uses the Qingxu page frame')
assert.match(printConfirmQx, /qx-btn/, 'PrintConfirmPage uses Qingxu action buttons')
assert.doesNotMatch(printConfirmQx, /KioskPageFrame/, 'print-confirm has left the V6 frame')
assert.doesNotMatch(printConfirmQx, /PrintPageFrame/, 'print-confirm has left the V6 print frame')
assert.doesNotMatch(printConfirmView, /KioskPageFrame/, 'print-confirm view has left the V6 frame')
assert.match(
  printConfirmQx,
  /usePrintConfirmQueryGuard/,
  'print-confirm sanitizes the address bar against price-tampering query keys',
)
assert.match(
  read('src/pages/print/printConfirmQuery.ts'),
  /missing-context['"][\s\S]*zero-amount/,
  'print-confirm covers the eight Qingxu confirm states',
)
assert.match(
  read('src/pages/print/printConfirmQuery.ts'),
  /same.*参数出现了不止一次|duplicate/,
  'duplicate query keys fail-closed to invalid-context',
)
assert.match(
  read('src/layouts/KioskRoot.tsx'),
  /QX_MIGRATED_ROUTES[\s\S]*['"]\/print\/confirm['"]/,
  '/print/confirm is registered in QX_MIGRATED_ROUTES',
)
for (const path of ['src/pages/print/PrintPreviewPage.tsx']) {
  const body = read(path)
  for (const marker of [
    'readPrintMaterialSession',
    'useTerminalDeviceStatus',
    'pageRange',
    'patchPrintMaterialSession',
  ]) {
    assert.match(body, new RegExp(marker), `${path} retains ${marker}`)
  }
}
// 2026-08-18：PrintParamsPage 已删除，参数设置由预览页独家承担。
assert.ok(
  !existsSync(join(kioskRoot, 'src/pages/print/PrintParamsPage.tsx')),
  'PrintParamsPage 已下线，不得复活重复参数页'
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
  'realStatusPresentation',
  "case 'pending'",
  "case 'claimed'",
  "case 'printing'",
  '等待终端领取',
  '终端已领取',
  '打印机正在出纸',
  'setBackendStatus',
]) {
  assert.match(
    printProgress,
    new RegExp(marker.replaceAll('*', '\\*')),
    `print progress retains ${marker}`
  )
}
assert.doesNotMatch(
  printProgress,
  /:\s*'终端已接收任务，文件校验通过'/,
  'pending/claimed 不得共用「终端已接收且校验通过」的错误话术'
)
assert.doesNotMatch(printProgress, /:\s*'正在打印'\s*}/, '真实任务主状态不得无条件显示正在打印')
const printDone = read('src/pages/print/PrintDonePage.tsx')
assert.match(printDone, /getPayStatus/, 'print done obtains pickup code from payment status')
assert.ok(!/Math\.random|randomUUID/.test(printDone), 'print done never fabricates a pickup code')

const pickupClaim = read('src/pages/print/PrintPickupClaimPage.tsx')
const pickupClaimCss = read('src/pages/print/styles/print-pickup-claim.css')
for (const marker of [
  'claimLockRef',
  // 到机码改 8 位后符号更名：扫码路径仍必须先过格式判据，且新旧两种码各有分支
  'isLegacyPickupCode(nextCode)',
  'PICKUP_CODE_PATTERN.test(nextCode)',
  'void handleClaim(nextCode)',
  'claimLockRef.current = false',
  "setCode('')",
  // 这条断言保护的实质是「页面必须告诉用户扫码这条路存在」，不是保护某句原文。
  // 2026-09-02 按 11-arrival-code.html 迁移后本页重定位为「输入到机码」页，
  // 扫码降为兜底出口，措辞由「扫描小程序二维码」改为「用机身扫码区」。
  // 断言随之改指新措辞，强度不变：删掉扫码入口仍然会红。
  '机身扫码区',
  // hid 指引屏的 echo 文案（11-arrival-code.html #hid-echo-code）。
  // 2026-09-07 补了独立 hid 屏之后这句仍必须在源码里，删掉仍然会红。
  '等待扫码输入',
  // 2026-09-02 迁移到青序流光：本页样式入口随之改名。断言强度不变——
  // 它保的是"这一页必须有自己的样式入口"，删掉仍然会红。
  "import './styles/pickup-claim-qx.css'",
  'data-w2-page="pickup-claim"',
  // 迁移到青序流光后按钮基类由 k-btn 改为 qx-btn；.pcp-submit 保留，
  // 断言保的是"提交按钮必须有稳定的可定位类名"，强度不变。
  'className="qx-btn pcp-submit"',
]) {
  assert.ok(pickupClaim.includes(marker), `pickup claim retains ${marker}`)
}
assert.match(
  pickupClaim,
  /if \(!PICKUP_CODE_ACCEPTED_PATTERN\.test\(submittedCode\) \|\| claimLockRef\.current\) return/,
  'pickup scanner submission is format-gated and idempotently locked'
)
assert.match(
  pickupClaim,
  /onKeyDown=\{e => \{ if \(e\.key === 'Enter'\) void handleClaim\(code\) \}\}/,
  'pickup scanner Enter suffix reuses the same guarded submission path'
)
for (const selector of [
  '.pickup-claim-page',
  '.pcp-input',
  '.pcp-submit.k-btn',
  '.pcp-help',
  '.pickup-claim-success',
]) {
  assert.ok(pickupClaimCss.includes(selector), `pickup claim CSS retains ${selector}`)
}
assert.match(
  pickupClaimCss,
  /@media \(max-height: 900px\) and \(orientation: landscape\)/,
  'pickup claim keeps a compact Windows landscape layout'
)
const pickupClaimQxCss = read('src/pages/print/styles/pickup-claim-qx.css')
assert.match(
  pickupClaimQxCss,
  /@media \(max-height: 900px\) and \(orientation: landscape\)/,
  'qingxu pickup claim CSS keeps the compact Windows landscape layout the page actually loads'
)
assert.match(
  pickupClaim,
  /const SETTLE_MS = 250/,
  'pickup 8-digit settle window stays 250ms (legacy 10-char numeric prefix trap)'
)
assert.match(
  pickupClaim,
  /data-claim-guide="hid"/,
  'pickup claim keeps a dedicated hid guidance state'
)
assert.match(
  pickupClaim,
  /setGuide\('hid'\)/,
  '机身扫码区入口 must switch into the hid guidance state without waiting for a scan'
)
assert.match(pickupClaim, /还是手输吧/, 'hid guidance keeps the draft "type instead" control')
assert.match(pickupClaim, /扫不出来？求助/, 'hid guidance keeps the draft help control')
assert.match(pickupClaim, /机身侧面的扫码区/, 'hid guidance names the scanner location on the kiosk body')
assert.match(pickupClaim, /亮度调高/, 'hid guidance includes the real-machine brightness condition')
assert.doesNotMatch(
  pickupClaim,
  /扫码器就绪|扫码器在线|扫码器正常/,
  'pickup claim must not fabricate scanner-ready status'
)
assert.match(pickupClaimQxCss, /\.pcp-hid-card\s*\{/, 'qingxu pickup claim CSS includes the hid guidance card')
assert.match(pickupClaimQxCss, /\.pcp-hid-entry\s*\{/, 'qingxu pickup claim CSS includes the pre-scan hid entry')
assert.doesNotMatch(
  pickupClaimQxCss,
  /margin:\s*-1px/,
  'pickup claim CSS must not use margin:-1px sr-only (fusion-w6 left=-1 overflow)'
)
const pickupHidGuide = read('src/pages/print/components/PickupHidGuide.tsx')
assert.match(pickupHidGuide, /请出示手机上的码/, 'hid guide screen keeps the draft headline')
assert.match(pickupHidGuide, /机身侧面的扫码区/, 'hid guide screen names the body-side scanner')
assert.match(pickupHidGuide, /亮度调高/, 'hid guide screen includes the real-machine brightness condition')
assert.doesNotMatch(
  pickupHidGuide,
  /扫码器就绪|扫码器在线|扫码器正常/,
  'hid guide screen must not fabricate scanner-ready status'
)
assert.match(
  pickupClaim,
  /import \{ PickupHidGuide, PickupThreeCodeCard \} from '\.\/components\/PickupHidGuide'/,
  'pickup claim page must render the extracted hid guide screen'
)

const scanPages = new Map([
  // 四页已迁出 V6 壳。循环体保留，避免删掉 assert 行；条目清空后改由下方 qxScanPages 同强度断言。
])
for (const [path, marker] of scanPages) {
  const body = read(path)
  assert.match(body, new RegExp(`data-w2-page=["']${marker}["']`), `${path} exposes ${marker}`)
  assert.match(body, /\.\/styles\/scan-fusion\.css/, `${path} imports the scoped W2 stylesheet`)
  assert.match(body, /KioskPageFrame/, `${path} uses the frozen page frame`)
  assert.match(body, /KioskPageHeader/, `${path} uses the frozen page header`)
}
const qxScanPages = new Map([
  ['src/pages/scan/ScanStartPage.tsx', 'scan-start'],
  ['src/pages/scan/ScanSettingsPage.tsx', 'scan-settings'],
  ['src/pages/scan/ScanProgressPage.tsx', 'scan-progress'],
  ['src/pages/scan/ScanResultPage.tsx', 'scan-result'],
])
for (const [path, marker] of qxScanPages) {
  const body = read(path)
  assert.match(body, /ScanWorkbenchShell/, `${path} uses the Qingxu page frame`)
  assert.doesNotMatch(body, /KioskPageFrame/, `${path} has left the V6 frame`)
  assert.match(body, new RegExp(`page=["']${marker}["']`), `${path} exposes ${marker}`)
  assert.doesNotMatch(body, /KioskPageHeader/, `${path} no longer uses the V6 page header`)
}
assert.match(
  read('src/pages/scan/ScanWorkbenchChrome.tsx'),
  /data-w2-page=\{page\}/,
  'scan chrome forwards the route ownership marker to the DOM',
)
assert.match(
  read('src/pages/scan/ScanWorkbenchChrome.tsx'),
  /QxPageFrame/,
  'scan chrome wraps QxPageFrame so the four scan routes leave the V6 shell',
)
assert.match(
  read('src/pages/scan/ScanWorkbenchChrome.tsx'),
  /QxAppNavbar/,
  'scan chrome uses the shared Qingxu navbar instead of an inlined copy',
)
assert.match(
  read('src/pages/scan/ScanWorkbenchChrome.tsx'),
  /scan-workbench-qx\.css/,
  'scan chrome imports the Qingxu scan stylesheet',
)
const kioskRootSource = read('src/layouts/KioskRoot.tsx')
for (const route of ['/scan/start', '/scan/settings', '/scan/progress', '/scan/result']) {
  assert.match(
    kioskRootSource,
    new RegExp(`QX_MIGRATED_ROUTES[\\s\\S]*['"]${route}['"]`),
    `${route} is registered in QX_MIGRATED_ROUTES`,
  )
}
const scanWorkbenchQxCss = read('src/pages/scan/styles/scan-workbench-qx.css')
assert.match(scanWorkbenchQxCss, /var\(--qx-ink\)/, 'scan workbench CSS consumes Qingxu tokens')
assert.match(scanWorkbenchQxCss, /--qx-tap-min|--qx-btn-h/, 'scan workbench CSS keeps the touch floor token')
assert.doesNotMatch(scanWorkbenchQxCss, /#[0-9a-fA-F]{3,8}\b|rgb\(/, 'scan workbench CSS does not introduce raw color literals')
assert.match(read('src/components/qingxu/QxAppNavbar.tsx'), /onHome,[\s\S]*onAdvisor,[\s\S]*onProfile/, 'QxAppNavbar keeps the shared three-tab signature')

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
assert.doesNotMatch(scanStart, /盖板感知|盖板已关|免点击扫描/, 'scan start must not imply lid-sensing auto start')
assert.match(scanStart, /改用面板扫描到 U 盘/, 'scan start keeps the USB-panel independent path')
assert.match(scanStart, /mode=usb-panel/, 'USB-panel path is a real query mode, not a fake scan session')
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
assert.doesNotMatch(
  scanResult,
  /loginPathForCurrentLocation/,
  'guest scan files have no claim path; result must not send guests to login as if documents will appear',
)
assert.match(
  scanResult,
  /本次不进入我的文档|前往我的文档/,
  'scan result uses honest documents destination copy',
)
assert.match(
  scanResult,
  /未登录扫描件不会进入「我的文档」/,
  'guest scan result must say the file will not enter My Documents',
)
assert.match(scanResult, /state\.file/, 'scan result derives its file only from route state')
assert.doesNotMatch(
  scanResult,
  /preview-url/,
  'anonymous scan preview must not call the login-gated preview-url endpoint',
)
assert.match(
  scanResult,
  /files\/:id\/content/,
  'scan result preview copy names the anonymous signed content URL',
)
assert.match(scanResult, /completed-no-file/, 'completed with file:null is a distinct honest terminal state')
assert.match(scanProgress, /立即检查/, 'progress keeps a real manual poll action')
assert.doesNotMatch(scanProgress, /盖板/, 'progress must not imply lid-sensing hardware events')
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

assert.doesNotMatch(
  convertImages,
  /<li>生成后自动进入确认打印；PDF 已保存到「我的文档」。<\/li>/,
  'convert rules must not unconditionally claim the PDF is in My Documents',
)
assert.match(
  convertImages,
  /未登录时 PDF 不会进入「我的文档」/,
  'convert rules must tell guests the PDF will not enter My Documents',
)
assert.match(
  convertImages,
  /getTerminalId\(\)/,
  'convert must read the kiosk terminal id before calling the API',
)
assert.match(
  convertImages,
  /终端编号未配置，无法使用格式转换/,
  'convert must fail closed when terminal id is missing (same as sign-stamp)',
)
assert.match(
  convertImages,
  /terminalId,/,
  'convert request body must include terminalId',
)
assert.match(
  signStamp,
  /getTerminalId\(\)/,
  'sign-stamp remains the reference deep-link gate that convert must copy',
)

const fileSourceCss = read('src/pages/print/styles/file-source-qx.css')
const fileSourceModel = read('src/pages/print/file-source/fileSourceModel.ts')
const uploadSessionHook = read('src/pages/upload/hooks/useUploadSession.ts')
assert.match(printUploadPage, /import \{ FileSourceView \}/, 'page composes FileSourceView')
assert.match(printUploadView, /import '\.\.\/styles\/file-source-qx\.css'/, 'view imports Qingxu CSS')
assert.match(fileSourceCss, /var\(--qx-ink\)/, 'page CSS uses Qingxu tokens')
assert.match(fileSourceCss, /--qx-tap-min/, 'page CSS keeps 48px touch floor token')
assert.doesNotMatch(fileSourceCss, /#[0-9a-fA-F]{3,8}\b/, 'page CSS has no naked hex')
const FILE_SOURCE_STATES = [
  'source-chooser', 'missing-file', 'unknown',
  'local-guide', 'local-picking', 'local-cancelled', 'local-rejected', 'local-oversize',
  'local-unreadable', 'local-uploading', 'local-upload-failed', 'local-ready',
  'phone-generating', 'phone-gen-failed', 'phone-ready', 'phone-waiting', 'phone-uploading',
  'phone-status-unknown', 'phone-expired', 'phone-uploaded', 'phone-confirming',
  'phone-confirm-failed', 'phone-confirmed', 'phone-cancel-requesting', 'phone-cancel-failed',
  'phone-cancelled',
  'usb-unavailable', 'usb-agent-offline', 'usb-wait', 'usb-detecting', 'usb-empty', 'usb-list',
  'usb-read-failed', 'usb-selected', 'usb-safeid-expired', 'usb-importing', 'usb-import-failed',
  'usb-ready',
]
assert.equal(FILE_SOURCE_STATES.length, 38, 'prototype state list has 38 entries')
for (const state of FILE_SOURCE_STATES) {
  assert.match(fileSourceModel, new RegExp(`'${state}'`), `model lists state ${state}`)
}
assert.match(fileSourceModel, /function deriveFileSourceScreen/, 'runtime derives screens from real data')
assert.doesNotMatch(printUploadPage, /capture=1/, 'runtime does not implement capture fixtures that fake uploaded files')
assert.doesNotMatch(printUploadView, /合成演示/, 'runtime does not label synthetic uploaded files')
assert.match(
  printUploadPage,
  /navigate\('\/print\/material-check', \{ state: \{ file, source \} \}\)/,
  'only material-check is the forward exit, and it carries file+source'
)
assert.doesNotMatch(printUploadPage, /navigate\('\/print\/preview'/, 'upload page never skips to preview')
assert.doesNotMatch(printUploadPage, /navigate\('\/print\/confirm'/, 'upload page never skips to confirm')
assert.doesNotMatch(printUploadPage, /materialCheck\s*:/, 'upload page does not write a fake materialCheck summary')
assert.match(printUploadView, /FILE_SOURCE_HAS_FILE\.has\(screen\)/, 'primary continue is gated on a confirmed current file')
assert.match(printUploadPage, /if \(!file\) return/, 'handleNext refuses to continue without a file')
assert.match(printUploadBits, /本机选文件/, 'channel copy uses 本机选文件')
assert.match(printUploadBits, /手机扫码上传/, 'channel copy uses 手机扫码上传')
assert.match(printUploadBits, /U 盘导入/, 'channel copy uses U 盘导入')
assert.match(printUploadBits, /扫描纸质原件/, 'scan is a real independent entry')
assert.match(printUploadBits, /我的文档 \/ 最近打印/, 'member documents is a real independent entry')
assert.match(printUpload, /第三方网盘尚未接入/, 'cloud drive is marked not connected')
assert.doesNotMatch(printUpload, /一键投递|立即投递|平台投递/, 'compliance: no platform apply copy')
assert.match(printUploadPage, /classifyLocalFile/, 'local files are classified before upload')
assert.match(fileSourceModel, /'local-uploading'/, 'uploading is a real screen')
assert.match(
  printUploadView,
  /本页无取消动作|没有「取消本次上传」/,
  'local-uploading does not offer a fake cancel-upload action'
)
assert.match(uploadSessionHook, /cancelFailed/, 'upload session hook tracks cancel failure instead of swallowing it')
assert.doesNotMatch(
  uploadSessionHook,
  /handleCancel[\s\S]{0,400}catch \{\s*\/\/ best-effort only\s*\}/,
  'upload session hook does not swallow DELETE failure then clear the session'
)
assert.doesNotMatch(
  uploadSessionHook,
  /catch \{\s*\/\/ best-effort only\s*\}/,
  'upload session hook has no best-effort cancel swallow'
)
assert.match(uploadSessionHook, /这次会话没能取消，文件还留着/, 'cancel failure keeps an honest user message')
assert.match(
  uploadSessionHook,
  /status: 'cancelled'/,
  'successful cancel records cancelled, does not invent success without the server'
)
assert.match(uploadSessionHook, /await revokePreviousSession\(existing\)/, 'refresh revokes the previous QR before minting a replacement')
assert.match(
  uploadSessionHook,
  /statusRef\.current\?\.status === 'uploaded'/,
  'refresh refuses to discard an already-uploaded file'
)
assert.match(printUploadPage, /usbSelected/, 'USB select-then-import is a real two-step')
assert.match(printUploadPage, /isUsbSafeIdExpired/, 'USB 410/expired safeId is a distinct failure')
assert.match(printUploadView, /file-source-primary/, 'primary CTA has a stable test id')
assert.match(printUploadView, /下一步：材料检查/, 'ready-state primary names the real next step')

console.log('ALL PASS fusion W2 print/scan contract')
