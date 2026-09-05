// ============================================================================
// 门禁：LLM 调用超时 + 全局并发上限
//
// 守的是 2026-08-17 架构承压深查发现的那个「一次故障拖垮全站」的形状：
// 11 个 LLM fetch 调用点里有 10 个没有任何 timeout，而除 contract-review 外
// 所有 AI 调用都同步跑在 HTTP 请求里（services/worker 是空壳，三个 BullMQ
// worker 全在 API 进程内）。模型端一卡住，请求就永远挂着，整个进程连打印下单
// 和后台审核一起停。
//
// 断言分两类，缺一不可：
//
//   静态（**派生式**，不硬编码文件名）：
//     1. 派生出「LLM 调用点」= services/api/src 下所有构造 chat/completions
//        URL 的非测试文件；其中每一处 fetch 调用都必须带 signal
//        （或走自带 signal 的统一底座 llmFetchJson）。
//        —— 硬编码那 10 个文件名的话，新加的第 12 个调用点又会漏。
//     4. 每个调用点都有**自己的**超时错误码，且互不重复。
//        （合同审查的教训：CONTRACT_REVIEW_ANALYSIS_FAILED 被 5 条路径共用，
//          生产故障根因查不出来。超时不许糊进通用兜底码。）
//     5. 每个走底座的调用点都显式处理了 LlmBusyError，不许漏到通用 catch。
//
//   运行时（**真跑**，不靠读代码推断）：
//     2. 对一个永远不回包的服务器，llmFetchJson 会在超时后抛 LlmTimeoutError，
//        而不是挂住。连「headers 回了、body 挂住」这种形态也要盖到。
//     3. 并发闸门满了会**立刻**抛 LlmBusyError，不排队、不返回成功；
//        释放后槽位可复用；进程级单例的上限是个合法正整数。
//
// 反向验证（先破后立）：摘掉 llm-http.ts 里传给 fetch 的 signal，本门禁必须变红
// 在断言 2 上（超时不再触发）；把某个调用点的超时码改成与别人相同，必须红在
// 断言 4 上。
// ============================================================================

import { createServer, type Server } from 'node:http'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  LLM_BUSY_MESSAGE,
  LLM_LONG_TIMEOUT_MS,
  LLM_TIMEOUT_MS,
  LlmBusyError,
  LlmConcurrencyGate,
  LlmTimeoutError,
  MAX_CONCURRENT_LLM,
  llmConcurrencyGate,
  llmFetchJson,
  llmTimeoutMessage,
} from '../src/ai/llm/llm-http'

const SRC_ROOT = join(__dirname, '..', 'src')

// ---------------------------------------------------------------------------
// 失败闭合（fail-closed）：门禁只有「跑完并打印结论」才算通过
//
// 这三道防线是被自己抓出来的：注入「拆掉并发上限判断」时，第 3 个调用不再被拒、
// 转而永久挂起，脚本停在 3.d 不动；等所有 setTimeout 烧完，事件循环排空，
// **Node 以退出码 0 静默退出**，连最终汇总都没打印 —— 门禁「变绿」了。
// 挂起而不失败是最危险的形态：CI 会当它通过，或者当成 flaky 重跑掉。
//
//   ① 退出码默认 1，只有走到最后一行才置 0：任何提前排空都是红。
//   ② 全局看门狗：既兜住「卡住不动」，又因为它是活跃 timer，
//      事件循环不可能在它到期前排空 —— 静默退出这条路被物理堵死。
//   ③ 单点看门狗：见各处 withWatchdog()，让红报在具体那条断言上而不是笼统超时。
// ---------------------------------------------------------------------------
process.exitCode = 1

const GLOBAL_WATCHDOG_MS = 120_000
const globalWatchdog = setTimeout(() => {
  console.log(`\n  FAIL  门禁自身超过 ${GLOBAL_WATCHDOG_MS / 1000} 秒未跑完 —— 存在挂起路径，按失败处理`)
  console.log('FAILED  门禁未跑完（挂起）')
  process.exit(1)
}, GLOBAL_WATCHDOG_MS)

/**
 * 给可能永久挂起的 await 套一层看门狗。
 * 超时返回一个 Error（而不是继续等），让调用处的断言正常判负。
 */
async function withWatchdog<T>(promise: Promise<T>, ms: number, what: string): Promise<T | Error> {
  const marker = Symbol('watchdog')
  const outcome = await Promise.race([
    promise.catch((error: unknown) => (error instanceof Error ? error : new Error(String(error)))),
    new Promise<typeof marker>((resolve) => setTimeout(() => resolve(marker), ms)),
  ])
  return outcome === marker ? new Error(`看门狗触发：${what}没有在 ${ms}ms 内返回`) : (outcome as T | Error)
}

