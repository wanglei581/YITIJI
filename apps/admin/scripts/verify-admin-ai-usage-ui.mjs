// Admin「AI 用量与额度」面板门禁（对接后端 #1088 GET /admin/ai-usage/daily）。
//
// 不靠搜几个字符串过关：适配器、显示名映射、分组表与面板都在本进程里真跑
// （TypeScript 转译 + node:vm 沙箱 + 最小 hooks 运行时），不连服务、不开浏览器。
//   A. 服务端事实：路径、角色、day 校验、触顶后果文案，逐项从 services/api/src 读出来对照。
//      服务端改了这里先红，免得面板说明与真实行为脱节。
//   B. aiUsageDaily.ts 适配器：请求路径与 day 参数；不合法日期不发请求；401 跳登录；
//      403 / 400 的错误码与服务端中文 message 原样带回；响应形状不对不当成功；mock 不造假数。
//   C. 显示名与金额：null key → 「未关联终端 / 未关联机构」；已知功能 / 供应商 key 给中文名；
//      认不出的 key 原样显示；金额两位小数带「元」。
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
  reached: { global: false, terminalIds: ['kiosk-01'], memberCount: 1 },
  byFeature: [{ key: 'resume_optimize', calls: 2, unmeasuredCalls: 0, measuredCostCny: 0.5, chargedCostCny: 0.5 }],
  byVendor: [{ key: 'deepseek', calls: 4, unmeasuredCalls: 1, measuredCostCny: 1.05, chargedCostCny: 1.1 }],
  byTerminal: [
    { key: null, calls: 1, unmeasuredCalls: 1, measuredCostCny: 0, chargedCostCny: 0.05 },
    { key: 'kiosk-01', calls: 3, unmeasuredCalls: 0, measuredCostCny: 1.05, chargedCostCny: 1.05 },
  ],
  byOrg: [{ key: null, calls: 4, unmeasuredCalls: 1, measuredCostCny: 1.05, chargedCostCny: 1.1 }],
})

console.log('\n=== Admin AI 用量与额度面板门禁 ===')

// ─── A. 服务端事实 ──────────────────────────────────────────────────────────
const controllerSource = read('services/api/src/ai/usage/admin-ai-usage.controller.ts', repoRoot)
const budgetSource = read('services/api/src/ai/usage/ai-budget.service.ts', repoRoot)
const summarySource = read('services/api/src/ai/usage/ai-usage-summary.ts', repoRoot)

function budgetMessage(varName, key) {
  const match = new RegExp(`${key}:\\s*'([^']+)'`).exec(budgetSource.slice(budgetSource.indexOf(varName)))
  assert.ok(match, `ai-budget.service.ts 里找不到 ${varName}.${key} 的原话`)
  return match[1]
}
const EXHAUSTED_GLOBAL = budgetMessage('EXHAUSTED_MESSAGE', 'global')

await check('A1 服务端事实：GET /admin/ai-usage/daily 只给 admin；day 校验与错误码同判法', () => {
  assert.match(controllerSource, /@Controller\('admin\/ai-usage'\)/, '控制器路径变了')
  assert.match(controllerSource, /@Get\('daily'\)/, '缺 GET daily')
  assert.match(controllerSource, /@Roles\('admin'\)/, '不再只限 admin')
  assert.match(controllerSource, /day\?\.trim\(\) \|\| beijingDayKey\(aiUsageNow\(\)\)/, '省略 day 不再默认北京时间今天')
  assert.match(controllerSource, /code: 'AI_USAGE_DAY_INVALID', message: '日期格式应为 YYYY-MM-DD'/, '非法 day 的错误码或提示变了')
})

