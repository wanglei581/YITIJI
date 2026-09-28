// Admin「AI 服务开关」面板门禁（D6 一键暂停与全机维护 + C6 使用声明 + C7 登录档位）。
//
// 不靠搜几个字符串过关：适配器与面板都在本进程里真跑（TypeScript 转译 + 最小 hooks 运行时），
// 不连服务、不开浏览器。
//   A. 服务端事实：路径、角色、档位取值、事由上限、提示原话、维护模式拦截的接口，逐项从
//      services/api/src 读出来对照。服务端改了这里先红，免得面板说明与真实行为脱节。
//   B. aiAccess.ts 适配器：GET / PUT /admin/ai-access；PUT 请求体只带本次字段和去空白后的事由；
//      缺事由或超长不发请求；401 跳登录；403 保留状态码；返回形状不对就报错；mock 默认四项全关。
//   C. AiAccessSwitchesPanel.tsx 真渲染：读取中 / 非管理员 / 读取失败 / 正常；事由必填；更严格的方向
//      要勾确认；提交中禁用；成功提示只在服务端返回且值一致之后出现；不做乐观更新；声明与登录两项
//      旁写明一体机要先更新；表单控件都有 id 与 label。
//   D. ai-services/index.tsx：加载中、加载失败、正常三个返回分支都把面板放在 <Page> 的第一个子元素。
//
// Run: pnpm --filter @ai-job-print/admin verify:admin-ai-access-ui

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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

// ─── 转译加载：依赖逐个登记，没登记的一律报错 ─────────────────────────────────
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
  const names = Object.keys(globals)
  new Function('module', 'exports', 'require', ...names, outputText)(
    module, module.exports, requireStub, ...names.map((name) => globals[name]),
  )
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
const userErrorMessage = load('src/services/api/userErrorMessage.ts', { './client': clientStub('http') })

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
    raw: (key) => map.get(key),
  }
}

function loadService(mode, respond) {
  const calls = []
  const redirects = []
  const fetchStub = async (url, init = {}) => {
    calls.push({ url, init })
    if (!respond) throw new Error('这个用例不该发请求')
    return respond(url, init)
  }
  const storage = memoryStorage()
  const service = load('src/services/api/aiAccess.ts', {
    './client': clientStub(mode),
    '../auth': { authHeader: () => ({ Authorization: 'Bearer gate-admin-token' }), redirectToLogin: () => redirects.push(1) },
  }, { fetch: fetchStub, window: { localStorage: storage, location: { pathname: '/ai-services', href: '' } } })
  return { service, calls, redirects, storage }
}

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const OFF = Object.freeze({ loginGate: 'off', declarationEnforced: false, paused: false, maintenance: false })

async function rejection(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('预期失败，实际成功了')
}

// ─── A. 服务端事实 ──────────────────────────────────────────────────────────
const controllerSource = read('services/api/src/ai-access/admin-ai-access.controller.ts', repoRoot)
const accessServiceSource = read('services/api/src/ai-access/ai-access.service.ts', repoRoot)

function serverMessage(code) {
  const match = new RegExp(`code: '${code}', message: '([^']+)'`).exec(accessServiceSource)
  assert.ok(match, `ai-access.service.ts 里找不到 ${code} 的提示原话`)
  return match[1]
}

/** 维护模式拦截的接口 → 面板里的叫法。服务端增减 @MaintenanceBlocked() 时先改面板说明，再改这张表。 */
const MAINTENANCE_LABELS = {
  'POST /me/print-orders': '会员打印下单',
  'POST /orders/package': '材料包下单',
  'POST /print/convert/images-to-pdf': '格式转换',
  'POST /print/jobs': '打印任务创建',
  'POST /scan/sessions': '扫描任务创建',
  'POST /upload-sessions': '上传会话创建',
}

function* serverSourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'generated', '__tests__'].includes(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* serverSourceFiles(full)
    else if (entry.name.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(entry.name)) yield full
  }
}

