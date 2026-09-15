/**
 * 扫描会话撤销的去重上限 —— **行为**测试（不是文本断言）。
 *
 * ## 它守的是什么
 *
 * 撤销这条路径上有两个互相拉扯的要求，去重写歪任何一头都会出事：
 *
 *   · 太松 → 一次清场连着触发三条链路（KioskPrivacyGuard.hardClear → logout →
 *     clearKioskSensitiveSession），对同一个任务发三次 DELETE，其中两次纯噪音；
 *   · 太紧 → 离开时那一次 DELETE 在路上丢了（keepalive 请求随文档拆卸被掐断），
 *     而离开那一刻还在飞的那次 **ACK 随后成功了**：服务端那条任务
 *     `deliveryAckedAt` 非空（60 秒未确认回收器收不到它）、状态仍是 waiting
 *     （Agent 的 current-lease 看得见它）—— 一个可投递却没人看着的收件箱，
 *     会活到自然过期，接走下一位用户在面板上扫出来的文件。
 *     补偿那一次 DELETE 被「发过没有」挡掉，正是 2026-09-14 查实的 P1。
 *
 * 所以判据不能是「发过没有」，只能是「已经发了几次」对上「这一次的意图允许几次」。
 * 下面每个 case 新装一份模块（模块级计数必须每次归零），`fetch` 是一个会记账的
 * 假函数，断言的是**它被调了几次、每次带了什么**，不是源码里写了什么字。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

const API_BASE_URL = '/api/v1'
const ORIGIN = 'http://127.0.0.1:4191'
const TERMINAL_ID = 'KSK-001'

let seed = 0

/**
 * 装一份被测模块。
 *
 * 三个外部依赖全部换成替身：`client`（会把 `import.meta.env` 拖进来，node 里装不起来）、
 * `screensaver`（终端 id）、`scanWorkbenchSession`（本机登记）。`fetch` / `window`
 * 走全局，由调用方在 return 的把手里控制。
 *
 * @param {{ session?: unknown, fetchImpl?: (url: string, init: unknown) => unknown }} options
 */
async function loadRevokeModule(options = {}) {
  seed += 1
  const key = `revoke-${seed}`
  const calls = []
  globalThis.__revokeBoxes = globalThis.__revokeBoxes ?? new Map()
  globalThis.__revokeBoxes.set(key, { session: options.session ?? null })

  const clientStub = toDataUrl(`export const API_BASE_URL = ${JSON.stringify(API_BASE_URL)}`)
  const screensaverStub = toDataUrl(`export function getTerminalId() { return ${JSON.stringify(TERMINAL_ID)} }`)
  const sessionStub = toDataUrl(`
export function readScanWorkbenchSession() {
  const box = globalThis.__revokeBoxes.get(${JSON.stringify(key)})
  if (box.session instanceof Error) throw box.session
  return box.session ?? undefined
}
`)

  const source = readFileSync(join(root, 'src/pages/scan/scanSessionRevoke.ts'), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: 'scanSessionRevoke.ts',
  }).outputText
    .replaceAll("'../../services/api/client'", `'${clientStub}'`)
    .replaceAll("'../../services/api/screensaver'", `'${screensaverStub}'`)
    .replaceAll("'./scanWorkbenchSession'", `'${sessionStub}'`)

  globalThis.window = { location: { origin: ORIGIN } }
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init })
    const impl = options.fetchImpl
    if (impl) return impl(url, init)
    return Promise.resolve({ ok: true })
  }

  const mod = await import(toDataUrl(`${code}\n// instance ${seed}\n`))
  return {
    mod,
    calls,
    setSession: (session) => globalThis.__revokeBoxes.get(key).session = session,
  }
}

const LATER = () => new Date(Date.now() + 10 * 60 * 1000).toISOString()
const liveSession = (scanTaskId = 'scan-1', controlToken = 'control-1') => ({
  stage: 'settings',
  live: { scanTaskId, controlToken, instructions: [], expiresAt: LATER() },
})

