import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
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
assert.match(main, /onError=\{handleRouterError\}/)
assert.match(main, /\[kiosk-route-error\]/)

// 2026-08-18：/print/params 已下线为指向 /print/preview 的兼容重定向，本身不再渲染页面，
// actionbar 由重定向目的地 /print/preview 提供，故从本清单移除。
for (const path of [
  '/print/upload',
  '/print/material-check', '/print/preview', '/print/confirm',
  '/print/cashier', '/print/progress', '/scan/start', '/scan/settings',
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
  // 唯一的值导入是 ApiHttpError，用等价的本地类替掉即可独立加载（其余是纯逻辑）。
  const standalone = source.replace(
    /^import \{ ApiHttpError \} from '\.\/httpAdapter'$/m,
    'class ApiHttpError extends Error {\n'
      + '  constructor(code, message, status) { super(message); this.code = code; this.status = status }\n'
      + '}',
  )
  assert.doesNotMatch(standalone, /^\s*import\s/m, 'userErrorMessage.ts 新增了运行时依赖，本判据需同步调整')

  const js = ts.transpileModule(standalone, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js, 'utf8').toString('base64')}`)
  const { userMessageOf } = mod
  assert.equal(typeof userMessageOf, 'function', 'userMessageOf 必须被导出')

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
}

console.log('PASS kiosk route errors use a safe Chinese recovery page')
console.log('PASS actionbar routes replace the global bottom navigation')
console.log(`PASS ${USER_FACING_ERROR_PAGES.length} 个业务页不再直接展示 err.message，适配器兜底全中文`)
console.log('PASS userMessageOf 运行时收敛技术串与内部报错，白名单码保留各自文案')