const decoratorName = (decorator) => {
  const expr = decorator.expression
  return ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) ? expr.expression.text : null
}
const decoratorPath = (decorator) => {
  const arg = decorator && ts.isCallExpression(decorator.expression) ? decorator.expression.arguments[0] : undefined
  if (!arg) return ''
  return ts.isStringLiteralLike(arg) ? arg.text : `<非字面量 ${arg.getText()}>`
}
const joinRoute = (...parts) => `/${parts.flatMap((part) => part.split('/')).filter(Boolean).join('/')}`

function maintenanceBlockedRoutes() {
  const routes = []
  for (const file of serverSourceFiles(resolve(repoRoot, 'services/api/src'))) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('MaintenanceBlocked()')) continue
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
    const visit = (node) => {
      if (ts.isClassDeclaration(node)) {
        const decorators = ts.getDecorators(node) ?? []
        const base = decoratorPath(decorators.find((d) => decoratorName(d) === 'Controller'))
        if (decorators.some((d) => decoratorName(d) === 'MaintenanceBlocked')) routes.push(`整个控制器 ${joinRoute(base)}`)
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue
          const methodDecorators = ts.getDecorators(member) ?? []
          if (!methodDecorators.some((d) => decoratorName(d) === 'MaintenanceBlocked')) continue
          const verb = methodDecorators.find((d) => ['Get', 'Post', 'Put', 'Patch', 'Delete'].includes(decoratorName(d)))
          routes.push(`${verb ? decoratorName(verb).toUpperCase() : '无 HTTP 方法'} ${joinRoute(base, decoratorPath(verb))}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return routes.sort()
}

console.log('\n=== Admin AI 服务开关面板门禁 ===')

const PAUSED_MESSAGE = serverMessage('AI_PAUSED')
const MAINTENANCE_MESSAGE = serverMessage('MAINTENANCE_MODE')
const httpModule = loadService('http').service

await check('A1 服务端事实：GET/PUT /admin/ai-access 只给 admin；档位取值与事由上限与面板常量一致', () => {
  assert.match(controllerSource, /@Controller\('admin\/ai-access'\)/, '控制器路径变了')
  assert.match(controllerSource, /@Get\(\)/, '缺 GET')
  assert.match(controllerSource, /@Put\(\)/, '缺 PUT')
  assert.match(controllerSource, /@Roles\('admin'\)/, '不再只限 admin')
  const gates = /@IsIn\(\[([^\]]*)\]\)\s*loginGate/.exec(controllerSource)
  assert.ok(gates, '找不到 loginGate 的 @IsIn')
  assert.deepEqual([...gates[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), [...httpModule.AI_LOGIN_GATES], '登录档位取值与服务端不一致')
  const max = /@MaxLength\((\d+)\)\s*reason/.exec(controllerSource)
  assert.ok(max, '找不到 reason 的 @MaxLength')
  assert.equal(Number(max[1]), httpModule.AI_ACCESS_REASON_MAX, '事由上限与服务端不一致')
  assert.match(accessServiceSource, /code: 'REASON_REQUIRED'/, '服务端不再校验事由')
})

await check('A2 服务端事实：维护模式拦截的接口正好是面板列出的六个', () => {
  assert.deepEqual(
    maintenanceBlockedRoutes(),
    Object.keys(MAINTENANCE_LABELS).sort(),
    '服务端 @MaintenanceBlocked() 的接口变了：先改面板「全机维护」的说明与确认文字，再改本门禁的 MAINTENANCE_LABELS',
  )
})

// ─── B. 适配器 ──────────────────────────────────────────────────────────────
await check('B1 http：GET /admin/ai-access 带管理员令牌，按 { success, data } 取四项', async () => {
  const { service, calls } = loadService('http', () => reply(200, { success: true, data: { ...OFF, maintenance: true } }))
  assert.deepEqual(await service.getAiAccessConfig(), { ...OFF, maintenance: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${API_BASE}/admin/ai-access`)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer gate-admin-token')
  assert.equal(calls[0].init.body, undefined)
  assert.equal(service.AI_ACCESS_DEMO, false, 'http 模式不能标演示数据')
})

