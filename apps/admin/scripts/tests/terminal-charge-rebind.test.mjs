// 改绑机构之后，收费设置必须按新机构重读。
// 复位提示只在本次接口返回「已复位」时出现一次，关掉抽屉再打开不再显示。
// 点保存发出的是重读后的谁付钱和五个价，不能把改绑前屏幕上的旧价写回去。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const PRICE_KEYS = ['resume_optimize', 'mock_interview', 'print_bw_page', 'print_color_page', 'scan']
const RESET_SENTENCE = '改绑机构，收费设置已复位'
const ORG_PAYS_LABEL = '机构或我方承担（用户免费）'
const USER_PAYS_LABEL = '向用户收费'

const FRAGMENT = Symbol('fragment')

function createReactRuntime() {
  const instances = new Map()
  let generation = 0
  let current = null
  let cursor = 0
  let rendering = false
  let dirty = false
  let pending = []
  const changed = (prev, next) => !prev || !next || prev.length !== next.length || next.some((value, index) => !Object.is(value, prev[index]))
  const nextSlot = () => {
    if (!rendering || !current) throw new Error('hooks 只能在组件渲染时调用')
    return cursor++
  }
  const react = {
    useState(initial) {
      const inst = current
      const index = nextSlot()
      if (!(index in inst.slots)) inst.slots[index] = typeof initial === 'function' ? initial() : initial
      return [inst.slots[index], (value) => {
        const next = typeof value === 'function' ? value(inst.slots[index]) : value
        if (!Object.is(next, inst.slots[index])) {
          inst.slots[index] = next
          dirty = true
        }
      }]
    },
    useRef(initial) {
      const index = nextSlot()
      if (!(index in current.slots)) current.slots[index] = { current: initial }
      return current.slots[index]
    },
    useMemo(factory, deps) {
      const index = nextSlot()
      const prev = current.slots[index]
      if (prev && !changed(prev.deps, deps)) return prev.value
      const value = factory()
      current.slots[index] = { deps, value }
      return value
    },
    useEffect(effect, deps) {
      const inst = current
      const index = nextSlot()
      inst.effectIndexes.add(index)
      const prev = inst.slots[index]
      if (prev && !changed(prev.deps, deps)) return
      inst.slots[index] = { deps, cleanup: prev?.cleanup, effect }
      pending.push(inst.slots[index])
    },
  }
  const element = (type, props, key) => ({ type, props: props ?? {}, key: key ?? props?.key })
  function renderNode(node, path) {
    if (node === null || node === undefined || typeof node === 'boolean') return []
    if (typeof node === 'string' || typeof node === 'number') return [String(node)]
    if (Array.isArray(node)) return node.flatMap((child, index) => renderNode(child, `${path}/${index}`))
    if (!node || typeof node !== 'object') throw new Error(`不认识的节点：${String(node)}`)
    if (node.type === FRAGMENT) return renderNode(node.props.children, `${path}/<>`)
    if (typeof node.type === 'function') return renderComponent(node.type, node.props ?? {}, `${path}/${node.type.name || 'anon'}`)
    if (typeof node.type === 'string') {
      const { children, ...props } = node.props
      return [{ type: node.type, props, children: renderNode(children, `${path}/${node.type}`) }]
    }
    throw new Error(`不认识的节点：${String(node.type)}`)
  }
  function renderComponent(type, props, path) {
    let inst = instances.get(path)
    if (!inst) inst = { slots: [], effectIndexes: new Set() }
    instances.set(path, inst)
    inst.seen = generation
    const prev = current
    const prevCursor = cursor
    current = inst
    cursor = 0
    rendering = true
    let output
    try {
      output = type(props)
    } catch (error) {
      const name = type.name || 'anonymous'
      if (error instanceof Error) error.message = `${name}: ${error.message}`
      throw error
    } finally {
      rendering = false
      current = prev
      cursor = prevCursor
    }
    return renderNode(output, path)
  }
  function dropUnmounted() {
    for (const [path, inst] of instances) {
      if (inst.seen === generation) continue
      for (const index of inst.effectIndexes) inst.slots[index]?.cleanup?.()
      instances.delete(path)
    }
  }
  function mount(Component) {
    const render = () => {
      for (let round = 0; round < 30; round += 1) {
        dirty = false
        generation += 1
        const tree = renderComponent(Component, {}, 'root')
        const effects = pending
        pending = []
        effects.forEach((slot) => {
          slot.cleanup?.()
          const cleanup = slot.effect()
          slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
        })
        if (!dirty) {
          dropUnmounted()
          return tree
        }
      }
      throw new Error('渲染不收敛')
    }
    return {
      render,
      unmount() {
        for (const inst of instances.values()) {
          for (const index of inst.effectIndexes) inst.slots[index]?.cleanup?.()
        }
        instances.clear()
      },
    }
  }
  return { react, jsxRuntime: { Fragment: FRAGMENT, jsx: element, jsxs: element }, mount }
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.children ?? [])
}

