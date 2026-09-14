/**
 * 投递确认（ACK）—— **行为**测试（不是文本断言）。
 *
 * ## 它守的是什么
 *
 * 服务端 2026-09-14 起把「会话建成」和「会话可投递」拆成两段：新建任务一律
 * `deliveryAckedAt = null`，Agent 的 current-lease 看不见它，直到本机
 * `POST /scan/sessions/:id/ack`。于是本机这一侧只剩一个判断要做对：
 * **这一次确认到底成没成**——成了才允许把用户支到打印机面板上去。
 *
 * 判错的两个方向代价不对称，所以下面每一条都按这个不对称来写：
 *   · 把「没确认」判成「确认了」→ 用户照着指引扫一张纸，那份文件不会进他的会话，
 *     人在机器前白等到轮询上限；
 *   · 把「服务端明确不认」判成「再试试」→ 页面对着一场自己根本碰不到的会话一直重试，
 *     而那条任务还占着这台终端的活动会话。
 *
 * 每个 case 新装一份模块，`ackScanSession` 是一个可控的假函数，断言的是
 * **它被怎么调、结论是什么**，不是源码里写了什么字。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const repoRoot = join(root, '../..')

function transpile(absolutePath, fileName) {
  const source = readFileSync(absolutePath, 'utf8')
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName,
  }).outputText
}

const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

/**
 * shared 那个码的**真值**，从真源码里抠出来。
 *
 * 直接在替身里硬写 'SCAN_TASK_ACK_NOT_ALLOWED' 就等于自己给自己发通行证：
 * shared 改名之后被测代码会在生产里对不上服务端，而这份用例照样绿。
 */
const sharedSource = readFileSync(join(repoRoot, 'packages/shared/src/types/scanTask.ts'), 'utf8')
const ACK_NOT_ALLOWED = /export const SCAN_TASK_ACK_NOT_ALLOWED = '([^']+)'/.exec(sharedSource)?.[1]
assert.equal(
  ACK_NOT_ALLOWED,
  'SCAN_TASK_ACK_NOT_ALLOWED',
  'shared 必须仍然导出这个码；改了名就得同时改服务端与这份用例',
)

const HTTP_ADAPTER_STUB = toDataUrl(`
export class ApiHttpError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}
`)
const SHARED_STUB = toDataUrl(`export const SCAN_TASK_ACK_NOT_ALLOWED = ${JSON.stringify(ACK_NOT_ALLOWED)}`)

const { ApiHttpError } = await import(HTTP_ADAPTER_STUB)

/** 本机凭据不全时 scanTasks.ts 抛的那个码，同样从真源码抠，不硬写。 */
const scanTasksSource = readFileSync(join(root, 'src/services/api/scanTasks.ts'), 'utf8')
const CREDENTIALS_INCOMPLETE =
  /export const SCAN_ACK_CREDENTIALS_INCOMPLETE = '([^']+)'/.exec(scanTasksSource)?.[1]
assert.ok(CREDENTIALS_INCOMPLETE, 'scanTasks.ts 必须导出「凭据不全」那个码')

let seed = 0
/**
 * 装一份被测模块，`ackScanSession` 换成受控替身。
 *
 * @param {(scanTaskId: string, controlToken: string, token: unknown) => Promise<unknown>} impl
 */
async function loadAckModule(impl) {
  seed += 1
  const calls = []
  globalThis.__ackCalls = globalThis.__ackCalls ?? new Map()
  const key = `ack-${seed}`
  globalThis.__ackCalls.set(key, { calls, impl })
  const scanTasksStub = toDataUrl(`
export const SCAN_ACK_CREDENTIALS_INCOMPLETE = ${JSON.stringify(CREDENTIALS_INCOMPLETE)}
export async function ackScanSession(scanTaskId, controlToken, token) {
  const box = globalThis.__ackCalls.get(${JSON.stringify(key)})
  box.calls.push({ scanTaskId, controlToken, token })
  return box.impl(scanTaskId, controlToken, token)
}
`)
  const userErrors = toDataUrl(
    transpile(join(root, 'src/services/api/userErrorMessage.ts'), 'userErrorMessage.ts')
      .replaceAll("'./httpAdapter'", `'${HTTP_ADAPTER_STUB}'`),
  )
  const code = transpile(join(root, 'src/pages/scan/scanDeliveryAck.ts'), 'scanDeliveryAck.ts')
    .replaceAll("'@ai-job-print/shared'", `'${SHARED_STUB}'`)
    .replaceAll("'../../services/api/scanTasks'", `'${scanTasksStub}'`)
    .replaceAll("'../../services/api/userErrorMessage'", `'${userErrors}'`)
  const mod = await import(toDataUrl(`${code}\n// instance ${seed}\n`))
  return { mod, calls }
}

