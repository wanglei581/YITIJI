import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { useAutoRefresh, type AutoRefreshContext, type AutoRefreshKind } from './useAutoRefresh.ts'

/**
 * 非浏览器：假时钟 + 可控 visibilityState，跑真实 hook。
 * 只替换 window 上的 setInterval，不动全局 setTimeout（React 调度还要用）。
 */

type Timer = { id: number; fn: () => void; ms: number; next: number }
type Listener = () => void

const timers = new Map<number, Timer>()
let timerSeq = 0
let peakTimers = 0
let now = 1_700_000_000_000
let visibilityState: DocumentVisibilityState = 'visible'
const visibilityListeners = new Set<Listener>()

const realDateNow = Date.now
Date.now = () => now

function timerCount(): number {
  return timers.size
}

function notePeak(): void {
  if (timers.size > peakTimers) peakTimers = timers.size
}

function resetClock(): void {
  timers.clear()
  timerSeq = 0
  peakTimers = 0
  now = 1_700_000_000_000
  visibilityState = 'visible'
  visibilityListeners.clear()
}

function advance(ms: number): void {
  const target = now + ms
  for (;;) {
    let due: Timer | null = null
    for (const timer of timers.values()) {
      if (timer.next <= target && (due === null || timer.next < due.next)) due = timer
    }
    if (!due) break
    now = due.next
    due.next = now + due.ms
    due.fn()
  }
  now = target
}

function setVisibility(next: DocumentVisibilityState): void {
  visibilityState = next
  for (const listener of [...visibilityListeners]) listener()
}

type MiniNode = {
  nodeType: number
  nodeName: string
  tagName: string
  namespaceURI: string
  ownerDocument: MiniDocument | null
  parentNode: MiniNode | null
  childNodes: MiniNode[]
  style: Record<string, string>
  textContent: string
  firstChild: MiniNode | null
  lastChild: MiniNode | null
  appendChild: (child: MiniNode) => MiniNode
  removeChild: (child: MiniNode) => MiniNode
  insertBefore: (child: MiniNode, ref: MiniNode | null) => MiniNode
  addEventListener: (type: string, listener: Listener) => void
  removeEventListener: (type: string, listener: Listener) => void
  setAttribute: () => void
  removeAttribute: () => void
  contains: (other: MiniNode | null) => boolean
}

type MiniDocument = MiniNode & {
  visibilityState: DocumentVisibilityState
  hidden: boolean
  documentElement: MiniNode
  body: MiniNode
  activeElement: MiniNode | null
  createElement: (tag: string) => MiniNode
}

function syncEnds(node: MiniNode): void {
  node.firstChild = node.childNodes[0] ?? null
  node.lastChild = node.childNodes[node.childNodes.length - 1] ?? null
}

function createNode(tag: string, owner: MiniDocument | null): MiniNode {
  const node = {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    tagName: tag.toUpperCase(),
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: owner,
    parentNode: null,
    childNodes: [] as MiniNode[],
    style: {},
    textContent: '',
    firstChild: null,
    lastChild: null,
    appendChild(child: MiniNode) {
      child.parentNode?.removeChild(child)
      child.parentNode = node
      node.childNodes.push(child)
      syncEnds(node)
      return child
    },
    removeChild(child: MiniNode) {
      const index = node.childNodes.indexOf(child)
      if (index >= 0) node.childNodes.splice(index, 1)
      child.parentNode = null
      syncEnds(node)
      return child
    },
    insertBefore(child: MiniNode, ref: MiniNode | null) {
      child.parentNode?.removeChild(child)
      child.parentNode = node
      const index = ref ? node.childNodes.indexOf(ref) : -1
      node.childNodes.splice(index < 0 ? node.childNodes.length : index, 0, child)
      syncEnds(node)
      return child
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    contains(other: MiniNode | null) {
      let current = other
      while (current) {
        if (current === node) return true
        current = current.parentNode
      }
      return false
    },
  }
  return node
}

function installDom(): void {
  if (typeof globalThis.window !== 'undefined' && (globalThis.window as { __o1Refresh?: boolean }).__o1Refresh) return
  const documentNode = createNode('#document', null)
  const document = documentNode as MiniDocument
  document.nodeType = 9
  document.ownerDocument = document
  document.documentElement = createNode('html', document)
  document.body = createNode('body', document)
  document.documentElement.appendChild(document.body)
  document.activeElement = document.body
  document.createElement = (tag: string) => createNode(tag, document)
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityState,
  })
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => visibilityState === 'hidden',
  })
  document.addEventListener = (type: string, listener: Listener) => {
    if (type === 'visibilitychange') visibilityListeners.add(listener)
  }
  document.removeEventListener = (type: string, listener: Listener) => {
    if (type === 'visibilitychange') visibilityListeners.delete(listener)
  }

  const windowObject = {
    __o1Refresh: true,
    document,
    navigator: { userAgent: 'node' },
    location: { protocol: 'http:' },
    HTMLIFrameElement: class HTMLIFrameElement {},
    addEventListener() {},
    removeEventListener() {},
    setInterval(fn: Timer['fn'], ms?: number) {
      const interval = ms ?? 0
      const id = ++timerSeq
      timers.set(id, { id, fn, ms: interval, next: now + interval })
      notePeak()
      return id
    },
    clearInterval(id?: number) {
      if (id === undefined) return
      timers.delete(id)
    },
  }
  Object.assign(windowObject, { top: windowObject, self: windowObject })
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: windowObject })
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: document })
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
installDom()

