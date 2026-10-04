import { verifyUsageContract } from './verify-admin-ai-usage-contract.mjs'
import { verifyUsageRender } from './verify-admin-ai-usage-render.mjs'
// Admin「AI 用量与额度」面板门禁（对接后端 #1088 GET /admin/ai-usage/daily）。
//
// 不靠搜几个字符串过关：适配器、显示名映射、分组表与面板都在本进程里真跑
// （TypeScript 转译 + node:vm 沙箱 + 最小 hooks 运行时），不连服务、不开浏览器。
//   A. 服务端事实：路径、角色、day 校验、触顶后果文案，逐项从 services/api/src 读出来对照。
//      服务端改了这里先红，免得面板说明与真实行为脱节。
//   B. aiUsageDaily.ts 适配器：请求路径与 day 参数；不合法日期不发请求；401 跳登录；
//      403 / 400 的错误码与服务端中文 message 原样带回；响应形状不对不当成功；mock 不造假数。
//   C. 显示名与金额：null key → 「无已验签终端 / 无机构」；已知功能 / 供应商 key 给中文名；
//      认不出的 key 原样显示；金额统一四位小数，沿用 formatYuan。
//   D. 面板真渲染：演示模式诚实空态；读取中 / 失败重试 / 正常三态；触顶告警引用服务端原话；
//      四个页签；0 调用如实显示；未来日期不采纳。失败只显示中文说明，不显示错误码。
//   E. 纪律：面板源码不含「预计 / 估算 / 预测」；按钮可点区域 ≥48px；index.tsx 三个分支都挂面板。
//   F. 返工：选中页签有 aria 选中态且是实色底白字；面板渲染结果无状态码 / 英文错误码 / 字段名；
//      旧日志概览在 0 次调用时不显示 0% 成功率。
//
// Run: pnpm --filter @ai-job-print/admin verify:admin-ai-usage-ui

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(adminRoot, '../..')
const read = (rel, base = adminRoot) => readFileSync(resolve(base, rel), 'utf8')