const CREDENTIALS = { scanTaskId: 'scan-1', controlToken: 'control-1' }

test('服务端记下了时间戳才算确认', async () => {
  const { mod, calls } = await loadAckModule(async () => ({
    scanTaskId: 'scan-1',
    deliveryAckedAt: '2026-09-14T10:00:00.000Z',
  }))
  const outcome = await mod.acknowledgeScanDelivery(CREDENTIALS, 'member-token')
  assert.deepEqual(outcome, { ok: true, deliveryAckedAt: '2026-09-14T10:00:00.000Z' })
  // 凭据必须**原样**交出去：服务端按字节比对 hash，替它整理一下就是另一份凭据。
  assert.deepEqual(calls, [{ scanTaskId: 'scan-1', controlToken: 'control-1', token: 'member-token' }])
})

test('2xx 但没带 deliveryAckedAt 时不许放行', async () => {
  for (const body of [{}, { deliveryAckedAt: '' }, { deliveryAckedAt: '   ' }, { deliveryAckedAt: 42 }, null]) {
    const { mod } = await loadAckModule(async () => body)
    const outcome = await mod.acknowledgeScanDelivery(CREDENTIALS, null)
    // 只看 HTTP 状态码就放行，等于凭一个空回执把用户支到面板上 —— 而服务端那边
    // 那条任务此刻仍然不可投递，他扫出来的纸不会进任何会话。
    assert.equal(outcome.ok, false, `空回执 ${JSON.stringify(body)} 不许当成确认成功`)
    assert.equal(outcome.definitive, false, '空回执不是「服务端明确不认」，还可以再问一次')
  }
})

test('服务端明确不认的三个码：撤掉这一场，不再重试', async () => {
  for (const error of [
    new ApiHttpError(ACK_NOT_ALLOWED, '当前扫描任务状态不允许确认投递', 409),
    new ApiHttpError('SCAN_TASK_FORBIDDEN', '无权确认该扫描任务', 403),
    new ApiHttpError('SCAN_TASK_NOT_FOUND', '扫描任务不存在', 404),
  ]) {
    const { mod } = await loadAckModule(async () => { throw error })
    const outcome = await mod.acknowledgeScanDelivery(CREDENTIALS, null)
    assert.equal(outcome.ok, false)
    assert.equal(outcome.definitive, true, `${error.code} 是确定结论：再问一百次也是同一个答案`)
    assert.equal(outcome.failure, mod.SCAN_ACK_REFUSED_FAILURE)
  }
})

test('本机凭据不全同样是确定结论（请求根本没发出去）', async () => {
  const { mod } = await loadAckModule(async () => {
    throw new ApiHttpError(CREDENTIALS_INCOMPLETE, '扫描会话凭据不完整，本次不会确认投递', 400)
  })
  const outcome = await mod.acknowledgeScanDelivery(CREDENTIALS, null)
  assert.equal(outcome.definitive, true, '凭据不全时重试多少次都还是不全，不能挂在「再试试」上')
})

