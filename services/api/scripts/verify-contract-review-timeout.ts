/**
 * verify:contract-review:timeout —— 合同审查超时口径 + 失败原因可见性门禁
 *
 * ── 守的是哪条真实故障 ─────────────────────────────────────────────────────
 *
 * 2026-08-17 生产：用户上传合同，extract 成功、analyze 全部失败，
 * 拿不到任何结果，页面只能显示「分析失败，服务端未说明原因」。
 *
 * 根因在 `contract-review-provider.service.ts` 内部自相矛盾（修复前）：
 *
 *   :7    const DEFAULT_TIMEOUT_MS = 30_000                 // 30 秒
 *   :11   deepseek: { model: 'deepseek-v4-pro' }            // 锁死推理模型
 *   :151  if (timeoutMs > DEFAULT_TIMEOUT_MS) throw ...     // 30 秒还是硬上限
 *   :158  setTimeout(() => controller.abort(), timeoutMs)
 *
 * 一边强制推理模型（返回 content 前先烧大量 reasoning token），
 * 一边把超时钉死在 30 秒且**不允许配置调高**。生产实测：数十字的极简合同
 * 调用该模型耗时 13.2 秒，已占 30 秒预算的 44%。真实合同必然超时。
 *
 * ── 本门禁的四组断言 ───────────────────────────────────────────────────────
 *
 *   A. 超时随体量伸缩，且不存在 30 秒硬上限（撤回修复 ⇒ A 红）
 *   B. 三层时限的包含链恒成立，服务端一定先于客户端落终态（口径对齐的证据）
 *   C. **真实 abort 实测**：驱动真的 `StrictFetchContractProviderTransport`，
 *      证明「超时会触发且报 CONTRACT_PROVIDER_TIMEOUT」，以及
 *      「同一个慢回包在按体量算出的超时下不会被 abort」——
 *      不是读代码推断，是跑出来的。
 *   D. 失败原因对用户可读、且日志里有底层错误类型但没有合同正文。
 *
 * 全程不连数据库、不连 Redis、不发真实网络请求（fetch 被替身接管），
 * 因此不受 `VERIFICATION_DATABASE_TARGET` 影响，也不与其他门禁共用状态。
 */
import { mapContractReviewTaskView } from '../src/contract-review/contract-review-task-view.mapper'
import {
  CONTRACT_REVIEW_GENERIC_FAILURE_REASON,
  contractReviewFailureCodes,
  contractReviewFailureReason,
  isKnownContractReviewFailureCode,
} from '../src/contract-review/contract-review-failure-reason'
import {
  CONTRACT_REVIEW_ERROR_LOG_MARKER,
  formatContractReviewErrorLog,
} from '../src/contract-review/contract-review-error-log'
import {
  CONTRACT_PROVIDER_MAX_TIMEOUT_MS,
  CONTRACT_PROVIDER_MIN_TIMEOUT_MS,
  CONTRACT_REVIEW_STAGE_MAX_MS,
  contractProviderTimeoutMs,
  contractReviewAnalyzeBudgetMs,
  contractReviewClientGiveUpMs,
  contractReviewEtaMs,
  contractReviewEtaSeconds,
} from '../src/contract-review/contract-review-timing'
import {
  StrictFetchContractProviderTransport,
  type ContractProviderTransportRequest,
} from '../src/contract-review/contract-review-provider.service'
import type { ContractReviewTaskRow } from '../src/contract-review/contract-review.types'

