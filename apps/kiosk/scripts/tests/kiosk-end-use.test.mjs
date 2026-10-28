/**
 * 统一清场 endKioskUse —— **行为**测试（不是文本断言）。
 *
 * 守的两件事（产品负责人 9/29「两处都堵，30 秒」）：
 *   1. runEndKioskUse 的四步顺序：结束人次 → 清本机数据 → 退出登录 → 离开；
 *      哪一步抛错后面几步照样走完（半清比多清危险）；目的地只有换号去登录页，其余回首页。
 *   2. 「还是你吗？」的判据：进个人资产页之前这台机器空了超过 30 秒才问；
 *      点进来的那一下不算「刚点过」；后退 / 深链按距今时长算；登录成功算本人刚确认过。
 *   3. 弹出了没回答就是「待确认」（粘性标记）：之后空多久、从哪条路进都先问；只有本人答「是我」、
 *      清场退出登录、新的一位登录成功才解除；标记只在内存里，整个模块不碰任何浏览器存储。
 *
 * 模块用 typescript 转成 JS 后直接 import；kioskPresence 对 kioskIdleTiming 的相对引用
 * 换成同值常量（值本身另由 verify-kiosk-end-use 对照源码）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
let seq = 0

function loadModule(rel, patch = (s) => s) {
  const source = patch(readFileSync(join(kioskRoot, rel), 'utf8'))
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  // 每次都是新模块：模块级状态（最近一次触碰）不能在 case 之间串。
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(js)}%0A//${seq++}`)
}

const loadPresence = () => loadModule('src/auth/kioskPresence.ts', (s) => {
  const timing = readFileSync(join(kioskRoot, 'src/auth/kioskIdleTiming.ts'), 'utf8')
  const ms = timing.match(/KIOSK_HANDOVER_CONFIRM_MS = ([\d_]+)/)[1]
  return s.replace(/import \{ KIOSK_HANDOVER_CONFIRM_MS \} from '\.\/kioskIdleTiming'/, `const KIOSK_HANDOVER_CONFIRM_MS = ${ms}`)
})

function recorder(throwing = new Set()) {
  const calls = []
  const step = (name) => (arg) => {
    calls.push(arg === undefined ? name : `${name}:${typeof arg === 'string' ? arg : JSON.stringify(arg)}`)
    if (throwing.has(name)) throw new Error(`${name} failed`)
  }
  return {
    calls,
    steps: { endVisit: step('endVisit'), clearLocal: step('clearLocal'), logout: step('logout'), leave: step('leave') },
  }
}

test('四步顺序：结束人次 → 清本机 → 退出登录 → 离开，原因映射到服务人次契约', async () => {
  const m = await loadModule('src/auth/kioskEndUse.ts')
  const expected = {
    end_use: ['endVisit:user_exit', 'clearLocal', 'logout', 'leave:{"path":"/"}'],
    switch_account: ['endVisit:handover', 'clearLocal', 'logout', 'leave:{"path":"/login","state":{"from":"/profile"}}'],
    idle_timeout: ['endVisit:idle_timeout', 'clearLocal', 'logout', 'leave:{"path":"/"}'],
    print_done_timeout: ['endVisit:idle_timeout', 'clearLocal', 'logout', 'leave:{"path":"/"}'],
    handover: ['endVisit:handover', 'clearLocal', 'logout', 'leave:{"path":"/"}'],
    privacy_fallback: ['endVisit:privacy_clear', 'clearLocal', 'logout', 'leave:{"path":"/"}'],
  }
  assert.deepEqual([...m.KIOSK_END_USE_REASONS], ['end_use', 'switch_account', 'idle_timeout', 'print_done_timeout', 'handover'])
  for (const [reason, calls] of Object.entries(expected)) {
    const r = recorder()
    m.runEndKioskUse(reason, r.steps)
    assert.deepEqual(r.calls, calls, reason)
  }
})

test('换号带提示：登录页顶部那句跟着走，登录后回「我的」', async () => {
  const m = await loadModule('src/auth/kioskEndUse.ts')
  const r = recorder()
  m.runEndKioskUse('switch_account', r.steps, { loginHint: '换绑成功，请用新手机号登录' })
  assert.equal(r.calls.at(-1), 'leave:{"path":"/login","state":{"from":"/profile","hint":"换绑成功，请用新手机号登录"}}')
  // 提示只对换号有效，别的原因一律回首页。
  const r2 = recorder()
  m.runEndKioskUse('end_use', r2.steps, { loginHint: '不该带过去' })
  assert.equal(r2.calls.at(-1), 'leave:{"path":"/"}')
})

test('哪一步出错，后面几步照样走完（宁可多清，不能半清）', async () => {
  const m = await loadModule('src/auth/kioskEndUse.ts')
  for (const bad of ['endVisit', 'clearLocal', 'logout']) {
    const r = recorder(new Set([bad]))
    assert.doesNotThrow(() => m.runEndKioskUse('handover', r.steps), bad)
    assert.deepEqual(
      r.calls.map((c) => c.split(':')[0]),
      ['endVisit', 'clearLocal', 'logout', 'leave'],
      `${bad} 抛错后仍然退出登录并离开`,
    )
  }
})

test('「还是你吗？」：进来之前空了 30 秒以上才问，30 秒内不问', async () => {
  const p = await loadPresence()
  const t0 = 1_000_000
  // 刚加载、从没见过触碰：不知道 = 很久，先问。
  assert.equal(p.needsHandoverConfirm(t0), true)

  // 首页上点过一下；31 秒后点「我的」（这一下连着 touchstart / pointerdown 两个事件），立刻进页。
  p.recordKioskTouch(t0)
  p.recordKioskTouch(t0 + 31_000)
  p.recordKioskTouch(t0 + 31_020)
  assert.equal(p.needsHandoverConfirm(t0 + 31_100), true, '点进来的那一下不能算「刚点过」')

  // 10 秒后再点：之前只空了 10 秒，不问。
  p.recordKioskTouch(t0 + 41_000)
  assert.equal(p.needsHandoverConfirm(t0 + 41_050), false)

  // 不点屏幕、浏览器后退 / 程序跳转进来：按距今时长算。
  assert.equal(p.needsHandoverConfirm(t0 + 41_000 + 29_000), false)
  assert.equal(p.needsHandoverConfirm(t0 + 41_000 + 30_001), true)
})

test('登录成功、答「是我，继续」算本人刚确认过', async () => {
  const p = await loadPresence()
  const t0 = 5_000_000
  p.recordKioskTouch(t0)
  // 扫码登录：屏幕 60 秒没人点，手机上登进来。
  p.markKioskPresenceConfirmed(t0 + 60_000)
  assert.equal(p.needsHandoverConfirm(t0 + 60_200), false)
  // 之后又空了 31 秒才进「我的」：照样要问。
  assert.equal(p.needsHandoverConfirm(t0 + 60_000 + 31_000), true)
})

test('弹出了没回答就是待确认：之后空多久、怎么进来都先问；没有标记时同样的触碰不会再问（被堵上的洞）', async () => {
  const t0 = 9_000_000
  // 上一位在 t0 点过最后一下，走开 36 秒；下一位点「我的」，确认层弹出（点进来的那一下之前空了 36 秒）。
  // 之后他去别处再回来：每两下间隔 4 秒（超过 1 秒才算新的一下），点进来之前只空了 4 秒。
  const touches = [t0, t0 + 36_000, t0 + 40_000, t0 + 44_000]
  const entryAt = touches.at(-1) + 100

  const withMarker = await loadPresence()
  withMarker.recordKioskTouch(touches[0])
  withMarker.recordKioskTouch(touches[1])
  assert.equal(withMarker.needsHandoverConfirm(touches[1] + 100), true, '空了 36 秒后点「我的」：确认层弹出')
  assert.equal(withMarker.isHandoverPending(), false, '光是判过一次不算弹出，标记由确认层出现时记下')
  withMarker.markHandoverPending()
  assert.equal(withMarker.isHandoverPending(), true)
  for (const at of touches.slice(2)) withMarker.recordKioskTouch(at)
  assert.equal(withMarker.needsHandoverConfirm(entryAt), true, '待确认期间，隔几秒再点底导航「我的」仍然要问')
  // 不点屏幕、后退或程序跳转进来（按距今时长算）同样要问；时间过去多久都不会自己解除。
  assert.equal(withMarker.needsHandoverConfirm(entryAt + 5_000), true)
  assert.equal(withMarker.needsHandoverConfirm(entryAt + 29_000), true)
  assert.equal(withMarker.needsHandoverConfirm(entryAt + 600_000), true)
  assert.equal(withMarker.isHandoverPending(), true)

  // 对照：同样的触碰、没有待确认标记，进页前只空了 4 秒，旧判据不会再问——这就是被堵上的洞。
  const without = await loadPresence()
  for (const at of touches) without.recordKioskTouch(at)
  assert.equal(without.needsHandoverConfirm(entryAt), false)
})

test('待确认只在本人答「是我」、清场退出登录、新的一位登录成功时解除，别的都解除不了', async () => {
  const p = await loadPresence()
  const t0 = 11_000_000
  p.recordKioskTouch(t0)

  // 本人答「是我，继续」或新的一位登录成功（同一个 markKioskPresenceConfirmed）：解除，并算刚确认过。
  p.markHandoverPending()
  p.markKioskPresenceConfirmed(t0 + 40_000)
  assert.equal(p.isHandoverPending(), false)
  assert.equal(p.needsHandoverConfirm(t0 + 40_200), false)

  // 清场、退出登录：解除。解除后回到只看空闲时长的老判据（这里空了 31 秒就问）。
  p.markHandoverPending()
  assert.equal(p.needsHandoverConfirm(t0 + 40_300), true)
  p.clearHandoverPending()
  assert.equal(p.isHandoverPending(), false)
  assert.equal(p.needsHandoverConfirm(t0 + 40_300), false)
  assert.equal(p.needsHandoverConfirm(t0 + 40_000 + 31_000), true)

  // 触碰、时间流逝都不能解除它。
  p.markHandoverPending()
  p.recordKioskTouch(t0 + 100_000)
  p.recordKioskTouch(t0 + 104_000)
  assert.equal(p.isHandoverPending(), true)
  assert.equal(p.needsHandoverConfirm(t0 + 104_100), true)

  // 测试用的重置回到刚加载的状态：不留标记。
  p.resetKioskPresenceForTest()
  assert.equal(p.isHandoverPending(), false)
})

test('待确认标记只在内存里：整套判断不碰任何浏览器存储、不改地址', async () => {
  const touched = []
  const trap = (name) => new Proxy(function trapped() {}, {
    get(_target, prop) { touched.push(`${name}.${String(prop)}`); return undefined },
    set(_target, prop) { touched.push(`${name}.${String(prop)}=`); return true },
    apply() { touched.push(`${name}()`) },
  })
  const names = ['localStorage', 'sessionStorage', 'indexedDB', 'document', 'history', 'location', 'navigator']
  // 先把模块加载好（转译器和 Node 自己可能读这些全局），陷阱只罩住对外那几个函数的调用。
  const p = await loadPresence()
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
  for (const name of names) Object.defineProperty(globalThis, name, { value: trap(name), configurable: true, writable: true })
  try {
    p.recordKioskTouch(1_000)
    p.markHandoverPending()
    p.isHandoverPending()
    p.needsHandoverConfirm(40_000)
    p.clearHandoverPending()
    p.markHandoverPending()
    p.markKioskPresenceConfirmed(50_000)
    p.resetKioskPresenceForTest()
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
  assert.deepEqual(touched, [], '标记不得写进 localStorage / sessionStorage / indexedDB / cookie / history / 地址')
})

test('阈值来自 kioskIdleTiming 的 30 秒常量', async () => {
  const timing = readFileSync(join(kioskRoot, 'src/auth/kioskIdleTiming.ts'), 'utf8')
  assert.match(timing, /export const KIOSK_HANDOVER_CONFIRM_MS = 30_000/)
  const presence = readFileSync(join(kioskRoot, 'src/auth/kioskPresence.ts'), 'utf8')
  assert.match(presence, /import \{ KIOSK_HANDOVER_CONFIRM_MS \} from '\.\/kioskIdleTiming'/)
})
