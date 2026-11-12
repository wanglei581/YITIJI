// 后台「首页显示免费使用」：失败弹回、成功才改、关抽屉再开仍是服务端返回的值。
// 演示包的保存函数在发请求前就拒绝，devices.spec.ts 的 page.route 拦不到成功响应，所以成功一路放在这里。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
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
  const slots = []
  const effectSlots = new Set()
  let cursor = 0
  let rendering = false
  let dirty = false
  let pending = []
  const changed = (prev, next) => !prev || !next || prev.length !== next.length || next.some((value, index) => !Object.is(value, prev[index]))
  const nextSlot = () => {
    if (!rendering) throw new Error('hooks 只能在组件渲染时调用')
    return cursor++
  }
  const react = {
    useState(initial) {
      const index = nextSlot()
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (value) => {
        const next = typeof value === 'function' ? value(slots[index]) : value
        if (!Object.is(next, slots[index])) {
          slots[index] = next
          dirty = true
        }
      }]
    },
    useRef(initial) {
      const index = nextSlot()
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useEffect(effect, deps) {
      const index = nextSlot()
      effectSlots.add(index)
      const prev = slots[index]
      if (prev && !changed(prev.deps, deps)) return
      slots[index] = { deps, cleanup: prev?.cleanup }
      pending.push(() => {
        slots[index].cleanup?.()
        const cleanup = effect()
        slots[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined
      })
    },
  }
  const element = (type, props, key) => ({ type, props: props ?? {}, key })
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
    throw new Error(`不认识的节点：${String(node.type)}`)
  }
  function mount(Component) {
    const render = () => {
      for (let round = 0; round < 20; round += 1) {
        dirty = false
        cursor = 0
        rendering = true
        let output
        try { output = Component() } finally { rendering = false }
        const tree = expand(output)
        const effects = pending
        pending = []
        effects.forEach((run) => run())
        if (!dirty) return tree
      }
      throw new Error('渲染不收敛')
    }
    return {
      render,
      unmount() {
        for (const index of effectSlots) slots[index]?.cleanup?.()
      },
    }
  }
  return { react, jsxRuntime: { Fragment: FRAGMENT, jsx: element, jsxs: element }, mount }
}

function textOf(node) {
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

async function flush() {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

test('点了以后保存还没回来，开关停在原来的开，按钮停用', async () => {
  let resolveSave
  saveImpl = () => new Promise((resolve) => { resolveSave = resolve })
  const saved = []
  const { view, tree } = mountSection({ terminalId: 't1', enabled: true, onSaved: (enabled) => saved.push(enabled) })
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
  assert.deepEqual(saved, [false])
  view.unmount()
})

test('演示数据保存失败后开关仍是开，并显示没有写入服务器', async () => {
  const saved = []
  saveImpl = async () => { throw new Error('当前是演示数据，没有写入服务器') }
  const { view, tree } = mountSection({ terminalId: 't1', enabled: true, onSaved: (enabled) => saved.push(enabled) })
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

test('成功后显示服务端返回的值；关掉再打开、列表刷新后仍是新值', async () => {
  let terminals = [{ id: 't1', homeFreeBadge: true }]
  let badgePatch = {}
  const enabledNow = () => patch.applyHomeFreeBadgePatch(terminals, badgePatch)[0].homeFreeBadge === true
  const onSaved = (enabled) => { badgePatch = { ...badgePatch, t1: enabled } }
  saveImpl = async (_terminalId, enabled) => {
    assert.equal(enabled, false)
    return { enabled: false }
  }
  const first = mountSection({ terminalId: 't1', enabled: enabledNow(), onSaved })
  switchOf(first.tree).props.onClick()
  await flush()
  const savedTree = first.view.render()
  assert.equal(switchOf(savedTree).props['aria-checked'], false)
  assert.match(textOf(savedTree), /已保存，并记入审计。/)
  first.view.unmount()

  const reopened = mountSection({ terminalId: 't1', enabled: enabledNow(), onSaved })
  assert.equal(switchOf(reopened.tree).props['aria-checked'], false, '关掉抽屉再打开仍是新值')
  assert.equal(textOf(switchOf(reopened.tree).children), '关')
  assert.doesNotMatch(textOf(reopened.tree), /已保存，并记入审计。/)
  reopened.view.unmount()

  const stale = patch.forgetMatchedHomeFreeBadgePatch(badgePatch, [{ id: 't1', homeFreeBadge: true }])
  assert.equal(stale.t1, false, '列表还是旧值时，补丁继续盖住')
  assert.equal(patch.applyHomeFreeBadgePatch([{ id: 't1', homeFreeBadge: true }], stale)[0].homeFreeBadge, false)

  terminals = [{ id: 't1', homeFreeBadge: false }]
  badgePatch = patch.forgetMatchedHomeFreeBadgePatch(badgePatch, terminals)
  assert.deepEqual(badgePatch, {})
  assert.equal(patch.applyHomeFreeBadgePatch(terminals, badgePatch)[0].homeFreeBadge, false, '列表刷新到新值后仍然显示新值')
})

test('开关改成服务端返回的值，而不是请求里那一个', async () => {
  const saved = []
  saveImpl = async () => ({ enabled: true })
  const { view, tree } = mountSection({ terminalId: 't1', enabled: true, onSaved: (enabled) => saved.push(enabled) })
  switchOf(tree).props.onClick()
  await flush()
  const done = view.render()
  assert.equal(switchOf(done).props['aria-checked'], true)
  assert.match(textOf(done), /已保存，并记入审计。/)
  assert.deepEqual(saved, [true])
  view.unmount()
})

test('终端列表和抽屉把保存结果写回同一份数据', () => {
  const index = read('src/routes/terminals/index.tsx')
  const drawer = read('src/routes/terminals/TerminalDetailDrawer.tsx')
  assert.match(index, /applyHomeFreeBadgePatch\(/)
  assert.match(index, /forgetMatchedHomeFreeBadgePatch\(/)
  assert.match(index, /onHomeFreeBadgeSaved=\{handleHomeFreeBadgeSaved\}/)
  assert.match(drawer, /onSaved=\{\(enabled\) => onHomeFreeBadgeSaved\(terminal\.id, enabled\)\}/)
  assert.match(drawer, /enabled=\{terminal\.homeFreeBadge === true\}/)
})
