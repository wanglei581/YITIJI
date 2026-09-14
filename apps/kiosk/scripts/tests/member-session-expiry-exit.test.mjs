/**
 * 401 出口 —— **行为**测试（不是文本断言）。
 *
 * 守的那句话：**401 之后本机同步清干净，但「回登录页」这一步要等服务端确认上一场
 * 扫描已经不可能再收到文件。** 缺陷成因写在 src/auth/memberSessionExpiryExit.ts，
 * 这里不复述。
 *
 * 下面每条判据源码断言都证明不了，只有跑起来才看得出真假：
 *   · 「没有扫描会话时一帧都不多等」—— assign 是不是在 `expire()` 里**同步**发生；
 *   · 「没拿到确认就不许跳」—— 5xx / 断网 / 403 之后 assign 有没有被调用；
 *   · 「等得到头」—— 走到服务端给的有效期之后它有没有自己放行；
 *   · 「本机清场不等网络」—— 闸还按着的时候 clearLocalSession 跑没跑；
 *   · 「至多跳一次」—— 重复 401 / cancel 之后 / 跳完之后 assign 的次数。
 *
 * 每个 case 新装一份模块（模块级状态必须每次归零），时间与定时器是假的，
 * `fetch` 会记账，`window.location.assign` 只记账不跳转。
 *
 * 取实例一律走 `getMemberSessionExpiryExit()` —— 生产里 AuthProvider 走的就是它。
 * 用一个 case 私有的工厂会把「全页只有一个 owner」这条判据测没了，而那正是
 * 2026-09-15 第二轮被 Grok 抓到的那个 P1。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (relativePath, fileName) => ts.transpileModule(
  readFileSync(join(root, relativePath), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName },
).outputText

const API_BASE_URL = '/api/v1'
const ORIGIN = 'http://127.0.0.1:4191'
const TERMINAL_ID = 'KSK-001'
/** 假时钟的起点。用一个固定值，断言里的「有效期」才好算。 */
const T0 = 1_800_000_000_000
const TEN_MINUTES = 10 * 60 * 1000
const MEMBER_TOKEN = 'expiring-member-token'
const SCAN_TASK_ID = 'scan-401'
const CONTROL_TOKEN = 'control-401'

let seed = 0

/**
 * 装一份被测出口，**连着真的收尾闸和真的撤销实现**一起装：用替身替掉闸就等于把要测的
 * 东西自己写一遍。只有 node 里装不起来的两个依赖走替身（`client` 会把 `import.meta.env`
 * 拖进来、`screensaver` 是终端 id），本机扫描登记由 case 控制。
 *
 * @param {{
 *   session?: unknown,
 *   pathname?: string,
 *   search?: string,
 *   fetchImpl?: (url: string, init: unknown) => unknown,
 * }} options
 */
