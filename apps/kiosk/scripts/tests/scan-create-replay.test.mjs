/**
 * 丢失响应的有界重放 —— **行为**测试（不是文本断言）。
 *
 * ## 它守的是什么
 *
 * `POST /scan/sessions` 的响应在回来的路上丢了，浏览器侧只有一个 TypeError。但服务端
 * **可能已经提交了一条 child waiting 任务**，挂在这台终端上等文件。屏幕上什么都没有，
 * 下一位走到面板前按下扫描，文件就投给了这条没人看着的任务 —— 公共一体机上的
 * 「看不见的收件箱」。
 *
 * 服务端把配对创建做成了幂等（同一对凭据再发一次拿回同一条 child），所以本机对未知态
 * 的正确动作是重放同一对请求。下面把这件事的边界逐条真的跑一遍：
 * 每个 case 新装一份模块，`send` 是一个会计数的假函数，断言的是**它被调了几次、
 * 收到了什么、最后抛/返回了什么**，不是源码里写了什么字。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function transpile(relativePath) {
  const source = readFileSync(join(root, relativePath), 'utf8')
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: relativePath,
  }).outputText
}

const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

/**
 * httpAdapter 的替身。
 *
 * 真的那一份会连带 `./client` 一起把 `import.meta.env` 拖进来，在 node 里装不起来。
 * 这里只复刻被测代码真正读的三样（code / message / status）。
 * 替身悄悄漂移是这种写法唯一的风险，所以下面最后一条 case 直接对真源码断言字段形状。
 */
const HTTP_ADAPTER_STUB = toDataUrl(`
export class ApiHttpError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}
`)

let seed = 0
async function loadReplayModule() {
  seed += 1
  const code = transpile('src/pages/scan/scanCreateReplay.ts')
    .replaceAll("'../../services/api/httpAdapter'", `'${HTTP_ADAPTER_STUB}'`)
  return import(toDataUrl(`${code}\n// instance ${seed}\n`))
}

async function loadRecoveryModule() {
  seed += 1
  const replay = toDataUrl(
    transpile('src/pages/scan/scanCreateReplay.ts')
      .replaceAll("'../../services/api/httpAdapter'", `'${HTTP_ADAPTER_STUB}'`),
  )
  const userErrors = toDataUrl(
    transpile('src/services/api/userErrorMessage.ts')
      .replaceAll("'./httpAdapter'", `'${HTTP_ADAPTER_STUB}'`),
  )
  const code = transpile('src/pages/scan/scanRescanRecovery.ts')
    .replaceAll("'../../services/api/httpAdapter'", `'${HTTP_ADAPTER_STUB}'`)
    .replaceAll("'../../services/api/userErrorMessage'", `'${userErrors}'`)
    .replaceAll("'./scanCreateReplay'", `'${replay}'`)
  return import(toDataUrl(`${code}\n// instance ${seed}\n`))
}

const { ApiHttpError } = await import(HTTP_ADAPTER_STUB)

/** 浏览器断网时 scanTasks.ts 造的就是这一个：code NETWORK_ERROR + status 0。 */
const offline = () => new ApiHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
const CHILD = { scanTaskId: 'child-1', controlToken: 'prior-token', instructions: ['放好原件'], expiresAt: '2099-01-01T00:00:00.000Z' }

/** 把退避压到 0 并记录每次真正睡了多久：用例跑得快，退避表本身照样被断言。 */
function harness() {
  const slept = []
  const replays = []
  return {
    slept,
    replays,
    options: {
      sleep: async (ms) => { slept.push(ms) },
      onReplay: (attempt) => { replays.push(attempt) },
    },
  }
}

/** 前 n 次未知失败，第 n+1 次返回 child；记录每次调用。 */
function sendFailingTimes(n, result = CHILD) {
  const calls = []
  return {
    calls,
    send: async () => {
      calls.push(Date.now())
      if (calls.length <= n) throw offline()
      return result
    },
  }
}