const clientPromise = import('react-dom/client')

let latestRefresh: (kind: AutoRefreshKind) => Promise<void> = async () => {}

function Probe(props: {
  intervalMs: number
  resetKey: string
  reload: (kind: AutoRefreshKind, ctx: AutoRefreshContext) => Promise<boolean>
}) {
  latestRefresh = useAutoRefresh(props)
  return null
}

async function mount(
  reload: (kind: AutoRefreshKind, ctx: AutoRefreshContext) => Promise<boolean>,
  resetKey = 'open',
) {
  const { createRoot } = await clientPromise
  const doc = globalThis.document as unknown as MiniDocument
  const container = doc.createElement('div')
  doc.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  await act(async () => {
    root.render(createElement(Probe, { intervalMs: 60_000, resetKey, reload }))
  })
  return root
}

async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

test('请求在途时反复前后台切换，任何时刻最多一个计时器', async () => {
  resetClock()
  let requests = 0
  let release = () => {}
  let hang: Promise<void> | null = null
  const reload = async () => {
    requests += 1
    if (hang) await hang
    return true
  }
  const root = await mount(reload)
  await act(async () => {
    await latestRefresh('user')
  })
  assert.equal(timerCount(), 1)
  assert.equal(requests, 1)

  now += 60_001
  hang = new Promise<void>((resolve) => {
    release = resolve
  })
  setVisibility('hidden')
  setVisibility('visible')
  assert.equal(requests, 2)
  assert.ok(timerCount() <= 1)

  for (let i = 0; i < 3; i += 1) {
    setVisibility('hidden')
    setVisibility('visible')
    assert.ok(timerCount() <= 1, `第 ${i + 1} 次切回前台时计时器为 ${timerCount()}`)
  }
  await flush()
  assert.equal(requests, 2)
  assert.ok(timerCount() <= 1)
  assert.ok(peakTimers <= 1, `峰值计时器 ${peakTimers}`)

  release()
  await flush()
  assert.equal(requests, 2)
  assert.equal(timerCount(), 1)
  assert.ok(peakTimers <= 1, `请求回来后峰值计时器 ${peakTimers}`)
  await act(async () => {
    root.unmount()
  })
})

test('卸载后计时器为 0，推进 120 秒不再请求', async () => {
  resetClock()
  let requests = 0
  const reload = async () => {
    requests += 1
    return true
  }
  const root = await mount(reload)
  assert.equal(timerCount(), 1)
  const baseline = requests
  await act(async () => {
    root.unmount()
  })
  assert.equal(timerCount(), 0)
  advance(120_000)
  await flush()
  assert.equal(requests, baseline)
  assert.equal(timerCount(), 0)
})

test('在途请求在卸载后返回时不写入状态、不安排计时器', async () => {
  resetClock()
  let requests = 0
  let stateWrites = 0
  let release = () => {}
  const hang = new Promise<void>((resolve) => {
    release = resolve
  })
  const reload = async (kind: AutoRefreshKind, ctx: AutoRefreshContext) => {
    requests += kind === 'user' || kind === 'auto' ? 1 : 0
    if (requests > 1) await hang
    if (ctx.disposed()) return false
    stateWrites += 1
    return true
  }
  const root = await mount(reload)
  await act(async () => {
    await latestRefresh('user')
  })
  assert.equal(stateWrites, 1)
  now += 60_001
  let inflight: Promise<void> = Promise.resolve()
  await act(async () => {
    setVisibility('hidden')
    setVisibility('visible')
    inflight = latestRefresh('auto')
  })
  await flush()
  assert.equal(requests, 2)
  assert.equal(stateWrites, 1)
  await act(async () => {
    root.unmount()
  })
  assert.equal(timerCount(), 0)
  release()
  await inflight
  await flush()
  assert.equal(stateWrites, 1)
  assert.equal(requests, 2)
  assert.equal(timerCount(), 0)
})

test.after(() => {
  Date.now = realDateNow
})
