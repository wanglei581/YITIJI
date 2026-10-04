/**
 * 后台「AI 次数」发放字段与「按人次数（今天）」只读面板。
 * 转译后在本进程里调用校验函数并渲染，不连服务、不开浏览器。
 *
 * Run: pnpm --filter @ai-job-print/admin verify:admin-ai-quota-ui
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(adminRoot, rel), 'utf8')
const COMMERCIAL = /购买|充值|价格|会员费/
const SOURCES = [
  'src/routes/member-benefits/index.tsx',
  'src/routes/member-benefits/AiQuotaGrantFields.tsx',
  'src/routes/ai-services/AiUsagePanel.tsx',
  'src/routes/ai-services/AiQuotaUsagePanel.tsx',
  'src/services/api/memberBenefitsAdmin.ts',
  'src/services/api/aiQuotaUsage.ts',
]

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

function load(rel, imports) {
  const { outputText } = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: rel,
  })
  const module = { exports: {} }
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: (id) => {
      if (!(id in imports)) throw new Error(`${rel} 引用了门禁没登记的依赖 ${id}`)
      return imports[id]
    },
    console,
  })
  vm.runInContext(outputText, context, { filename: rel })
  return module.exports
}

const FRAGMENT = Symbol('Fragment')
function createReactRuntime() {
  const slots = []
  let cursor = 0
  let dirty = false
  let pending = []
  const changed = (prev, next) => !prev || !next || prev.length !== next.length || next.some((value, index) => !Object.is(value, prev[index]))
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (value) => {
        const next = typeof value === 'function' ? value(slots[index]) : value
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true }
      }]
    },
    useEffect(effect, deps) {
      const index = cursor++
      const prev = slots[index]
      if (prev && !changed(prev.deps, deps)) return
      slots[index] = { deps }
      pending.push(() => { effect() })
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
  function mount(Component, props) {
    const render = () => {
      for (let round = 0; round < 20; round += 1) {
        dirty = false
        cursor = 0
        const tree = expand(Component(props))
        const effects = pending
        pending = []
        effects.forEach((run) => run())
        if (!dirty) return tree
      }
      throw new Error('渲染不收敛')
    }
    return {
      async settle() {
        render()
        for (let index = 0; index < 10; index += 1) await new Promise((done) => setImmediate(done))
        return render()
      },
    }
  }
  return { react, jsxRuntime: { Fragment: FRAGMENT, jsx: (type, props) => ({ type, props: props ?? {} }), jsxs: (type, props) => ({ type, props: props ?? {} }) }, mount }
}

function textOf(tree) {
  return tree.map((node) => (typeof node === 'string' ? node : textOf(node.children))).join('')
}
function* nodesOf(tree) {
  for (const node of tree) {
    if (typeof node === 'string') continue
    yield node
    yield* nodesOf(node.children)
  }
}

console.log('\n=== 后台 AI 次数发放与按人次数面板 ===')

await check('发放页有「AI 次数」，用途和数量放在独立组件里', () => {
  const page = read('src/routes/member-benefits/index.tsx')
  const fields = read('src/routes/member-benefits/AiQuotaGrantFields.tsx')
  assert.match(page, /value: 'ai_quota', label: 'AI 次数'/)
  assert.match(page, /<AiQuotaGrantFields/)
  assert.match(page, /aiQuotaGrantExtra\(/)
  assert.match(page, /benefitType === 'ai_quota'/)
  assert.match(fields, /简历类/)
  assert.match(fields, /小青/)
  assert.match(fields, /模拟面试/)
  assert.match(fields, /id="ai-quota-purpose"/)
  assert.match(fields, /id="ai-quota-quantity"/)
  assert.ok(fields.split('\n').length <= 300, '用途字段组件应保持在 300 行以内')
})

await check('数量必须是 1–9999 的整数，发放额外字段带上用途', () => {
  const fields = load('src/routes/member-benefits/AiQuotaGrantFields.tsx', { 'react/jsx-runtime': { jsx: () => null, jsxs: () => null } })
  assert.equal(fields.validateAiQuotaGrant('', '2'), '请选择 AI 次数的用途')
  assert.equal(fields.validateAiQuotaGrant('print', '2'), '请选择 AI 次数的用途')
  for (const quantity of ['', '0', '10000', '1.5', '2e1', '-1', '  ']) {
    assert.equal(fields.validateAiQuotaGrant('ai_resume', quantity), 'AI 次数必须为 1–9999 的整数', JSON.stringify(quantity))
  }
  assert.equal(fields.validateAiQuotaGrant('ai_interview', '1'), null)
  assert.equal(fields.validateAiQuotaGrant('ai_assistant', '9999'), null)
  const extra = fields.aiQuotaGrantExtra('ai_resume', '12')
  assert.equal(extra.serviceKey, 'ai_resume')
  assert.equal(extra.quantityTotal, 12)
  assert.equal(fields.aiQuotaPurposeLabel('ai_assistant'), '小青')
  assert.equal(fields.benefitTypeLabel('ai_quota'), 'AI 次数')
  assert.equal(fields.AI_QUOTA_PURPOSES.map((item) => item.value).join(','), 'ai_resume,ai_assistant,ai_interview')
})

await check('用量页挂了按人次数面板，演示模式没有数字也不发请求', async () => {
  const runtime = createReactRuntime()
  let calls = 0
  const panel = load('src/routes/ai-services/AiQuotaUsagePanel.tsx', {
    react: runtime.react,
    'react/jsx-runtime': runtime.jsxRuntime,
    '../../services/api/aiUsageDaily': { AI_USAGE_DAILY_DEMO: true },
    '../../services/api/aiQuotaUsage': { getAdminAiQuotaUsage: () => { calls += 1; return Promise.resolve(null) } },
    '../../services/api/client': { ApiHttpError: class ApiHttpError extends Error {} },
    '../../services/api/userErrorMessage': { userMessageOf: () => '请稍后重试' },
  })
  const tree = await runtime.mount(panel.AiQuotaUsagePanel, {}).settle()
  const text = textOf(tree)
  assert.match(text, /按人次数（今天）/)
  assert.match(text, /演示模式不连接按人次数/)
  assert.doesNotMatch(text, /\d/)
  assert.equal(calls, 0)
  assert.match(read('src/routes/ai-services/AiUsagePanel.tsx'), /<AiQuotaUsagePanel/)
})

function sample(limit) {
  return {
    day: '2026-10-04',
    buckets: [
      { bucket: 'ai_resume', usedTotal: 2, membersUsed: 1, membersExhausted: 1, dailyLimit: 2 },
      { bucket: 'ai_assistant', usedTotal: 1, membersUsed: 1, membersExhausted: 0, dailyLimit: 80 },
      { bucket: 'ai_interview', usedTotal: 5, membersUsed: 1, membersExhausted: 1, dailyLimit: 5 },
    ],
    guest: { perTerminalDailyLimit: limit, terminalsUsed: limit === 0 ? 0 : 1, usedTotal: limit === 0 ? 0 : 1 },
    extra: [
      { bucket: 'ai_resume', remainingTotal: 8, expiringWithin30Days: 1 },
      { bucket: 'ai_assistant', remainingTotal: 2, expiringWithin30Days: 2 },
      { bucket: 'ai_interview', remainingTotal: 0, expiringWithin30Days: 0 },
    ],
  }
}

async function renderLive(summary) {
  const runtime = createReactRuntime()
  const panel = load('src/routes/ai-services/AiQuotaUsagePanel.tsx', {
    react: runtime.react,
    'react/jsx-runtime': runtime.jsxRuntime,
    '../../services/api/aiUsageDaily': { AI_USAGE_DAILY_DEMO: false },
    '../../services/api/aiQuotaUsage': { getAdminAiQuotaUsage: () => Promise.resolve(summary) },
    '../../services/api/client': { ApiHttpError: class ApiHttpError extends Error { constructor(code, message, status) { super(message); this.status = status } } },
    '../../services/api/userErrorMessage': { userMessageOf: (_error, fallback) => fallback },
  })
  return runtime.mount(panel.AiQuotaUsagePanel, { reloadKey: 1 }).settle()
}

await check('按人次数面板只读：关闭时写明需登录，打开时写每台每天，都不能改配置', async () => {
  const closed = await renderLive(sample(0))
  const closedText = textOf(closed)
  assert.match(closedText, /按人次数（今天）/)
  assert.match(closedText, /简历类/)
  assert.match(closedText, /小青/)
  assert.match(closedText, /模拟面试/)
  assert.match(closedText, /已用 2 次/)
  assert.match(closedText, /用过 1 人，用完 1 人/)
  assert.match(closedText, /机构加的次数剩余 8，其中 1 次在 30 天内到期/)
  assert.match(closedText, /游客池：关闭（需登录后使用 AI）。在服务器配置里调整。/)
  assert.equal([...nodesOf(closed)].some((node) => node.type === 'input' || node.type === 'button' || node.type === 'select'), false)

  const openedTree = await renderLive(sample(3))
  const opened = textOf(openedTree)
  assert.match(opened, /游客池：每台每天 3 次/)
  assert.match(opened, /在服务器配置里调整/)
  assert.equal([...nodesOf(openedTree)].some((node) => node.type === 'input' || node.type === 'button' || node.type === 'select'), false)
})

await check('响应只留白名单字段，页面和接口文案没有购买、充值、价格、会员费', () => {
  const client = load('src/services/api/aiQuotaUsage.ts', {
    '@ai-job-print/shared': {},
    './client': { API_BASE_URL: 'https://admin-gate.invalid/api/v1', API_MODE: 'http', ApiHttpError: class ApiHttpError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status } } },
    '../auth': { authHeader: () => ({}), redirectToLogin: () => undefined },
  })
  const leaked = { ...sample(3), endUserId: 'eu-zhou-qiming', phone: '13853241867' }
  leaked.buckets = leaked.buckets.map((row) => ({ ...row, endUserId: 'eu-han-shufen' }))
  const parsed = client.adminAiQuotaUsageFromResponse({ success: true, data: leaked })
  const text = JSON.stringify(parsed)
  assert.equal(text.includes('eu-zhou-qiming'), false)
  assert.equal(text.includes('eu-han-shufen'), false)
  assert.equal(text.includes('13853241867'), false)
  assert.equal(parsed.buckets.length, 3)
  for (const rel of SOURCES) {
    assert.doesNotMatch(read(rel), COMMERCIAL, `${rel} 出现了购买、充值、价格或会员费`)
  }
  assert.match(read('package.json'), /"verify:admin-ai-quota-ui": "node scripts\/verify-admin-ai-quota-ui\.mjs"/)
})

console.log(`\n${passed} PASS  后台 AI 次数发放与按人次数面板`)