function nodesOf(tree) {
  const found = []
  for (const node of tree) {
    if (typeof node === 'string') continue
    found.push(node)
    found.push(...nodesOf(node.children ?? []))
  }
  return found
}

function clickLabeled(tree, label) {
  const button = nodesOf(tree).find((node) => node.type === 'button' && (node.props['aria-label'] === label || textOf(node.children).includes(label)))
  assert.ok(button, `找不到按钮 ${label}`)
  button.props.onClick()
  return button
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

function chargeView(mode, cents) {
  const prices = {}
  for (const key of PRICE_KEYS) {
    prices[key] = {
      configuredCents: cents,
      effectiveCents: mode === 'user_pays' ? cents : 0,
      reason: mode,
    }
  }
  return {
    userChargeMode: mode,
    personalChargeEnabled: true,
    isPublicSite: false,
    orgBound: true,
    prices,
  }
}

function priceValues(tree) {
  return nodesOf(tree)
    .filter((node) => node.type === 'input' && node.props.inputMode === 'decimal')
    .map((node) => node.props.value)
}

function checkedModeLabel(tree) {
  const label = nodesOf(tree).find((node) => node.type === 'label' && nodesOf(node.children ?? []).some((child) => child.type === 'input' && child.props.type === 'radio' && child.props.checked))
  assert.ok(label, '找不到选中的谁付钱')
  return textOf(label)
}

function terminalRecord() {
  return {
    id: 't1',
    terminalCode: 'T-001',
    displayName: '一号机',
    locationLabel: '大厅',
    macAddress: null,
    orgId: 'org-a',
    orgName: '甲机构',
    orgType: 'school',
    online: true,
    enabled: true,
    lifecycleStatus: 'active',
    agentStatus: 'ok',
    localTaskDatabaseAvailable: true,
    lastHeartbeatAt: null,
    agentVersion: null,
    ipAddress: null,
    diskFreeGb: null,
    printerStatus: null,
    scanInputHealth: null,
    registeredAt: null,
    homeFreeBadge: true,
  }
}

function mountTerminalPage(options) {
  const runtime = createReactRuntime()
  const jobs = []
  const cache = new Map()
  const loads = []
  const saves = []
  const assigns = []
  const server = { mode: 'user_pays', cents: 100 }
  const nullComponent = (name) => {
    const component = () => null
    Object.defineProperty(component, 'name', { value: name })
    return component
  }
  const { jsx } = runtime.jsxRuntime
  function loadCached(path) {
    if (cache.has(path)) return cache.get(path)
    const exports = {}
    cache.set(path, exports)
    const output = ts.transpileModule(readFileSync(join(root, path), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    const module = { exports }
    new Function('exports', 'module', 'require', output)(exports, module, resolve)
    return exports
  }
  function resolve(name) {
    if (name === 'react') return runtime.react
    if (name === 'react/jsx-runtime') return runtime.jsxRuntime
    if (name === '@ai-job-print/shared') {
      return {
        formatDateTime: (value) => String(value ?? ''),
        formatRelativeTime: (value) => String(value ?? ''),
        formatDate: (value) => String(value ?? ''),
        TERMINAL_CHARGE_MAX_UNIT_CENTS: 100000,
        TERMINAL_CHARGE_SERVICE_KEYS: PRICE_KEYS,
        TERMINAL_CHARGE_SERVICE_LABELS: {
          resume_optimize: 'AI 简历优化（每次）',
          mock_interview: 'AI 模拟面试（每次）',
          print_bw_page: '黑白打印（每页）',
          print_color_page: '彩色打印（每页）',
          scan: '扫描（每次）',
        },
        TERMINAL_USER_CHARGE_MODE_LABELS: {
          org_pays: ORG_PAYS_LABEL,
          user_pays: USER_PAYS_LABEL,
        },
      }
    }
    if (name === '@ai-job-print/refresh') {
      const merge = loadCached('../../packages/refresh/src/merge.ts')
      return {
        mergeById: merge.mergeById,
        useInteractionLock() {},
        useRefreshable(_key, fetcher, refreshOptions) {
          const [state, setState] = runtime.react.useState({ data: undefined, status: 'idle', error: null })
          const fetcherRef = runtime.react.useRef(fetcher)
          const optionsRef = runtime.react.useRef(refreshOptions)
          fetcherRef.current = fetcher
          optionsRef.current = refreshOptions
          const refresh = () => {
            let run
            try {
              run = fetcherRef.current()
            } catch (error) {
              return Promise.reject(error)
            }
            return Promise.resolve(run).then((incoming) => {
              setState((current) => ({
                data: optionsRef.current.merge(current.data, incoming),
                status: 'ready',
                error: null,
              }))
            })
          }
          runtime.react.useEffect(() => { void refresh() }, [])
          return { data: state.data, status: state.status, error: state.error, hasPending: false, refresh }
        },
      }
    }
    if (name === '@ai-job-print/ui') {
      return {
        Card: ({ children }) => jsx('div', { children }),
        StatusBadge: ({ label }) => jsx('span', { children: label }),
        Button: ({ children, onClick, disabled, 'aria-label': ariaLabel }) => jsx('button', {
          type: 'button',
          onClick,
          disabled,
          'aria-label': ariaLabel,
          children,
        }),
        Drawer: ({ open, onClose, title, children }) => (open
          ? jsx('section', {
            children: [
              jsx('h2', { children: title }),
              jsx('button', { type: 'button', 'aria-label': '关闭', onClick: onClose, children: '关闭' }),
              children,
            ],
          })
          : null),
        ConsoleTable: ({ items, columns }) => jsx('div', {
          children: (items ?? []).map((item) => jsx('div', {
            key: item.id,
            children: (columns ?? []).map((column) => column.cell(item)),
          })),
        }),
      }
    }
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null })
    if (name === '../components/DataTable') {
      return {
        useTableState(defaultPageSize = 20) {
          const [page, setPage] = runtime.react.useState(1)
          const [pageSize, setPageSize] = runtime.react.useState(defaultPageSize)
          const [search, setSearch] = runtime.react.useState('')
          return { page, pageSize, search, setPage, setPageSize, setSearch }
        },
      }
    }
    if (name === '../components/FilterChip') return { FilterChip: ({ label }) => jsx('span', { children: label }) }
    if (name === '../../services/api/client') {
      class ApiHttpError extends Error {
        constructor(code, message, status) {
          super(message)
          this.code = code
          this.status = status
        }
      }
      return { API_MODE: 'http', ApiHttpError }
    }
    if (name === '../../services/api/devices') {
      return {
        getTerminals() {
          let resolveJob
          let rejectJob
          const promise = new Promise((resolve, reject) => { resolveJob = resolve; rejectJob = reject })
          jobs.push({ resolve: resolveJob, reject: rejectJob })
          return promise
        },
        getOrgOptions: async () => ({
          organizations: [
            { id: 'org-a', name: '甲机构', type: 'school' },
            { id: 'org-b', name: '乙机构', type: 'school' },
          ],
        }),
        assignTerminalOrg: async (terminalCode, orgId) => {
          assigns.push({ terminalCode, orgId })
          const chargeSettingsReset = options.reset
          if (chargeSettingsReset) {
            server.mode = 'org_pays'
            server.cents = 0
          }
          return {
            terminalId: 't1',
            terminalCode,
            oldOrgId: 'org-a',
            newOrgId: orgId,
            orgName: orgId === 'org-b' ? '乙机构' : '甲机构',
            chargeSettingsReset,
          }
        },
        updateTerminalProfile: async () => { throw new Error('这个用例不改档案') },
      }
    }
    if (name === '../../services/api/homeFreeBadge') {
      return { saveTerminalHomeFreeBadge: async () => { throw new Error('这个用例不改首页免费使用') } }
    }
    if (name === '../../services/api/terminalCharge') {
      return {
        loadTerminalChargeSettings: async (terminalId) => {
          loads.push(terminalId)
          return chargeView(server.mode, server.cents)
        },
        saveTerminalChargeSettings: async (terminalId, body) => {
          saves.push({ terminalId, body: structuredClone(body) })
          return chargeView(body.userChargeMode, body.userChargeMode === 'user_pays' ? server.cents : 0)
        },
        chargeSummary: (view) => ({
          userChargeMode: view.userChargeMode,
          personalChargeEnabled: view.personalChargeEnabled,
          isPublicSite: view.isPublicSite,
          prices: view.prices,
        }),
      }
    }
    if (name === '../partners/orgTypeOptions') return { isParkedOrgType: () => false }
    const files = {
      './homeFreeBadgePatch': 'src/routes/terminals/homeFreeBadgePatch.ts',
      './chargeSettingsPatch': 'src/routes/terminals/chargeSettingsPatch.ts',
      './TerminalDetailDrawer': 'src/routes/terminals/TerminalDetailDrawer.tsx',
      './TerminalHomeFreeBadgeSection': 'src/routes/terminals/TerminalHomeFreeBadgeSection.tsx',
      './TerminalChargeSettingsSection': 'src/routes/terminals/TerminalChargeSettingsSection.tsx',
      './terminalStatusViews': 'src/routes/terminals/terminalStatusViews.ts',
      './printCompletionEvidence': 'src/routes/terminals/printCompletionEvidence.ts',
    }
    if (files[name]) return loadCached(files[name])
    const stubs = {
      './TerminalDailyFreeSidesSection': 'TerminalDailyFreeSidesSection',
      './TerminalLifecycleActions': 'TerminalLifecycleActions',
      './TerminalNetworkDiagnostics': 'TerminalNetworkDiagnostics',
      './TerminalPrinterQueue': 'TerminalPrinterQueue',
      './ReleaseObservationPanel': 'ReleaseObservationPanel',
      './CreatePlannedTerminalDialog': 'CreatePlannedTerminalDialog',
      './TerminalBindCodeDialog': 'TerminalBindCodeDialog',
    }
    if (stubs[name]) return { [stubs[name]]: nullComponent(stubs[name]) }
    throw new Error(`Unexpected dependency ${name}`)
  }
  const page = loadCached('src/routes/terminals/index.tsx')
  const view = runtime.mount(page.default)
  return { view, jobs, loads, saves, assigns }
}

async function openCharge(view, jobs) {
  let tree = view.render()
  assert.equal(jobs.length, 1, '打开页面就发出第一次列表请求')
  jobs[0].resolve({ terminals: [terminalRecord()] })
  await flush()
  tree = view.render()
  clickLabeled(tree, '管理 T-001')
  tree = view.render()
  await flush()
  return view.render()
}

async function rebind(view, tree) {
  clickLabeled(tree, '更改机构')
  tree = view.render()
  const select = nodesOf(tree).find((node) => node.type === 'select')
  assert.ok(select, '找不到机构选择')
  select.props.onChange({ target: { value: 'org-b' } })
  tree = view.render()
  clickLabeled(tree, '保存归属')
  await flush()
  tree = view.render()
  await flush()
  return view.render()
}

test('改绑返回已复位后重读为机构承担和 0，保存不会把旧价写回', async () => {
  const { view, jobs, loads, saves, assigns } = mountTerminalPage({ reset: true })
  let tree = await openCharge(view, jobs)
  assert.equal(textOf(tree).includes(RESET_SENTENCE), false, '没改绑过，不能显示已复位')
  assert.equal(checkedModeLabel(tree), USER_PAYS_LABEL)
  assert.deepEqual(priceValues(tree), ['1.00', '1.00', '1.00', '1.00', '1.00'])
  assert.deepEqual(loads, ['t1'])

  tree = await rebind(view, tree)
  assert.equal(assigns[0].terminalCode, 'T-001')
  assert.equal(assigns[0].orgId, 'org-b')
  assert.equal(textOf(tree).includes(RESET_SENTENCE), true)
  assert.equal(checkedModeLabel(tree), ORG_PAYS_LABEL)
  assert.deepEqual(priceValues(tree), ['0.00', '0.00', '0.00', '0.00', '0.00'])
  assert.deepEqual(loads, ['t1', 't1'], '改绑后必须按新机构再读一次')

  clickLabeled(tree, '保存收费设置')
  await flush()
  tree = view.render()
  assert.equal(saves.length, 1)
  assert.equal(saves[0].terminalId, 't1')
  assert.equal(saves[0].body.userChargeMode, 'org_pays')
  assert.deepEqual(saves[0].body.prices, {
    resume_optimize: 0,
    mock_interview: 0,
    print_bw_page: 0,
    print_color_page: 0,
    scan: 0,
  })

  clickLabeled(tree, '关闭')
  tree = view.render()
  clickLabeled(tree, '管理 T-001')
  tree = view.render()
  await flush()
  tree = view.render()
  assert.equal(textOf(tree).includes(RESET_SENTENCE), false, '重新打开抽屉不再显示这一次的复位提示')
  assert.equal(checkedModeLabel(tree), ORG_PAYS_LABEL)
  view.unmount()
})

test('改绑接口没说已复位时不提示，保存仍按重读到的旧价', async () => {
  const { view, jobs, loads, saves } = mountTerminalPage({ reset: false })
  let tree = await openCharge(view, jobs)
  assert.equal(textOf(tree).includes(RESET_SENTENCE), false)
  tree = await rebind(view, tree)
  assert.equal(textOf(tree).includes(RESET_SENTENCE), false)
  assert.equal(checkedModeLabel(tree), USER_PAYS_LABEL)
  assert.deepEqual(priceValues(tree), ['1.00', '1.00', '1.00', '1.00', '1.00'])
  assert.deepEqual(loads, ['t1', 't1'])
  clickLabeled(tree, '保存收费设置')
  await flush()
  view.render()
  assert.equal(saves[0].body.userChargeMode, 'user_pays')
  assert.deepEqual(saves[0].body.prices, {
    resume_optimize: 100,
    mock_interview: 100,
    print_bw_page: 100,
    print_color_page: 100,
    scan: 100,
  })
  view.unmount()
})
