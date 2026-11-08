/**
 * 政策最小闭环停放守卫（2026-11-05 产品负责人在方案页点「按方案开工」，批准停放 7 处）。
 *
 * 停放 = 源码保留、不注册、不打包，旧链接回政策首页，以后能恢复。本门禁守四件事：
 *   ① 停放源码仍在、文件头有停放注释（别被「无引用清理」当垃圾删掉）；
 *   ② 一体机与机构后台的在用源码都不值导入停放文件（import type 会被编译擦掉，不算打包边）；
 *      唯一例外：auth/kioskSensitiveSession.ts 只准用 hasLocalFavorites / clearAllLocalFavorites
 *      清掉改版前留在本机的旧收藏（公共设备隐私清场）；
 *   ③ 旧链接 /renshi（无参数）与 tab=policy|eligibility|social|register 真跑路由函数，都回 /policy-service；
 *   ④ 政策首页不再摆浏览记录 / AI 服务记录 / 全部服务 / 条件核对 / 社保 / 登记入口，详情不再有重复的问小青按钮。
 * 另有阳性对照：扫描器必须能看到一条已知的真实值导入，免得解析坏了全部「通过」。
 *
 * 运行：node scripts/verify-kiosk-parked-policy.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const KIOSK = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARTNER = join(KIOSK, '..', 'partner')
const PARK_MARK = /^(\/\/|\/\*) 停放（2026-11-05 政策最小闭环）/

const PARKED = {
  kiosk: [
    // 条件核对整块
    'src/pages/renshi/EligibilityPanel.tsx',
    'src/pages/renshi/EligibilityResults.tsx',
    'src/pages/renshi/eligibilityOutcome.ts',
    'src/pages/renshi/renshi-eligibility-qx.css',
    'src/services/api/policy-eligibility.ts',
    // 社保指南、就业登记两页写死的说明
    'src/pages/renshi/SocialPanel.tsx',
    'src/pages/renshi/RegisterPanel.tsx',
    // 5 条本机整理的通用办事指引
    'src/pages/renshi/builtinData.ts',
    // 被三屏取代的旧政策面板与它的焦点逻辑、窄屏样式
    'src/pages/renshi/PolicyPanel.tsx',
    'src/pages/renshi/policyFocus.tsx',
    'src/pages/renshi/usePolicyFocus.ts',
    'src/pages/renshi/renshi-narrow-qx.css',
    // 未登录的本机收藏
    'src/favorites/localFavorites.ts',
  ],
  partner: [
    // 机构后台「申领条件」录入（随一体机条件核对停放）
    'src/routes/policy/EligibilityRulesDrawer.tsx',
    'src/routes/policy/EligibilityRuleEditor.tsx',
  ],
}

/** 唯一允许的值导入：清场只清旧残留，不读写收藏。 */
const ALLOWED = {
  'kiosk:src/auth/kioskSensitiveSession.ts -> src/favorites/localFavorites.ts': ['clearAllLocalFavorites', 'hasLocalFavorites'],
}

let failed = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => {
  failed += 1
  console.error(`  FAIL ${message}`)
}
const rel = (root, file) => relative(root, file).split('\\').join('/')

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) return []
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path)
    return entry.isFile() ? [path] : []
  })
}