const deletedIds = (calls) => calls.map(({ url }) => url.split('/').pop())

test('一次清场连着触发三条链路，也只发一次 DELETE', async () => {
  const { mod, calls } = await loadRevokeModule({ session: liveSession() })
  // hardClear → logout → clearKioskSensitiveSession，全都读同一份本机登记。
  assert.equal(mod.revokeLiveScanSession('member-token'), true)
  assert.equal(mod.revokeLiveScanSession('member-token'), false)
  assert.equal(mod.revokeLiveScanSession(null), false)
  assert.deepEqual(deletedIds(calls), ['scan-1'])
})

test('两个入口共用同一份计数：读登记 + 交凭证合起来仍然只发一次', async () => {
  const { mod, calls } = await loadRevokeModule({ session: liveSession() })
  assert.equal(mod.revokeLiveScanSession(null), true)
  // 创建方手里那份凭证指向同一条任务：默认意图不许再发一次。
  assert.equal(
    mod.revokeCreatedScanSession({ scanTaskId: 'scan-1', controlToken: 'control-1' }, null),
    false,
  )
  assert.deepEqual(deletedIds(calls), ['scan-1'])
})

/* ── 这一条就是那个 P1 ───────────────────────────────────────────────────────
 *
 * 离开 → 第一次 DELETE 发出去了（在路上丢了，本机永远不会知道）→ 还在飞的那次
 * ACK 成功 → 任务此刻可投递且回收器收不到它。补偿必须发得出去。 */
test('离开之后 ACK 才成功：补偿那一次必须越过去重', async () => {
  const { mod, calls } = await loadRevokeModule({ session: liveSession() })
  assert.equal(mod.revokeLiveScanSession('member-token'), true)
  assert.equal(
    mod.revokeCreatedScanSession(
      { scanTaskId: 'scan-1', controlToken: 'control-1' },
      'member-token',
      'ack-compensation',
    ),
    true,
    '「发过没有」这个判据会在这里把唯一一次补偿挡掉，留下一个可投递却没人看着的收件箱',
  )
  assert.deepEqual(deletedIds(calls), ['scan-1', 'scan-1'])
})

test('补偿本身也有上限：再补也不会变成无限重试', async () => {
  const { mod, calls } = await loadRevokeModule({ session: liveSession() })
  const credentials = { scanTaskId: 'scan-1', controlToken: 'control-1' }
  assert.equal(mod.revokeLiveScanSession(null), true)
  assert.equal(mod.revokeCreatedScanSession(credentials, null, 'ack-compensation'), true)
  // 设置页和等待页可能各自挂着一次确认；两边都补，合起来仍然封在 2 次。
  assert.equal(mod.revokeCreatedScanSession(credentials, null, 'ack-compensation'), false)
  assert.equal(mod.revokeLiveScanSession(null), false)
  assert.equal(calls.length, 2)
})

test('没有先发过尽力而为那一次时，补偿也不会额外多发一次', async () => {
  // 「创建还在飞的时候被清场」就是这个形状：本机登记里根本没有 live，
  // 离开那一次撤销无从下手，随后领回来的凭证由持有方直接交出来。
  const { mod, calls } = await loadRevokeModule({ session: null })
  const credentials = { scanTaskId: 'scan-9', controlToken: 'control-9' }
  assert.equal(mod.revokeLiveScanSession(null), false, '登记里没有 live 就一个请求都不该发')
  assert.equal(mod.revokeCreatedScanSession(credentials, null, 'ack-compensation'), true)
  assert.equal(mod.revokeCreatedScanSession(credentials, null, 'ack-compensation'), true)
  assert.equal(mod.revokeCreatedScanSession(credentials, null, 'ack-compensation'), false)
  assert.equal(calls.length, 2, '上限是按任务累计的 2 次，不是「尽力而为 1 次 + 补偿无限次」')
})

