// 后台「首页显示免费使用」：失败弹回、成功才改当前这一下、换终端不卡住。
// 保存成功之后才发出的列表，回来就以服务器为准。演示包的保存函数在发请求前就拒绝，
// devices.spec.ts 的 page.route 拦不到成功响应，所以成功一路放在这个组件支架里，
// 关掉再打开走终端页和抽屉的真组件，不在脚本里自己保管一份开关。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path) => readFileSync(join(root, path), 'utf8')

function load(path, resolve) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'module', 'require', output)(module.exports, module, resolve)
  return module.exports
}

const patch = load('src/routes/terminals/homeFreeBadgePatch.ts', () => {
  throw new Error('补丁函数不应再依赖别的模块')
})

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

let saveImpl = async () => { throw new Error('这个用例没有安排保存') }

function mountSection(props) {
  const runtime = createReactRuntime()
  const section = load('src/routes/terminals/TerminalHomeFreeBadgeSection.tsx', (name) => {
    if (name === 'react') return runtime.react
    if (name === 'react/jsx-runtime') return runtime.jsxRuntime
    if (name === '../../services/api/homeFreeBadge') {
      return { saveTerminalHomeFreeBadge: (terminalId, enabled) => saveImpl(terminalId, enabled) }
    }
    throw new Error(`Unexpected dependency ${name}`)
  })
  const view = runtime.mount(() => section.TerminalHomeFreeBadgeSection(props))
  return { view, tree: view.render() }
}

