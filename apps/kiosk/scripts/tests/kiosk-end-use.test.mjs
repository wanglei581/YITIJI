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
 *   4. 空档一到判据时长就**当时**记待确认（10/29 首页包实测的洞：下一位先碰别处、隔几秒再点「我的」，
 *      进页前只空了几秒，旧判据不问）：定时器到点就记，下一次触碰发现空档早已超时也在这一下之前补记；
 *      每一次触碰、登录成功、答「是我」都让空档重新计；在场一直有操作就一直不记，不误弹。
 *
 * 模块用 typescript 转成 JS 后直接 import；kioskPresence 对 kioskIdleTiming 的相对引用
 * 换成同值常量（值本身另由 verify-kiosk-end-use 对照源码）。
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
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

  // 一直在场、只空了 10 秒再点：不问；不点屏幕、浏览器后退 / 程序跳转进来：按距今时长算。
  // （另起一个干净模块：上面那个已经把空了 31 秒记成了待确认，之后怎么碰都只有本人答「是我」才解除。）
  const present = await loadPresence()
  present.recordKioskTouch(t0)
  present.recordKioskTouch(t0 + 10_000)
  assert.equal(present.needsHandoverConfirm(t0 + 10_050), false)
  assert.equal(present.needsHandoverConfirm(t0 + 10_000 + 29_000), false)
  assert.equal(present.needsHandoverConfirm(t0 + 10_000 + 30_001), true)
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

test('空档一到判据时长就当时记待确认：下一位先碰别处、隔几秒再点「我的」照样要问，时间和触碰都解除不了（被堵上的洞）', async () => {
  const t0 = 9_000_000
  // 上一位在 t0 点过最后一下，走开 36 秒；下一位先碰屏上别处（第一下），之后每两下间隔 4 秒（超过 1 秒才算新的一下），
  // 点「我的」那一下之前只空了 4 秒——旧判据只看这个，不会问；确认层也从没弹过，没有谁来记标记。
  const touches = [t0, t0 + 36_000, t0 + 40_000, t0 + 44_000]
  const entryAt = touches.at(-1) + 100

  const p = await loadPresence()
  p.recordKioskTouch(touches[0])
  assert.equal(p.isHandoverPending(), false, '上一位刚点过，还没空到判据时长')
  p.recordKioskTouch(touches[1])
  assert.equal(p.isHandoverPending(), true, '空了 36 秒：下一位的第一下触碰到来时就已记为待确认（不等确认层、不等进页）')
  for (const at of touches.slice(2)) p.recordKioskTouch(at)
  assert.equal(p.needsHandoverConfirm(entryAt), true, '隔几秒再点底导航「我的」仍然要问（进页前只空了 4 秒）')
  // 不点屏幕、后退或程序跳转进来同样要问；时间过去多久都不会自己解除。
  for (const later of [5_000, 29_000, 600_000]) assert.equal(p.needsHandoverConfirm(entryAt + later), true)
  assert.equal(p.isHandoverPending(), true)

  // 交接页弹出时再记一次（KioskHandoverGate 的老路径）：不改变什么，仍是待确认。
  p.markHandoverPending()
  assert.equal(p.isHandoverPending(), true)
})

test('在场一直有操作（每两下之间都不到判据时长）不记待确认，不误弹', async () => {
  const p = await loadPresence()
  const t0 = 9_500_000
  // 20 秒一下，持续 5 分钟：累计远超 30 秒，但从没有哪两下之间空到 30 秒。
  for (let i = 0; i <= 15; i += 1) p.recordKioskTouch(t0 + i * 20_000)
  assert.equal(p.isHandoverPending(), false)
  // 再点一下「我的」：进页前只空了 20 秒，不问。
  const entryTouch = t0 + 16 * 20_000
  p.recordKioskTouch(entryTouch)
  assert.equal(p.needsHandoverConfirm(entryTouch + 100), false)
  assert.equal(p.isHandoverPending(), false)
})

test('从没见过触碰就弹出的确认层（刚加载）：之后隔几秒怎么碰都仍待确认（交接页自己记的标记）', async () => {
  const p = await loadPresence()
  const t0 = 9_800_000
  assert.equal(p.needsHandoverConfirm(t0), true, '从没见过触碰：不知道 = 很久，先问')
  p.markHandoverPending()
  for (const at of [t0 + 1_000, t0 + 5_000, t0 + 9_000, t0 + 13_000]) p.recordKioskTouch(at)
  assert.equal(p.needsHandoverConfirm(t0 + 13_100), true, '确认层弹出过没回答：隔几秒再点仍要问')
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

test('定时判：满 30 秒没有任何触碰，定时器到点就当时记待确认；记下之后触碰和时间都解除不了', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const p = await loadPresence()
    p.recordKioskTouch(1_000)
    mock.timers.tick(29_999)
    assert.equal(p.isHandoverPending(), false, '还差 1 毫秒，没到判据时长')
    mock.timers.tick(1)
    assert.equal(p.isHandoverPending(), true, '满 30 秒没人碰：到点当时就记，不等进页、不等确认层')
    p.recordKioskTouch(40_000)
    mock.timers.tick(120_000)
    assert.equal(p.isHandoverPending(), true)
    assert.equal(p.needsHandoverConfirm(41_000), true)
  } finally {
    mock.timers.reset()
  }
})

test('每一次触碰都重新计空档：在场一直有操作，定时器永远到不了点', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const p = await loadPresence()
    let at = 1_000
    // 20 秒一下，持续 400 秒。
    for (let i = 0; i < 20; i += 1) {
      p.recordKioskTouch(at)
      mock.timers.tick(20_000)
      at += 20_000
    }
    assert.equal(p.isHandoverPending(), false)
    // 最后一下之后真的走开了：再满 30 秒才记。
    mock.timers.tick(10_000)
    assert.equal(p.isHandoverPending(), true)
  } finally {
    mock.timers.reset()
  }
})

test('登录成功、答「是我」之后空档从这一刻重新计：旧定时器不会把刚确认过的人又记成待确认', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const p = await loadPresence()
    p.recordKioskTouch(1_000)
    mock.timers.tick(29_000) // 距上一下触碰 29 秒，旧定时器还差 1 秒到点
    p.markKioskPresenceConfirmed(30_000) // 扫码登录成功
    mock.timers.tick(2_000) // 旧定时器本该在这里到点
    assert.equal(p.isHandoverPending(), false, '登录成功之后重新计时，不该被旧定时器误记')
    mock.timers.tick(28_001) // 从确认那一刻起满 30 秒
    assert.equal(p.isHandoverPending(), true)
    // 记下之后本人再答「是我」：解除，并且又从这一刻重新计。
    p.markKioskPresenceConfirmed(61_000)
    assert.equal(p.isHandoverPending(), false)
    mock.timers.tick(29_999)
    assert.equal(p.isHandoverPending(), false)
  } finally {
    mock.timers.reset()
  }
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