async function loadExit(options = {}) {
  seed += 1
  const key = `expiry-${seed}`
  const calls = []
  const assigned = []
  globalThis.__expiryBoxes = globalThis.__expiryBoxes ?? new Map()
  globalThis.__expiryBoxes.set(key, { session: options.session ?? null })

  const clientStub = toDataUrl(`export const API_BASE_URL = ${JSON.stringify(API_BASE_URL)}`)
  const screensaverStub = toDataUrl(`export function getTerminalId() { return ${JSON.stringify(TERMINAL_ID)} }`)
  const sessionStub = toDataUrl(`
export function readScanWorkbenchSession() {
  const box = globalThis.__expiryBoxes.get(${JSON.stringify(key)})
  if (box.session instanceof Error) throw box.session
  return box.session ?? undefined
}
`)

  const revokeUrl = toDataUrl(
    `${transpile('src/pages/scan/scanSessionRevoke.ts', 'scanSessionRevoke.ts')}\n// instance ${seed}\n`
      .replaceAll("'../../services/api/client'", `'${clientStub}'`)
      .replaceAll("'../../services/api/screensaver'", `'${screensaverStub}'`)
      .replaceAll("'./scanWorkbenchSession'", `'${sessionStub}'`),
  )
  const modelUrl = toDataUrl(
    `${transpile('src/pages/scan/scanSettingsModel.ts', 'scanSettingsModel.ts')}\n// instance ${seed}\n`,
  )
  const gateUrl = toDataUrl(
    `${transpile('src/pages/scan/scanCleanupGate.ts', 'scanCleanupGate.ts')}\n// instance ${seed}\n`
      .replaceAll("'./scanSettingsModel'", `'${modelUrl}'`)
      .replaceAll("'./scanSessionRevoke'", `'${revokeUrl}'`)
      .replaceAll("'./scanWorkbenchSession'", `'${sessionStub}'`),
  )
  const returnPathUrl = toDataUrl(
    `${transpile('src/auth/returnPath.ts', 'returnPath.ts')}\n// instance ${seed}\n`,
  )
  const exitCode = `${transpile('src/auth/memberSessionExpiryExit.ts', 'memberSessionExpiryExit.ts')}\n// instance ${seed}\n`
    .replaceAll("'../pages/scan/scanCleanupGate'", `'${gateUrl}'`)
    .replaceAll("'./returnPath'", `'${returnPathUrl}'`)

  // 假时钟 + 假定时器：闸的退避表、稳定重试、自然过期全按时间判，真等要跑十分钟。
  let now = T0
  let timerSeq = 0
  const timers = new Map()
  globalThis.window = {
    location: {
      origin: ORIGIN,
      pathname: options.pathname ?? '/profile/me',
      search: options.search ?? '',
      hash: '',
      assign: (url) => { assigned.push(String(url)) },
    },
    setTimeout: (fn, ms) => {
      timerSeq += 1
      timers.set(timerSeq, { at: now + (Number(ms) || 0), fn })
      return timerSeq
    },
    clearTimeout: (id) => { timers.delete(id) },
    addEventListener: () => undefined,
  }
  const realDateNow = Date.now
  Date.now = () => now

  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init })
    const impl = options.fetchImpl
    if (impl) return impl(String(url), init)
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  }

  const gate = await import(gateUrl)
  const mod = await import(toDataUrl(exitCode))

  const flush = async () => {
    for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  const advance = async (ms) => {
    const target = now + ms
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = Math.max(now, due[1].at)
      due[1].fn()
      await flush()
    }
    now = target
    await flush()
  }

  /**
   * 站在 `logout()` 的位置：**同步**清本机，并把要撤的那一场交给收尾闸。
   * 真实 logout 走 `clearKioskSensitiveSession` → `beginScanSessionCleanup`；
   * 其余（打印材料、收藏残留）与 401 时序无关，这里不复刻。
   */
  const localClear = { count: 0 }
  const clearLocalSession = () => {
    localClear.count += 1
    gate.beginScanSessionCleanup(MEMBER_TOKEN)
  }

  return {
    mod,
    gate,
    calls,
    assigned,
    localClear,
    clearLocalSession,
    flush,
    advance,
    restore: () => { Date.now = realDateNow },
  }
}

const liveSession = (overrides = {}) => ({
  stage: 'settings',
  scanType: 'resume',
  live: {
    scanTaskId: SCAN_TASK_ID,
    controlToken: CONTROL_TOKEN,
    instructions: ['放好原件'],
    expiresAt: new Date(T0 + TEN_MINUTES).toISOString(),
    ...overrides,
  },
})

const jsonError = (status, code) => Promise.resolve({
  ok: false,
  status,
  json: () => Promise.resolve({ success: false, error: { code, message: '服务端原文不许上屏' } }),
})

test('没有待清理扫描会话时，401 立即回登录页（同步跳一次，一个撤销请求都不发）', async () => {
  const harness = await loadExit({ session: null })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    exit.expire(harness.clearLocalSession)
    // 一次 await 都没有：最常见的那条路径上时序必须和这条闸出现之前一模一样。
    assert.equal(harness.localClear.count, 1)
    assert.deepEqual(harness.assigned, ['/login?from=%2Fprofile%2Fme'])
    assert.equal(harness.calls.length, 0, '没有 live 就没有可撤的东西，不许平白发请求')
  } finally {
    harness.restore()
  }
})