await check('B2 http：PUT 请求体只带本次字段和去空白后的事由，返回值取自服务端响应', async () => {
  const { service, calls } = loadService('http', () => reply(200, { success: true, data: { ...OFF, paused: true, loginGate: 'before_export' } }))
  const result = await service.updateAiAccessConfig({ paused: true }, '  模型服务商故障，先暂停  ')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${API_BASE}/admin/ai-access`)
  assert.equal(calls[0].init.method, 'PUT')
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer gate-admin-token')
  assert.deepEqual(JSON.parse(calls[0].init.body), { paused: true, reason: '模型服务商故障，先暂停' })
  assert.deepEqual(result, { ...OFF, paused: true, loginGate: 'before_export' }, '返回值必须是服务端响应里的四项')
})

await check('B3 http：事由去空白后为空或超过 200 字、或没有要切的字段，都不发请求', async () => {
  for (const [patch, reason, code] of [
    [{ paused: true }, '', 'REASON_REQUIRED'],
    [{ paused: true }, ' \n\t ', 'REASON_REQUIRED'],
    [{ maintenance: true }, '事'.repeat(201), 'REASON_TOO_LONG'],
    [{}, '有事由但没字段', 'NOTHING_TO_CHANGE'],
  ]) {
    const { service, calls } = loadService('http', () => reply(200, { success: true, data: OFF }))
    const error = await rejection(service.updateAiAccessConfig(patch, reason))
    assert.equal(error.code, code)
    assert.equal(error.status, 400)
    assert.equal(calls.length, 0, `${code} 时不能发请求`)
  }
  const { service, calls } = loadService('http', () => reply(200, { success: true, data: OFF }))
  await service.updateAiAccessConfig({ maintenance: false }, '事'.repeat(200))
  assert.equal(calls.length, 1, '正好 200 字要允许提交')
})

await check('B4 http：401 跳登录；403、400 保留状态码与服务端说明；网络失败与形状不对都报错', async () => {
  const unauthorized = loadService('http', () => reply(401, { error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' } }))
  assert.equal((await rejection(unauthorized.service.getAiAccessConfig())).status, 401)
  assert.equal(unauthorized.redirects.length, 1, '401 必须跳登录')

  const forbidden = loadService('http', () => reply(403, { error: { code: 'AUTH_ROLE_FORBIDDEN', message: '当前角色无权访问 (需要: admin)' } }))
  const forbiddenError = await rejection(forbidden.service.updateAiAccessConfig({ paused: true }, '演练'))
  assert.equal(forbiddenError.status, 403)
  assert.equal(forbiddenError.code, 'AUTH_ROLE_FORBIDDEN')
  assert.equal(forbidden.redirects.length, 0, '403 不是登录过期，不能跳登录')

  const badRequest = loadService('http', () => reply(400, { error: { code: 'REASON_REQUIRED', message: '请填写切换事由' } }))
  const badRequestError = await rejection(badRequest.service.updateAiAccessConfig({ paused: true }, '演练'))
  assert.equal(badRequestError.message, '请填写切换事由')

  const offline = loadService('http', () => { throw new TypeError('Failed to fetch') })
  const offlineError = await rejection(offline.service.getAiAccessConfig())
  assert.equal(offlineError.code, 'NETWORK_ERROR')
  assert.equal(offlineError.status, 0)

  for (const body of [{ success: true }, { success: true, data: { ...OFF, loginGate: 'always' } }, { success: true, data: { ...OFF, paused: 'on' } }]) {
    const malformed = loadService('http', () => reply(200, body))
    assert.equal((await rejection(malformed.service.getAiAccessConfig())).code, 'UNEXPECTED_RESPONSE')
  }
})

await check('B5 mock：默认四项全关、不发请求；切换写回本浏览器并重新读出；缺事由不写；可模拟 403', async () => {
  const { service, calls, storage } = loadService('mock')
  assert.equal(service.AI_ACCESS_DEMO, true, 'mock 模式必须标演示数据')
  assert.deepEqual(await service.getAiAccessConfig(), OFF)
  assert.deepEqual(await service.updateAiAccessConfig({ maintenance: true }, '演练全机维护'), { ...OFF, maintenance: true })
  assert.deepEqual(JSON.parse(storage.raw(service.MOCK_AI_ACCESS_KEY)), { ...OFF, maintenance: true })
  const error = await rejection(service.updateAiAccessConfig({ paused: true }, '   '))
  assert.equal(error.code, 'REASON_REQUIRED')
  assert.deepEqual(await service.getAiAccessConfig(), { ...OFF, maintenance: true }, '缺事由时不能改演示数据')
  storage.setItem(service.MOCK_AI_ACCESS_SIMULATE_KEY, 'forbidden')
  assert.equal((await rejection(service.getAiAccessConfig())).status, 403)
  assert.equal(calls.length, 0, 'mock 模式不能发请求')
})

// ─── C. 面板真渲染（最小 hooks 运行时） ───────────────────────────────────────
const FRAGMENT = Symbol('Fragment')

function createReactRuntime() {
  const slots = []
  const effectSlots = new Set()
  let cursor = 0
  let rendering = false
  let dirty = false
  let pending = []
  const changed = (prev, next) => !prev || !next || prev.length !== next.length || next.some((v, i) => !Object.is(v, prev[i]))
  const nextSlot = () => {
    if (!rendering) throw new Error('只有面板组件本身可以调用 hooks：门禁运行时里子组件没有独立状态')
    return cursor++
  }
  const react = {
    useState(initial) {
      const i = nextSlot()
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], (value) => {
        const next = typeof value === 'function' ? value(slots[i]) : value
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true }
      }]
    },
    useRef(initial) {
      const i = nextSlot()
      if (!(i in slots)) slots[i] = { current: initial }
      return slots[i]
    },
    useMemo(factory, deps) {
      const i = nextSlot()
      if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: factory(), deps }
      return slots[i].value
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps) },
    useEffect(effect, deps) {
      const i = nextSlot()
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
  const element = (type, props) => ({ type, props: props ?? {} })

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
      /** 先渲染一次让副作用发出请求，等异步回来，再渲染出结果。 */
      async settle() {
        render()
        for (let k = 0; k < 10; k += 1) await new Promise((done) => setImmediate(done))
        return render()
      },
      unmount() { for (const i of effectSlots) slots[i]?.cleanup?.() },
    }
  }
  return { react, jsxRuntime: { Fragment: FRAGMENT, jsx: element, jsxs: element }, mount }
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
const submitButton = (tree) => find(tree, (node) => node.type === 'button' && node.props.type === 'submit')[0]
const rowOf = (tree, key) => {
  const row = byId(tree, `ai-access-row-${key}`)
  assert.ok(row, `找不到「${key}」这一行`)
  return row
}
const rowText = (tree, key) => textOf(rowOf(tree, key).children)
const badgeOf = (tree, key) => textOf(find(rowOf(tree, key).children, (node) => 'data-badge' in node.props)[0]?.children ?? [])

const iconStub = new Proxy({}, { get: (_, name) => (typeof name === 'string' && name.endsWith('Icon') ? () => null : undefined) })
const uiStub = { StatusBadge: ({ label, status }) => ({ type: 'span', props: { 'data-badge': status ?? 'default', children: label } }) }

function deferred() {
  let resolveFn
  let rejectFn
  const promise = new Promise((resolvePromise, rejectPromise) => { resolveFn = resolvePromise; rejectFn = rejectPromise })
  return { promise, resolve: resolveFn, reject: rejectFn }
}

function mountPanel({ demo = false, get, update } = {}) {
  const runtime = createReactRuntime()
  const calls = { get: 0, update: [] }
  const handlers = {
    get: get ?? (async () => ({ ...OFF })),
    update: update ?? (async () => { throw new Error('这个用例没有预期提交') }),
  }
  const panel = load('src/routes/ai-services/AiAccessSwitchesPanel.tsx', {
    react: runtime.react,
    'react/jsx-runtime': runtime.jsxRuntime,
    '@ai-job-print/ui': uiStub,
    'lucide-react': iconStub,
    '../../services/api/aiAccess': {
      ...httpModule,
      AI_ACCESS_DEMO: demo,
      getAiAccessConfig: () => { calls.get += 1; return handlers.get() },
      updateAiAccessConfig: (patch, reason) => { calls.update.push({ patch, reason }); return handlers.update(patch, reason) },
    },
    '../../services/api/client': clientStub('http'),
    '../../services/api/userErrorMessage': userErrorMessage,
  })
  assert.equal(typeof panel.AiAccessSwitchesPanel, 'function', '面板必须具名导出 AiAccessSwitchesPanel')
  return { view: runtime.mount(panel.AiAccessSwitchesPanel), calls, handlers }
}

const act = {
  click(node) {
    assert.ok(node, '找不到要点的按钮')
    assert.notEqual(node.props.disabled, true, `按钮「${textOf(node.children)}」是禁用的`)
    node.props.onClick()
  },
  type(tree, id, value) {
    const node = byId(tree, id)
    assert.ok(node, `找不到 #${id}`)
    node.props.onChange({ target: { value } })
  },
  tick(tree, id, checked) {
    const node = byId(tree, id)
    assert.ok(node, `找不到 #${id}`)
    node.props.onChange({ target: { checked } })
  },
  /** 直接触发表单提交（等于回车或绕过禁用按钮），检验提交函数自己也守住条件。 */
  submit(tree) {
    const form = find(tree, (node) => node.type === 'form')[0]
    assert.ok(form, '没有切换表单')
    form.props.onSubmit({ preventDefault() {} })
  },
}

