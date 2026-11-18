/**
 * 预览页去确认页：真实执行 PrintPreviewPage，把 useNavigate 换成记下调用的替身。
 *
 * 正常去确认页走一次。再带着回执去确认，按确认页退回预览时交还的那份状态，再去一次。
 * 每一次跳到确认页的状态键只能是 printContextId、printReturnState，不能带这份文件的地址或签名。
 *
 * 写法照 print-handoff.test.mjs：转译真实源码，内存里的 sessionStorage，不另抄跳转逻辑。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const reactUrl = import.meta.resolve('react')
const jsxUrl = import.meta.resolve('react/jsx-runtime')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const ALLOWED_STATE_KEYS = new Set(['printContextId', 'printReturnState'])

function transpile(absolutePath, replacements = {}, jsx = false) {
  let out = ts.transpileModule(readFileSync(absolutePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
    fileName: absolutePath,
  }).outputText
  out = out.replace(/import\s+['"][^'"]+\.css['"];?/g, '')
  for (const [specifier, url] of Object.entries(replacements)) {
    out = out.split(`'${specifier}'`).join(`'${url}'`).split(`"${specifier}"`).join(`"${url}"`)
  }
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]).filter((specifier) => !specifier.startsWith('data:') && !specifier.startsWith('file:'))
  assert.deepEqual(leftover, [], `${absolutePath} 还有没替换的运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)) },
    removeItem: (key) => { map.delete(key) },
    clear: () => { map.clear() },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
}

const sharedUrl = toDataUrl(
  'export const VERIFIED_PRINT_PARAMETER_PROFILE = { colorMode: "black_white", duplex: "simplex", pagesPerSheet: 1 }\n',
)
const routerUrl = toDataUrl(`
export function useNavigate() {
  return (...args) => { globalThis.__printPreviewNavLog.push(args) }
}
export function useLocation() {
  return { pathname: '/print/desk', search: '?step=preview', hash: '', key: 'preview', state: globalThis.__printPreviewLocationState }
}
`)
const frameUrl = toDataUrl(`
import { jsx } from '${jsxUrl}'
export function printAsk(label, draft) { return { label, draft, voice: false } }
export function PrintTouchFrame(props) {
  globalThis.__printPreviewFrame = props
  return jsx('div', { children: props.children })
}
`)
const nullComponent = (name) => toDataUrl(`export function ${name}() { return null }\n`)
const deviceUrl = toDataUrl(`
export function useTerminalDeviceStatus() {
  return {
    printer: { isOnline: true, hasPaper: true, errorCode: null },
    printerLabel: '打印机就绪',
    printerNotice: null,
    printerReady: true,
    kind: 'ready',
    loading: false,
  }
}
`)
const capabilityUrl = toDataUrl(`
export function usePrintParamCapability() {
  return { loading: false, color: { allowed: true, reason: null }, duplex: { allowed: true, reason: null } }
}
`)
const authUrl = toDataUrl('export function useAuth() { return { getToken() { return "token" } } }\n')
const materialsUrl = toDataUrl('export function getPrintParamSuggestions() { return Promise.resolve({ available: false }) }\n')
const userErrorUrl = toDataUrl('export function userMessageOf(_error, fallback) { return fallback }\n')
const previewKindUrl = toDataUrl('export function previewKindForFile() { return "pdf" }\n')

const sessionUrl = transpile(join(kioskRoot, 'src/pages/print/printMaterialSession.ts'))
const policyUrl = transpile(join(kioskRoot, 'src/pages/print/printHandoffPolicy.ts'))
const unattendedUrl = transpile(join(kioskRoot, 'src/copy/unattendedCopy.ts'))
const handoffUrl = transpile(join(kioskRoot, 'src/pages/print/printHandoff.ts'), {
  './printMaterialSession': sessionUrl,
  './printHandoffPolicy': policyUrl,
  '../../copy/unattendedCopy': unattendedUrl,
})
const paramsUrl = transpile(join(kioskRoot, 'src/pages/print/usePreviewPrintParams.ts'), {
  react: reactUrl,
  '@ai-job-print/shared': sharedUrl,
})
const pageUrl = transpile(join(kioskRoot, 'src/pages/print/PrintPreviewPage.tsx'), {
  react: reactUrl,
  'react/jsx-runtime': jsxUrl,
  'react-router-dom': routerUrl,
  '@ai-job-print/shared': sharedUrl,
  '../../hooks/useTerminalDeviceStatus': deviceUrl,
  '../../hooks/usePrintParamCapability': capabilityUrl,
  '../../auth/useAuth': authUrl,
  './PrintTouchFrame': frameUrl,
  './art/PrintIcon': nullComponent('PrintIcon'),
  './components/FileThumbCard': nullComponent('FileThumbCard'),
  './components/PrintEmptyDesk': nullComponent('PrintEmptyDesk'),
  '../../services/api/materials': materialsUrl,
  '../../services/api/userErrorMessage': userErrorUrl,
  '../../copy/unattendedCopy': unattendedUrl,
  './printMaterialSession': sessionUrl,
  './printHandoff': handoffUrl,
  './usePreviewPrintParams': paramsUrl,
  './printUsageEstimate': transpile(join(kioskRoot, 'src/pages/print/printUsageEstimate.ts')),
  './pageRange': transpile(join(kioskRoot, 'src/pages/print/pageRange.ts')),
  './piiRedaction': transpile(join(kioskRoot, 'src/pages/print/piiRedaction.ts')),
  './printDeskModel': transpile(join(kioskRoot, 'src/pages/print/printDeskModel.ts')),
  './components/printPreviewKind': previewKindUrl,
}, true)

const { createElement } = await import(reactUrl)
const { renderToStaticMarkup } = await import('react-dom/server')
const { PrintPreviewPage } = await import(pageUrl)
const handoffApi = await import(handoffUrl)

function assertConfirmState(args, fileUrl, contextId) {
  assert.equal(args[0], '/print/confirm')
  const state = args[1] && args[1].state
  assert.equal(typeof state, 'object')
  assert.ok(state && !Array.isArray(state))
  for (const key of Object.keys(state)) {
    assert.ok(ALLOWED_STATE_KEYS.has(key), `跳转状态出现允许名单之外的键：${key}`)
  }
  assert.equal(state.printContextId, contextId)
  const raw = JSON.stringify(args)
  assert.equal(raw.includes(fileUrl), false, '跳转状态里出现了文件地址')
  assert.equal(raw.includes('fileUrl'), false, '跳转状态里出现了文件地址键')
  assert.equal(raw.includes('sig='), false, '跳转状态里出现了签名地址')
}

function clickNext(context, fileUrl) {
  const before = globalThis.__printPreviewNavLog.length
  renderToStaticMarkup(createElement(PrintPreviewPage, { handoff: context }))
  const frame = globalThis.__printPreviewFrame
  assert.equal(frame.primary.label, '下一步：核对价格')
  assert.equal(frame.primary.disabled, false)
  frame.primary.onClick()
  const added = globalThis.__printPreviewNavLog.slice(before)
  const confirm = added.filter((args) => args[0] === '/print/confirm')
  assert.ok(confirm.length >= 1, '没有跳到确认页')
  for (const args of confirm) assertConfirmState(args, fileUrl, context.contextId)
  assert.equal(added.length, 1, `这一次应只跳一次，实际 ${added.length} 次`)
  return added[0]
}

test('去确认页的真实跳转只带交接编号和回执，打印来回再去也不带文件地址', () => {
  const previousWindow = globalThis.window
  globalThis.__printPreviewNavLog = []
  globalThis.__printPreviewLocationState = null
  globalThis.__printPreviewFrame = null
  try {
    const storage = memoryStorage()
    globalThis.window = { sessionStorage: storage }
    const now = Date.now()
    const fileUrl = `/api/v1/files/file-b/content?expires=${now + 30 * 60_000}&sig=sig-preview-secret`
    const begun = handoffApi.beginPrintHandoff({
      origin: 'resume_optimize',
      file: { name: '优化稿.pdf', size: '64 KB', pages: 1, fileId: 'file-b', fileUrl, mimeType: 'application/pdf' },
    }, { kind: 'guest' }, now)
    assert.equal(begun.ok, true)
    const context = begun.context

    globalThis.__printPreviewLocationState = null
    const plain = clickNext(context, fileUrl)
    assertConfirmState(plain, fileUrl, context.contextId)
    assert.deepEqual(Object.keys(plain[1].state), ['printContextId'])

    const carry = { pathname: '/resume/report', search: '', state: { from: 'resume-report' } }
    globalThis.__printPreviewLocationState = { printReturnState: carry }
    const withCarry = clickNext(context, fileUrl)
    assertConfirmState(withCarry, fileUrl, context.contextId)
    assert.deepEqual(Object.keys(withCarry[1].state).sort(), ['printContextId', 'printReturnState'])
    assert.deepEqual(withCarry[1].state.printReturnState, carry)

    globalThis.__printPreviewLocationState = withCarry[1].state
    const afterRoundTrip = clickNext(context, fileUrl)
    assertConfirmState(afterRoundTrip, fileUrl, context.contextId)
    assert.deepEqual(Object.keys(afterRoundTrip[1].state).sort(), ['printContextId', 'printReturnState'])
    assert.deepEqual(afterRoundTrip[1].state.printReturnState, carry)
    assert.equal(JSON.stringify(globalThis.__printPreviewNavLog).includes(fileUrl), false)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    delete globalThis.__printPreviewNavLog
    delete globalThis.__printPreviewLocationState
    delete globalThis.__printPreviewFrame
  }
})