test('撤销还没拿到确认时不跳转，但本机 401 清场已经同步做完了', async () => {
  const harness = await loadExit({
    session: liveSession(),
    fetchImpl: () => jsonError(500, 'INTERNAL_ERROR'),
  })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    exit.expire(harness.clearLocalSession)
    // 本机那一半是同步的：闸还按着，PII / 令牌 / 登录态一秒都不许多留。
    assert.equal(harness.localClear.count, 1, '本机清场不等网络')
    assert.deepEqual(harness.assigned, [], '服务端还没说话就不许换人')
    await harness.flush()
    assert.deepEqual(harness.assigned, [])
    // 退避表跑满几轮，仍然一次 5xx 都没变成确认。
    await harness.advance(20_000)
    assert.ok(harness.calls.length >= 3, `应当持续重试，实际 ${harness.calls.length} 次`)
    assert.deepEqual(harness.assigned, [], '5xx 一直不给结论就一直等，不许提前跳')
    assert.equal(harness.gate.scanCleanupHolding(), true)
  } finally {
    harness.restore()
  }
})

test('断网（请求根本发不出去）同样不跳转', async () => {
  const harness = await loadExit({
    session: liveSession(),
    fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
  })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    exit.expire(harness.clearLocalSession)
    await harness.advance(20_000)
    assert.equal(harness.localClear.count, 1)
    assert.deepEqual(harness.assigned, [], '连不上服务端时本机说不出「已经撤掉」，不许换人')
    assert.equal(harness.gate.scanCleanupStatus().lastOutcome, 'unreachable')
  } finally {
    harness.restore()
  }
})

test('403 之后 fallback 也被拒时不跳转（没走完 fallback 更不许跳）', async () => {
  const harness = await loadExit({
    session: liveSession(),
    fetchImpl: () => jsonError(403, 'SCAN_TASK_FORBIDDEN'),
  })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    exit.expire(harness.clearLocalSession)
    await harness.flush()
    // 第一次带身份被 403 → 摘掉身份再试一次（服务端为「登出之后仍要撤得掉」留的路）。
    assert.equal(harness.calls.length, 2, '403 必须走完那条只凭 controlToken 的 fallback')
    assert.deepEqual(harness.assigned, [])
    await harness.advance(20_000)
    assert.deepEqual(harness.assigned, [], '凭据被拒时服务端并没有说「撤掉了」，不许换人')
    assert.equal(harness.gate.scanCleanupStatus().lastOutcome, 'rejected')
  } finally {
    harness.restore()
  }
})

test('服务端确认撤掉之后才跳，并且只跳一次', async () => {
  let confirm = false
  const harness = await loadExit({
    session: liveSession(),
    fetchImpl: () => (confirm
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) })
      : jsonError(500, 'INTERNAL_ERROR')),
  })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    exit.expire(harness.clearLocalSession)
    await harness.advance(5_000)
    assert.deepEqual(harness.assigned, [])
    confirm = true
    await harness.advance(10_000)
    assert.deepEqual(harness.assigned, ['/login?from=%2Fprofile%2Fme'], '确认之后才放行，且只放行一次')
    assert.equal(harness.gate.scanCleanupHolding(), false)
    // 又来一发 401：页面正在跳走，不许再跳第二次。
    exit.expire(harness.clearLocalSession)
    await harness.advance(10_000)
    assert.equal(harness.assigned.length, 1, '至多跳一次')
  } finally {
    harness.restore()
  }
})

test('服务端一直不回话时，走到真实 expiresAt 才放行，且只跳一次', async () => {
  const harness = await loadExit({
    session: liveSession(),
    fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
  })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    exit.expire(harness.clearLocalSession)
    await harness.advance(TEN_MINUTES - 1_000)
    assert.deepEqual(harness.assigned, [], '有效期之前一直等：这一场服务端还签得出租约')
    // 过了服务端给的有效期：租约查询带 `expiresAt > now`，此后签不出它。
    await harness.advance(11_000)
    assert.deepEqual(harness.assigned, ['/login?from=%2Fprofile%2Fme'])
    assert.equal(harness.gate.scanCleanupHolding(), false)
  } finally {
    harness.restore()
  }
})

