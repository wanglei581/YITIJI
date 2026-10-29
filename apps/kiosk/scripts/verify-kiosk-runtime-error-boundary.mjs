import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createStaticHandler, createStaticRouter, matchRoutes, StaticRouterProvider } from 'react-router-dom'
import { checkShellChromeProp } from './lib/shell-chrome-contract.mjs'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(kioskRoot, path), 'utf8')

const errorPagePath = join(kioskRoot, 'src/pages/errors/KioskRouteErrorPage.tsx')
assert.ok(existsSync(errorPagePath), 'KioskRouteErrorPage.tsx must exist')

const errorPage = read('src/pages/errors/KioskRouteErrorPage.tsx')
const routes = read('src/routes/index.tsx')
const main = read('src/main.tsx')
const root = read('src/layouts/KioskRoot.tsx')

assert.match(errorPage, /useRouteError/)
assert.match(errorPage, /isRouteErrorResponse/)
assert.match(errorPage, /页面不存在/)
assert.match(errorPage, /页面暂时无法显示/)
assert.match(errorPage, /重试页面/)
assert.match(errorPage, /返回首页/)
assert.match(errorPage, /window\.location\.reload\(\)/)
assert.match(errorPage, /navigate\('\/',\s*\{\s*replace:\s*true\s*\}\)/)
assert.doesNotMatch(errorPage, /\{\s*(?:error|routeError)\s*\}/, 'raw route errors must never render into public UI')
assert.doesNotMatch(errorPage, /\.stack\b/, 'stack traces must never render into public UI')