test('第一次就成功时不重放', async () => {
  const { replayCreateUntilOutcomeKnown } = await loadReplayModule()
  const { calls, send } = sendFailingTimes(0)
  const h = harness()
  assert.deepEqual(await replayCreateUntilOutcomeKnown(send, true, h.options), CHILD)
  assert.equal(calls.length, 1, '成功一次就该收工')
  assert.deepEqual(h.replays, [], '没有失败就不该有任何重放回调')
})

test('普通创建（非配对）遇到未知态一个字节都不重发', async () => {
  const { replayCreateUntilOutcomeKnown } = await loadReplayModule()
  const { calls, send } = sendFailingTimes(1)
  const h = harness()
  await assert.rejects(
    () => replayCreateUntilOutcomeKnown(send, false, h.options),
    (error) => error.code === 'NETWORK_ERROR',
  )
  // 普通创建没有幂等键：重发就是真的多建一条任务，而多出来的那一条会停在 waiting 收下一位的文件。
  assert.equal(calls.length, 1, '非配对请求只许发一次')
  assert.deepEqual(h.replays, [])
})

test('配对请求遇到未知态会重放，并把同一条 child 领回来', async () => {
  const { replayCreateUntilOutcomeKnown } = await loadReplayModule()
  const { calls, send } = sendFailingTimes(1)
  const h = harness()
  const recovered = await replayCreateUntilOutcomeKnown(send, true, h.options)
  assert.deepEqual(recovered, CHILD, '重放拿回的就是服务端那条 child')
  assert.equal(recovered.controlToken, 'prior-token', 'child 的 controlToken 就是上一场那份明文')
  assert.equal(calls.length, 2, '一次原始 + 一次重放')
  assert.deepEqual(h.replays, [1], '重放回调从 1 起算，且每次重放只回调一次')
})

test('重放期间拿到任何 HTTP 应答就当场收工（429 走用户手动重试）', async () => {
  const { replayCreateUntilOutcomeKnown } = await loadReplayModule()
  const calls = []
  const send = async () => {
    calls.push(1)
    if (calls.length === 1) throw offline()
    throw new ApiHttpError('RATE_LIMITED', '当前使用的人较多', 429)
  }
  const h = harness()
  await assert.rejects(
    () => replayCreateUntilOutcomeKnown(send, true, h.options),
    (error) => error.status === 429 && error.code === 'RATE_LIMITED',
  )
  // 429 是一个**确定**的答案：服务端回过话了。继续重放只会烧掉整个大厅的限流额度，
  // 而这条失败码本来就该走「原样放回授权 + 用户按再试一次安全重扫」那条既有路径。
  assert.equal(calls.length, 2, '拿到 429 之后不许再重放')
})

test('SCAN_TERMINAL_BUSY / 5xx / 401 同样是确定答案，不触发重放', async () => {
  for (const definite of [
    new ApiHttpError('SCAN_TERMINAL_BUSY', '本机正在扫描中', 409),
    new ApiHttpError('INTERNAL_ERROR', '服务异常', 500),
    new ApiHttpError('TERMINAL_SESSION_INVALID', '终端安全会话无效', 401),
    new ApiHttpError('SCAN_RESCAN_AUTHORITY_INCOMPLETE', '安全重扫凭证不完整', 400),
  ]) {
    const { replayCreateUntilOutcomeKnown } = await loadReplayModule()
    const calls = []
    const send = async () => { calls.push(1); throw definite }
    const h = harness()
    await assert.rejects(() => replayCreateUntilOutcomeKnown(send, true, h.options))
    assert.equal(calls.length, 1, `${definite.code} 是确定失败，不该重放`)
  }
})