await check('A2 服务端事实：触顶后果照真实行为——只拦生成与语音，只读导出删除材料检查不拦，次日恢复', () => {
  assert.equal(EXHAUSTED_GLOBAL, '今天的 AI 服务额度已用完，明天恢复；打印、扫描等其他功能照常', '全局触顶提示原话变了，面板告警文字要跟着改')
  // 触顶是拒绝（503），不是降级：assertWithinBudget 抛 ServiceUnavailableException
  assert.match(budgetSource, /throw new ServiceUnavailableException\(\{ error: \{ code: AI_BUDGET_EXHAUSTED/, '触顶不再抛 503 AI_BUDGET_EXHAUSTED')
  assert.match(budgetSource, /只拦 generate \/ voice/, '拦截范围说明变了（面板「后果」段落要重写）')
  assert.match(budgetSource, /只读、导出、删除、打印前材料检查（@AiUseExempt）一律不拦/, '豁免范围说明变了（面板「后果」段落要重写）')
  assert.match(budgetSource, /失败关闭/, '读不到花费时不再是失败关闭')
})

await check('A3 服务端事实：桶字段白名单、null key 口径、不含会员号', () => {
  assert.match(summarySource, /null 表示「无已验签终端」\/「无所属机构」/, 'null key 口径说明变了')
  assert.match(summarySource, /\*\*不含会员号\*\*，会员只给人数/, '汇总不再遵守「不含会员号」白名单')
  for (const field of ['calls', 'unmeasuredCalls', 'measuredCostCny', 'chargedCostCny']) {
    assert.match(summarySource, new RegExp(`${field}:`), `桶缺 ${field}`)
  }
})

// ─── B. 适配器（node:vm 沙箱真跑） ───────────────────────────────────────────
const http = loadAdapter('http', () => reply(200, { success: true, data: SAMPLE() })).service

await check('B1 http：GET /admin/ai-usage/daily 带管理员令牌与 day 参数，按 { success, data } 取全量字段', async () => {
  const { service, calls } = loadAdapter('http', () => reply(200, { success: true, data: SAMPLE() }))
  const summary = await service.getAiUsageDaily('2026-09-28')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${API_BASE}/admin/ai-usage/daily?day=2026-09-28`)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer gate-admin-token')
  // vm 沙箱里创建的对象原型与宿主不同，deepStrictEqual 会连原型一起比：先 JSON 往返归一化。
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), SAMPLE(), '解析结果必须逐字段等于服务端 data')
  assert.equal(service.AI_USAGE_DAILY_DEMO, false, 'http 模式不能标演示')
})

await check('B2 http：省略 day 不带查询串', async () => {
  const { service, calls } = loadAdapter('http', () => reply(200, { success: true, data: SAMPLE() }))
  await service.getAiUsageDaily()
  assert.equal(calls[0].url, `${API_BASE}/admin/ai-usage/daily`)
})

await check('B3 http：不合法日期（格式错、月或日越界）根本不发请求', async () => {
  for (const day of ['2026-9-1', '2026/09/28', 'abc', '2026-13-01', '2026-09-32', '']) {
    const { service, calls } = loadAdapter('http', () => reply(200, { success: true, data: SAMPLE() }))
    const error = await rejection(service.getAiUsageDaily(day))
    assert.equal(error.code, 'AI_USAGE_DAY_INVALID', `day=${JSON.stringify(day)}`)
    assert.equal(error.status, 400)
    assert.equal(calls.length, 0, `day=${JSON.stringify(day)} 不能发请求`)
  }
  assert.equal(http.isAiUsageDayKey('2026-09-28'), true)
  assert.equal(http.isAiUsageDayKey('2026-13-01'), false)
})

await check('B4 http：401 跳登录；403 / 400 的错误码与服务端中文 message 原样带回', async () => {
  const unauthorized = loadAdapter('http', () => reply(401, { error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' } }))
  assert.equal((await rejection(unauthorized.service.getAiUsageDaily())).status, 401)
  assert.equal(unauthorized.redirects.length, 1, '401 必须跳登录')

  const forbidden = loadAdapter('http', () => reply(403, { error: { code: 'AUTH_ROLE_FORBIDDEN', message: '当前角色无权访问 (需要: admin)' } }))
  const forbiddenError = await rejection(forbidden.service.getAiUsageDaily())
  assert.equal(forbiddenError.status, 403)
  assert.equal(forbiddenError.code, 'AUTH_ROLE_FORBIDDEN')
  assert.equal(forbiddenError.message, '当前角色无权访问 (需要: admin)', '服务端 message 要原样带回')
  assert.equal(forbidden.redirects.length, 0, '403 不是登录过期，不能跳登录')

  const badDay = loadAdapter('http', () => reply(400, { error: { code: 'AI_USAGE_DAY_INVALID', message: '日期格式应为 YYYY-MM-DD' } }))
  const badDayError = await rejection(badDay.service.getAiUsageDaily())
  assert.equal(badDayError.code, 'AI_USAGE_DAY_INVALID')
  assert.equal(badDayError.message, '日期格式应为 YYYY-MM-DD')

  const offline = loadAdapter('http', () => { throw new TypeError('Failed to fetch') })
  const offlineError = await rejection(offline.service.getAiUsageDaily())
  assert.equal(offlineError.code, 'NETWORK_ERROR')
  assert.equal(offlineError.status, 0)
})

await check('B5 http：响应形状不对不当成功（缺 data / 日期错 / 负数金额 / 未计量单价 0 / 桶字段坏）', async () => {
  const broken = [
    { success: true },
    { success: true, data: { ...SAMPLE(), day: '2026/09/28' } },
    { success: true, data: { ...SAMPLE(), limits: { ...SAMPLE().limits, globalCny: -1 } } },
    { success: true, data: { ...SAMPLE(), limits: { ...SAMPLE().limits, unmeasuredCallCostCny: 0 } } },
    { success: true, data: { ...SAMPLE(), totals: { ...SAMPLE().totals, memberCount: '2' } } },
    { success: true, data: { ...SAMPLE(), reached: { ...SAMPLE().reached, terminalIds: 'kiosk-01' } } },
    { success: true, data: { ...SAMPLE(), byFeature: {} } },
    { success: true, data: { ...SAMPLE(), byTerminal: [{ key: 123, calls: 1, unmeasuredCalls: 0, measuredCostCny: 0, chargedCostCny: 0 }] } },
    { success: true, data: { ...SAMPLE(), byVendor: [{ key: 'deepseek', calls: -1, unmeasuredCalls: 0, measuredCostCny: 0, chargedCostCny: 0 }] } },
  ]
  for (const body of broken) {
    const { service } = loadAdapter('http', () => reply(200, body))
    const error = await rejection(service.getAiUsageDaily())
    assert.equal(error.code, 'UNEXPECTED_RESPONSE', `body=${JSON.stringify(body).slice(0, 80)} 不能当成功`)
  }
})

await check('B6 mock：标演示、不发请求、直接拒绝（不造假数）', async () => {
  const { service, calls } = loadAdapter('mock')
  assert.equal(service.AI_USAGE_DAILY_DEMO, true, 'mock 模式必须标演示')
  const error = await rejection(service.getAiUsageDaily('2026-09-28'))
  assert.equal(error.code, 'DEMO_MODE_NO_USAGE_DATA')
  assert.equal(calls.length, 0, 'mock 模式不能发请求')
})

// ─── C. 显示名与金额（真跑 aiUsageDisplay.ts） ────────────────────────────────
await check('C1 null key 显示「未关联终端 / 未关联机构」；已知 key 给中文名；认不出原样显示', () => {
  const display = load('src/routes/ai-services/aiUsageDisplay.ts', {})
  assert.equal(display.aiUsageKeyName('terminal', null), '未关联终端')
  assert.equal(display.aiUsageKeyName('org', null), '未关联机构')
  assert.equal(display.aiUsageKeyName('terminal', 't_09fd'), '未命名终端')
  assert.equal(display.aiUsageKeyName('org', 'org_6349'), '未命名机构')
  assert.equal(display.aiUsageKeyName('feature', 'resume_optimize'), 'AI简历优化')
  assert.equal(display.aiUsageKeyName('feature', 'assistant_chat'), 'AI助手对话')
  assert.equal(display.aiUsageKeyName('feature', 'unknown'), '未知功能')
  assert.equal(display.aiUsageKeyName('vendor', 'deepseek'), 'DeepSeek')
  assert.equal(display.aiUsageKeyName('vendor', 'qwen'), '通义千问')
  assert.equal(display.aiUsageKeyName('feature', 'brand_new_feature'), 'brand_new_feature', '认不出的功能 key 必须原样显示')
  assert.equal(display.aiUsageKeyName('vendor', 'api.somehost.com'), 'api.somehost.com', '认不出的厂商 key（主机名）必须原样显示')
})

await check('C2 金额两位小数带「元」', () => {
  const display = load('src/routes/ai-services/aiUsageDisplay.ts', {})
  assert.equal(display.formatCny(1.1), '1.10 元')
  assert.equal(display.formatCny(0.05), '0.05 元')
  assert.equal(display.formatCny(0), '0.00 元')
  assert.equal(display.formatCny(123.456), '123.46 元')
})

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
      return get ? get(day) : Promise.resolve(SAMPLE())
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

await check('D1 演示模式：诚实空态，不出现任何数字，也不发请求', async () => {
  const panel = mountPanel({ demo: true })
  const tree = await panel.view.settle()
  assert.match(textOf(tree), /演示模式不连接真实用量数据/)
  assert.doesNotMatch(textOf(tree), /\d/, '演示模式不能出现任何数字（不造演示数据）')
  assert.equal(panel.calls.length, 0)
  assert.equal(byId(tree, 'ai-usage-day'), undefined, '演示模式不渲染日期选择')
})

await check('D2 读取中不出数字；读完只显示服务端给的数', async () => {
  const pending = deferred()
  const panel = mountPanel({ get: () => pending.promise })
  let tree = panel.view.render()
  assert.match(textOf(tree), /正在读取/)
  assert.doesNotMatch(textOf(tree), /已计费金额/)
  pending.resolve(SAMPLE())
  tree = await panel.view.settle()
  assert.match(textOf(tree), /1\.10 元 \/ 100\.00 元/, '已计费金额 / 全局上限要用服务端数字')
  assert.match(textOf(tree), /4 次/)
  assert.match(textOf(tree), /未计量/, '要有一句话解释未计量')
  assert.match(textOf(tree), /0\.05 元\/次/, '解释里要带服务端的保守单价')
  assert.match(textOf(tree), /2 人/)
})

await check('D3 查看北京时间今天且触顶：全局醒目标红并照服务端原话写后果；终端与会员只给终端号和人数', async () => {
  const summary = SAMPLE()
  summary.day = '2026-09-29'
  summary.reached = { global: true, terminalIds: ['kiosk-01', 'kiosk-02'], memberCount: 3 }
  const panel = mountPanel({ get: () => Promise.resolve(summary) })
  const tree = await panel.view.settle()
  const alert = find(tree, (node) => node.props.role === 'alert').map((node) => textOf(node.children)).join('\n')
  assert.match(alert, /全站当日 AI 额度已用完/)
  assert.ok(alert.includes(EXHAUSTED_GLOBAL), `后果必须引用服务端原话「${EXHAUSTED_GLOBAL}」`)
  assert.match(alert, /这台机器今天的 AI 服务额度已用完/, '单终端触顶要引用终端档原话')
  assert.match(alert, /你今天的 AI 服务额度已用完/, '会员触顶要引用会员档原话')
  assert.match(alert, /未命名终端、未命名终端/, '接口只给 ID 时不编造终端名')
  assert.doesNotMatch(alert, /kiosk-0[12]/, '终端 ID 不在正文展示')
  for (const id of ['kiosk-01', 'kiosk-02']) assert.ok(find(tree, (node) => node.props.title === id).length > 0, `触顶终端 ${id} 必须保留悬停原值`)
  assert.match(alert, /3 人/, '已到会员上限的只给人数')
  assert.doesNotMatch(alert, /会员号|endUser|user-/, '告警里不能出现会员标识')
  assert.match(textOf(tree), /今日已计费金额/)
})

await check('D3b 历史日期触顶：列出终端与人数，但不把「现在就会拒绝新请求」说成正在发生', async () => {
  const summary = SAMPLE()
  summary.day = '2026-09-28'
  summary.reached = { global: true, terminalIds: ['kiosk-01'], memberCount: 2 }
  const panel = mountPanel({ get: () => Promise.resolve(summary) })
  const tree = await panel.view.settle()
  const text = textOf(tree)
  assert.match(text, /历史日期 2026-09-28/)
  assert.match(text, /不会据此拒绝现在的新请求/)
  assert.doesNotMatch(text, /新的 AI 生成与语音请求会被拒绝/, '历史日期的账不能写成闸门正在拒绝新请求')
  assert.match(text, /未命名终端/)
  assert.ok(find(await panel.view.settle(), (node) => node.props.title === 'kiosk-01').length > 0, '历史触顶终端在悬停保留 ID')
  assert.match(text, /2 人/)
  assert.doesNotMatch(text, /均未触顶/)
  assert.match(text, /2026-09-28 已计费金额/)
})

await check('D3c 今天只触到单终端：不能写成三档都没满', async () => {
  const summary = SAMPLE()
  summary.day = '2026-09-29'
  summary.reached = { global: false, terminalIds: ['kiosk-01'], memberCount: 0 }
  const panel = mountPanel({ get: () => Promise.resolve(summary) })
  const text = textOf(await panel.view.settle())
  assert.match(text, /全站当日额度未用完/)
  assert.doesNotMatch(text, /均未触顶/)
  assert.match(text, /这台机器今天的 AI 服务额度已用完/)
  assert.doesNotMatch(text, /你今天的 AI 服务额度已用完/)
})

await check('D4 四个页签：功能 / 供应商给中文名，终端 / 机构的 null key 给「未关联」', async () => {
  const panel = mountPanel({})
  let tree = await panel.view.settle()
  assert.match(textOf(tree), /AI简历优化/, '功能页签要显示中文名')
  assert.match(textOf(tree), /已计费金额（计入额度）/)
  act.click(tabs(tree, '按供应商')[0])
  tree = panel.view.render()
  assert.match(textOf(tree), /DeepSeek/)
  act.click(tabs(tree, '按终端')[0])
  tree = panel.view.render()
  assert.match(textOf(tree), /未关联终端/)
  assert.match(textOf(tree), /未命名终端/)
  assert.ok(find(tree, (node) => node.props.title === 'kiosk-01').length > 0, '按终端列表保留 ID 悬停')
  assert.doesNotMatch(textOf(tree), /kiosk-01/)
  act.click(tabs(tree, '按机构')[0])
  tree = panel.view.render()
  assert.match(textOf(tree), /未关联机构/)
})

await check('D5 当天 0 调用：如实显示 0，不装作没查到', async () => {
  const summary = SAMPLE()
  summary.totals = { key: null, calls: 0, unmeasuredCalls: 0, measuredCostCny: 0, chargedCostCny: 0, memberCount: 0 }
  summary.byFeature = []
  summary.byVendor = []
  summary.byTerminal = []
  summary.byOrg = []
  summary.reached = { global: false, terminalIds: [], memberCount: 0 }
  const panel = mountPanel({ get: () => Promise.resolve(summary) })
  const tree = await panel.view.settle()
  assert.match(textOf(tree), /当天 0 次 AI 调用/)
  assert.match(textOf(tree), /当日该维度没有调用记录/)
  assert.match(textOf(tree), /0\.00 元 \/ 100\.00 元/)
})

await check('D6 失败可重试：只显示服务端中文说明，不显示错误码，重试后恢复', async () => {
  let attempt = 0
  const panel = mountPanel({
    get: () => {
      attempt += 1
      return attempt === 1
        ? Promise.reject(new ApiHttpError('AI_USAGE_DAY_INVALID', '日期格式应为 YYYY-MM-DD', 400))
        : Promise.resolve(SAMPLE())
    },
  })
  let tree = await panel.view.settle()
  assert.match(textOf(tree), /AI 用量读取失败：日期格式应为 YYYY-MM-DD/)
  assert.doesNotMatch(textOf(tree), /AI_USAGE_DAY_INVALID/, '失败说明不能把英文错误码给运营看')
  act.click(buttons(tree, '重试')[0])
  panel.view.render() // 点击只改状态，要再渲染一次 effect 才会发出第二次请求
  assert.equal(panel.calls.length, 2)
  tree = await panel.view.settle()
  assert.match(textOf(tree), /已计费金额/)
})

await check('D7 403：写明只有管理员可以查看', async () => {
  const panel = mountPanel({ get: () => Promise.reject(new ApiHttpError('AUTH_ROLE_FORBIDDEN', '当前角色无权访问 (需要: admin)', 403)) })
  const tree = await panel.view.settle()
  assert.match(textOf(tree), /只有管理员可以查看 AI 用量与额度/)
})

await check('D8 日期：未来日期不采纳也不重取；换成过去某天按该日重取', async () => {
  const panel = mountPanel({})
  let tree = await panel.view.settle()
  assert.equal(panel.calls.length, 1)
  assert.equal(panel.calls[0], '2026-09-29', '默认查北京时间今天')
  assert.match(textOf(tree), /年-月-日/, '英文区域浏览器也给明确的输入格式')
  assert.ok(find(tree, (node) => node.props.lang === 'zh-CN').length > 0, '日期表单使用中文语言')
  // 未来日期（今天 2026-09-29）：不采纳
  byId(tree, 'ai-usage-day').props.onChange({ target: { value: '2026-09-30' } })
  tree = panel.view.render()
  assert.equal(panel.calls.length, 1, '未来日期不能触发重取')
  assert.equal(byId(tree, 'ai-usage-day').props.value, '2026-09-29', '未来日期不能被采纳')
  // 昨天：按该日重取
  byId(tree, 'ai-usage-day').props.onChange({ target: { value: '2026-09-28' } })
  await panel.view.settle()
  assert.equal(panel.calls.length, 2)
  assert.equal(panel.calls[1], '2026-09-28')
})

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
  assert.match(text, /未命名终端/, '只有 ID 时给诚实名称空态')
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