/** 打开某一项的切换表单、填事由、按需勾确认，返回渲染树。 */
function prepareChange(panel, tree, label, reason, { confirm = true } = {}) {
  act.click(buttons(tree, label)[0])
  let next = panel.view.render()
  act.type(next, 'ai-access-reason', reason)
  next = panel.view.render()
  if (confirm) {
    act.tick(next, 'ai-access-confirm', true)
    next = panel.view.render()
  }
  return next
}

await check('C1 读取中不出任何开关；读完四项按服务端返回显示，说明与服务端原话、维护拦截清单一致', async () => {
  const pendingGet = deferred()
  const panel = mountPanel({ get: () => pendingGet.promise })
  let tree = panel.view.render()
  assert.match(textOf(tree), /正在读取 AI 服务开关/)
  assert.equal(find(tree, (node) => node.type === 'button').length, 0, '读取完成前不能出现开关按钮')
  pendingGet.resolve({ loginGate: 'before_export', declarationEnforced: true, paused: false, maintenance: true })
  tree = await panel.view.settle()
  assert.equal(panel.calls.get, 1)
  assert.equal(badgeOf(tree, 'paused'), 'AI 正常')
  assert.equal(badgeOf(tree, 'maintenance'), '维护中')
  assert.equal(badgeOf(tree, 'loginGate'), '导出、打印前登录')
  assert.equal(badgeOf(tree, 'declarationEnforced'), '已要求声明')
  assert.ok(rowText(tree, 'paused').includes(PAUSED_MESSAGE), `「AI 暂停」说明要引用服务端原话「${PAUSED_MESSAGE}」`)
  assert.ok(rowText(tree, 'maintenance').includes(MAINTENANCE_MESSAGE), `「全机维护」说明要引用服务端原话「${MAINTENANCE_MESSAGE}」`)
  for (const label of Object.values(MAINTENANCE_LABELS)) {
    assert.ok(rowText(tree, 'maintenance').includes(label), `「全机维护」说明漏了「${label}」`)
  }
})