test('child 已不可恢复（409）在重放途中就收工并原样抛出', async () => {
  const { replayCreateUntilOutcomeKnown } = await loadReplayModule()
  const calls = []
  const send = async () => {
    calls.push(1)
    if (calls.length === 1) throw offline()
    throw new ApiHttpError('SCAN_RETRY_CHILD_NOT_RECOVERABLE', '该重扫会话已不可恢复', 409)
  }
  const h = harness()
  await assert.rejects(
    () => replayCreateUntilOutcomeKnown(send, true, h.options),
    (error) => error.code === 'SCAN_RETRY_CHILD_NOT_RECOVERABLE',
  )
  assert.equal(calls.length, 2)
})

test('一直未知时有界收工，抛 SCAN_CREATE_REPLAY_UNRESOLVED 且 status 为 0', async () => {
  const { replayCreateUntilOutcomeKnown, SCAN_CREATE_REPLAY_DELAYS_MS, SCAN_CREATE_REPLAY_UNRESOLVED } =
    await loadReplayModule()
  const calls = []
  const send = async () => { calls.push(1); throw offline() }
  const h = harness()
  await assert.rejects(
    () => replayCreateUntilOutcomeKnown(send, true, h.options),
    (error) => error.code === SCAN_CREATE_REPLAY_UNRESOLVED
      // status 必须是 0：本仓约定它表示「结果确实未知」，页面据此把那枚授权原样放回。
      // 写成非 0 会让它被当成一次确定失败，授权被永久丢弃。
      && error.status === 0,
  )
  assert.equal(calls.length, SCAN_CREATE_REPLAY_DELAYS_MS.length + 1, '一次原始 + 退避表长度次重放，到此为止')
  assert.deepEqual(h.slept, [...SCAN_CREATE_REPLAY_DELAYS_MS], '必须按退避表的顺序和数值退避')
  assert.deepEqual(h.replays, SCAN_CREATE_REPLAY_DELAYS_MS.map((_, i) => i + 1))
})

test('重放次数有上限，最坏情况不超过创建端点一分钟额度的一半', async () => {
  const { SCAN_CREATE_REPLAY_DELAYS_MS } = await loadReplayModule()
  // 创建端点是 12 次/分**按出口 IP** 计的（scan-tasks.controller.ts 的 @Throttle，
  // tracker 是纯 IP），一个大厅好几台机器共用一个桶。
  assert.ok(
    SCAN_CREATE_REPLAY_DELAYS_MS.length + 1 <= 6,
    '一次创建意图最多用掉 6/12，另一半必须留给用户自己的动作',
  )
  assert.ok(SCAN_CREATE_REPLAY_DELAYS_MS.every((ms) => ms > 0), '每次重放之前都必须真的退避，不许空转')
  for (let i = 1; i < SCAN_CREATE_REPLAY_DELAYS_MS.length; i += 1) {
    assert.ok(SCAN_CREATE_REPLAY_DELAYS_MS[i] > SCAN_CREATE_REPLAY_DELAYS_MS[i - 1], '退避必须递增')
  }
})

test('onReplay 在每次重放**发出之前**回调：屏幕要先改口再等', async () => {
  const { replayCreateUntilOutcomeKnown } = await loadReplayModule()
  const order = []
  const send = async () => { order.push('send'); throw offline() }
  await assert.rejects(() => replayCreateUntilOutcomeKnown(send, true, {
    delaysMs: [1, 1],
    sleep: async () => { order.push('sleep') },
    onReplay: () => { order.push('notify') },
  }))
  // 先 notify 再 sleep 再 send：顺序反了的话，用户会对着一句「正在建扫描会话」
  // 干等一整个退避周期，而那句话在重放窗口里已经是假的。
  assert.deepEqual(order, ['send', 'notify', 'sleep', 'send', 'notify', 'sleep', 'send'])
})

