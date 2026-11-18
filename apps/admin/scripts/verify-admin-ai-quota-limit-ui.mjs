/**
 * 后台「每天的免费次数」：保存成功、保存失败、恢复默认。
 * 转译后在本进程里渲染，不连服务、不开浏览器。
 *
 * Run: pnpm --filter @ai-job-print/admin verify:admin-ai-quota-limit-ui
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
  'src/routes/ai-services/AiQuotaLimitPanel.tsx',
  'src/routes/ai-services/AiUsagePanel.tsx',
  'src/services/api/aiQuotaLimits.ts',
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
        if (!Object.is(next, slots[index])) {
          slots[index] = next
          dirty = true
        }
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
  return {
    react,
    jsxRuntime: { Fragment: FRAGMENT, jsx: (type, props) => ({ type, props: props ?? {} }), jsxs: (type, props) => ({ type, props: props ?? {} }) },
    mount,
  }
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
function button(tree, label) {
  for (const node of nodesOf(tree)) {
    if (node.type === 'button' && textOf(node.children) === label) return node
  }
  throw new Error(`没有按钮 ${label}`)
}

class ApiHttpError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

function row(bucket, effective, source, fallback) {
  return { bucket, effective, source, fallback }
}
function config(resume, source = 'default') {
  return {
    buckets: [
      row('ai_resume', resume, source, 20),
      row('ai_assistant', 80, 'default', 80),
      row('ai_interview', 5, 'default', 5),
    ],
  }
}

function panelOf(runtime, api) {
  return load('src/routes/ai-services/AiQuotaLimitPanel.tsx', {
    react: runtime.react,
    'react/jsx-runtime': runtime.jsxRuntime,
    '../../services/api/aiQuotaLimits': { AI_QUOTA_LIMITS_DEMO: false, ...api },
    '../../services/api/client': { ApiHttpError },
    '../../services/api/userErrorMessage': {
      userMessageOf: (error, fallback) => (error instanceof Error && error.message ? error.message : fallback),
    },
  })
}

console.log('\n=== 后台每天的免费次数 ===')

await check('保存成功：按服务端返回显示，并通知用量面板重读', async () => {
  const runtime = createReactRuntime()
  let changed = 0
  let sent = null
  const panel = panelOf(runtime, {
    getAiQuotaLimits: () => Promise.resolve(config(20)),
    updateAiQuotaLimits: (input) => {
      sent = input
      return Promise.resolve(config(9, 'admin'))
    },
    resetAiQuotaLimits: () => Promise.reject(new Error('这条用例不恢复默认')),
  })
  const view = runtime.mount(panel.AiQuotaLimitPanel, { onChanged: () => { changed += 1 } })
  const loaded = await view.settle()
  assert.match(textOf(loaded), /当前生效 20 次，来源：缺省，默认 20 次/)
  button(loaded, '保存').props.onClick()
  const saved = await view.settle()
  const text = textOf(saved)
  assert.equal(sent.ai_resume, 20)
  assert.match(text, /已保存，并记入审计。/)
  assert.match(text, /当前生效 9 次，来源：后台保存的，默认 20 次/)
  assert.equal(changed, 1)
})

await check('保存失败：照实提示，当前生效值不变，不通知用量面板', async () => {
  const runtime = createReactRuntime()
  let changed = 0
  const panel = panelOf(runtime, {
    getAiQuotaLimits: () => Promise.resolve(config(20, 'env')),
    updateAiQuotaLimits: () => Promise.reject(new ApiHttpError('AI_QUOTA_LIMIT_INVALID', '服务端拒绝了这次修改', 400)),
    resetAiQuotaLimits: () => Promise.reject(new Error('这条用例不恢复默认')),
  })
  const view = runtime.mount(panel.AiQuotaLimitPanel, { onChanged: () => { changed += 1 } })
  const loaded = await view.settle()
  button(loaded, '保存').props.onClick()
  const failed = await view.settle()
  const text = textOf(failed)
  assert.match(text, /服务端拒绝了这次修改/)
  assert.match(text, /当前生效 20 次，来源：服务器配置，默认 20 次/)
  assert.equal(text.includes('已保存，并记入审计。'), false)
  assert.equal([...nodesOf(failed)].some((node) => node.props?.role === 'alert'), true)
  assert.equal(changed, 0)
})

await check('恢复默认：显示缺省，并通知用量面板重读', async () => {
  const runtime = createReactRuntime()
  let changed = 0
  const panel = panelOf(runtime, {
    getAiQuotaLimits: () => Promise.resolve(config(9, 'admin')),
    updateAiQuotaLimits: () => Promise.reject(new Error('这条用例不保存')),
    resetAiQuotaLimits: () => Promise.resolve(config(20, 'default')),
  })
  const view = runtime.mount(panel.AiQuotaLimitPanel, { onChanged: () => { changed += 1 } })
  const loaded = await view.settle()
  assert.match(textOf(loaded), /来源：后台保存的/)
  button(loaded, '恢复默认').props.onClick()
  const restored = await view.settle()
  const text = textOf(restored)
  assert.match(text, /已恢复默认，并记入审计。/)
  assert.match(text, /当前生效 20 次，来源：缺省，默认 20 次/)
  assert.equal(text.includes('后台保存的'), false)
  assert.equal(changed, 1)
})

await check('改完上限后，用量面板跟着重读并显示新的每人每天次数', async () => {
  const runtime = createReactRuntime()
  let limit = 20
  let reads = 0
  const usage = load('src/routes/ai-services/AiQuotaUsagePanel.tsx', {
    react: runtime.react,
    'react/jsx-runtime': runtime.jsxRuntime,
    '@ai-job-print/shared': {},
    '../../services/api/aiUsageDaily': { AI_USAGE_DAILY_DEMO: false },
    '../../services/api/aiQuotaUsage': {
      getAdminAiQuotaUsage: () => {
        reads += 1
        return Promise.resolve({
          day: '2026-11-17',
          buckets: [
            { bucket: 'ai_resume', usedTotal: 1, membersUsed: 1, membersExhausted: 0, dailyLimit: limit },
            { bucket: 'ai_assistant', usedTotal: 0, membersUsed: 0, membersExhausted: 0, dailyLimit: 80 },
            { bucket: 'ai_interview', usedTotal: 0, membersUsed: 0, membersExhausted: 0, dailyLimit: 5 },
          ],
          guest: { perTerminalDailyLimit: 0, terminalsUsed: 0, usedTotal: 0 },
          extra: ['ai_resume', 'ai_assistant', 'ai_interview'].map((bucketName) => ({ bucket: bucketName, remainingTotal: 0, expiringWithin30Days: 0 })),
        })
      },
    },
    '../../services/api/client': { ApiHttpError },
    '../../services/api/userErrorMessage': { userMessageOf: () => '请稍后重试' },
  })
  const props = { reloadKey: 0 }
  const view = runtime.mount(usage.AiQuotaUsagePanel, props)
  const first = textOf(await view.settle())
  assert.match(first, /每人每天 20 次/)
  limit = 11
  props.reloadKey = 1
  const second = textOf(await view.settle())
  assert.match(second, /每人每天 11 次/)
  assert.equal(second.includes('每人每天 20 次'), false)
  assert.equal(reads, 2)
  const page = read('src/routes/ai-services/AiUsagePanel.tsx')
  assert.match(page, /<AiQuotaLimitPanel onChanged=\{\(\) => setReloadSeq\(\(value\) => value \+ 1\)\} \/>/)
  assert.match(page, /<AiQuotaUsagePanel reloadKey=\{reloadSeq\} \/>/)
})

await check('演示模式不显示次数，文案不含购买、充值、价格、会员费', async () => {
  const runtime = createReactRuntime()
  let calls = 0
  const panel = panelOf(runtime, {
    AI_QUOTA_LIMITS_DEMO: true,
    getAiQuotaLimits: () => { calls += 1; return Promise.resolve(config(20)) },
    updateAiQuotaLimits: () => { calls += 1; return Promise.resolve(config(9, 'admin')) },
    resetAiQuotaLimits: () => { calls += 1; return Promise.resolve(config(20)) },
  })
  // panelOf 先展开了 false。演示开关要盖住它。
  const demo = load('src/routes/ai-services/AiQuotaLimitPanel.tsx', {
    react: runtime.react,
    'react/jsx-runtime': runtime.jsxRuntime,
    '../../services/api/aiQuotaLimits': {
      AI_QUOTA_LIMITS_DEMO: true,
      getAiQuotaLimits: () => { calls += 1; return Promise.resolve(config(20)) },
      updateAiQuotaLimits: () => { calls += 1; return Promise.resolve(config(1, 'admin')) },
      resetAiQuotaLimits: () => { calls += 1; return Promise.resolve(config(20)) },
    },
    '../../services/api/client': { ApiHttpError },
    '../../services/api/userErrorMessage': { userMessageOf: () => '请稍后重试' },
  })
  const tree = await runtime.mount(demo.AiQuotaLimitPanel, {}).settle()
  const text = textOf(tree)
  assert.match(text, /演示模式不连接每天的免费次数，请连接真实后端后再改。/)
  assert.doesNotMatch(text, /\d/)
  assert.equal(calls, 0)
  assert.equal(typeof panel.AiQuotaLimitPanel, 'function')
  for (const rel of SOURCES) assert.doesNotMatch(read(rel), COMMERCIAL, `${rel} 出现了购买、充值、价格或会员费`)
  assert.match(read('package.json'), /"verify:admin-ai-quota-limit-ui": "node scripts\/verify-admin-ai-quota-limit-ui\.mjs"/)
})

console.log(`\n${passed} PASS  后台每天的免费次数`)
