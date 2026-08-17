import { readFileSync } from 'node:fs'
import ts from 'typescript'

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertIncludes(src, marker, label) {
  if (!src.includes(marker)) throw new Error(`${label}: missing ${marker}`)
  console.log(`PASS ${label}`)
}

function assertNotIncludes(src, marker, label) {
  if (src.includes(marker)) throw new Error(`${label}: unexpected ${marker}`)
  console.log(`PASS ${label}`)
}

function assertMatches(src, pattern, label) {
  if (!pattern.test(src)) throw new Error(`${label}: missing ${pattern}`)
  console.log(`PASS ${label}`)
}

// ---------------------------------------------------------------------------
// 手机扫码上传的两条「丢数据级」不变量用 AST 结构断言，不用字面量匹配。
// 字面量匹配只要有人重命名变量或调整 `||` 顺序就会失效，维护者顺手改掉断言字符串
// 就能把洞无声地放回去。下面两条钉的是语义：
//   1) refresh 必须先 await 撤销旧会话，再签发新码；
//   2) 「刷新二维码」按钮的 disabled 必须包含由 status==='uploaded' 推导出的条件。
// 找不到目标结构时一律报错（而不是放行），避免结构变化让门禁静默退化成恒真。
// ---------------------------------------------------------------------------

const PANEL_PATH = 'src/pages/upload/components/UploadSessionQrPanel.tsx'

function parsePanel(src) {
  return ts.createSourceFile(PANEL_PATH, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/** name -> 函数体/初始化表达式，覆盖 `function f(){}` 与 `const f = ...` 两种写法。 */
function collectNamedBodies(root) {
  const map = new Map()
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      map.set(node.name.text, node.body)
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      map.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return map
}

function calleeName(node) {
  if (!ts.isCallExpression(node)) return null
  const expr = node.expression
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  return null
}

function collectCallNames(node) {
  const names = new Set()
  const visit = (current) => {
    const name = calleeName(current)
    if (name) names.add(name)
    ts.forEachChild(current, visit)
  }
  visit(node)
  return names
}

function isAwaited(call) {
  let current = call.parent
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current))) current = current.parent
  return Boolean(current && ts.isAwaitExpression(current))
}