await check('C2 声明、登录档位两项旁写明一体机要先更新、否则直接报错；暂停与维护两项没有这句', async () => {
  const panel = mountPanel()
  const tree = await panel.view.settle()
  for (const key of ['loginGate', 'declarationEnforced']) {
    assert.match(rowText(tree, key), /一体机要先更新到/)
    assert.match(rowText(tree, key), /会直接报错/)
  }
  assert.match(rowText(tree, 'declarationEnforced'), /AI 按钮下显示声明/)
  assert.match(rowText(tree, 'loginGate'), /去登录/)
  for (const key of ['paused', 'maintenance']) assert.doesNotMatch(rowText(tree, key), /一体机要先更新到/)
})

await check('C3 底部写明保存一年、到期回到服务器配置；只有 mock 才标「演示数据」', async () => {
  const live = await mountPanel().view.settle()
  assert.match(textOf(live), /后台切换保存一年，到期回到服务器配置文件里的值/)
  assert.match(textOf(live), /长期设置也请写进服务器配置/)
  assert.doesNotMatch(textOf(live), /演示数据/)
  assert.match(textOf(await mountPanel({ demo: true }).view.settle()), /演示数据/)
})

await check('C4 事由必填：空白、超过 200 字都不能提交；更严格的方向还必须勾确认', async () => {
  const panel = mountPanel()
  let tree = await panel.view.settle()
  act.click(buttons(tree, '暂停 AI')[0])
  tree = panel.view.render()
  assert.equal(submitButton(tree).props.disabled, true, '刚打开时提交按钮必须禁用')
  act.tick(tree, 'ai-access-confirm', true)
  tree = panel.view.render()
  for (const reason of ['', '   ', '\n\t ', '事'.repeat(201)]) {
    act.type(tree, 'ai-access-reason', reason)
    tree = panel.view.render()
    assert.equal(submitButton(tree).props.disabled, true, `事由「${reason.slice(0, 8)}」时提交按钮必须禁用`)
    act.submit(tree)
    tree = panel.view.render()
    assert.equal(panel.calls.update.length, 0, `事由「${reason.slice(0, 8)}」时不能发出切换`)
  }
  act.type(tree, 'ai-access-reason', ' 模型服务商故障，先暂停 ')
  act.tick(tree, 'ai-access-confirm', false)
  tree = panel.view.render()
  assert.equal(submitButton(tree).props.disabled, true, '没勾确认时提交按钮必须禁用')
  act.submit(tree)
  assert.equal(panel.calls.update.length, 0, '没勾确认时不能发出切换')
  act.tick(panel.view.render(), 'ai-access-confirm', true)
  assert.equal(submitButton(panel.view.render()).props.disabled, false, '事由合格且已确认后才能提交')
})