let passed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---------------------------------------------------------------------------
// 派生：谁是 LLM 调用点
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'generated' || entry === 'node_modules') continue
      walk(full, out)
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.includes('.test.')) {
      out.push(full)
    }
  }
  return out
}

/**
 * 把注释内容抹成等长空格（保留换行，行号不变）。
 *
 * 必须做这一步：本文件里的说明性注释本身就会写 `fetch()`、写错误码字面量，
 * 不抹掉的话门禁会读自己的文档然后报假红 —— 那比没有门禁更糟，因为它会训练
 * 后来的人「这条红是噪音，忽略就行」。`https://` 里的 `//` 不能误伤。
 */
function blankComments(source: string): string {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, (m, prefix: string) => prefix + ' '.repeat(m.length - prefix.length))
  return out
}

/**
 * 「LLM 调用点」的派生规则：文件里出现 OpenAI 兼容的 chat/completions 路径。
 * 这是**行为特征**而不是文件清单 —— 任何人新加一个 LLM 调用，都会自动进入
 * 本门禁的扫描范围，不需要有人记得来这里补一行。
 */
const allFiles = walk(SRC_ROOT)
const sourceOf = new Map(allFiles.map((f) => [f, blankComments(readFileSync(f, 'utf8'))]))
const llmUrlFiles = allFiles.filter((f) => (sourceOf.get(f) ?? '').includes('chat/completions'))

/**
 * 发请求的调用：标识符必须以**小写** fetch 开头，或是 do/llm 前缀的包装
 * （fetch( / fetchImpl( / this.fetchImpl( / doFetch( / llmFetchJson(）。
 * 要求首字母小写是为了排除类名 —— `new StrictFetchContractProviderTransport()`
 * 里也有 "Fetch"，但它不发请求。
 */