test('code 为 NETWORK_ERROR 时即使 status 非 0 也算未知态', async () => {
  const { isUnknownCreateOutcome } = await loadReplayModule()
  assert.equal(isUnknownCreateOutcome(new ApiHttpError('NETWORK_ERROR', 'x', 502)), true)
  assert.equal(isUnknownCreateOutcome(new ApiHttpError('WHATEVER', 'x', 0)), true)
  assert.equal(isUnknownCreateOutcome(new ApiHttpError('RATE_LIMITED', 'x', 429)), false)
  assert.equal(isUnknownCreateOutcome(new Error('plain')), false, '非 ApiHttpError 不算 —— 不按 message 文本猜')
  assert.equal(isUnknownCreateOutcome(undefined), false)
})

test('重放到头的结论仍是 outcomeUnknown，授权因此会被原样放回', async () => {
  const { classifyCreateFailure } = await loadRecoveryModule()
  const { SCAN_CREATE_REPLAY_UNRESOLVED } = await loadReplayModule()
  const verdict = classifyCreateFailure(new ApiHttpError(SCAN_CREATE_REPLAY_UNRESOLVED, '无法确认', 0))
  // refusedRescan 一旦为 true，页面会永久丢弃一枚服务端**可能还认**的授权，
  // 用户只剩下一场注定撞两小时同字节去重的普通会话。
  assert.equal(verdict.refusedRescan, false)
  assert.equal(verdict.outcomeUnknown, true)
  assert.match(verdict.failure.title, /还是没能确认/)
  assert.match(verdict.failure.description, /再试一次安全重扫/, '必须指向那颗仍然成对的按钮')
  assert.match(verdict.failure.description, /不会多建一场/, '必须解释重放为什么是安全的')
  assert.doesNotMatch(verdict.failure.description, /本页不会自动重发/, '重发已经发过了，说这句就是假话')
})

test('child 不可恢复被判为「服务端明确不认」，并落到它自己那一屏', async () => {
  const { classifyCreateFailure, isRescanRefusedByServer } = await loadRecoveryModule()
  assert.equal(isRescanRefusedByServer('SCAN_RETRY_CHILD_NOT_RECOVERABLE'), true)
  const verdict = classifyCreateFailure(
    new ApiHttpError('SCAN_RETRY_CHILD_NOT_RECOVERABLE', '该重扫会话已不可恢复', 409),
  )
  assert.equal(verdict.refusedRescan, true, '必须永久丢弃：服务端不会再为这枚授权开第二条 child')
  assert.equal(verdict.outcomeUnknown, false)
  assert.match(verdict.failure.title, /那次安全重扫的会话已经失效/)
  // 这一屏比通用那条多交代一件事：服务端没留下还在等文件的任务。
  // 用户据此才知道自己刚才那张纸不会被谁悄悄收走。
  assert.match(verdict.failure.description, /没有留下还在等文件的任务/)
  assert.match(verdict.failure.description, /重新开始一次扫描/, '出路必须是显式的普通重启')
})

test('通用拒绝码仍然落到原来那一屏，没有被 child 那一条顶替', async () => {
  const { classifyCreateFailure } = await loadRecoveryModule()
  const verdict = classifyCreateFailure(
    new ApiHttpError('SCAN_RETRY_NOT_AUTHORIZED', '重扫授权无效、已过期或已使用', 403),
  )
  assert.equal(verdict.refusedRescan, true)
  assert.match(verdict.failure.title, /安全重扫授权已失效/)
  assert.match(verdict.failure.description, /可能按重复件拒收/)
})

test('替身没有漂移：真 ApiHttpError 仍然是 code + status 的那三件套', async () => {
  // 上面所有 case 都跑在替身上。真那一份哪天改了字段名，这条会红。
  const source = readFileSync(join(root, 'src/services/api/httpAdapter.ts'), 'utf8')
  assert.match(
    source,
    /export class ApiHttpError extends Error \{\s*\n\s*constructor\(\s*\n\s*public readonly code: string,\s*\n\s*message: string,\s*\n\s*public readonly status: number,/,
    'isUnknownCreateOutcome 读的就是 code 与 status；真类改了字段，替身上的结论就不作数了',
  )
})