await check('C5 提交中全部禁用；成功提示只在服务端返回之后出现；显示的是服务端返回的四项，不做乐观更新', async () => {
  const pendingUpdate = deferred()
  const panel = mountPanel({ update: () => pendingUpdate.promise })
  let tree = prepareChange(panel, await panel.view.settle(), '暂停 AI', ' 模型服务商故障，先暂停 ')
  act.submit(tree)
  tree = panel.view.render()
  assert.deepEqual(panel.calls.update, [{ patch: { paused: true }, reason: '模型服务商故障，先暂停' }])
  assert.equal(submitButton(tree).props.disabled, true)
  assert.match(textOf(submitButton(tree).children), /提交中/)
  assert.equal(buttons(tree, '取消')[0].props.disabled, true)
  assert.equal(byId(tree, 'ai-access-reason').props.disabled, true)
  for (const node of find(tree, (n) => n.type === 'button')) assert.equal(node.props.disabled, true, `提交中「${textOf(node.children)}」必须禁用`)
  assert.doesNotMatch(textOf(tree), /已切换/, '服务端还没返回就出现了成功提示')
  assert.equal(badgeOf(tree, 'paused'), 'AI 正常', '服务端还没返回就改了显示（乐观更新）')
  pendingUpdate.resolve({ ...OFF, paused: true, maintenance: true })
  tree = await panel.view.settle()
  assert.match(textOf(tree), /已切换，约 30 秒内全部生效/)
  assert.equal(badgeOf(tree, 'paused'), '已暂停')
  assert.equal(badgeOf(tree, 'maintenance'), '维护中', '显示必须以服务端返回的四项为准')
  assert.equal(find(tree, (node) => node.type === 'form').length, 0, '成功后收起表单')
})