function resolveAny(root, fromFile, specifier) {
  let base
  if (specifier.startsWith('@/')) base = join(root, 'src', specifier.slice(2))
  else if (specifier.startsWith('.')) base = join(dirname(fromFile), specifier)
  else return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.css`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try { if (readdirSync(candidate)) continue } catch { /* 不是目录 */ }
      return rel(root, candidate)
    }
  }
  return null
}

/** 值导入、副作用导入、再导出与动态 import；记下导入了哪些名字（命名导入）。 */
function valueImports(sourceFile) {
  const found = []
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : []
      const valueNames = named.filter((element) => !element.isTypeOnly).map((element) => (element.propertyName ?? element.name).text)
      const hasValue = !clause?.isTypeOnly && (
        !clause || Boolean(clause.name)
        || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        || valueNames.length > 0
      )
      const wholeModule = !clause || Boolean(clause.name) || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
      if (hasValue) found.push({ specifier: node.moduleSpecifier.text, names: wholeModule ? ['*'] : valueNames })
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      found.push({ specifier: node.moduleSpecifier.text, names: ['*'] })
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      found.push({ specifier: node.arguments[0].text, names: ['*'] })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function scanApp(app, root) {
  const parked = new Set(PARKED[app])
  const edges = []
  for (const file of walk(join(root, 'src'))) {
    if (!/\.(ts|tsx)$/.test(file)) continue
    const from = rel(root, file)
    if (from.includes('/__tests__/') || /\.(test|spec)\.(ts|tsx)$/.test(from)) continue
    const source = ts.createSourceFile(from, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    for (const { specifier, names } of valueImports(source)) {
      const to = resolveAny(root, file, specifier)
      if (to) edges.push({ from, to, names, fromParked: parked.has(from), toParked: parked.has(to) })
    }
  }
  return edges
}

console.log('\n=== 政策最小闭环停放（2026-11-05）===')

// ① 停放源码仍在、带停放注释
for (const [app, files] of Object.entries(PARKED)) {
  const root = app === 'kiosk' ? KIOSK : PARTNER
  for (const file of files) {
    const path = join(root, file)
    if (!existsSync(path)) { fail(`① ${app} 停放源码被删 ${file}`); continue }
    if (PARK_MARK.test(readFileSync(path, 'utf8'))) pass(`① ${app} 停放源码仍在且带停放注释 ${file}`)
    else fail(`① ${app} ${file} 文件头缺「停放（2026-11-05 政策最小闭环）」注释`)
  }
}

// ② 在用源码不值导入停放文件（停放文件之间互相引用不算）
const kioskEdges = scanApp('kiosk', KIOSK)
const partnerEdges = scanApp('partner', PARTNER)
const offenders = []
for (const [app, edges] of [['kiosk', kioskEdges], ['partner', partnerEdges]]) {
  for (const edge of edges) {
    if (!edge.toParked || edge.fromParked) continue
    const allowed = ALLOWED[`${app}:${edge.from} -> ${edge.to}`]
    if (allowed && edge.names.length > 0 && edge.names.every((name) => allowed.includes(name))) continue
    offenders.push(`${app}: ${edge.from} -> ${edge.to}（${edge.names.join(', ')}）`)
  }
}
if (offenders.length === 0) pass('② 一体机与机构后台的在用源码都不值导入停放文件（清场残留例外只用两个清理函数）')
else fail(`② 停放文件仍被在用代码导入：\n    ${offenders.join('\n    ')}`)

// 阳性对照：扫描器必须看得到已知的真实值导入，解析坏了不能全部「通过」
const sees = (edges, from, to) => edges.some((edge) => edge.from === from && edge.to === to)
if (sees(kioskEdges, 'src/pages/renshi/RenshiPage.tsx', 'src/pages/renshi/PolicyDetail.tsx')
  && sees(kioskEdges, 'src/auth/kioskSensitiveSession.ts', 'src/favorites/localFavorites.ts')
  && sees(kioskEdges, 'src/pages/renshi/EligibilityPanel.tsx', 'src/pages/renshi/EligibilityResults.tsx')
  && sees(partnerEdges, 'src/routes/policy/EligibilityRulesDrawer.tsx', 'src/routes/policy/EligibilityRuleEditor.tsx')) {
  pass('阳性对照：扫描器看得到 RenshiPage→PolicyDetail、清场→本机收藏、停放件之间的真实导入')
} else fail('阳性对照失败：扫描器没看到已知的真实导入，②的「没有违规」不可信')

// ③ 旧链接真跑路由函数
function loadRenshiPage() {
  const transpile = (file) => ts.transpileModule(readFileSync(join(KIOSK, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const run = (code, resolve) => {
    const module = { exports: {} }
    new Function('exports', 'module', 'require', code)(module.exports, module, resolve)
    return module.exports
  }
  const policyModel = run(transpile('src/pages/renshi/policyModel.ts'), (name) => { throw new Error(`policyModel 意外依赖 ${name}`) })
  const state = { params: new URLSearchParams() }
  const stubs = {
    Navigate: function Navigate() {},
    PolicyCategoryList: function PolicyCategoryList() {},
    PolicyDetail: function PolicyDetail() {},
    PolicyNotices: function PolicyNotices() {},
  }
  const jsx = (type, props, key) => ({ type, props, key })
  const page = run(transpile('src/pages/renshi/RenshiPage.tsx'), (name) => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'react-router-dom') return { Navigate: stubs.Navigate, useSearchParams: () => [state.params] }
    if (name === './PolicyCategoryList') return { PolicyCategoryList: stubs.PolicyCategoryList }
    if (name === './PolicyDetail') return { PolicyDetail: stubs.PolicyDetail }
    if (name === './PolicyNotices') return { PolicyNotices: stubs.PolicyNotices }
    if (name === './policyModel') return policyModel
    throw new Error(`RenshiPage 意外依赖 ${name}（停放模块不该回到活路由）`)
  })
  return (query) => {
    state.params = new URLSearchParams(query)
    return page.RenshiPage()
  }
}
try {
  const render = loadRenshiPage()
  for (const query of ['', 'tab=policy', 'tab=eligibility', 'tab=social', 'tab=register', 'tab=whatever', 'audience=all']) {
    const element = render(query)
    if (element?.type?.name === 'Navigate' && element.props.to === '/policy-service' && element.props.replace === true) {
      pass(`③ /renshi${query ? `?${query}` : ''} 回政策首页`)
    } else fail(`③ /renshi${query ? `?${query}` : ''} 应 <Navigate to="/policy-service" replace />，实际 ${element?.type?.name ?? element}`)
  }
  const detail = render('policy=p-1')
  const list = render('audience=graduate&page=2')
  const notice = render('tab=notice')
  if (detail?.type?.name === 'PolicyDetail' && detail.props.id === 'p-1'
    && list?.type?.name === 'PolicyCategoryList' && list.props.audience === 'graduate' && list.props.page === 2
    && notice?.type?.name === 'PolicyNotices') {
    pass('③ 在用的三条路照常：?policy=详情、?audience=列表（带页码）、?tab=notice 公告')
  } else fail('③ ?policy= / ?audience= / ?tab=notice 没有分到详情、列表、公告')
} catch (error) {
  fail(`③ 路由函数跑不起来：${error.message}`)
}

// ④ 政策首页、规格、详情不再有停放的入口
const hub = readFileSync(join(KIOSK, 'src/pages/service-hubs/PolicyTouchHub.tsx'), 'utf8')
const specs = readFileSync(join(KIOSK, 'src/pages/service-hubs/serviceHubSpecs.ts'), 'utf8')
const policySpec = specs.match(/\n {2}policy: \{[\s\S]*?\n {2}\},\n/)?.[0] ?? ''
const banned = [/\/me\/activity/, /\/me\/ai-records/, /全部服务/, /\/renshi\?tab=(eligibility|social|register|policy)\b/, /核对申领条件|社保指南|就业登记|通用办事指引/]
const hubHits = banned.filter((pattern) => pattern.test(hub) || pattern.test(policySpec)).map((pattern) => pattern.source)
if (policySpec && hubHits.length === 0) pass('④ 政策首页与规格不再摆浏览记录 / AI 服务记录 / 全部服务 / 条件核对 / 社保 / 登记入口')
else fail(`④ 政策首页或规格仍有停放入口：${policySpec ? hubHits.join(', ') : '找不到 policy 规格块'}`)
const detail = readFileSync(join(KIOSK, 'src/pages/renshi/PolicyDetail.tsx'), 'utf8')
if (!detail.includes('问小青别的问题') && /<PolicyTouchLayout compact ask=\{false\}/.test(detail)) {
  pass('④ 详情不再有重复的「问小青别的问题」，底栏不挂问小青（只留「问小青这条」一张卡）')
} else fail('④ 详情仍有重复的问小青入口')

if (failed > 0) {
  console.error(`\n❌ ${failed} 项失败\n`)
  process.exit(1)
}
console.log('\n✅ ALL PASS — 政策最小闭环停放 7 处保持停放\n')
