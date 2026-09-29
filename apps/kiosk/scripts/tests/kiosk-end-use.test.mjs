/**
 * 统一清场 endKioskUse —— **行为**测试（不是文本断言）。
 *
 * 守的两件事（产品负责人 9/29「两处都堵，30 秒」）：
 *   1. runEndKioskUse 的四步顺序：结束人次 → 清本机数据 → 退出登录 → 离开；
 *      哪一步抛错后面几步照样走完（半清比多清危险）；目的地只有换号去登录页，其余回首页。
 *   2. 「还是你吗？」的判据：进个人资产页之前这台机器空了超过 30 秒才问；
 *      点进来的那一下不算「刚点过」；后退 / 深链按距今时长算；登录成功算本人刚确认过。
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

test('阈值来自 kioskIdleTiming 的 30 秒常量', async () => {
  const timing = readFileSync(join(kioskRoot, 'src/auth/kioskIdleTiming.ts'), 'utf8')
  assert.match(timing, /export const KIOSK_HANDOVER_CONFIRM_MS = 30_000/)
  const presence = readFileSync(join(kioskRoot, 'src/auth/kioskPresence.ts'), 'utf8')
  assert.match(presence, /import \{ KIOSK_HANDOVER_CONFIRM_MS \} from '\.\/kioskIdleTiming'/)
})