test('断网 / 5xx / 429 / 终端票失效：还没确认，但可以再问一次', async () => {
  for (const error of [
    new ApiHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0),
    new ApiHttpError('INTERNAL_ERROR', '服务异常', 500),
    new ApiHttpError('RATE_LIMITED', '当前使用的人较多', 429),
    new ApiHttpError('TERMINAL_SESSION_INVALID', '终端安全会话无效', 401),
  ]) {
    const { mod } = await loadAckModule(async () => { throw error })
    const outcome = await mod.acknowledgeScanDelivery(CREDENTIALS, null)
    assert.equal(outcome.ok, false)
    // 判成 definitive 会把一场**服务端并没有拒绝**的会话撤掉：用户白丢一次创建，
    // 而这些失败里最常见的那一类（断网）多半几秒后就好了。
    assert.equal(outcome.definitive, false, `${error.code} 证明不了服务端不认这一场`)
    assert.equal(outcome.failure, mod.SCAN_ACK_PENDING_FAILURE)
  }
})

test('非 ApiHttpError 的意外异常也不许被判成「服务端明确不认」', async () => {
  const { mod } = await loadAckModule(async () => { throw new TypeError('boom') })
  const outcome = await mod.acknowledgeScanDelivery(CREDENTIALS, null)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.definitive, false, '本机自己炸了不等于服务端拒绝，不许据此撤掉用户的会话')
})

test('isDefinitiveAckRefusal 只认表里那几个码', async () => {
  const { mod } = await loadAckModule(async () => ({ deliveryAckedAt: 'x' }))
  assert.equal(mod.isDefinitiveAckRefusal(ACK_NOT_ALLOWED), true)
  assert.equal(mod.isDefinitiveAckRefusal('SCAN_TASK_FORBIDDEN'), true)
  assert.equal(mod.isDefinitiveAckRefusal('NETWORK_ERROR'), false)
  assert.equal(mod.isDefinitiveAckRefusal(undefined), false, '取不到码时不许当成拒绝')
})

test('两屏文案：纯字符串、都劝阻面板操作、都不说「去扫」', async () => {
  const { mod } = await loadAckModule(async () => ({ deliveryAckedAt: 'x' }))
  for (const [name, text] of [
    ['REFUSED', mod.SCAN_ACK_REFUSED_FAILURE.description],
    ['PENDING', mod.SCAN_ACK_PENDING_FAILURE.description],
    ['NOTICE', mod.SCAN_ACK_PENDING_NOTICE],
    ['PROGRESS_REASON', mod.SCAN_ACK_REFUSED_PROGRESS_REASON],
  ]) {
    // 这些串直接渲染进 <p>，没有 markdown：写 ** 会把星号打在 27 寸公共屏上。
    assert.doesNotMatch(text, /\*\*/, `${name} 不许写 markdown`)
    // 每一句都必须说清「现在扫也没用」——这是这道闸在屏幕上唯一看得见的部分。
    assert.match(
      text,
      /不会被投递到这一场|不会投到这一场|只会白扫|不会再把面板上扫出来的文件投给它/,
      `${name} 必须说清这一刻扫出来的文件不会进这一场`,
    )
  }
  // 两条结论屏各自指向一条**按得到**的出路，且不能互相串（结果页上没有那颗重启按钮）。
  assert.match(mod.SCAN_ACK_REFUSED_FAILURE.description, /重新开始一次扫描/)
  assert.match(mod.SCAN_ACK_PENDING_FAILURE.description, /再确认一次/)
  assert.doesNotMatch(
    mod.SCAN_ACK_REFUSED_PROGRESS_REASON,
    /再确认一次|按「重新开始一次扫描」/,
    '等待页拒绝之后落的是结果屏，那里没有这两颗按钮 —— 照抄过去就是指一条按不到的路',
  )
})

test('替身没有漂移：真 ApiHttpError 仍然是 code + status 的那三件套', async () => {
  const source = readFileSync(join(root, 'src/services/api/httpAdapter.ts'), 'utf8')
  assert.match(
    source,
    /export class ApiHttpError extends Error \{\s*\n\s*constructor\(\s*\n\s*public readonly code: string,\s*\n\s*message: string,\s*\n\s*public readonly status: number,/,
    'classifyAckFailure 读的就是 code；真类改了字段，替身上的结论就不作数了',
  )
})