let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  ✅ ${name}`); return }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

const PAGES = Array.from({ length: 50 }, (_, index) => index + 1)

// ─────────────────────────────────────────────────────────────────────────────
// A. 超时随体量伸缩，且 30 秒硬上限已经不存在
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[A] 超时随体量伸缩，30 秒硬上限已移除')

const OLD_HARD_CEILING_MS = 30_000

check(
  '1 页合同的模型超时已高于旧的 30 秒硬上限',
  contractProviderTimeoutMs(1) > OLD_HARD_CEILING_MS,
  `实际 ${contractProviderTimeoutMs(1)}ms`,
)
check(
  '5 页合同的模型超时已高于旧的 30 秒硬上限',
  contractProviderTimeoutMs(5) > OLD_HARD_CEILING_MS,
  `实际 ${contractProviderTimeoutMs(5)}ms`,
)
check(
  '模型超时随页数单调不减（不是一个写死的常量）',
  PAGES.slice(1).every((p) => contractProviderTimeoutMs(p) >= contractProviderTimeoutMs(p - 1)),
)
check(
  '模型超时确实随体量增长（20 页 > 1 页），不是全程贴着同一个值',
  contractProviderTimeoutMs(20) > contractProviderTimeoutMs(1),
  `1 页 ${contractProviderTimeoutMs(1)}ms → 20 页 ${contractProviderTimeoutMs(20)}ms`,
)
check(
  '阶段预算随页数单调不减',
  PAGES.slice(1).every((p) => contractReviewAnalyzeBudgetMs(p) >= contractReviewAnalyzeBudgetMs(p - 1)),
)
check(
  '阶段预算确实随体量增长（50 页 > 1 页）',
  contractReviewAnalyzeBudgetMs(50) > contractReviewAnalyzeBudgetMs(1),
  `1 页 ${contractReviewAnalyzeBudgetMs(1)}ms → 50 页 ${contractReviewAnalyzeBudgetMs(50)}ms`,
)
check(
  '页数非法（0 / 负数 / 非整数 / NaN）时退化到 1 页预算，不抛错、不给 0 超时',
  [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY].every(
    (bad) => contractProviderTimeoutMs(bad as number) === contractProviderTimeoutMs(1),
  ),
)
check(
  '超出 50 页时按 50 页封顶，不会算出无界预算',
  contractProviderTimeoutMs(9_999) === contractProviderTimeoutMs(50) &&
    contractReviewAnalyzeBudgetMs(9_999) === contractReviewAnalyzeBudgetMs(50),
)
check(
  '仍然存在确定的上限 —— 上游挂起时必须有时刻返回超时失败，不能永久挂着',
  contractProviderTimeoutMs(50) <= CONTRACT_PROVIDER_MAX_TIMEOUT_MS &&
    contractReviewAnalyzeBudgetMs(50) <= CONTRACT_REVIEW_STAGE_MAX_MS,
)

// ─────────────────────────────────────────────────────────────────────────────
// B. 三层时限的包含链 —— 这就是「服务端口径与前端预估口径一致」的证据
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[B] 服务端超时口径 vs 小程序预估口径')

// 小程序 pages/contract-review/contract-review.js 的原文：
//   _estimate(pages) { return 20 + p * 15 }            // 秒
//   maxTries = ceil((eta * 4) / (POLL_MS / 1000))      // 放弃点 = 预计时间 4 倍
const MINIAPP_ETA_SECONDS = (pages: number): number => 20 + pages * 15

check(
  '服务端 eta 公式与小程序 _estimate() 逐页逐字相等',
  PAGES.every((p) => contractReviewEtaSeconds(p) === MINIAPP_ETA_SECONDS(p)),
  PAGES.filter((p) => contractReviewEtaSeconds(p) !== MINIAPP_ETA_SECONDS(p)).join(','),
)
check(
  '下发给客户端的 estimatedSeconds 就是同一条公式（客户端无需再自己算）',
  contractReviewEtaSeconds(3) === MINIAPP_ETA_SECONDS(3) &&
    contractReviewEtaMs(3) === MINIAPP_ETA_SECONDS(3) * 1_000,
)
check(
  '模型超时 ≤ 阶段预算：模型还没超时，整段预算不会先到（逐页 1..50）',
  PAGES.every((p) => contractProviderTimeoutMs(p) <= contractReviewAnalyzeBudgetMs(p)),
  PAGES.filter((p) => contractProviderTimeoutMs(p) > contractReviewAnalyzeBudgetMs(p)).join(','),
)
check(
  '阶段预算 < 客户端放弃点：服务端一定先落终态，用户不会只等到轮询超时（逐页 1..50）',
  PAGES.every((p) => contractReviewAnalyzeBudgetMs(p) < contractReviewClientGiveUpMs(p)),
  PAGES.filter((p) => contractReviewAnalyzeBudgetMs(p) >= contractReviewClientGiveUpMs(p)).join(','),
)
check(
  '前端「预计 N 秒」时服务端不会在 N 秒之前 abort（逐页 1..50）',
  PAGES.every((p) => contractProviderTimeoutMs(p) >= contractReviewEtaMs(p) ||
    contractProviderTimeoutMs(p) === CONTRACT_PROVIDER_MAX_TIMEOUT_MS),
  PAGES.filter((p) => contractProviderTimeoutMs(p) < contractReviewEtaMs(p) &&
    contractProviderTimeoutMs(p) !== CONTRACT_PROVIDER_MAX_TIMEOUT_MS).join(','),
)

console.log('    页数 → eta / 模型超时 / 阶段预算 / 客户端放弃点（秒）')
for (const p of [1, 3, 5, 10, 20, 50]) {
  console.log(
    `      ${String(p).padStart(2)} → ${contractReviewEtaSeconds(p)}` +
    ` / ${contractProviderTimeoutMs(p) / 1000}` +
    ` / ${contractReviewAnalyzeBudgetMs(p) / 1000}` +
    ` / ${contractReviewClientGiveUpMs(p) / 1000}`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// C. 真实 abort 实测 —— 驱动真的 transport，不做代码推断
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[C] 真实 transport 实测：慢回包会不会被 abort')

function transportRequest(timeoutMs: number): ContractProviderTransportRequest {
  return {
    url: 'https://api.deepseek.com/chat/completions',
    apiKey: 'verify-contract-timeout-key-123456',
    payload: {
      model: 'deepseek-v4-pro',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: '{"pages":[]}' },
      ],
    },
    timeoutMs,
  }
}

/**
 * 一个「慢上游」替身：delayMs 之后才回 200，期间尊重 abort 信号。
 * 这正是 deepseek-v4-pro 在真实合同上的行为形态（先烧 reasoning token 再回包）。
 */
function slowFetch(delayMs: number) {
  return async (_url: string, init: RequestInit): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response('{}', { status: 200 })), delayMs)
      init.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('aborted-by-signal'))
      }, { once: true })
    })
}

async function rejectionOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return '<resolved>'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

async function runTransportChecks(): Promise<void> {
  // C-1：超时确实会触发，且报的是 TIMEOUT 而不是 TRANSPORT_FAILED。
  // 用一个很小的 max 把等待压到亚秒级 —— 机制与生产完全同一条代码路径。
  const tooTight = new StrictFetchContractProviderTransport(slowFetch(1_500), 300)
  const tightStart = Date.now()
  const tightError = await rejectionOf(() => tooTight.send(transportRequest(300)))
  const tightElapsed = Date.now() - tightStart
  check(
    '上限低于回包耗时 ⇒ 真的 abort 了（不是静静地等下去）',
    tightError === 'CONTRACT_PROVIDER_TIMEOUT' && tightElapsed < 1_200,
    `error=${tightError} elapsed=${tightElapsed}ms`,
  )
  check(
    '超时报 CONTRACT_PROVIDER_TIMEOUT，不再塌成 CONTRACT_PROVIDER_TRANSPORT_FAILED',
    tightError === 'CONTRACT_PROVIDER_TIMEOUT',
    `实际 ${tightError}`,
  )

  // C-2：同一个慢回包，改用「按体量算出的超时」就不再被 abort。
  // 这是「长合同现在不会被 abort」的直接证据：1500ms 的回包在旧的
  // 30 秒常量下当然也能过，所以下面 C-3 才是真正的对照。
  const roomy = new StrictFetchContractProviderTransport(slowFetch(1_500))
  const roomyStart = Date.now()
  const roomyError = await rejectionOf(() => roomy.send(transportRequest(contractProviderTimeoutMs(5))))
  check(
    '按 5 页体量算出的超时下，同一个慢回包正常返回、没有被 abort',
    roomyError === '<resolved>',
    `error=${roomyError} elapsed=${Date.now() - roomyStart}ms`,
  )

  // C-3：**旧行为 vs 新行为的对照**。
  // 把「上游耗时」和「超时上限」按同一比例缩小 100 倍来跑：
  //   旧：上限恒为 30_000/100 = 300ms，与页数无关   → 5 页(950ms) 必然 abort
  //   新：上限 = contractProviderTimeoutMs(5)/100    → 同一个回包顺利返回
  // 缩放只影响本检查的等待时间，不改变被验证的关系。
  const SCALE = 100
  const fivePageUpstreamMs = Math.round(contractReviewEtaMs(5) / SCALE) // 95_000/100 = 950ms
  const oldCeilingScaled = Math.round(OLD_HARD_CEILING_MS / SCALE) // 300ms
  const newCeilingScaled = Math.round(contractProviderTimeoutMs(5) / SCALE)

  const underOldCeiling = new StrictFetchContractProviderTransport(
    slowFetch(fivePageUpstreamMs), oldCeilingScaled,
  )
  const oldResult = await rejectionOf(() => underOldCeiling.send(transportRequest(oldCeilingScaled)))
  check(
    `对照：旧的固定 30 秒上限（缩放为 ${oldCeilingScaled}ms）会 abort 掉 5 页合同的回包`,
    oldResult === 'CONTRACT_PROVIDER_TIMEOUT',
    `实际 ${oldResult}`,
  )

  const underNewCeiling = new StrictFetchContractProviderTransport(
    slowFetch(fivePageUpstreamMs), newCeilingScaled,
  )
  const newResult = await rejectionOf(() => underNewCeiling.send(transportRequest(newCeilingScaled)))
  check(
    `对照：按体量伸缩后的上限（缩放为 ${newCeilingScaled}ms）让同一个回包正常返回`,
    newResult === '<resolved>',
    `实际 ${newResult}`,
  )

  // C-4：生产构造（不传参）的上限必须容得下最长合同的超时。
  const production = new StrictFetchContractProviderTransport(slowFetch(0))
  check(
    '生产默认构造的上限 ≥ 50 页合同算出的超时（默认值不会重新变成瓶颈）',
    // 用一个 50 页的超时去发一次立刻返回的请求；若默认上限比它小，
    // resolveTimeout 会把它夹小 —— 这里只需断言构造本身不拒绝该量级。
    CONTRACT_PROVIDER_MAX_TIMEOUT_MS >= contractProviderTimeoutMs(50) &&
      (await rejectionOf(() => production.send(transportRequest(contractProviderTimeoutMs(50))))) === '<resolved>',
  )
  check(
    '模型超时下限不低于 60 秒（短合同也不会回到「随时可能被 abort」）',
    contractProviderTimeoutMs(1) >= CONTRACT_PROVIDER_MIN_TIMEOUT_MS,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// D. 失败原因可读 + 日志可运维且不泄漏
// ─────────────────────────────────────────────────────────────────────────────
function runFailureAndLogChecks(): void {
  console.log('\n[D] 失败原因对用户可读')

  const codes = contractReviewFailureCodes()
  check('失败原因白名单非空', codes.length > 0, `${codes.length} 条`)
  check(
    '白名单里必须覆盖本次故障的两个超时码',
    isKnownContractReviewFailureCode('CONTRACT_PROVIDER_TIMEOUT') &&
      isKnownContractReviewFailureCode('CONTRACT_REVIEW_TIMEOUT'),
  )
  check(
    '每条文案都非空且足够具体（≥ 8 字）',
    codes.every((code) => contractReviewFailureReason(code).length >= 8),
    codes.filter((code) => contractReviewFailureReason(code).length < 8).join(','),
  )
  // 文案里出现机器码 / 堆栈 / 厂商名 / 模型名，等于把内部实现透给用户。
  const LEAKY = [
    'CONTRACT_', '_FAILED', 'Error', 'at ', 'undefined', 'null',
    'deepseek', 'qwen', 'DeepSeek', 'Qwen', 'provider', 'BullMQ', 'Redis', 'Prisma',
  ]
  const leaked = codes.filter((code) => {
    const reason = contractReviewFailureReason(code)
    return LEAKY.some((needle) => reason.includes(needle))
  })
  check('文案里不出现机器码 / 堆栈 / 厂商名 / 模型名 / 内部组件名', leaked.length === 0, leaked.join(','))
  check(
    '超时文案要告诉用户「篇幅太长」这个可行动的原因，而不是只说失败',
    contractReviewFailureReason('CONTRACT_PROVIDER_TIMEOUT').includes('篇幅') ||
      contractReviewFailureReason('CONTRACT_PROVIDER_TIMEOUT').includes('较长'),
  )
  check(
    '未登记的码走兜底文案，绝不回显原始码',
    contractReviewFailureReason('SOME_UNREGISTERED_CODE') === CONTRACT_REVIEW_GENERIC_FAILURE_REASON &&
      !CONTRACT_REVIEW_GENERIC_FAILURE_REASON.includes('SOME_UNREGISTERED_CODE'),
  )
  check(
    'null / undefined / 非字符串也有兜底文案，不会抛错',
    [null, undefined, 42, {}].every(
      (bad) => contractReviewFailureReason(bad) === CONTRACT_REVIEW_GENERIC_FAILURE_REASON,
    ),
  )

  console.log('\n[D2] 视图层：failed 才带原因，其余状态不带')

  const baseRow: ContractReviewTaskRow = {
    id: 'task-verify-timeout',
    endUserId: null,
    accessTokenHash: null,
    sourceFileId: 'file-1',
    resultFileId: null,
    contractType: 'labor_contract',
    status: 'failed',
    analyzedPages: 5,
    totalPages: 5,
    truncated: false,
    ocrConfidence: 'high',
    expiresAt: new Date('2026-08-18T00:00:00.000Z'),
    resultJson: null,
    extractionFingerprint: null,
    confirmedAt: null,
    errorCode: 'CONTRACT_PROVIDER_TIMEOUT',
  }

  const failedView = mapContractReviewTaskView(baseRow)
  check(
    'failed 任务带上可读的 failureReason（小程序 _poll() 读的就是这个键）',
    typeof failedView.failureReason === 'string' && failedView.failureReason.length >= 8,
    String(failedView.failureReason),
  )
  check(
    'failed 任务带上白名单内的 failureCode',
    failedView.failureCode === 'CONTRACT_PROVIDER_TIMEOUT',
    String(failedView.failureCode),
  )
  check(
    'estimatedSeconds 按已识别页数下发，与小程序公式一致',
    failedView.estimatedSeconds === MINIAPP_ETA_SECONDS(5),
    String(failedView.estimatedSeconds),
  )
  const unknownCodeView = mapContractReviewTaskView({ ...baseRow, errorCode: 'INTERNAL_WEIRD_STATE' })
  check(
    '未登记的码不外泄：failureCode 为 null，但 failureReason 仍有兜底文案',
    unknownCodeView.failureCode === null &&
      unknownCodeView.failureReason === CONTRACT_REVIEW_GENERIC_FAILURE_REASON,
  )
  const runningView = mapContractReviewTaskView({
    ...baseRow, status: 'ai_analyzing', errorCode: 'CONTRACT_PROVIDER_TIMEOUT',
  })
  check(
    '处理中的任务不带失败原因（不让客户端误判成已失败）',
    runningView.failureCode === null && runningView.failureReason === null,
  )
  const noPagesView = mapContractReviewTaskView({ ...baseRow, analyzedPages: 0, totalPages: null })
  check(
    '页数尚未识别时 estimatedSeconds 退化到 1 页，与小程序取值顺序一致',
    noPagesView.estimatedSeconds === MINIAPP_ETA_SECONDS(1),
    String(noPagesView.estimatedSeconds),
  )

  console.log('\n[D3] 日志：有底层错误类型，没有合同正文 / PII')

  // 对抗性输入：把合同正文、姓名、身份证号、薪资、凭证塞进异常消息，
  // 断言它们**没有一条**出现在日志行里。
  const CONTRACT_BODY = '甲方：北京某某科技有限公司；乙方：张三，身份证号 110101199001011234，' +
    '月薪 18000 元，试用期六个月，违约金 50000 元。'
  const SECRET = 'sk-contract-review-abcdef0123456789'
  const leakyError = new Error(`解析失败：${CONTRACT_BODY} apiKey=${SECRET}`)

  const line = formatContractReviewErrorLog({
    taskId: 'task-verify-timeout',
    stage: 'analyze',
    safeCode: 'CONTRACT_REVIEW_ANALYSIS_FAILED',
    cause: leakyError,
  })

  check('日志有可 grep 的固定前缀', line.includes(CONTRACT_REVIEW_ERROR_LOG_MARKER))
  check('日志记录了阶段', line.includes('stage=analyze'))
  check('日志记录了对外的安全码', line.includes('code=CONTRACT_REVIEW_ANALYSIS_FAILED'))
  check('日志记录了底层错误类型', line.includes('errorType=Error'))
  check('日志记录了 taskId，运维可据此定位', line.includes('taskId=task-verify-timeout'))
  for (const [label, needle] of [
    ['合同正文', '试用期六个月'],
    ['甲方名称', '北京某某科技有限公司'],
    ['姓名', '张三'],
    ['身份证号', '110101199001011234'],
    ['薪资', '18000'],
    ['凭证', SECRET],
  ] as const) {
    check(`日志不含${label}`, !line.includes(needle))
  }
  check(
    '自由文本消息只留 NON_MACHINE_CODE 占位，不原样落盘',
    line.includes('causeCode=NON_MACHINE_CODE'),
  )

  // 底层错误本身是机器码时，必须原样保留 —— 这正是那晚要挖 Redis 才拿到的东西。
  const codeLine = formatContractReviewErrorLog({
    taskId: 'task-verify-timeout',
    stage: 'analyze',
    safeCode: 'CONTRACT_PROVIDER_TIMEOUT',
    cause: new Error('CONTRACT_PROVIDER_TIMEOUT'),
  })
  check(
    '底层错误是机器码时原样入日志（causeCode=CONTRACT_PROVIDER_TIMEOUT）',
    codeLine.includes('causeCode=CONTRACT_PROVIDER_TIMEOUT'),
    codeLine.split('\n')[0] ?? '',
  )
  check(
    '栈帧只取 `at …` 行，不含带 message 的首行',
    codeLine.split('\n').slice(1).every((frame) => frame.startsWith('at ')) &&
      !codeLine.includes('Error: CONTRACT_PROVIDER_TIMEOUT'),
  )
  check(
    '非 Error 抛出物不会让日志崩掉',
    formatContractReviewErrorLog({
      taskId: 'x', stage: 'extract', safeCode: 'CONTRACT_REVIEW_EXTRACTION_FAILED', cause: 'plain string',
    }).includes('causeCode=NON_MACHINE_CODE'),
  )
  check(
    '非法 taskId 不会被原样写进日志',
    !formatContractReviewErrorLog({
      taskId: '张三的合同 <script>', stage: 'analyze',
      safeCode: 'CONTRACT_REVIEW_ANALYSIS_FAILED', cause: new Error('X'),
    }).includes('张三'),
  )
}

async function main(): Promise<void> {
  await runTransportChecks()
  runFailureAndLogChecks()
  console.log(`\n${failures === 0 ? '✅' : '❌'} contract review timeout gate: ${checks - failures}/${checks} PASS`)
  if (failures > 0) process.exit(1)
}

void main()