const FETCH_CALL = /(?:^|[^\w$])(?:[\w$]+\.)?((?:fetch|doFetch|llmFetchJson)[\w$]*)\s*\(/g

function fetchCallsIn(source: string): Array<{ callee: string; index: number }> {
  const calls: Array<{ callee: string; index: number }> = []
  for (const match of source.matchAll(FETCH_CALL)) {
    const start = match.index ?? 0
    // 跳过类型/接口/字段声明里的 fetchImpl（`readonly fetchImpl?: typeof fetch`）。
    const before = source.slice(Math.max(0, start - 48), start + 24)
    if (/(readonly|private|public|protected)?\s*fetchImpl\s*[?:]/.test(before)) continue
    calls.push({ callee: match[1], index: start })
  }
  return calls
}

// 真正的调用点 = 既提到 LLM URL，又确实发请求的文件。
// 只提到 URL 却不发请求的（如把 URL 当配置交给腾讯 TRTC 机器人、或注释里写路径）
// 不属于本门禁的管辖范围 —— 那些请求不是本进程发的，本进程也就无从设超时。
const callSites = llmUrlFiles.filter((f) => fetchCallsIn(sourceOf.get(f) ?? '').length > 0)
const nonCalling = llmUrlFiles.filter((f) => !callSites.includes(f))

console.log('\n[1] 派生式扫描：所有 LLM 调用点都带 signal')
console.log(`    提到 LLM URL 的文件 ${llmUrlFiles.length} 个，其中真正发请求的 ${callSites.length} 个：`)
for (const f of callSites) console.log(`      - ${relative(SRC_ROOT, f)}`)
if (nonCalling.length > 0) {
  console.log(`    仅提及、不发请求（不在管辖范围）：`)
  for (const f of nonCalling) console.log(`      - ${relative(SRC_ROOT, f)}`)
}

check(
  '1.0 派生结果非空（扫描规则本身有效）',
  callSites.length >= 11,
  `只派生出 ${callSites.length} 个，扫描规则可能失效 —— 空结果不等于没问题`,
)

for (const file of callSites) {
  const rel = relative(SRC_ROOT, file)
  const source = sourceOf.get(file) ?? ''
  const offenders: string[] = []

  for (const { callee, index } of fetchCallsIn(source)) {
    // 统一底座：signal 由它自己传，断言 1.base + 断言 2 各自证明它确实生效。
    if (callee === 'llmFetchJson') continue
    if (!/\bsignal\s*:/.test(source.slice(index, index + 1600))) {
      offenders.push(`${rel}:${source.slice(0, index).split('\n').length} ${callee}() 没有 signal`)
    }
  }

  check(`1.${callSites.indexOf(file) + 1} ${rel} 的 fetch 调用都带 signal`, offenders.length === 0, offenders.join('; '))
}

// 底座本身：它是唯一一个「不提 chat/completions 却发 LLM 请求」的文件，
// 上面的派生规则扫不到它，所以单独钉一条明确的断言，而不是让它无人看管。
{
  const baseSource = blankComments(readFileSync(join(SRC_ROOT, 'ai', 'llm', 'llm-http.ts'), 'utf8'))
  // 只看真正派发请求的调用；`llmFetchJson(` 在这个文件里是函数**声明**，不是调用。
  const baseCalls = fetchCallsIn(baseSource).filter(({ callee }) => callee !== 'llmFetchJson')
  check('1.base 底座使用 AbortController（真取消，不是 Promise.race）', baseSource.includes('new AbortController()'))
  check('1.base 底座没有用 Promise.race 假装超时', !/Promise\s*\.\s*race\s*\(/.test(baseSource))
  check('1.base 底座确实有派发请求的调用', baseCalls.length > 0, '扫不到调用说明规则失效，不是「没问题」')
  check(
    '1.base 底座把 signal 传进了 fetch',
    baseCalls.every(({ index }) => /\bsignal\s*:/.test(baseSource.slice(index, index + 400))),
    baseCalls
      .filter(({ index }) => !/\bsignal\s*:/.test(baseSource.slice(index, index + 400)))
      .map(({ callee, index }) => `${callee}() @ line ${baseSource.slice(0, index).split('\n').length}`)
      .join('; '),
  )
}

// ---------------------------------------------------------------------------
// 静态：超时错误码可辨识
// ---------------------------------------------------------------------------

console.log('\n[4] 超时错误码互不重复（不许糊进通用兜底码）')

const TIMEOUT_CODE = /'([A-Z][A-Z0-9_]*_TIMEOUT)'/g
const codeOwners = new Map<string, string[]>()

for (const file of callSites) {
  const rel = relative(SRC_ROOT, file)
  const source = sourceOf.get(file) ?? ''
  const codes = new Set([...source.matchAll(TIMEOUT_CODE)].map((m) => m[1]))
  check(`4.a ${rel} 有独立的超时错误码`, codes.size > 0, '该调用点没有任何 *_TIMEOUT 码')
  for (const code of codes) {
    codeOwners.set(code, [...(codeOwners.get(code) ?? []), rel])
  }
}

const shared = [...codeOwners.entries()].filter(([, owners]) => new Set(owners).size > 1)
check(
  '4.b 没有任何超时错误码被多个调用点共用',
  shared.length === 0,
  shared.map(([code, owners]) => `${code} 被 ${owners.join(' / ')} 共用`).join('; '),
)

// ---------------------------------------------------------------------------
// 静态：每个走底座的调用点都显式处理「AI 正忙」
// ---------------------------------------------------------------------------

console.log('\n[5] 走底座的调用点都显式处理 LlmBusyError')

const gatedSites = callSites.filter((f) => (sourceOf.get(f) ?? '').includes('llmFetchJson'))
check('5.0 走底座的调用点非空', gatedSites.length >= 10, `只有 ${gatedSites.length} 个`)

for (const file of gatedSites) {
  const rel = relative(SRC_ROOT, file)
  const source = sourceOf.get(file) ?? ''
  check(
    `5.a ${rel} 显式分支处理 LlmBusyError → AI_BUSY`,
    source.includes('LlmBusyError') && source.includes('AI_BUSY'),
    '并发拒绝会漏到通用 catch，被误报成「连接失败」',
  )
}

// ---------------------------------------------------------------------------
// 运行时：超时真的会触发（不是读代码推断）
// ---------------------------------------------------------------------------

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('listen failed')
  return address.port
}

async function runtimeChecks(): Promise<void> {
  console.log('\n[2] 运行时：模型端卡住时 llmFetchJson 会超时，而不是挂住')

  // 形态一：连 headers 都不回。
  const deadServer = createServer(() => {
    /* 故意什么都不做 */
  })
  // 形态二：headers 回了，body 永远不结束 —— 只把 fetch() 包进超时是盖不住这个的。
  const halfServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{"choi')
  })

  const deadPort = await listen(deadServer)
  const halfPort = await listen(halfServer)

  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }

  for (const [label, port] of [
    ['headers 不回', deadPort],
    ['headers 回了但 body 挂住', halfPort],
  ] as const) {
    const startedAt = Date.now()
    let thrown: unknown = null
    // 看门狗：signal 一旦被摘掉，下面这个 await 会**永远**挂住，门禁就从「红」
    // 退化成「卡死」—— 而卡死的 CI 只会被当成 flaky 重跑掉，等于没有门禁。
    // 所以超过 5 秒一律判负并继续，让失败以红色的形式说出来。
    const WATCHDOG = Symbol('watchdog')
    try {
      const outcome = await Promise.race([
        llmFetchJson(`http://127.0.0.1:${port}/chat/completions`, init, { timeoutMs: 400 }).then(() => null),
        new Promise((resolve) => setTimeout(() => resolve(WATCHDOG), 5_000)),
      ])
      thrown = outcome === WATCHDOG ? new Error('看门狗触发：调用没有在 5 秒内返回，超时机制未生效') : null
    } catch (error) {
      thrown = error
    }
    const elapsed = Date.now() - startedAt
    check(
      `2.a [${label}] 抛 LlmTimeoutError`,
      thrown instanceof LlmTimeoutError,
      `实际抛出：${thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)}`,
    )
    check(`2.b [${label}] 在超时窗口内返回（${elapsed}ms）`, elapsed < 5_000, `耗时 ${elapsed}ms，疑似没有真正 abort`)
  }

  // 超时不能把槽位漏掉：超时后闸门必须已经归还。
  check('2.c 超时后并发槽位已归还', llmConcurrencyGate.inFlightCount === 0, `仍在途 ${llmConcurrencyGate.inFlightCount}`)

  deadServer.close()
  halfServer.close()

  // -------------------------------------------------------------------------
  console.log('\n[3] 运行时：并发上限存在且生效（满了立刻拒绝，不排队）')

  check(
    '3.a 进程级单例上限是合法正整数',
    Number.isInteger(MAX_CONCURRENT_LLM) && MAX_CONCURRENT_LLM >= 1 && MAX_CONCURRENT_LLM <= 32,
    `MAX_CONCURRENT_LLM=${MAX_CONCURRENT_LLM}`,
  )
  check('3.b 全站共用同一个闸门实例', llmConcurrencyGate.limit === MAX_CONCURRENT_LLM)

  // 用 limit=2 的独立闸门 + 可控的挂起 fetch，实测「第 3 个会怎样」。
  const gate = new LlmConcurrencyGate(2)
  const settlers: Array<() => void> = []
  const hangingFetch = (() =>
    new Promise((resolve) => {
      settlers.push(() =>
        resolve({ ok: true, status: 200, statusText: 'OK', json: async () => ({ choices: [] }) }),
      )
    })) as unknown as typeof fetch

  const opts = { timeoutMs: 30_000, gate, fetchImpl: hangingFetch }
  const first = llmFetchJson('http://127.0.0.1:1/chat/completions', init, opts)
  const second = llmFetchJson('http://127.0.0.1:1/chat/completions', init, opts)
  // 让前两个把槽位真正占住
  await new Promise((r) => setTimeout(r, 20))
  check('3.c 前 2 个占住槽位', gate.inFlightCount === 2, `在途 ${gate.inFlightCount}`)

  const rejectedAt = Date.now()
  // 看门狗必需：闸门一旦失效，第 3 个不会被拒而是跟着挂起，这里会永久卡住。
  // 没有它，脚本会停在这一行、等所有 timer 烧完后事件循环排空，
  // Node 退出码 0 静默退出 —— 门禁「变绿」。这条路必须堵死。
  const third = await withWatchdog(
    llmFetchJson('http://127.0.0.1:1/chat/completions', init, opts),
    3_000,
    '超限的第 3 个调用',
  )
  const rejectElapsed = Date.now() - rejectedAt

  check(
    '3.d 超限的第 3 个抛 LlmBusyError',
    third instanceof LlmBusyError,
    `实际抛出：${third instanceof Error ? `${third.name}: ${third.message}` : String(third)}`,
  )
  check('3.e 是立刻拒绝而不是排队等待', rejectElapsed < 200, `等了 ${rejectElapsed}ms`)
  check('3.f 被拒时不产生任何成功结果', !(third instanceof Object && 'ok' in (third as object)))
  check('3.g 被拒不占用槽位（计数没漂）', gate.inFlightCount === 2, `在途 ${gate.inFlightCount}`)

  // 放掉前两个，槽位必须能复用 —— 否则闸门会把自己锁死。
  for (const settle of settlers) settle()
  await withWatchdog(Promise.all([first, second]), 3_000, '前两个调用收尾')
  check('3.h 释放后槽位归零', gate.inFlightCount === 0, `在途 ${gate.inFlightCount}`)

  const done = llmFetchJson('http://127.0.0.1:1/chat/completions', init, opts)
  await new Promise((r) => setTimeout(r, 20))
  for (const settle of settlers) settle()
  const fourth = await withWatchdog(done, 3_000, '释放后的新调用')
  check('3.i 槽位释放后可以继续服务', !(fourth instanceof Error), `实际：${String(fourth)}`)

  // -------------------------------------------------------------------------
  console.log('\n[6] 用户可见文案如实说明发生了什么')

  const timeoutText = llmTimeoutMessage('AI 诊断', 45_000)
  check('6.a 超时文案明说「超时」', timeoutText.includes('超时'), timeoutText)
  check('6.b 超时文案说明未生成结果（不伪造成功）', timeoutText.includes('未生成结果'), timeoutText)
  check('6.c 超时文案带上实际等待时长', timeoutText.includes('45'), timeoutText)
  // 亚秒值不能渲染成「已等待 0 秒」—— 那是句假话。
  check('6.c2 亚秒超时不会说成「0 秒」', !llmTimeoutMessage('AI 助手', 400).includes('0 秒'), llmTimeoutMessage('AI 助手', 400))
  check('6.d 「正忙」文案不伪造成功态', !/已完成|已生成|成功/.test(LLM_BUSY_MESSAGE), LLM_BUSY_MESSAGE)
  check(
    '6.e 「正忙」文案说明其他功能不受影响',
    LLM_BUSY_MESSAGE.includes('不受影响'),
    LLM_BUSY_MESSAGE,
  )

  console.log('\n[7] 超时档位')
  check('7.a 默认档对齐 job-ai 的 45 秒量级', LLM_TIMEOUT_MS >= 5_000 && LLM_TIMEOUT_MS <= 60_000, `${LLM_TIMEOUT_MS}ms`)
  check('7.b 长文档档更长但仍有硬上限', LLM_LONG_TIMEOUT_MS > LLM_TIMEOUT_MS && LLM_LONG_TIMEOUT_MS <= 180_000, `${LLM_LONG_TIMEOUT_MS}ms`)

  console.log('\n[8] 一体机客户端超时不得短于后端长档')
  const adapterSrc = readFileSync(join(__dirname, '../../../apps/kiosk/src/services/api/aiHttpAdapter.ts'), 'utf8')
  const clientRaw = (adapterSrc.match(/const LLM_TIMEOUT_MS\s*=\s*([0-9_]+)/) ?? [])[1] ?? ''
  const clientLong = Number(clientRaw.replace(/_/g, ''))
  check('8.a kiosk LLM_TIMEOUT_MS 存在且为数字', Number.isFinite(clientLong) && clientLong > 0, String(clientLong))
  check(
    '8.b 客户端超时 ≥ 后端 LLM_LONG_TIMEOUT_MS 默认值',
    clientLong >= LLM_LONG_TIMEOUT_MS,
    `client=${clientLong} backend=${LLM_LONG_TIMEOUT_MS}`,
  )
  check('8.c parse/optimize/generate 走长超时', adapterSrc.includes('LLM_TIMEOUT_MS') && adapterSrc.includes('/resume/parse'), adapterSrc.slice(0, 80))
}

/**
 * 断言条数下限：防「跑了一半就宣布通过」。
 * 派生出的调用点数量会随代码增长，所以只钉一个保守下限，不钉精确值。
 */
const MIN_EXPECTED_ASSERTIONS = 55

runtimeChecks()
  .then(() => {
    clearTimeout(globalWatchdog)
    console.log(`\n${'='.repeat(70)}`)
    if (failures.length > 0) {
      console.log(`FAILED  ${passed} 通过 / ${failures.length} 失败`)
      for (const f of failures) console.log(`  - ${f}`)
      process.exit(1)
    }
    if (passed < MIN_EXPECTED_ASSERTIONS) {
      console.log(`FAILED  只跑了 ${passed} 条断言（下限 ${MIN_EXPECTED_ASSERTIONS}）—— 门禁被截断，不算通过`)
      process.exit(1)
    }
    console.log(`PASSED  ${passed} 项断言全部通过`)
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error('门禁自身执行失败：', error)
    process.exit(1)
  })