test('等待期间重复 401 既不重复清本机，也不重复登记跳转', async () => {
  let confirm = false
  const harness = await loadExit({
    session: liveSession(),
    fetchImpl: () => (confirm
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) })
      : jsonError(503, 'SERVICE_UNAVAILABLE')),
  })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    exit.expire(harness.clearLocalSession)
    for (let i = 0; i < 5; i += 1) exit.expire(harness.clearLocalSession)
    await harness.advance(5_000)
    assert.equal(harness.localClear.count, 1, '第一次就已经清干净了，重复 401 不该再清一遍')
    assert.deepEqual(harness.assigned, [])
    confirm = true
    await harness.advance(20_000)
    assert.equal(harness.assigned.length, 1, '五发 401 只换来一次跳转')
  } finally {
    harness.restore()
  }
})

test('clearLocalSession 自己调了 cancel()，这次跳转仍然登记得上（登记排在清场之后）', async () => {
  let confirm = false
  const harness = await loadExit({
    session: liveSession(),
    fetchImpl: () => (confirm
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) })
      : jsonError(500, 'INTERNAL_ERROR')),
  })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    /* AuthProvider 传进来的就是 `logout`，而 logout 是手工登出 / 隐私清场共用的那一个。
     * 只要有人往 logout 里加一句 cancel()，这条断言就要求「登记仍然发生」——
     * 登记必须排在清场之后，不能反过来被自己的清场撤掉。 */
    exit.expire(() => {
      exit.cancel()
      harness.clearLocalSession()
    })
    await harness.advance(3_000)
    assert.deepEqual(harness.assigned, [], '闸还按着就不许跳')
    confirm = true
    await harness.advance(20_000)
    assert.equal(harness.assigned.length, 1, '确认之后这次跳转必须照常发生，不能被自己的清场吞掉')
  } finally {
    harness.restore()
  }
})

test('等待期间这一位重新登录：cancel() 之后不再把他踢去登录页', async () => {
  const harness = await loadExit({
    session: liveSession(),
    fetchImpl: () => jsonError(500, 'INTERNAL_ERROR'),
  })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    exit.expire(harness.clearLocalSession)
    await harness.advance(3_000)
    assert.deepEqual(harness.assigned, [])
    exit.cancel() // login() 走的这一条
    await harness.advance(TEN_MINUTES + 10_000)
    assert.deepEqual(harness.assigned, [], '已经重新登录的人不该被旧的过期跳转打断')
  } finally {
    harness.restore()
  }
})

test('卸载（cancel）之后的新一发 401 仍然能重新登记并跳一次', async () => {
  const harness = await loadExit({ session: null })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    // StrictMode：订阅建了又拆。拆的时候什么都还没发生。
    exit.cancel()
    exit.expire(harness.clearLocalSession)
    assert.deepEqual(harness.assigned, ['/login?from=%2Fprofile%2Fme'], '解除武装不能变成永远不再跳')
  } finally {
    harness.restore()
  }
})

test('跳过一次之后即使再 cancel，也不会跳第二次', async () => {
  const harness = await loadExit({ session: null })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    exit.expire(harness.clearLocalSession)
    assert.equal(harness.assigned.length, 1)
    exit.cancel()
    exit.expire(harness.clearLocalSession)
    exit.expire(harness.clearLocalSession)
    assert.equal(harness.assigned.length, 1, '一个页面生命周期里至多跳一次')
  } finally {
    harness.restore()
  }
})

test('已经在登录页时不跳转，但本机 401 清场照做', async () => {
  const harness = await loadExit({ session: null, pathname: '/login', search: '?from=%2F' })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    exit.expire(harness.clearLocalSession)
    assert.equal(harness.localClear.count, 1)
    assert.deepEqual(harness.assigned, [], '登录页自循环')
    // 登录页上没有登记过出口，所以下一发 401 仍然要把本机再清一次。
    exit.expire(harness.clearLocalSession)
    assert.equal(harness.localClear.count, 2)
  } finally {
    harness.restore()
  }
})