let passed = 0
async function check(name, fn) {
  try {
    await fn()
  } catch (error) {
    console.error(`  FAIL ${name}\n       ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  passed += 1
  console.log(`  PASS ${name}`)
}

// ─── 转译加载（node:vm 沙箱）：依赖逐个登记，没登记的一律报错 ──────────────────
function load(rel, imports, globals = {}) {
  const { outputText } = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: rel,
  })
  const module = { exports: {} }
  const requireStub = (id) => {
    if (id === '@ai-job-print/shared') return { ...load('../../packages/shared/src/aiDisplayLabels.ts', {}), ...load('../../packages/shared/src/formatNumber.ts', {}) }
    if (!(id in imports)) throw new Error(`${rel} 引用了门禁没登记的依赖 ${id}`)
    return imports[id]
  }
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: requireStub,
    console,
    ...globals,
  })
  vm.runInContext(outputText, context, { filename: rel })
  return module.exports
}

class ApiHttpError extends Error {
  constructor(code, message, status, reason) {
    super(message)
    this.code = code
    this.status = status
    this.reason = reason
    this.name = 'ApiHttpError'
  }
}
const API_BASE = 'https://admin-gate.invalid/api/v1'
const clientStub = (mode) => ({ API_MODE: mode, API_BASE_URL: API_BASE, ApiHttpError })

function loadAdapter(mode, respond) {
  const calls = []
  const redirects = []
  const fetchStub = async (url, init = {}) => {
    calls.push({ url, init })
    if (!respond) throw new Error('这个用例不该发请求')
    return respond(url, init)
  }
  const service = load('src/services/api/aiUsageDaily.ts', {
    './client': clientStub(mode),
    '../auth': { authHeader: () => ({ Authorization: 'Bearer gate-admin-token' }), redirectToLogin: () => redirects.push(1) },
  }, { fetch: fetchStub })
  return { service, calls, redirects }
}

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

async function rejection(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('预期失败，实际成功了')
}

// ─── 一份形状合法的响应（后端 ai-usage-summary.ts 的白名单形状） ────────────────
const SAMPLE = () => ({
  day: '2026-09-28',
  limits: { globalCny: 100, terminalCny: 30, memberCny: 5, unmeasuredCallCostCny: 0.05 },
  totals: { key: null, calls: 4, unmeasuredCalls: 1, measuredCostCny: 1.05, chargedCostCny: 1.1, memberCount: 2 },
  reached: { global: false, terminalIds: ['kiosk-01'], terminals: [{ terminalId: 'kiosk-01', terminalCode: null }], memberCount: 1 },
  byFeature: [{ key: 'resume_optimize', calls: 2, unmeasuredCalls: 0, measuredCostCny: 0.5, chargedCostCny: 0.5 }],
  byVendor: [{ key: 'deepseek', calls: 4, unmeasuredCalls: 1, measuredCostCny: 1.05, chargedCostCny: 1.1 }],
  byTerminal: [
    { key: null, terminalCode: null, calls: 1, unmeasuredCalls: 1, measuredCostCny: 0, chargedCostCny: 0.05 },
    { key: 'kiosk-01', terminalCode: null, calls: 3, unmeasuredCalls: 0, measuredCostCny: 1.05, chargedCostCny: 1.05 },
  ],
  byOrg: [{ key: null, orgName: null, calls: 4, unmeasuredCalls: 1, measuredCostCny: 1.05, chargedCostCny: 1.1 }],
})

function legacySample() {
  const sample = SAMPLE()
  delete sample.reached.terminals
  for (const bucket of sample.byTerminal) delete bucket.terminalCode
  for (const bucket of sample.byOrg) delete bucket.orgName
  return sample
}

console.log('\n=== Admin AI 用量与额度面板门禁 ===')

// ─── A. 服务端事实 ──────────────────────────────────────────────────────────
const { http, EXHAUSTED_GLOBAL } = await verifyUsageContract({ check, read, repoRoot, loadAdapter, load, SAMPLE, legacySample, reply, rejection, ApiHttpError, API_BASE })

// ─── D. 面板真渲染（最小 hooks 运行时） ───────────────────────────────────────
const FRAGMENT = Symbol('Fragment')
const sharedElement = (type, props) => ({ type, props: props ?? {} })
const sharedJsx = { Fragment: FRAGMENT, jsx: sharedElement, jsxs: sharedElement }

function createReactRuntime() {
  const slots = []
  const effectSlots = new Set()
  let cursor = 0
  let rendering = false
  let dirty = false
  let pending = []
  const changed = (prev, next) => !prev || !next || prev.length !== next.length || next.some((v, i) => !Object.is(v, prev[i]))
  const react = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], (value) => {
        const next = typeof value === 'function' ? value(slots[i]) : value
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true }
      }]
    },
    useEffect(effect, deps) {
      const i = cursor++
      effectSlots.add(i)
      const prev = slots[i]
      if (prev && !changed(prev.deps, deps)) return
      slots[i] = { deps, cleanup: prev?.cleanup }
      pending.push(() => {
        slots[i].cleanup?.()
        const cleanup = effect()
        slots[i].cleanup = typeof cleanup === 'function' ? cleanup : undefined
      })
    },
  }
  function expand(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return []
    if (typeof node === 'string' || typeof node === 'number') return [String(node)]
    if (Array.isArray(node)) return node.flatMap(expand)
    if (node.type === FRAGMENT) return expand(node.props.children)
    if (typeof node.type === 'function') return expand(node.type(node.props))
    if (typeof node.type === 'string') {
      const { children, ...props } = node.props
      return [{ type: node.type, props, children: expand(children) }]
    }
    throw new Error(`门禁运行时不认识的节点：${String(node.type)}`)
  }
  function mount(Component) {
    const render = () => {
      for (let round = 0; round < 50; round += 1) {
        dirty = false
        cursor = 0
        rendering = true
        let output
        try { output = Component({}) } finally { rendering = false }
        const tree = expand(output)
        const effects = pending
        pending = []
        effects.forEach((run) => run())
        if (!dirty) return tree
      }
      throw new Error('渲染不收敛（setState 循环）')
    }
    return {
      render,
      async settle() {
        render()
        for (let k = 0; k < 10; k += 1) await new Promise((done) => setImmediate(done))
        return render()
      },
      unmount() { for (const i of effectSlots) slots[i]?.cleanup?.() },
    }
  }
  return { react, jsxRuntime: { Fragment: FRAGMENT, jsx: sharedElement, jsxs: sharedElement }, mount }
}

function* nodesOf(tree) {
  for (const node of tree) {
    if (typeof node === 'string') continue
    yield node
    yield* nodesOf(node.children)
  }
}
const textOf = (tree) => tree.map((node) => (typeof node === 'string' ? node : textOf(node.children))).join('')
const find = (tree, predicate) => [...nodesOf(tree)].filter(predicate)
const byId = (tree, id) => find(tree, (node) => node.props.id === id)[0]
const buttons = (tree, label) => find(tree, (node) => node.type === 'button' && textOf(node.children).trim() === label)
const tabs = (tree, label) => find(tree, (node) => node.type === 'button' && node.props.role === 'tab' && textOf(node.children).trim() === label)

const act = {
  click(node) {
    assert.ok(node, '找不到要点的按钮')
    assert.notEqual(node.props.disabled, true, `按钮「${textOf(node.children)}」是禁用的`)
    node.props.onClick()
  },
}

const iconStub = new Proxy({}, { get: (_, name) => (typeof name === 'string' && name.endsWith('Icon') ? () => null : undefined) })
const userErrorMessage = load('src/services/api/userErrorMessage.ts', { './client': clientStub('http') })
const displayModule = load('src/routes/ai-services/aiUsageDisplay.ts', {})
const breakdownModule = load('src/routes/ai-services/AiUsageBreakdownTable.tsx', {
  'react/jsx-runtime': sharedJsx,
  './aiUsageDisplay': displayModule,
  '../../services/api/aiUsageDaily': http,
})

function deferred() {
  let resolveFn
  let rejectFn
  const promise = new Promise((resolvePromise, rejectPromise) => { resolveFn = resolvePromise; rejectFn = rejectPromise })
  return { promise, resolve: resolveFn, reject: rejectFn }
}

/**
 * 挂载面板。get(day) 控制 getAiUsageDaily 的行为（默认回 SAMPLE）。
 * 子组件 AiUsageBreakdownTable 用真模块（无 hooks，纯 props 函数组件）。
 */
function mountPanel({ demo = false, get } = {}) {
  const runtime = createReactRuntime()
  const calls = []
  const service = {
    AI_USAGE_DAILY_DEMO: demo,
    beijingTodayKey: () => '2026-09-29',
    isAiUsageDayKey: http.isAiUsageDayKey,
    getAiUsageDaily: (day) => {
      calls.push(day)
      return (get ? get(day) : Promise.resolve(SAMPLE())).then((summary) => http.aiUsageDailyFromResponse({ success: true, data: summary }))
    },
  }
  const panel = load('src/routes/ai-services/AiUsagePanel.tsx', {
    react: runtime.react,
    'react/jsx-runtime': runtime.jsxRuntime,
    'lucide-react': iconStub,
    '../../services/api/aiUsageDaily': service,
    '../../services/api/client': clientStub('http'),
    '../../services/api/userErrorMessage': userErrorMessage,
    './aiUsageDisplay': displayModule,
    './AiUsageBreakdownTable': breakdownModule,
  })
  assert.equal(typeof panel.AiUsagePanel, 'function', '面板必须具名导出 AiUsagePanel')
  return { view: runtime.mount(panel.AiUsagePanel), calls }
}

await verifyUsageRender({ check, mountPanel, textOf, find, buttons, tabs, act, SAMPLE, legacySample, loadAdapter, reply, ApiHttpError, deferred, byId, EXHAUSTED_GLOBAL })

// ─── E. 纪律 ────────────────────────────────────────────────────────────────
const PANEL_SOURCES = [
  'src/routes/ai-services/AiUsagePanel.tsx',
  'src/routes/ai-services/AiUsageBreakdownTable.tsx',
  'src/routes/ai-services/aiUsageDisplay.ts',
  'src/services/api/aiUsageDaily.ts',
]

await check('E1 面板源码不含「预计 / 估算 / 预测」（运营看钱的面板不自行推算任何数字）', () => {
  for (const rel of PANEL_SOURCES) {
    const source = read(rel)
    for (const word of ['预计', '估算', '预测']) {
      assert.ok(!source.includes(word), `${rel} 出现了「${word}」：只展示服务端给的数，不自行推算`)
    }
  }
})

await check('E2 按钮可点区域至少 48px（min-h-12），日期输入同高', () => {
  assert.match(read('src/routes/ai-services/AiUsagePanel.tsx'), /min-h-12/, '面板控件缺 min-h-12（48px）')
  assert.match(read('src/routes/ai-services/AiUsageBreakdownTable.tsx'), /min-h-12/, '页签按钮缺 min-h-12（48px）')
})

await check('E3 index.tsx：加载中、加载失败、正常三个分支都挂面板，且行数压在 780 以下', () => {
  const source = read('src/routes/ai-services/index.tsx')
  const sourceFile = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const imported = sourceFile.statements.some((statement) =>
    ts.isImportDeclaration(statement)
    && statement.moduleSpecifier.text === './AiUsagePanel'
    && statement.importClause?.namedBindings
    && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some((element) => element.name.text === 'AiUsagePanel' && !element.isTypeOnly))
  assert.ok(imported, 'index.tsx 没有从 ./AiUsagePanel 导入面板')
  const page = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'AiServicesPage')
  assert.ok(page?.body, '找不到 AiServicesPage')
  const returns = []
  const walk = (node, branch) => {
    if (ts.isFunctionLike(node)) return
    if (ts.isIfStatement(node)) {
      walk(node.thenStatement, node.expression.getText(sourceFile))
      if (node.elseStatement) walk(node.elseStatement, `非（${node.expression.getText(sourceFile)}）`)
      return
    }
    if (ts.isReturnStatement(node) && node.expression) {
      let expr = node.expression
      while (ts.isParenthesizedExpression(expr)) expr = expr.expression
      if (ts.isJsxElement(expr) && expr.openingElement.tagName.getText(sourceFile) === 'Page') returns.push({ branch, jsx: expr })
      return
    }
    ts.forEachChild(node, (child) => walk(child, branch))
  }
  for (const statement of page.body.statements) walk(statement, '正常')
  const branches = returns.map((entry) => entry.branch)
  assert.ok(branches.some((branch) => /\bloading\b/.test(branch)), `缺加载中分支（找到：${branches.join(' / ')}）`)
  assert.ok(branches.some((branch) => /\berror\b/.test(branch)), `缺加载失败分支（找到：${branches.join(' / ')}）`)
  assert.ok(branches.includes('正常'), `缺正常分支（找到：${branches.join(' / ')}）`)
  for (const { branch, jsx } of returns) {
    const names = jsx.children
      .filter((child) => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces) && !(ts.isJsxExpression(child) && !child.expression))
      .map((child) => (ts.isJsxSelfClosingElement(child) ? child.tagName.getText(sourceFile) : ''))
    assert.ok(names.includes('AiUsagePanel'), `分支「${branch}」没有挂 <AiUsagePanel />`)
  }
  const lines = source.split('\n').length
  assert.ok(lines <= 780, `index.tsx 已 ${lines} 行，超过 780 行上限：继续往别的文件拆`)
})

await check('E4 新文件都在 300 行以内', () => {
  for (const rel of [...PANEL_SOURCES, 'src/routes/ai-services/AiOperationCostTable.tsx', 'src/routes/ai-services/aiOperationLabels.ts']) {
    const lines = read(rel).split('\n').length
    assert.ok(lines <= 300, `${rel} 已 ${lines} 行，超过 300 行：该拆了`)
  }
})

await check('E5 package.json 注册本门禁', () => {
  assert.match(read('package.json'), /"verify:admin-ai-usage-ui": "node scripts\/verify-admin-ai-usage-ui\.mjs"/)
})

// ─── F. 返工口径（渲染结果，不靠注释过关） ────────────────────────────────────
const STATUS_CODE = /(?:^|[^0-9.])(?:503|500|403|401|400)(?![0-9])/
const ERROR_CODE = /\b(?:AI|AUTH|HTTP)_[A-Z0-9_]+\b/
const FIELD_NAME = /\b(?:chargedCostCny|unmeasuredCalls|measuredCostCny|terminalIds|globalCny|memberCount|unmeasuredCallCostCny|estimatedCostCny)\b/

function assertOperatorFacing(text, where) {
  assert.doesNotMatch(text, STATUS_CODE, `${where} 出现了 HTTP 状态码`)
  assert.doesNotMatch(text, ERROR_CODE, `${where} 出现了英文错误码`)
  assert.doesNotMatch(text, FIELD_NAME, `${where} 出现了字段名`)
}

await check('F1 选中页签有 aria 选中态，且是实色底白字（同页分段按钮），未选中不是这个底', async () => {
  const panel = mountPanel({})
  let tree = await panel.view.settle()
  const selected = () => find(tree, (node) => node.type === 'button' && node.props.role === 'tab' && node.props['aria-selected'] === true)
  const idle = () => find(tree, (node) => node.type === 'button' && node.props.role === 'tab' && node.props['aria-selected'] !== true)
  assert.equal(selected().length, 1, '同一时刻只能有一个选中页签')
  const on = selected()[0]
  assert.equal(textOf(on.children).trim(), '按功能', '默认选中应按功能')
  assert.match(String(on.props.className), /bg-primary-600/, '选中态要用实色 primary-600 底')
  assert.match(String(on.props.className), /text-white/, '选中态要用白字')
  assert.match(String(on.props.className), /appearance-none/, '选中态要去掉原生按钮外观，避免画成浅底浅字')
  assert.doesNotMatch(String(on.props.className), /transition-colors/, '选中态不要颜色过渡，过渡中途会看起来像禁用')
  assert.ok(idle().length >= 3, '未选中页签也要在')
  for (const node of idle()) {
    assert.equal(node.props['aria-selected'], false, `未选中页签「${textOf(node.children)}」的 aria-selected 必须是 false`)
    assert.doesNotMatch(String(node.props.className), /bg-primary-600/, '未选中页签不能用选中底色')
  }
  act.click(tabs(tree, '按机构')[0])
  tree = panel.view.render()
  const org = selected()
  assert.equal(org.length, 1)
  assert.equal(textOf(org[0].children).trim(), '按机构')
  assert.equal(org[0].props['aria-selected'], true)
  assert.match(String(org[0].props.className), /bg-primary-600/)
  assert.match(String(org[0].props.className), /text-white/)
})

await check('F2 面板渲染结果不含 HTTP 状态码、英文错误码、字段名；触顶保留服务端原话', async () => {
  const summary = SAMPLE()
  summary.day = '2026-09-29'
  summary.reached = { global: true, terminalIds: ['kiosk-01'], memberCount: 1 }
  const panel = mountPanel({ get: () => Promise.resolve(summary) })
  const text = textOf(await panel.view.settle())
  assert.ok(text.includes(EXHAUSTED_GLOBAL), '触顶仍要引用服务端原话')
  assert.match(text, /会被拒绝，并提示「/)
  assert.match(text, /AI简历优化/, '已知功能显示中文名')
  assert.doesNotMatch(text, /resume_optimize/, '已知功能不要再附英文 key')
  assert.match(text, /终端（尾号 osk-01）/, '只有 ID 时显示真实尾号')
  assert.ok(find(await panel.view.settle(), (node) => node.props.title === 'kiosk-01').length > 0, '终端 ID 在悬停保留')
  assert.doesNotMatch(text, /kiosk-01/, '正文不直接露出终端 ID')
  assertOperatorFacing(text, '触顶面板')

  const failed = mountPanel({
    get: () => Promise.reject(new ApiHttpError('AI_USAGE_DAY_INVALID', '日期格式应为 YYYY-MM-DD', 400)),
  })
  const errorText = textOf(await failed.view.settle())
  assert.match(errorText, /日期格式应为 YYYY-MM-DD/)
  assertOperatorFacing(errorText, '读取失败')
})

await check('F3 旧日志概览：0 次调用不显示 0% 成功率，页面改叫按日志估算的成本', () => {
  const display = load('src/routes/ai-services/aiUsageDisplay.ts', {})
  assert.equal(display.logOverviewRate(0, 0), '—', '0 次调用不能显示 0% 成功率')
  assert.equal(display.logOverviewRate(0, 100), '—')
  assert.equal(display.logOverviewLatency(0, 0), '—', '0 次调用不能显示 0 ms')
  assert.equal(display.logOverviewRate(4, 0), '0%', '有调用且全部失败时 0% 是真实结果')
  assert.equal(display.logOverviewRate(4, 95), '95%')
  assert.equal(display.logOverviewLatency(3, 120), '120 ms')
  const index = read('src/routes/ai-services/index.tsx')
  assert.match(index, /logOverviewRate\(/, '近 24 小时概览的成功率必须走 logOverviewRate')
  assert.match(index, /logOverviewLatency\(/, '近 24 小时概览的平均响应时间必须走 logOverviewLatency')
  // 旧日志概览来自 GET /admin/ai/usage，服务端按滚动 24 小时统计（ai-log.service.ts AI_USAGE_WINDOW_MS），
  // 不是北京时间自然日：写「今日」会让运营拿它和按自然日计费的额度面板对不上（W-101）。
  assert.match(index, />近 24 小时概览</)
  assert.match(index, /note="近 24 小时累计"/)
  assert.match(index, /近 24 小时暂无调用/)
  assert.doesNotMatch(index, /今日概览|今日累计|今日暂无调用/, 'AI 服务管理的旧日志概览不是自然日，不能写「今日」')
  const dashboard = read('src/routes/dashboard/index.tsx')
  assert.match(dashboard, /近 24 小时暂无调用/, '工作台 AI 调用卡片同一接口，要标出统计窗口')
  assert.match(dashboard, /近 24 小时 · 成功率/)
  assert.doesNotMatch(dashboard, /今日暂无调用/, '工作台 AI 调用不是自然日，不能写「今日」')
  assert.match(index, /label="按日志估算的成本"/)
  assert.match(index, /和上面额度面板的「已计费金额」不是一回事/)
  assert.doesNotMatch(index, /label="预估成本"/)
  assert.doesNotMatch(index, /value=\{`\$\{successRate\}%`\}/)
  assert.doesNotMatch(index, /value=\{`\$\{usage\.avgLatencyMs\} ms`\}/)
})

console.log(`\nALL PASS（${passed} 项）`)