/** 在 body 中按源码顺序找到第一个 names 内的调用；requireAwait 时只认被 await 的调用。 */
function firstCallPosition(body, names, requireAwait) {
  let position = Infinity
  const visit = (node) => {
    const name = calleeName(node)
    if (name && names.has(name) && (!requireAwait || isAwaited(node))) {
      position = Math.min(position, node.getStart())
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return position
}

function assertRefreshRevokesOldQrBeforeMinting(src, label) {
  const sourceFile = parsePanel(src)
  const bodies = collectNamedBodies(sourceFile)

  // 直接或间接调用 cancelUploadSession 的本地函数,都算「撤销旧码」的入口。
  const revokers = new Set(['cancelUploadSession'])
  for (let changed = true; changed;) {
    changed = false
    for (const [name, body] of bodies) {
      if (revokers.has(name)) continue
      for (const called of collectCallNames(body)) {
        if (revokers.has(called)) {
          revokers.add(name)
          changed = true
          break
        }
      }
    }
  }

  const refresh = bodies.get('refresh')
  if (!refresh) {
    throw new Error(`${label}: 找不到 refresh 定义（结构已变，断言必须同步更新而不是删除）`)
  }

  const mintPosition = firstCallPosition(refresh, new Set(['createUploadSession']), false)
  if (!Number.isFinite(mintPosition)) {
    throw new Error(`${label}: refresh 里找不到 createUploadSession（结构已变，断言必须同步更新而不是删除）`)
  }

  const revokePosition = firstCallPosition(refresh, revokers, true)
  if (!Number.isFinite(revokePosition)) {
    throw new Error(`${label}: refresh 从未 await 撤销旧会话就签发了新码，旧二维码刷新后仍可被用来上传`)
  }
  if (revokePosition > mintPosition) {
    throw new Error(`${label}: refresh 先签发新码才撤销旧会话，两码之间存在旧码仍然可用的窗口`)
  }
  console.log(`PASS ${label}`)
}

function assertRefreshButtonLockedWhileUploaded(src, label) {
  const sourceFile = parsePanel(src)
  const bodies = collectNamedBodies(sourceFile)

  let button = null
  const findButton = (node) => {
    if (!button && ts.isJsxElement(node)) {
      const directText = node.children.map((child) => (ts.isJsxText(child) ? child.text : '')).join('')
      if (directText.includes('刷新二维码')) button = node
    }
    ts.forEachChild(node, findButton)
  }
  findButton(sourceFile)
  if (!button) {
    throw new Error(`${label}: 找不到「刷新二维码」按钮（结构已变，断言必须同步更新而不是删除）`)
  }

  const attributes = button.openingElement.attributes.properties
  if (attributes.some((attribute) => ts.isJsxSpreadAttribute(attribute))) {
    throw new Error(`${label}: 刷新按钮使用了 spread 属性，disabled 无法静态判定`)
  }
  const disabled = attributes.find((attribute) => (
    ts.isJsxAttribute(attribute) && attribute.name.getText() === 'disabled'
  ))
  if (!disabled?.initializer || !ts.isJsxExpression(disabled.initializer) || !disabled.initializer.expression) {
    throw new Error(`${label}: 刷新按钮没有可静态判定的 disabled 表达式`)
  }

  const referenced = new Set()
  const collectIdentifiers = (node) => {
    if (ts.isIdentifier(node)) referenced.add(node.text)
    ts.forEachChild(node, collectIdentifiers)
  }
  collectIdentifiers(disabled.initializer.expression)

  const derivesFromUploadedStatus = (name, seen) => {
    if (seen.has(name)) return false
    seen.add(name)
    const body = bodies.get(name)
    if (!body) return false
    let found = false
    const walk = (node) => {
      if (found) return
      if (ts.isStringLiteralLike(node) && node.text === 'uploaded') {
        found = true
        return
      }
      if (ts.isIdentifier(node) && node.text !== name && derivesFromUploadedStatus(node.text, seen)) {
        found = true
        return
      }
      ts.forEachChild(node, walk)
    }
    walk(body)
    return found
  }

  const source = [...referenced].find((name) => derivesFromUploadedStatus(name, new Set()))
  if (!source) {
    throw new Error(`${label}: 刷新按钮 disabled 不含任何由 status==='uploaded' 推导的条件，手机端已上传的文件会被一次误触丢弃`)
  }
  console.log(`PASS ${label}（disabled 由 ${source} 参与判定）`)
}

const source = read('src/pages/resume/ResumeSourcePage.tsx')
const panel = read('src/pages/upload/components/UploadSessionQrPanel.tsx')
const phone = read('src/pages/upload/PhoneUploadPage.tsx')
const routes = read('src/routes/index.tsx')
const api = read('src/services/api/uploadSessions.ts')
const usbPanel = read('src/pages/resume/components/ResumeUsbImportPanel.tsx')
const usbApi = read('src/services/files/usbImportApi.ts')
const preview = read('src/components/FileContentPreview.tsx')
const previewDialog = read('src/components/FilePreviewDialog.tsx')
const optimize = read('src/pages/resume/ResumeOptimizePage.tsx')
const selfAssessment = read('src/pages/resume/SelfAssessmentFlow.tsx')

assertIncludes(source, '手机扫码上传', 'resume source exposes phone upload')
assertIncludes(source, 'UploadSessionQrPanel', 'resume source uses QR panel')
assertIncludes(source, 'ResumeUsbImportPanel', 'resume source uses the Terminal Agent USB panel')
assertIncludes(source, 'FileContentPreview', 'resume source renders the uploaded original file')
assertIncludes(source, 'fileUrl: uploaded.signedUrl', 'local resume upload keeps its short preview URL in memory')
assertIncludes(source, 'fileUrl: file.fileUrl', 'phone resume upload passes through its short preview URL')
assertIncludes(usbPanel, 'getUsbStatus', 'resume USB panel reads real Agent status')
assertIncludes(usbPanel, 'listUsbFiles', 'resume USB panel lists real Agent files')
assertIncludes(usbPanel, "uploadUsbFile(item.safeId, 'resume_upload', getToken())", 'resume USB panel uploads with the resume purpose and current in-memory member token')
assertIncludes(usbApi, "Authorization: `Bearer ${endUserToken}`", 'USB bridge forwards the optional member token in the standard authorization header')
assertIncludes(source, 'const sourceBusy = uploading || phoneBusy || usbBusy', 'resume upload channels share one navigation lock')
assertIncludes(usbPanel, 'mountedRef.current = true', 'resume USB panel restores its mounted guard under React StrictMode effect replay')
assertIncludes(usbPanel, 'onBusyChange?.(false)', 'resume USB panel clears its parent busy state on unmount')
assertIncludes(usbPanel, 'item.sizeBytes <= MAX_RESUME_BYTES', 'resume USB panel enforces its stated 10MB file limit')
assertNotIncludes(usbPanel, '`${mimeType} ${filename}`', 'resume USB format detection does not use filename substrings')
assertIncludes(usbPanel, "normalizedMime === 'image/jpeg'", 'resume USB format detection prefers exact image MIME')
assertIncludes(preview, '<iframe', 'shared file preview renders PDF content')
assertIncludes(preview, '<img', 'shared file preview renders image content')
assertIncludes(preview, 'setRenderFailed(false)', 'shared file preview resets a prior render failure when the selected file changes')
assertIncludes(preview, "normalizedMime && !['application/octet-stream', 'binary/octet-stream'].includes(normalizedMime)", 'shared file preview trusts a specific MIME before extension fallback')
assertNotIncludes(preview, "target=\"_blank\"", 'shared Kiosk preview does not leave a signed file open outside the privacy root')
assertNotIncludes(preview, "normalized.includes('pdf')", 'shared file preview does not use substring PDF detection')
assertIncludes(previewDialog, 'FileContentPreview', 'sensitive file dialog uses the shared inline preview')
assertIncludes(previewDialog, 'QRCodeSVG', 'sensitive file dialog can hand a short-lived download URL to the user phone')
assertIncludes(previewDialog, 'h-12 w-12', 'sensitive file dialog close button keeps the 48px Kiosk touch target')
assertIncludes(optimize, 'FilePreviewDialog', 'optimized resumes open inside the Kiosk privacy root')
assertIncludes(selfAssessment, 'FilePreviewDialog', 'self-assessment PDFs open inside the Kiosk privacy root')
assertNotIncludes(optimize, "window.open(exported.signedUrl", 'optimized resumes do not escape to a new browser tab')
assertNotIncludes(selfAssessment, 'target="_blank"', 'self-assessment PDFs do not escape to a new browser tab')
assertIncludes(panel, 'QRCodeSVG', 'QR panel renders real QR')
assertIncludes(panel, 'confirmUploadSession', 'Kiosk confirmation is explicit')
assertIncludes(panel, 'requiresKioskConfirmation', 'panel understands confirmation state')
assertIncludes(panel, 'created.controlToken', 'Kiosk keeps control token outside QR URL')
assertIncludes(panel, 'UPLOAD_SESSION_NOT_FOUND', 'polling stops when session disappears')
assertRefreshRevokesOldQrBeforeMinting(panel, 'refresh revokes the previous QR before minting a replacement')
assertRefreshButtonLockedWhileUploaded(panel, 'an uploaded file cannot be discarded by refreshing the QR')
assertIncludes(panel, 'window.setInterval(() => setNow(Date.now()), 1_000)', 'QR countdown is driven by the server expiry timestamp')
assertIncludes(panel, 'uploadSessionUserMessage', 'Kiosk QR errors use public-safe copy')
assertIncludes(api, 'url.hash = fragment.toString()', 'phone upload token stays in URL fragment')
assertIncludes(phone, '一体机上确认', 'phone page explains kiosk confirmation')
assertIncludes(phone, 'PHONE_UPLOAD_PURPOSES', 'phone page maps each supported purpose explicitly')
assertIncludes(phone, '签名或印章图片', 'signature uploads use their own mobile copy and file filter')
assertNotIncludes(phone, '就业服务大厅 · 01号机', 'phone page does not invent a terminal name')
assertIncludes(phone, 'uploadSessionUserMessage', 'phone upload errors use public-safe copy')
assertIncludes(phone, "state !== 'success'", 'successful uploads cannot be reset into a false re-upload state')
assertIncludes(phone, 'location.hash', 'phone page reads fragment upload token')
assertNotIncludes(phone, 'useSearchParams', 'phone page does not read upload token from query string')
assertNotIncludes(phone, 'searchParams.get', 'phone page does not fall back to query token')
assertMatches(
  phone,
  /<input\b(?=[^>]*\btype=(?:"file"|'file'))(?=[^>]*\baria-label=\{\s*`选择\$\{fileNoun\}`\s*\})[^>]*>/,
  'phone upload file input keeps a dynamic accessible label',
)
assertIncludes(source, 'aria-label="选择本机简历文件"', 'resume source file input has accessible label')
assertIncludes(routes, '/upload/phone', 'phone upload route is registered')
assertNotIncludes(source, '/print/upload', 'resume phone upload must not route through print flow')
for (const persistenceApi of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
  assertNotIncludes(`${source}\n${panel}\n${usbPanel}`, persistenceApi, `resume preview URL is not persisted through ${persistenceApi}`)
}

console.log('PASS resume phone upload UI verification')