test('上限是按 scanTaskId 算的：另一条任务不受上一条的影响', async () => {
  const { mod, calls } = await loadRevokeModule({ session: liveSession('scan-a', 'control-a') })
  assert.equal(mod.revokeLiveScanSession(null), true)
  assert.equal(
    mod.revokeCreatedScanSession({ scanTaskId: 'scan-b', controlToken: 'control-b' }, null),
    true,
  )
  assert.deepEqual(deletedIds(calls), ['scan-a', 'scan-b'])
})

test('每一次 DELETE 都带齐服务端要校验的三样，且走 keepalive', async () => {
  const { mod, calls } = await loadRevokeModule({ session: liveSession() })
  mod.revokeLiveScanSession('outgoing-member-token')
  mod.revokeCreatedScanSession(
    { scanTaskId: 'scan-1', controlToken: 'control-1' },
    'outgoing-member-token',
    'ack-compensation',
  )
  assert.equal(calls.length, 2)
  for (const { url, init } of calls) {
    assert.equal(url, `${ORIGIN}${API_BASE_URL}/scan/sessions/scan-1`)
    assert.equal(init.method, 'DELETE')
    // 页面正在被拆掉：没有 keepalive 的请求会随文档一起被取消。
    assert.equal(init.keepalive, true)
    // 控制凭据对不上服务端只会 403；身份用的必须是**正在失效**的那一个
    // （服务端 cancel() 按 endUserId 校验，拿新身份发同样只会 403）。
    assert.equal(init.headers.get('X-Scan-Session-Control'), 'control-1')
    assert.equal(init.headers.get('X-Terminal-Id'), TERMINAL_ID)
    assert.equal(init.headers.get('Authorization'), 'Bearer outgoing-member-token')
  }
})

test('已经有结果快照 / 已经过期的任务，一个 DELETE 都不发', async () => {
  const terminal = {
    stage: 'result',
    live: { scanTaskId: 'scan-1', controlToken: 'control-1', instructions: [], expiresAt: LATER() },
    result: { outcome: 'failed', success: false, reason: '扫描任务未能完成' },
  }
  const { mod, calls, setSession } = await loadRevokeModule({ session: terminal })
  assert.equal(mod.revokeLiveScanSession(null), false, '结果快照 = 服务端已给终态，再 DELETE 只是噪音')
  setSession({
    stage: 'settings',
    live: {
      scanTaskId: 'scan-2',
      controlToken: 'control-2',
      instructions: [],
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    },
  })
  assert.equal(mod.revokeLiveScanSession(null), false, '本机已知过期：服务端 reaper 会收掉它')
  assert.equal(calls.length, 0)
})

test('撤销永远不把清场卡住：fetch 同步抛也好、异步 reject 也好，都不冒泡', async () => {
  const rejections = []
  const onRejection = (reason) => rejections.push(reason)
  process.on('unhandledRejection', onRejection)
  try {
    const throwing = await loadRevokeModule({
      session: liveSession(),
      fetchImpl: () => { throw new TypeError('Failed to fetch') },
    })
    assert.equal(throwing.mod.revokeLiveScanSession(null), false, '同步抛 = 这一次没发出去')

    const rejecting = await loadRevokeModule({
      session: liveSession('scan-r', 'control-r'),
      fetchImpl: () => Promise.reject(new TypeError('network error')),
    })
    assert.equal(rejecting.mod.revokeLiveScanSession(null), true)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(rejections, [], '撤销失败必须被吞掉：清场比撤销更要紧')
  } finally {
    process.off('unhandledRejection', onRejection)
  }
})

test('本机登记读不出来时不猜，直接不发', async () => {
  const { mod, calls } = await loadRevokeModule({ session: new Error('sessionStorage blocked') })
  assert.equal(mod.revokeLiveScanSession(null), false)
  assert.equal(calls.length, 0)
})