await check('C6 服务端返回值与这次要切的不一致：不说已切换，提示核对', async () => {
  const panel = mountPanel({ update: async () => ({ ...OFF }) })
  act.submit(prepareChange(panel, await panel.view.settle(), '暂停 AI', '演练'))
  const tree = await panel.view.settle()
  assert.doesNotMatch(textOf(tree), /已切换/)
  assert.match(textOf(tree), /与这次要切换的不一致/)
  assert.equal(badgeOf(tree, 'paused'), 'AI 正常')
})

await check('C7 提交失败：显示服务端说明、状态不变、表单留着可重试', async () => {
  const panel = mountPanel({ update: async () => { throw new ApiHttpError('REASON_REQUIRED', '请填写切换事由', 400) } })
  act.submit(prepareChange(panel, await panel.view.settle(), '开启全机维护', '演练'))
  const tree = await panel.view.settle()
  const alerts = find(tree, (node) => node.props.role === 'alert').map((node) => textOf(node.children))
  assert.ok(alerts.some((text) => text.includes('请填写切换事由')), '要显示服务端的错误说明')
  assert.doesNotMatch(textOf(tree), /已切换/)
  assert.equal(badgeOf(tree, 'maintenance'), '未维护')
  assert.equal(byId(tree, 'ai-access-reason').props.value, '演练', '失败后保留已填事由')
  assert.equal(submitButton(tree).props.disabled, false, '失败后可以重试')
})

await check('C8 非管理员：读取或提交遇到 403 都只显示「只有管理员可以查看和切换」，不渲染开关', async () => {
  const forbidden = () => new ApiHttpError('AUTH_ROLE_FORBIDDEN', '当前角色无权访问 (需要: admin)', 403)
  const onRead = mountPanel({ get: async () => { throw forbidden() } })
  const onUpdate = mountPanel({ update: async () => { throw forbidden() } })
  act.submit(prepareChange(onUpdate, await onUpdate.view.settle(), '暂停 AI', '演练'))
  for (const tree of [await onRead.view.settle(), await onUpdate.view.settle()]) {
    assert.match(textOf(tree), /只有管理员可以查看和切换/)
    assert.equal(find(tree, (node) => ['button', 'input', 'textarea', 'select', 'form'].includes(node.type)).length, 0)
    assert.equal(find(tree, (node) => String(node.props.id ?? '').startsWith('ai-access-row-')).length, 0)
  }
})

await check('C9 读取失败：说明原因，可以重新读取', async () => {
  let attempt = 0
  const panel = mountPanel({
    get: async () => {
      attempt += 1
      if (attempt === 1) throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
      return { ...OFF }
    },
  })
  let tree = await panel.view.settle()
  assert.match(textOf(tree), /AI 服务开关读取失败：网络连接失败/)
  assert.equal(find(tree, (node) => String(node.props.id ?? '').startsWith('ai-access-row-')).length, 0)
  act.click(buttons(tree, '重新读取')[0])
  tree = await panel.view.settle()
  assert.equal(panel.calls.get, 2)
  assert.equal(badgeOf(tree, 'paused'), 'AI 正常')
})