// ── <AuthProvider key> 重挂：出口的所有权必须跟着页面走，不跟着 React 树走 ──────
//
// `main.tsx` 在 terminalId 从 A 换成 B 时用 `key={identityRevision}` 重挂整棵树。
// 待办的跳转登记在**模块级**的收尾闸上，活得比那棵树久 —— 所以「谁能取消它」这件事
// 必须跨重挂保持同一个答案。第一版把实例挂在 Provider 的 ref 上，重挂就多出一个
// owner：新 Provider 的 login() 取消的是新 owner，旧 owner 照样在闸 settle 之后
// 把刚登进来的这一位 assign 回登录页（2026-09-15 Grok 主对抗审查，bug:true）。
//
// 下面两条是一对，缺一条都测不出那个缺陷：
//   · 重挂后有人登录 → 必须取消得掉（单实例测不到，因为根本没有第二个 owner）；
//   · 重挂后没人登录 → 那条跳转仍然必须走完（只测「别跳」会把整条出口删掉也绿）。

test('Provider 重挂后新用户登录：旧那次过期跳转必须取消得掉（跨重挂唯一 owner）', async () => {
  let confirm = false
  const harness = await loadExit({
    session: liveSession(),
    fetchImpl: () => (confirm
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) })
      : jsonError(500, 'INTERNAL_ERROR')),
  })
  try {
    // Provider #1（terminalId = A）收到 401 并登记跳转，闸这会儿正按着。
    const first = harness.mod.getMemberSessionExpiryExit()
    first.expire(harness.clearLocalSession)
    await harness.advance(3_000)
    assert.deepEqual(harness.assigned, [], '闸还按着就不许跳')

    // terminalId A→B：<AuthProvider key> 重挂，新 Provider 取它自己那一份出口。
    const second = harness.mod.getMemberSessionExpiryExit()
    assert.equal(second, first, '重挂前后必须是同一个 owner，否则新 Provider 取消不了旧的那次登记')

    // 新用户登录 —— AuthProvider.login() 调的就是这一句。
    second.cancel()
    confirm = true
    await harness.advance(20_000)
    assert.deepEqual(
      harness.assigned,
      [],
      '刚登进来的这一位不许被上一次过期的跳转踢回登录页',
    )
  } finally {
    harness.restore()
  }
})

test('Provider 重挂后没人登录：那次过期跳转仍然必须走完，且只走一次', async () => {
  let confirm = false
  const harness = await loadExit({
    session: liveSession(),
    fetchImpl: () => (confirm
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) })
      : jsonError(500, 'INTERNAL_ERROR')),
  })
  try {
    const first = harness.mod.getMemberSessionExpiryExit()
    first.expire(harness.clearLocalSession)
    await harness.advance(3_000)
    // 重挂了，但没有人登录、也没有人取消。
    const second = harness.mod.getMemberSessionExpiryExit()
    assert.equal(second, first)
    confirm = true
    await harness.advance(20_000)
    assert.deepEqual(
      harness.assigned,
      ['/login?from=%2Fprofile%2Fme'],
      '没人接手时这条跳转是必须走完的承诺，不能被重挂悄悄吞掉',
    )
  } finally {
    harness.restore()
  }
})

test('跳转地址里不许出现令牌、控制凭据或任务号', async () => {
  const harness = await loadExit({ session: liveSession(), pathname: '/scan', search: '?stage=settings' })
  try {
    const exit = harness.mod.getMemberSessionExpiryExit()
    exit.expire(harness.clearLocalSession)
    await harness.advance(TEN_MINUTES + 10_000)
    assert.equal(harness.assigned.length, 1)
    const target = harness.assigned[0]
    assert.equal(target, '/login?from=%2Fscan%3Fstage%3Dsettings')
    for (const secret of [MEMBER_TOKEN, CONTROL_TOKEN, SCAN_TASK_ID]) {
      assert.ok(!target.includes(secret), `跳转地址泄露了 ${secret}`)
      assert.ok(!decodeURIComponent(target).includes(secret), `跳转地址（解码后）泄露了 ${secret}`)
    }
  } finally {
    harness.restore()
  }
})