const routeSource = ts.createSourceFile('routes.tsx', routes, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let routerArray = null
const visit = (node) => {
  if (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'createBrowserRouter'
    && node.arguments[0]
    && ts.isArrayLiteralExpression(node.arguments[0])
  ) routerArray = node.arguments[0]
  ts.forEachChild(node, visit)
}
visit(routeSource)
assert.ok(routerArray, 'createBrowserRouter array must exist')
for (const route of routerArray.elements) {
  assert.ok(ts.isObjectLiteralExpression(route), 'every top-level router entry must be an object')
  const errorElement = route.properties.find((property) => (
    ts.isPropertyAssignment(property)
    && ts.isIdentifier(property.name)
    && property.name.text === 'errorElement'
  ))
  assert.ok(errorElement, 'every top-level route object must own the safe kiosk error element')
  assert.match(errorElement.getText(routeSource), /<KioskRouteErrorPage\s*\/>/)
}

// 未注册地址走真实的 * element，并不会产生 useRouteError 的 404 对象。
// 从生产路由 AST 取路径树和兜底 JSX；只替换视觉组件，保留真实页面判定与 Router。
{
  let fallbackElement = null
  const property = (object, name) => object.properties.find((node) => (
    ts.isPropertyAssignment(node) && node.name.getText(routeSource) === name
  ))?.initializer
  const routeTree = (array) => array.elements.map((object) => {
    const path = property(object, 'path')?.text
    const children = property(object, 'children')
    if (path === '*') fallbackElement = property(object, 'element').getText(routeSource)
    return { path, index: property(object, 'index')?.kind === ts.SyntaxKind.TrueKeyword,
      ...(children ? { children: routeTree(children) } : {}) }
  })
  const tree = routeTree(routerArray)
  assert.ok(fallbackElement, 'unknown paths must have a fallback inside the runtime root')
  for (const path of ['/smart-campus/freshman-insights', '/smart-campus/unknown', '/unknown']) {
    const matches = matchRoutes(tree, path)
    assert.equal(matches.at(-1).route.path, '*', `${path} must match only the unknown-route branch`)
    assert.ok(matches.slice(0, -1).every(({ route }) => route.path === undefined),
      'unknown paths must stay outside visual layouts and capability/hosting gates')
  }
  for (const path of ['/smart-campus', '/smart-campus/welcome', '/smart-campus/service/luggage', '/jobs']) {
    assert.notEqual(matchRoutes(tree, path).at(-1).route.path, '*', `${path} must remain registered`)
  }

  const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  const chromeUrl = dataUrl('export const getKioskPresentationAttributes = () => ({});'
    + 'export const KioskTopbar = () => null; export const KioskStageFit = ({ children }) => children;'
    + 'export const HomeIcon = () => null; export const RefreshCwIcon = () => null; export const TriangleAlertIcon = () => null;')
  const compile = (code) => ts.transpileModule(code, {
    fileName: 'probe.tsx',
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText.replace(/from ["']react\/jsx-runtime["']/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
  const pageUrl = dataUrl(compile(errorPage)
    .replaceAll("from 'react-router-dom'", `from '${import.meta.resolve('react-router-dom')}'`)
    .replace(/from '(?:@ai-job-print\/ui|lucide-react|\.\.\/\.\.\/components\/kiosk-shell\/KioskStageFit)'/g, `from '${chromeUrl}'`))
  const { KioskRouteErrorPage } = await import(pageUrl)
  const { fallback } = await import(dataUrl(compile(
    `import { KioskRouteErrorPage } from '${pageUrl}'; export const fallback = ${fallbackElement}`,
  )))
  const renderRoute = async (path, loader) => {
    const testRoutes = [
      { path: '/registered', loader, element: createElement('h1', null, '已注册页面'), errorElement: createElement(KioskRouteErrorPage) },
      { path: '*', element: fallback },
    ]
    const handler = createStaticHandler(testRoutes)
    const context = await handler.query(new Request(`http://kiosk.test${path}`))
    const router = createStaticRouter(handler.dataRoutes, context)
    return renderToStaticMarkup(createElement(StaticRouterProvider, { router, context, hydrate: false }))
  }
  for (const path of ['/smart-campus/freshman-insights', '/smart-campus/unknown', '/unknown']) {
    const html = await renderRoute(path)
    assert.match(html, />页面不存在<\/h1>/, `${path} must display not-found without a route error`)
    assert.match(html, /当前入口可能已经调整，请返回首页重新选择服务。/)
  }
  assert.match(await renderRoute('/registered'), /已注册页面/)
  for (const error of [new Error('render failed'), new Response('unavailable', { status: 500 })]) {
    assert.match(await renderRoute('/registered', () => { throw error }), /页面暂时无法显示/,
      'registered route failures must not be disguised as missing pages')
  }
  assert.match(await renderRoute('/registered', () => { throw new Response('missing', { status: 404 }) }), /页面不存在/)
}
assert.match(main, /onError=\{handleRouterError\}/)
assert.match(main, /\[kiosk-route-error\]/)

// 2026-08-18：/print/params 已下线为指向 /print/preview 的兼容重定向，本身不再渲染页面，
// actionbar 由重定向目的地 /print/preview 提供，故从本清单移除。
for (const path of [
  '/print/upload',
  '/print/desk',
  '/print/material-check', '/print/preview', '/print/confirm',
  '/print/cashier', '/print/progress', '/scan', '/scan/start', '/scan/settings',
  '/scan/progress', '/scan/result', '/print-scan/convert', '/print-scan/sign',
  '/resume/source', '/resume/generate', '/resume/generate/preview', '/resume/report',
]) {
  assert.ok(root.includes(`'${path}'`), `actionbar route must replace global bottom nav: ${path}`)
}
// 本门禁只关心一件事：带自有操作条的路由必须替换掉全局底部导航（否则页面底部
// 会同时出现两条操作栏）。原先逐字匹配整个表达式，等于顺带锁死了「还能有哪些
// 遮蔽条件」——那不是本门禁的职责，2026-09-02 新增 isQxRoute 时因此误红。
// 现在只断言 usesPageActionbar 确实是其中一个判据；表达式整体是否合法由
// verify:fusion-shell 用同一个 checkShellChromeProp 负责。
const navChrome = checkShellChromeProp(root, 'hideBottomNav')
assert.ok(navChrome.ok, `KioskRoot hideBottomNav: ${navChrome.reason ?? ''}`)
assert.ok(
  navChrome.disjuncts.includes('usesPageActionbar'),
  'hideBottomNav must keep usesPageActionbar as a disjunct, or actionbar routes render two stacked bars',
)

// ---- 业务页的错误文案（2026-08-18 专家评审：10 个页面甩英文技术串）----
//
// 上面两条只管路由级错误边界。真正被用户看到英文的是业务页自己的 catch：
// 普遍写成 `err instanceof Error ? err.message : '中文兜底'` —— 兜底挂在了「不是 Error」
// 那一支，而技术串（适配器造的 `HTTP 500`、浏览器的 `Failed to fetch`）恰恰都是
// **有 message 的 Error**，于是那句中文一次都执行不到。

const RAW_MESSAGE_PATTERN = /(\b\w+)\s+instanceof\s+Error\s*\?\s*\1\.message/

/** 评审点名的 10 页（含 DeepSeek 逐行核出的实际转串文件）。 */
const USER_FACING_ERROR_PAGES = [
  'src/pages/jobs/JobsPage.tsx',
  'src/pages/jobs/JobDetailPage.tsx',
  'src/pages/resume/JobFitPage.tsx',
  'src/pages/resume/JobFitActionsPage.tsx',
  'src/pages/job-fairs/FairVisitPlanPage.tsx',
  'src/pages/interview/InterviewSessionPage.tsx',
  'src/pages/resume/ResumeOptimizePage.tsx',
  'src/pages/resume/ResumeGeneratePreviewPage.tsx',
  'src/pages/resume/ResumeParsePage.tsx',
  'src/pages/resume/components/ResumeTranscriptConfirmDialog.tsx',
  'src/pages/print/PrintConfirmPage.tsx',
  'src/pages/print/PrintCashierPage.tsx',
  'src/pages/print/PrintUploadPage.tsx',
  'src/pages/print/PrintMaterialCheckPage.tsx',
  'src/pages/print-scan/SignStampPage.tsx',
  'src/pages/print-scan/ConvertImagesPage.tsx',
  'src/pages/scan/ScanProgressPage.tsx',
  'src/pages/scan/ScanSettingsPage.tsx',
  'src/pages/profile/me/MySettingsPage.tsx',
  'src/pages/profile/me/MyPrivacyRequestsPage.tsx',
  'src/pages/resume/ResumeGeneratePage.tsx',
  'src/pages/resume/JobMaterialLibraryPage.tsx',
  'src/pages/resume/ResumeTemplateLibraryPage.tsx',
]

for (const rel of USER_FACING_ERROR_PAGES) {
  assert.ok(existsSync(join(kioskRoot, rel)), `user-facing error page must exist: ${rel}`)
  const source = read(rel)
  assert.doesNotMatch(
    source,
    RAW_MESSAGE_PATTERN,
    `${rel}: 不得直接展示 err.message —— 服务端存在含环境变量名与字体路径的中文报错，`
      + `请改用 userMessageOf(err, '与当前操作相关的中文兜底')`,
  )
}

// 适配器造的兜底串本身也不能是英文：仓库多数适配器早已用中文「请求失败（状态码）」，
// 这里钉死不许再有人退回 `HTTP ${status}`。扫整个 services 目录而不是白名单，
// 避免新增适配器时漏登记。
const servicesDir = join(kioskRoot, 'src/services')
const collectTs = (dir, acc = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectTs(full, acc)
    else if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}
const englishPlaceholders = []
for (const file of collectTs(servicesDir)) {
  if (file.endsWith('userErrorMessage.ts')) continue // 该模块的注释里引用了事故原文
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!/`HTTP[ _]\$\{/.test(line)) return
    // 赋给 code 的是**机器码**，不进 UI（userMessageOf 对未知码一律用页面兜底句），
    // 只有 message 位置才是用户会读到的字符串。
    if (/\bcode\b\s*[:=]/.test(line)) return
    englishPlaceholders.push(`${file.slice(kioskRoot.length + 1)}:${i + 1}`)
  })
}
assert.deepEqual(
  englishPlaceholders,
  [],
  '适配器兜底文案不得使用英文 `HTTP ${status}`，请用「请求失败（${status}）」',
)

// ---- 运行时判据：把收敛器真的编译出来调一遍 ----
//
// 上面两条是静态的，挡不住「把 userMessageOf 的实现改回 `return error.message`」——
// 自测实证：只回退实现、页面调用点不动，静态断言全绿。收敛行为必须由运行时钉住。
// 做法沿用 verify-ai-down-fallbacks.mjs ⑤-A：纯本地编译 + 内存 import，不连网络/数据库。
{
  const source = read('src/services/api/userErrorMessage.ts')
  // 值导入只有两个：ApiHttpError 用等价的本地类替掉；无人值守标准句（copy/unattendedCopy，自身无依赖）
  // 原样转译后以 data URL 接上，这样断言的就是真标准句，不是另抄的一份。其余是纯逻辑。
  const COPY_IMPORT = /^import \{[^}]*\} from '\.\.\/\.\.\/copy\/unattendedCopy'$/m
  const standalone = source.replace(
    /^import \{ ApiHttpError \} from '\.\/httpAdapter'$/m,
    'export class ApiHttpError extends Error {\n'
      + '  constructor(code, message, status) { super(message); this.code = code; this.status = status }\n'
      + '}',
  )
  assert.match(standalone, COPY_IMPORT, 'userErrorMessage.ts 必须从 copy/unattendedCopy 取无人值守标准句')
  assert.doesNotMatch(standalone.replace(COPY_IMPORT, ''), /^\s*import\s/m, 'userErrorMessage.ts 新增了运行时依赖，本判据需同步调整')

  const transpileEsm = (code) => ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`
  const copyUrl = toDataUrl(transpileEsm(read('src/copy/unattendedCopy.ts')))
  const copy = await import(copyUrl)
  const js = transpileEsm(standalone).replace("'../../copy/unattendedCopy'", `'${copyUrl}'`)
  assert.ok(js.includes(copyUrl), '标准句导入没有接上真实的 unattendedCopy')
  const mod = await import(toDataUrl(js))
  const { userMessageOf, ApiHttpError } = mod
  assert.equal(typeof userMessageOf, 'function', 'userMessageOf 必须被导出')
  assert.equal(typeof ApiHttpError, 'function', '测试桩必须导出 ApiHttpError，否则无法构造带服务端原文的错误')

  const FALLBACK = '导出失败，请稍后重试'
  // 这四条是用户实际会撞到的技术串，一条都不许显示出去。
  for (const probe of [
    new Error('HTTP 500'),
    new Error('Failed to fetch'),
    new Error('Load failed'),
    // 中文但不是给用户看的：服务端 job-material-pdf.service.ts 的真实下发内容。
    new Error('服务器缺少可用中文字体，无法生成求职材料 PDF；请配置 JOB_MATERIAL_PDF_FONT_PATH 指向 .ttf/.ttc 中文字体文件'),
  ]) {
    assert.equal(
      userMessageOf(probe, FALLBACK),
      FALLBACK,
      `技术/内部错误必须落到调用方兜底句，实测透传了：${probe.message}`,
    )
  }
  // 白名单里的码要给自己的说法，而不是一律吞成兜底 —— 否则「限流」和「未配置」
  // 会被显示成同一句话，用户无从判断该等还是该找人。
  const rateLimited = userMessageOf({ code: 'RATE_LIMITED' }, FALLBACK)
  assert.notEqual(rateLimited, FALLBACK, 'RATE_LIMITED 必须有自己的文案')
  assert.match(rateLimited, /[\u4e00-\u9fff]/, 'RATE_LIMITED 文案必须是中文')
  // verify-ai-down-fallbacks 要求解析页透出真实原因，MOCK_MODE 不能被抹成通用文案。
  assert.notEqual(userMessageOf({ code: 'MOCK_MODE' }, FALLBACK), FALLBACK, 'MOCK_MODE 必须有自己的文案')
  for (const [code, hint] of [
    ['NETWORK_ERROR', /网络|重试/],
    ['TERMINAL_NOT_READY', /暂时不能用.*(稍后再来|换一台机器)/],
    ['ONLINE_PAYMENT_DISABLED', /线上支付.*(其他支付方式|服务电话|联系方式)/],
    ['SCAN_TERMINAL_BUSY', /扫描|等待/],
    ['PRINTER_UNAVAILABLE', /暂时不能用.*(稍后再来|换一台机器)/],
  ]) {
    const text = userMessageOf({ code }, FALLBACK)
    assert.notEqual(text, FALLBACK, `${code} 必须有自己的文案`)
    assert.match(text, hint, `${code} 文案须含下一步`)
  }
  // 2026-10-04 U 盘读不了（Defender 拦截或已隔离）：固定说「换一个文件」，不能落到兜底「请重试」——
  // 重试同一个文件不会成功。列表过期则要重新读取 U 盘，同样不能说成「重试」。
  // 本地接口抛的是带 code 的 LocalAgentApiError（不是 ApiHttpError），这里用同形状的对象。
  const usbUnreadable = userMessageOf({ code: 'LOCAL_USB_FILE_UNREADABLE', message: 'x' }, 'U 盘文件导入失败，请重试')
  assert.equal(usbUnreadable, '这个文件读不了，请换一个文件', 'LOCAL_USB_FILE_UNREADABLE 必须提示换一个文件')
  const usbExpired = userMessageOf({ code: 'LOCAL_USB_FILE_EXPIRED', message: 'x' }, 'U 盘文件导入失败，请重试')
  assert.match(usbExpired, /重新读取 U 盘/, 'LOCAL_USB_FILE_EXPIRED 必须提示重新读取 U 盘')
  assert.doesNotMatch(usbExpired, /请重试/, 'LOCAL_USB_FILE_EXPIRED 不能说成「请重试」')
  // 2026-10-04 能力开关：关着和查不到各有一句固定说法，不能落到兜底「请重试」。
  const usbDisabled = userMessageOf({ code: 'LOCAL_USB_DISABLED', message: 'x' }, 'U 盘文件导入失败，请重试')
  assert.equal(usbDisabled, '这台机器暂未开放 U 盘导入，请用手机扫码上传', 'LOCAL_USB_DISABLED 必须提示改用手机扫码')
  assert.doesNotMatch(usbDisabled, /请重试/, 'LOCAL_USB_DISABLED 不能落到兜底「请重试」')
  const usbUnknown = userMessageOf({ code: 'LOCAL_USB_CAPABILITY_UNKNOWN', message: 'x' }, 'U 盘文件导入失败，请重试')
  assert.equal(usbUnknown, '暂时确认不了 U 盘导入是否开放，请稍后再试或用手机扫码上传', 'LOCAL_USB_CAPABILITY_UNKNOWN 必须说明暂时确认不了')
  assert.notEqual(usbUnknown, 'U 盘文件导入失败，请重试', 'LOCAL_USB_CAPABILITY_UNKNOWN 不能落到兜底「请重试」')
  // PRINT_TERMINAL_QUEUE_HALTED（#1150 方案 A，只此一个新码）：
  // 合格中文原话原样显示。兜底句与拍板原话相同，只断言那一句时拿掉白名单仍会绿，
  // 所以再钉一条不同的合格中文（#1150 现文「本机…」），证明不是固定覆盖。
  // 英文堆栈或路径、以及空原话，回退一体机自己的那句，不落到调用方兜底。
  // PRINTER_UNAVAILABLE 不放行：带「本机暂停接打印单…」时仍是原来的固定文案。
  // 现场不安排人：打印机不可用是整台机器暂时打不了，用标准句 3（读自真实 unattendedCopy，不另抄）。
  const PRINTER_FIXED = copy.machineUnusableLine()
  assert.match(PRINTER_FIXED, /^这台机器暂时不能用，请(稍后再来|换一台机器)，或/, '标准句 3 的形状变了，本门禁的固定句要跟着看')
  const QUEUE_HALTED_FALLBACK = '这台终端暂停接打印单，暂不能下单，请稍后再试或换一台终端'
  const QUEUE_HALTED_SERVER = '本机暂停接打印单，暂不能下单，请稍后再试或换一台终端'
  assert.equal(
    userMessageOf(new ApiHttpError('PRINT_TERMINAL_QUEUE_HALTED', QUEUE_HALTED_FALLBACK, 400), FALLBACK),
    QUEUE_HALTED_FALLBACK,
    '新码带拍板那句时必须原样显示',
  )
  assert.equal(
    userMessageOf(new ApiHttpError('PRINT_TERMINAL_QUEUE_HALTED', QUEUE_HALTED_SERVER, 400), FALLBACK),
    QUEUE_HALTED_SERVER,
    '新码带另一句合格中文时必须原样显示，不能被兜底句盖住',
  )
  const leakedPath = 'Error: ENOENT\n    at Queue.pause (C:\\\\Windows\\\\System32\\\\spool\\\\PRINTERS:12:3)'
  const leaked = userMessageOf(new ApiHttpError('PRINT_TERMINAL_QUEUE_HALTED', leakedPath, 400), FALLBACK)
  assert.equal(leaked, QUEUE_HALTED_FALLBACK, '英文堆栈或路径不得透传，须回退到一体机兜底句')
  assert.notEqual(leaked, leakedPath)
  assert.notEqual(leaked, FALLBACK)
  const missing = userMessageOf(new ApiHttpError('PRINT_TERMINAL_QUEUE_HALTED', '   ', 400), FALLBACK)
  assert.equal(missing, QUEUE_HALTED_FALLBACK, '原话缺失时回退到一体机兜底句')
  assert.notEqual(missing, FALLBACK)
  const printerShown = userMessageOf(new ApiHttpError('PRINTER_UNAVAILABLE', QUEUE_HALTED_SERVER, 400), FALLBACK)
  assert.equal(printerShown, PRINTER_FIXED, 'PRINTER_UNAVAILABLE 不得透传「本机暂停接打印单」')
  assert.notEqual(printerShown, QUEUE_HALTED_SERVER)
  assert.notEqual(printerShown, QUEUE_HALTED_FALLBACK)
  // 现场不安排人：透传码的服务端原话若仍叫用户去找现场的人，换成这个码登记过的那句；
  // 没登记的透传码（CONVERT_FAILED）退回调用方兜底句。干净原话照旧原样显示（上面已钉）。
  const HANDOFF_SERVER = '本机暂停接打印单，请联系现场工作人员'
  assert.equal(copy.containsStaffHandoff(HANDOFF_SERVER), true, '阳性对照：夹具原话本身必须命中词表')
  assert.equal(
    userMessageOf(new ApiHttpError('PRINT_TERMINAL_QUEUE_HALTED', HANDOFF_SERVER, 400), FALLBACK),
    QUEUE_HALTED_FALLBACK,
    '服务端原话叫人找现场的人时，必须换成登记过的固定句',
  )
  assert.equal(
    userMessageOf(new ApiHttpError('CONVERT_FAILED', '转换失败，请找现场工作人员', 400), FALLBACK),
    FALLBACK,
    '没有登记句的透传码，原话叫人找现场的人时退回调用方兜底句',
  )
  assert.equal(
    userMessageOf(new ApiHttpError('CONVERT_FAILED', '合成图片尺寸不受支持，请换一张图', 400), FALLBACK),
    '合成图片尺寸不受支持，请换一张图',
    '干净的透传原话照旧原样显示',
  )
  // 码表整表真跑一遍：没有一句叫用户去找现场的人（静态扫描扫不到函数拼出来的句子，这里补上）。
  const handoffs = []
  for (const code of mod.SHARED_USER_MESSAGE_CODES) {
    const text = userMessageOf({ code }, FALLBACK)
    if (copy.containsStaffHandoff(text) || text.includes('工作人员')) handoffs.push(`${code}：${text}`)
  }
  assert.deepEqual(handoffs, [], `码表里有句子叫用户去找现场的人：\n${handoffs.join('\n')}`)
  assert.ok(mod.SHARED_USER_MESSAGE_CODES.length > 40, '码表被清空或没读到，整表检查是空转')
  const generic5xx = userMessageOf(new ApiHttpError('SOMETHING_NEW', 'x', 503), FALLBACK)
  assert.equal(generic5xx, `服务暂时不可用，请稍后重试。${copy.helpNeededLine()}。`, '5xx 通用句要给重试加标准句 1，不叫人找人')
  assert.equal(copy.containsStaffHandoff(generic5xx), false)
  const otherCode = userMessageOf(new ApiHttpError('RATE_LIMITED', QUEUE_HALTED_SERVER, 429), FALLBACK)
  assert.equal(otherCode, '当前使用的人较多，请稍后再试', '非透传码不得显示服务端原话')
  assert.notEqual(otherCode, QUEUE_HALTED_SERVER)
  class ProbeTypeError extends TypeError {}
  const networkText = userMessageOf(new ProbeTypeError('Failed to fetch'), FALLBACK)
  assert.notEqual(networkText, FALLBACK, 'TypeError 断网必须映射中文，不得透传 Failed to fetch')
  assert.match(networkText, /网络|重试/)
}

console.log('PASS kiosk route errors use a safe Chinese recovery page')
console.log('PASS unknown routes show not-found; registered routes retain success, 404 and non-404 semantics')
console.log('PASS actionbar routes replace the global bottom navigation')
console.log(`PASS ${USER_FACING_ERROR_PAGES.length} 个业务页不再直接展示 err.message，适配器兜底全中文`)
console.log('PASS userMessageOf 运行时收敛技术串与内部报错，白名单码保留各自文案')