await check('C10 更严格才要确认（确认文字写明后果）；放宽不要；每项只提交自己的字段', async () => {
  const strict = [
    ['暂停 AI', { paused: true }, /会被拒绝/],
    ['开启全机维护', { maintenance: true }, /会被拒绝/],
    ['开始要求声明', { declarationEnforced: true }, /会被拒绝[\s\S]*一体机[\s\S]*会直接报错/],
    ['改为“导出、打印前登录”', { loginGate: 'before_export' }, /会被拒绝[\s\S]*一体机[\s\S]*会直接报错/],
    ['改为“使用 AI 前登录”', { loginGate: 'before_generate' }, /会被拒绝[\s\S]*一体机[\s\S]*会直接报错/],
  ]
  for (const [label, patch, consequence] of strict) {
    const panel = mountPanel({ update: async (sent) => ({ ...OFF, ...sent }) })
    const tree = prepareChange(panel, await panel.view.settle(), label, '演练', { confirm: false })
    const confirm = find(tree, (node) => node.type === 'label' && node.props.htmlFor === 'ai-access-confirm')[0]
    assert.ok(confirm, `「${label}」是更严格的方向，必须有确认框`)
    assert.match(textOf(confirm.children), consequence, `「${label}」的确认文字要写明后果`)
    assert.equal(submitButton(tree).props.disabled, true)
    act.tick(tree, 'ai-access-confirm', true)
    act.submit(panel.view.render())
    assert.deepEqual(panel.calls.update[0], { patch, reason: '演练' })
    assert.match(textOf(await panel.view.settle()), /已切换/)
  }
  const relaxed = [
    ['恢复 AI', { paused: false }],
    ['结束维护', { maintenance: false }],
    ['不再要求声明', { declarationEnforced: false }],
    ['改为“导出、打印前登录”', { loginGate: 'before_export' }],
    ['改为“不要求登录”', { loginGate: 'off' }],
  ]
  const strictest = { loginGate: 'before_generate', declarationEnforced: true, paused: true, maintenance: true }
  for (const [label, patch] of relaxed) {
    const panel = mountPanel({ get: async () => ({ ...strictest }), update: async (sent) => ({ ...strictest, ...sent }) })
    const tree = prepareChange(panel, await panel.view.settle(), label, '恢复', { confirm: false })
    assert.equal(byId(tree, 'ai-access-confirm'), undefined, `「${label}」是放宽，不需要确认框`)
    assert.equal(submitButton(tree).props.disabled, false)
    act.submit(tree)
    assert.deepEqual(panel.calls.update[0], { patch, reason: '恢复' })
  }
  const offPanel = mountPanel()
  assert.equal(buttons(await offPanel.view.settle(), '改为“不要求登录”').length, 0, '当前档位不应再出现「改为」自己')
})

await check('C11 表单控件都有 id，并有 htmlFor 指向它的 label', async () => {
  const panel = mountPanel()
  let tree = await panel.view.settle()
  act.click(buttons(tree, '暂停 AI')[0])
  tree = panel.view.render()
  const controls = find(tree, (node) => ['input', 'textarea', 'select'].includes(node.type))
  assert.ok(controls.length >= 2, '切换表单至少有事由输入框和确认框')
  for (const control of controls) {
    assert.ok(control.props.id, `${control.type} 没有 id`)
    const labels = find(tree, (node) => node.type === 'label' && node.props.htmlFor === control.props.id)
    assert.equal(labels.length, 1, `#${control.props.id} 需要且只需要一个 label`)
    assert.ok(textOf(labels[0].children).trim(), `#${control.props.id} 的 label 不能是空的`)
  }
})

// ─── D. AI 服务管理页三个分支 ─────────────────────────────────────────────────
await check('D1 AI 服务管理页：加载中、加载失败、正常三个分支都把面板放在 <Page> 的第一个子元素', () => {
  const source = read('src/routes/ai-services/index.tsx')
  const sourceFile = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const imported = sourceFile.statements.some((statement) =>
    ts.isImportDeclaration(statement)
    && statement.moduleSpecifier.text === './AiAccessSwitchesPanel'
    && statement.importClause?.namedBindings
    && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some((element) => element.name.text === 'AiAccessSwitchesPanel' && !element.isTypeOnly))
  assert.ok(imported, 'index.tsx 没有从 ./AiAccessSwitchesPanel 导入面板')
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
    const first = jsx.children.find((child) =>
      !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces) && !(ts.isJsxExpression(child) && !child.expression))
    assert.ok(
      first && ts.isJsxSelfClosingElement(first) && first.tagName.getText(sourceFile) === 'AiAccessSwitchesPanel',
      `分支「${branch}」返回的 <Page> 第一个子元素不是 <AiAccessSwitchesPanel />：紧急暂停不能因为统计接口在加载或失败就找不到`,
    )
  }
})

await check('D2 package.json 注册本门禁', () => {
  assert.match(read('package.json'), /"verify:admin-ai-access-ui": "node scripts\/verify-admin-ai-access-ui\.mjs"/)
})

console.log(`\nALL PASS（${passed} 项）`)