function switchOf(tree) {
  const button = nodesOf(tree).find((node) => node.type === 'button' && node.props.role === 'switch')
  assert.ok(button, '找不到开关')
  return button
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

function terminalRecord(overrides) {
  return {
    id: 't1',
    terminalCode: 'T-001',
    displayName: '一号机',
    locationLabel: '大厅',
    macAddress: null,
    orgId: null,
    orgName: null,
    orgType: null,
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
    ...overrides,
  }
}

function mountTerminalPage() {
  const runtime = createReactRuntime()
  const jobs = []
  const cache = new Map()
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
      }
    }
    if (name === '@ai-job-print/refresh') {
      const merge = loadCached('../../packages/refresh/src/merge.ts')
      return {
        mergeById: merge.mergeById,
        useInteractionLock() {},
        useRefreshable(_key, fetcher, options) {
          const [state, setState] = runtime.react.useState({ data: undefined, status: 'idle', error: null })
          const fetcherRef = runtime.react.useRef(fetcher)
          const optionsRef = runtime.react.useRef(options)
          fetcherRef.current = fetcher
          optionsRef.current = options
          const refresh = () => {
            // 和真的刷新一样：取列表的函数在点击或挂载时立刻执行，序号在发出请求时拿走。
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
        Button: ({ children, onClick, disabled }) => jsx('button', { type: 'button', onClick, disabled, children }),
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
        getOrgOptions: async () => ({ organizations: [] }),
        assignTerminalOrg: async () => { throw new Error('这个用例不改归属') },
        updateTerminalProfile: async () => { throw new Error('这个用例不改档案') },
      }
    }
    if (name === '../../services/api/homeFreeBadge') {
      return { saveTerminalHomeFreeBadge: (terminalId, enabled) => saveImpl(terminalId, enabled) }
    }
    if (name === '../../services/api/terminalCharge') {
      return { chargeSummary: (view) => view }
    }
    if (name === '../partners/orgTypeOptions') return { isParkedOrgType: () => false }
    const files = {
      './homeFreeBadgePatch': 'src/routes/terminals/homeFreeBadgePatch.ts',
      './chargeSettingsPatch': 'src/routes/terminals/chargeSettingsPatch.ts',
      './TerminalDetailDrawer': 'src/routes/terminals/TerminalDetailDrawer.tsx',
      './TerminalHomeFreeBadgeSection': 'src/routes/terminals/TerminalHomeFreeBadgeSection.tsx',
      './terminalStatusViews': 'src/routes/terminals/terminalStatusViews.ts',
      './printCompletionEvidence': 'src/routes/terminals/printCompletionEvidence.ts',
    }
    if (files[name]) return loadCached(files[name])
    const stubs = {
      './TerminalDailyFreeSidesSection': 'TerminalDailyFreeSidesSection',
      './TerminalChargeSettingsSection': 'TerminalChargeSettingsSection',
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
  return { view, jobs }
}

describe('后台首页免费使用开关', { concurrency: 1 }, () => {
  test('点了以后保存还没回来，开关停在原来的开，按钮停用', async () => {
    let resolveSave
    saveImpl = () => new Promise((resolve) => { resolveSave = resolve })
    const saved = []
    const { view, tree } = mountSection({
      terminalId: 't1',
      enabled: true,
      onSaved: (terminalId, enabled) => saved.push([terminalId, enabled]),
    })
    assert.equal(switchOf(tree).props['aria-checked'], true)
    switchOf(tree).props.onClick()
    const pending = view.render()
    assert.equal(switchOf(pending).props.disabled, true)
    assert.equal(switchOf(pending).props['aria-checked'], true)
    assert.equal(textOf(switchOf(pending).children), '保存中…')
    assert.deepEqual(saved, [])
    resolveSave({ enabled: false })
    await flush()
    const done = view.render()
    assert.equal(switchOf(done).props['aria-checked'], false)
    assert.equal(switchOf(done).props.disabled, false)
    assert.equal(textOf(switchOf(done).children), '关')
    assert.match(textOf(done), /已保存，并记入审计。/)
    // 写回的是这一台的返回值。旧请求以后要能认出是哪一台，不能只交一个布尔。
    assert.deepEqual(saved, [['t1', false]])
    view.unmount()
  })

  test('演示数据保存失败后开关仍是开，并显示没有写入服务器', async () => {
    const saved = []
    saveImpl = async () => { throw new Error('当前是演示数据，没有写入服务器') }
    const { view, tree } = mountSection({
      terminalId: 't1',
      enabled: true,
      onSaved: (terminalId, enabled) => saved.push([terminalId, enabled]),
    })
    switchOf(tree).props.onClick()
    await flush()
    const done = view.render()
    assert.equal(switchOf(done).props['aria-checked'], true)
    assert.equal(textOf(switchOf(done).children), '开')
    assert.match(textOf(done), /当前是演示数据，没有写入服务器/)
    assert.doesNotMatch(textOf(done), /已保存，并记入审计。/)
    assert.deepEqual(saved, [])
    view.unmount()
  })

  test('开关改成服务端返回的值，而不是请求里那一个', async () => {
    const saved = []
    saveImpl = async () => ({ enabled: true })
    const { view, tree } = mountSection({
      terminalId: 't1',
      enabled: true,
      onSaved: (terminalId, enabled) => saved.push([terminalId, enabled]),
    })
    switchOf(tree).props.onClick()
    await flush()
    const done = view.render()
    assert.equal(switchOf(done).props['aria-checked'], true)
    assert.match(textOf(done), /已保存，并记入审计。/)
    assert.deepEqual(saved, [['t1', true]])
    view.unmount()
  })

  test('A 还在保存时换到 B，B 不显示保存中，A 的结果不改 B', async () => {
    let resolveSave
    saveImpl = (_terminalId, enabled) => {
      assert.equal(enabled, false)
      return new Promise((resolve) => { resolveSave = resolve })
    }
    const saved = []
    const props = {
      terminalId: 'A',
      enabled: true,
      listIssuedAt: 1,
      onSaved: (terminalId, enabled) => saved.push([terminalId, enabled]),
    }
    const { view, tree } = mountSection(props)
    switchOf(tree).props.onClick()
    const saving = view.render()
    assert.equal(textOf(switchOf(saving).children), '保存中…')

    props.terminalId = 'B'
    props.enabled = true
    const onB = view.render()
    assert.equal(textOf(switchOf(onB).children), '开', 'B 用自己的初始状态，不能接着显示 A 的保存中')
    assert.equal(switchOf(onB).props.disabled, false)
    assert.doesNotMatch(textOf(onB), /已保存，并记入审计。/)

    resolveSave({ enabled: false })
    await flush()
    const after = view.render()
    assert.deepEqual(saved, [['A', false]], '旧请求仍写回 A 自己的补丁')
    assert.equal(switchOf(after).props['aria-checked'], true, '人已经在看 B，A 的返回值不能把 B 改成关')
    assert.equal(textOf(switchOf(after).children), '开')
    assert.doesNotMatch(textOf(after), /已保存，并记入审计。/)
    assert.equal(switchOf(after).props.disabled, false)
    view.unmount()
  })

  test('A 保存中去 B 再回到 A，旧请求的结果不改当前这台屏幕上的开关', async () => {
    let resolveSave
    saveImpl = () => new Promise((resolve) => { resolveSave = resolve })
    const saved = []
    const props = {
      terminalId: 'A',
      enabled: true,
      listIssuedAt: 1,
      onSaved: (terminalId, enabled) => saved.push([terminalId, enabled]),
    }
    const { view, tree } = mountSection(props)
    switchOf(tree).props.onClick()
    view.render()
    props.terminalId = 'B'
    props.enabled = false
    const onB = view.render()
    assert.equal(textOf(switchOf(onB).children), '关')
    assert.equal(switchOf(onB).props.disabled, false)

    props.terminalId = 'A'
    props.enabled = true
    const back = view.render()
    assert.equal(textOf(switchOf(back).children), '开', '回到 A 时先显示离开前列表里的值')
    assert.equal(switchOf(back).props.disabled, false)

    resolveSave({ enabled: false })
    await flush()
    const after = view.render()
    assert.deepEqual(saved, [['A', false]])
    assert.equal(switchOf(after).props['aria-checked'], true, '只比终端号会把旧请求当成回到 A 之后的这一下')
    assert.equal(textOf(switchOf(after).children), '开')
    assert.doesNotMatch(textOf(after), /已保存，并记入审计。/)
    assert.equal(switchOf(after).props.disabled, false)
    view.unmount()
  })

  test('补丁：保存之后才取回的列表以服务器为准；更早发出的列表仍盖住；空值当关', () => {
    assert.equal(patch.homeFreeBadgeOn(undefined), false)
    assert.equal(patch.homeFreeBadgeOn(null), false)
    assert.equal(patch.homeFreeBadgeOn(true), true)
    const saved = { t1: { enabled: true, savedAt: 5 } }
    const earlier = patch.dropHomeFreeBadgePatchAfterList(saved, [{ id: 't1', homeFreeBadge: false }], 4)
    assert.equal(earlier.t1.enabled, true, '列表请求在保存成功之前发出，回来仍可能是旧值')
    assert.equal(patch.applyHomeFreeBadgePatch([{ id: 't1', homeFreeBadge: false }], earlier)[0].homeFreeBadge, true)

    const opposite = patch.dropHomeFreeBadgePatchAfterList(saved, [{ id: 't1', homeFreeBadge: false }], 6)
    assert.equal(opposite.t1, undefined, '保存成功之后取回的相反值就是别人改过的，补丁不能再盖住')
    const missing = patch.dropHomeFreeBadgePatchAfterList(saved, [{ id: 't1', homeFreeBadge: undefined }], 6)
    assert.equal(missing.t1, undefined, '服务器没给这个字段，不能因为对不上 true 就一直盖住')
    const empty = patch.dropHomeFreeBadgePatchAfterList(saved, [{ id: 't1', homeFreeBadge: null }], 6)
    assert.equal(empty.t1, undefined, 'null 与缺省一样，都是关')
    assert.equal(patch.homeFreeBadgeOn(undefined), false)
  })

  test('终端页和抽屉：保存写回这一台；之后的列表相反或空值都显示服务器；关掉再打开不留提示', async () => {
    const saves = []
    saveImpl = (terminalId, enabled) => new Promise((resolve) => { saves.push({ terminalId, enabled, resolve }) })
    const { view, jobs } = mountTerminalPage()
    let tree = view.render()
    assert.equal(jobs.length, 1, '打开页面就发出第一次列表请求')
    jobs[0].resolve({ terminals: [terminalRecord({ id: 'A', terminalCode: 'A-1', homeFreeBadge: false })] })
    await flush()
    tree = view.render()
    clickLabeled(tree, '管理 A-1')
    tree = view.render()
    assert.equal(textOf(switchOf(tree).children), '关')

    switchOf(tree).props.onClick()
    tree = view.render()
    assert.equal(textOf(switchOf(tree).children), '保存中…')
    // 这一下刷新在保存成功之前发出。回来即使还是关，也不能把刚保存的开冲掉。
    clickLabeled(tree, '刷新')
    const earlyList = jobs.length - 1
    saves[0].resolve({ enabled: true })
    await flush()
    tree = view.render()
    assert.equal(saves[0].terminalId, 'A')
    assert.equal(textOf(switchOf(tree).children), '开')
    assert.match(textOf(tree), /已保存，并记入审计。/)

    jobs[earlyList].resolve({ terminals: [terminalRecord({ id: 'A', terminalCode: 'A-1', homeFreeBadge: false })] })
    await flush()
    tree = view.render()
    assert.equal(textOf(switchOf(tree).children), '开', '更早发出的列表还是旧值，补丁继续盖住')

    clickLabeled(tree, '刷新')
    jobs.at(-1).resolve({ terminals: [terminalRecord({ id: 'A', terminalCode: 'A-1', homeFreeBadge: false })] })
    await flush()
    tree = view.render()
    assert.equal(textOf(switchOf(tree).children), '关', '这是保存成功之后才取回的相反值，显示服务器上的关')
    assert.doesNotMatch(textOf(switchOf(tree).children), /保存中/)

    switchOf(tree).props.onClick()
    tree = view.render()
    saves.at(-1).resolve({ enabled: true })
    await flush()
    tree = view.render()
    assert.equal(textOf(switchOf(tree).children), '开')
    clickLabeled(tree, '刷新')
    jobs.at(-1).resolve({ terminals: [terminalRecord({ id: 'A', terminalCode: 'A-1', homeFreeBadge: undefined })] })
    await flush()
    tree = view.render()
    assert.equal(switchOf(tree).props['aria-checked'], false, '服务器没给这个字段，按关显示，不能留着刚才的开')
    assert.equal(textOf(switchOf(tree).children), '关')

    clickLabeled(tree, '关闭')
    tree = view.render()
    assert.equal(nodesOf(tree).some((node) => node.type === 'button' && node.props.role === 'switch'), false)
    clickLabeled(tree, '管理 A-1')
    tree = view.render()
    assert.equal(textOf(switchOf(tree).children), '关', '关掉再打开读的是列表，不是抽屉里残留的提示')
    assert.doesNotMatch(textOf(tree), /已保存，并记入审计。/)
    assert.equal(switchOf(tree).props.disabled, false)
    view.unmount()
  })

  test('终端页上 A 保存中换到 B 再回到 A，旧请求不改当前屏幕', async () => {
    let resolveSave
    saveImpl = () => new Promise((resolve) => { resolveSave = resolve })
    const { view, jobs } = mountTerminalPage()
    let tree = view.render()
    jobs[0].resolve({
      terminals: [
        terminalRecord({ id: 'A', terminalCode: 'A-1', displayName: 'A 机', homeFreeBadge: true }),
        terminalRecord({ id: 'B', terminalCode: 'B-1', displayName: 'B 机', homeFreeBadge: true }),
      ],
    })
    await flush()
    tree = view.render()
    clickLabeled(tree, '管理 A-1')
    tree = view.render()
    assert.equal(textOf(switchOf(tree).children), '开')
    switchOf(tree).props.onClick()
    tree = view.render()
    assert.equal(textOf(switchOf(tree).children), '保存中…')

    clickLabeled(tree, '管理 B-1')
    tree = view.render()
    assert.equal(textOf(switchOf(tree).children), '开')
    assert.equal(switchOf(tree).props.disabled, false, 'B 不能卡在 A 的保存中')
    assert.doesNotMatch(textOf(tree), /保存中/)

    clickLabeled(tree, '管理 A-1')
    tree = view.render()
    assert.equal(textOf(switchOf(tree).children), '开')
    assert.equal(switchOf(tree).props.disabled, false)

    resolveSave({ enabled: false })
    await flush()
    tree = view.render()
    assert.equal(switchOf(tree).props['aria-checked'], true, '回到 A 之后，离开前那一次的结果不能改现在的开关')
    assert.equal(textOf(switchOf(tree).children), '开')
    assert.doesNotMatch(textOf(tree), /已保存，并记入审计。/)
    assert.equal(switchOf(tree).props.disabled, false)
    view.unmount()
  })

  test('终端列表和抽屉把保存结果写回发出请求的那一台', () => {
    const index = read('src/routes/terminals/index.tsx')
    const drawer = read('src/routes/terminals/TerminalDetailDrawer.tsx')
    assert.match(index, /applyHomeFreeBadgePatch\(/)
    assert.match(index, /dropHomeFreeBadgePatchAfterList\(/)
    assert.match(index, /nextHomeFreeBadgeClock\(/)
    assert.match(index, /serverListIssuedAt=\{terminalData\?\.listIssuedAt \?\? 0\}/)
    assert.match(index, /onHomeFreeBadgeSaved=\{handleHomeFreeBadgeSaved\}/)
    assert.match(drawer, /enabled=\{homeFreeBadgeOn\(terminal\.homeFreeBadge\)\}/)
    assert.match(drawer, /onSaved=\{\(savedTerminalId, enabled\) => onHomeFreeBadgeSaved\(savedTerminalId, enabled\)\}/)
    assert.doesNotMatch(index, /forgetMatchedHomeFreeBadgePatch/)
    assert.doesNotMatch(drawer, /forgetMatchedHomeFreeBadgePatch/)
  })
})
