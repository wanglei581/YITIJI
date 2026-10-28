/**
 * 首页「继续办理」交接保护 —— **行为**测试（不是文本断言）。
 *
 * 守的三件事（隐私 P0，第六包取证 7.2 条；浏览器端到端见 tests/visual/home-continue-handover.spec.ts）：
 *   1. 粘性：记成「收起」之后只认记下它时的那张令牌；换了令牌（新的一位登录）就不收；
 *      判成要确认就收，没登录（没有令牌指纹）什么都不收；记同一张重复记没有副作用，订阅者只在变化时被叫。
 *   2. 令牌指纹：同一张令牌同一个值、不同令牌不同值，8 位十六进制，值里不含令牌本身。
 *   3. 「刚确认过」的判法 presenceJustConfirmed 所依赖的前提——**普通触碰永远不会把「进页之前空了多久」
 *      记成恰好 0，只有 markKioskPresenceConfirmed 会**——用真正的 kioskPresence 逐种触碰序列验一遍。
 *      这条前提一旦被改动破坏（普通触碰也能记出 0），首页「答『是我』后面板回来」就会误解除或解除不了，
 *      这里先红，提醒去改 presenceJustConfirmed。
 *
 * 模块用 typescript 转成 JS 后直接 import；continueHandover 对 kioskPresence 的引用换成读 globalThis，
 * kioskPresence 对 kioskIdleTiming 的引用换成同值常量（值本身另由 verify-kiosk-end-use 对照源码）。
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
  // 每次都是新模块：模块级状态（最近一次触碰、收起的令牌）不能在 case 之间串。
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(js)}%0A//${seq++}`)
}

const loadPresence = () => loadModule('src/auth/kioskPresence.ts', (s) => {
  const timing = readFileSync(join(kioskRoot, 'src/auth/kioskIdleTiming.ts'), 'utf8')
  const ms = timing.match(/KIOSK_HANDOVER_CONFIRM_MS = ([\d_]+)/)[1]
  return s.replace(/import \{ KIOSK_HANDOVER_CONFIRM_MS \} from '\.\/kioskIdleTiming'/, `const KIOSK_HANDOVER_CONFIRM_MS = ${ms}`)
})

async function loadHold(presence) {
  globalThis.__presence = presence
  return loadModule('src/pages/home/continueHandover.ts', (s) => {
    const patched = s.replace(
      /import \{ idleBeforeEntryMs \} from '\.\.\/\.\.\/auth\/kioskPresence'/,
      'const idleBeforeEntryMs = (now) => globalThis.__presence.idleBeforeEntryMs(now)',
    )
    assert.notEqual(patched, s, '源码里对 kioskPresence 的引用写法变了，测试的替换要跟着改')
    return patched
  })
}

test('令牌指纹：同一张同一个值，不同令牌不同值，8 位十六进制，不含令牌本身', async () => {
  const m = await loadHold(await loadPresence())
  const a = 'member-token-wang-xiaoyu'
  const b = 'member-token-chen-lixing'
  assert.match(m.tokenFingerprint(a), /^[0-9a-f]{8}$/)
  assert.equal(m.tokenFingerprint(a), m.tokenFingerprint(a))
  assert.notEqual(m.tokenFingerprint(a), m.tokenFingerprint(b))
  assert.ok(!a.includes(m.tokenFingerprint(a)) && !m.tokenFingerprint(a).includes(a))
})

test('收起判定：没登录不收；记过的令牌收；换了令牌不收；判成要确认就收', async () => {
  const m = await loadHold(await loadPresence())
  const wang = m.tokenFingerprint('member-token-wang-xiaoyu')
  const chen = m.tokenFingerprint('member-token-chen-lixing')
  // 没登录：没有令牌指纹，没有什么可收（面板自己什么都不画）。
  assert.equal(m.isContinueHeld(null, null, true), false)
  assert.equal(m.isContinueHeld(wang, null, true), false)
  // 登录着、没记过、判据说不用确认：不收。
  assert.equal(m.isContinueHeld(null, wang, false), false)
  // 判据说要确认：收（渲染期就拦住，面板不挂载）。
  assert.equal(m.isContinueHeld(null, wang, true), true)
  // 已经记成收起：判据后来翻回「不用确认」也还是收——这就是粘性。
  assert.equal(m.isContinueHeld(wang, wang, false), true)
  // 记的是另一位的令牌：新登录的这一位不受牵连。
  assert.equal(m.isContinueHeld(wang, chen, false), false)
})

test('记收起 / 解除：重复记同一张不重复通知，解除后清空，退订后不再通知', async () => {
  const m = await loadHold(await loadPresence())
  const wang = m.tokenFingerprint('member-token-wang-xiaoyu')
  const chen = m.tokenFingerprint('member-token-chen-lixing')
  let notified = 0
  const unsubscribe = m.subscribeContinueHold(() => { notified += 1 })
  assert.equal(m.continueHeldFor(), null)

  m.holdContinueFor(wang)
  assert.equal(m.continueHeldFor(), wang)
  assert.equal(notified, 1)
  m.holdContinueFor(wang)
  assert.equal(notified, 1, '重复记同一张令牌不该再通知')

  m.holdContinueFor(chen)
  assert.equal(m.continueHeldFor(), chen, '只有一格：新记的覆盖旧的')
  assert.equal(notified, 2)

  m.releaseContinueHold()
  assert.equal(m.continueHeldFor(), null)
  assert.equal(notified, 3)
  m.releaseContinueHold()
  assert.equal(notified, 3, '没有收起时解除没有副作用')

  unsubscribe()
  m.holdContinueFor(wang)
  assert.equal(notified, 3, '退订之后不再被叫')
})

test('刚确认过：只有 markKioskPresenceConfirmed 会让「进页之前空了多久」恰好为 0，普通触碰永远不会', async () => {
  const presence = await loadPresence()
  const m = await loadHold(presence)
  const T = 1_000_000

  // 刚加载、从没见过触碰：不知道 = 无穷大，不算确认过。
  presence.resetKioskPresenceForTest()
  assert.equal(m.presenceJustConfirmed(T), false)

  // 第一下触碰（从没见过上一下）：无穷大，不是 0。
  presence.recordKioskTouch(T)
  assert.equal(m.presenceJustConfirmed(T), false)
  // 隔了 3 秒再碰：记成 3000，不是 0。同一下连着触发（500 毫秒内）不重算，值不变。
  presence.recordKioskTouch(T + 3_000)
  assert.equal(m.presenceJustConfirmed(T + 3_000), false)
  presence.recordKioskTouch(T + 3_500)
  assert.equal(m.presenceJustConfirmed(T + 3_500), false)
  // 空了 45 秒之后的一下：记成 45 秒，不是 0。
  presence.recordKioskTouch(T + 48_500)
  assert.equal(m.presenceJustConfirmed(T + 48_500), false)
  // 之后任何时刻（点进来的 2 秒窗口里、窗口外）都不是 0。
  for (const dt of [0, 500, 1_999, 2_001, 20_000, 31_000]) {
    assert.equal(m.presenceJustConfirmed(T + 48_500 + dt), false, `+${dt}ms`)
  }

  // 登录成功 / 答「是我，继续」：恰好 0，并且在下一下「新的」触碰之前一直是 0。
  const C = T + 100_000
  presence.markKioskPresenceConfirmed(C)
  assert.equal(m.presenceJustConfirmed(C), true)
  assert.equal(m.presenceJustConfirmed(C + 500), true)
  presence.recordKioskTouch(C + 600) // 同一下手势里连着触发的触碰事件，不算新的一下
  assert.equal(m.presenceJustConfirmed(C + 600), true)
  // 隔了 3 秒的下一下是新的一下：记成 3000，确认过的窗口关上。
  presence.recordKioskTouch(C + 3_600)
  assert.equal(m.presenceJustConfirmed(C + 3_600), false)
})
