// ============================================================================
// LLM HTTP 调用底座：超时 + 全局并发闸门
//
// 为什么要有这个文件 —— 2026-08-17 架构承压深查的结论：
//
//   仓库里 11 个 LLM `fetch` 调用点，只有 job-ai（45 秒固定）和 contract-review
//   （60–300 秒动态）带 timeout，其余 10 个既没有 `signal` 也没有 `AbortController`。
//   而除 contract-review 外，所有 AI 调用都是**同步跑在 HTTP 请求里**的
//   （`services/worker` 目录下只有一个 package.json，三个 BullMQ worker 全部
//   跑在 API 进程内）。于是模型端一卡住，请求就永远挂着：连接不会断、
//   Node 的 socket 不会释放、请求也不会失败，只是无限期地占着。并发再叠上来，
//   整个 API 进程（**包括打印下单、包括后台审核**）跟着一起停。
//
//   没有超时，就没有「失败」这个状态；只有「永远没回来」。
//
// 这里把两件事收成一个入口，让所有 LLM 调用点共用：
//
//   1. 超时：`AbortController` + `signal`，真正取消底层请求。
//      不用 `Promise.race` —— 那个只是不再 await，socket 和上游请求还在，
//      泄漏照旧，等于把「挂住」换成「看不见地挂住」。
//   2. 并发闸门：全局在途上限，满了**立刻拒绝**，不排队（理由见 LlmConcurrencyGate）。
//
// 覆盖范围：所有跑在 HTTP 请求链路里的 LLM 调用（含 job-ai）。
// **不含 contract-review** —— 它走队列、自带分级超时和整段预算，
// 语义不同：队列作业被「当前繁忙」打回是错的，它该排队。
//
// 刻意不做的事：
//   - 不改任何 AI 业务逻辑。调用方原有的 `!res.ok` / 「未返回内容」/ 成本落账
//     （onLlmCall）分支全部原样保留，本文件只在前面**补**两条新分支。
//   - 不记请求/响应正文。LLM 的入参出参含简历、身份证、面试作答等 PII，
//     本文件从头到尾不 log body，也不把上游正文塞进 error message。
// ============================================================================

/**
 * 模型端卡住、由我们主动 abort。
 *
 * 单独立一个类型，是因为「超时」和「网络真的断了」必须能分开报 —— 这条教训
 * 来自合同审查：`CONTRACT_REVIEW_ANALYSIS_FAILED` 曾被 5 条失败路径共用，
 * 生产故障排查了整晚才反推出「其实是自己 abort 的」，而当时网络实测是好的。
 * 调用方据此映射到各自**独立**的 `AI_*_TIMEOUT` 错误码，不许糊进通用兜底码。
 */
export class LlmTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`LLM_TIMEOUT_${timeoutMs}`)
    this.name = 'LlmTimeoutError'
  }
}

/** 在途 LLM 调用已达全局上限，本次请求未发出（一次上游调用都没花）。 */
export class LlmBusyError extends Error {
  constructor(readonly limit: number) {
    super(`LLM_BUSY_${limit}`)
    this.name = 'LlmBusyError'
  }
}

// ---------------------------------------------------------------------------
// 超时档位
// ---------------------------------------------------------------------------

function readTimeoutEnv(name: string, fallbackMs: number, ceilingMs: number): number {
  const raw = Number(process.env[name])
  // 非法值退化到默认而不是抛错：宁可用默认值，也不要因为一个配错的环境变量
  // 让 AI 整条不可用。下限 5 秒防止「配成 0 = 立刻超时」把功能配死。
  return Number.isFinite(raw) && raw >= 5_000 ? Math.min(raw, ceilingMs) : fallbackMs
}

/**
 * 默认档 45 秒 —— 对齐既有的 job-ai（`AI_JOB_LLM_TIMEOUT_MS`，45 秒固定）。
 * 适用于对话、结构化短文本生成这类一问一答的调用。
 */
export const LLM_TIMEOUT_MS = readTimeoutEnv('AI_LLM_TIMEOUT_MS', 45_000, 60_000)

/**
 * 长文档档 90 秒。只给「整篇简历级别」的生成/重写：诊断报告、简历生成、简历优化。
 *
 * 为什么不跟着 45 秒一刀切：这三个的输出 token 量是对话类的数倍，45 秒会把
 * 「正常但慢」误判成故障，用户看到超时、后台却照样计费。为什么不放到几百秒：
 * 一体机用户站在屏幕前等，90 秒已经是可解释的上限；合同审查敢用 60–300 秒
 * 是因为它异步跑在队列里、用户不在原地等，简历这条链不具备那个条件。
 */
export const LLM_LONG_TIMEOUT_MS = readTimeoutEnv('AI_LLM_LONG_TIMEOUT_MS', 90_000, 180_000)

// ---------------------------------------------------------------------------
// 全局并发闸门
// ---------------------------------------------------------------------------

function readConcurrencyEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isInteger(raw) && raw >= 1 && raw <= 32 ? raw : fallback
}

/**
 * 全局在途 LLM 调用上限。
 *
 * 取 8 的依据（这是**安全上限**，不是调优出来的吞吐量目标 —— 它的职责是阻止
 * 无上限堆积，不是塑造流量，正常负载下不应该被摸到）：
 *
 *   - 参照 `print-sign` 的 `MAX_CONCURRENT_COMPOSE = 2`：那里是 2，因为 pdf-lib
 *     合成是**同步 CPU**，真的会阻塞事件循环。LLM 调用是 I/O 等待型，等待期间
 *     不占事件循环，所以上限可以显著高于 2，不必也取 2。
 *   - 真正被这个数字兜住的是：同时在途的响应缓冲内存、上游厂商的并发/配额压力，
 *     以及模型端卡死时能堆积多少条永不返回的请求。
 *   - 8 之上继续放大没有收益：单进程 API 同时还要服务打印下单和后台审核，
 *     AI 不该把进程资源吃到影响它们。
 *
 * 需要按真实负载调整时改 `AI_MAX_CONCURRENT_LLM`，不用改代码。
 */
export const MAX_CONCURRENT_LLM = readConcurrencyEnv('AI_MAX_CONCURRENT_LLM', 8)

/**
 * 计数信号量：满了**立刻拒绝**，不排队。
 *
 * 为什么不像 `print-sign` 那样排队等：那边是一体机点了「合成盖章」之后的后台
 * 工序，多等几秒无所谓。AI 这条链不一样 —— 用户就站在 27 寸竖屏前面看着。
 * 排队意味着他先干等 N 秒，再等自己那次 45 秒超时，最坏情况比直接告诉他
 * 「现在忙」要难受得多，而且期间他完全不知道发生了什么。立刻拒绝可以让他
 * 马上改去打印、扫描、查岗位 —— 那些功能本来就没坏。
 *
 * 另外排队队列本身是没有上限的，模型端一卡住，队列就是第二个无限堆积点，
 * 等于把刚堵上的洞在旁边重新挖一个。
 *
 * 拒绝时抛 `LlmBusyError`，由调用方映射成 503 + `AI_BUSY`，如实说「AI 正忙」。
 * 绝不返回空结果、占位文案或任何看起来像成功的东西。
 */
export class LlmConcurrencyGate {
  private inFlight = 0

  constructor(readonly limit: number) {}

  /** 当前在途数（给门禁和运维观测用）。 */
  get inFlightCount(): number {
    return this.inFlight
  }

  /** 拿槽位；满了抛 `LlmBusyError`，此时**一个上游请求都没发出**。 */
  acquire(): void {
    if (this.inFlight >= this.limit) throw new LlmBusyError(this.limit)
    this.inFlight += 1
  }

  /** 还槽位。只在 acquire 成功后的 finally 里调用，做下限保护防止计数漂负。 */
  release(): void {
    if (this.inFlight > 0) this.inFlight -= 1
  }
}

/** 进程级单例：全站 LLM 调用共用这一个闸门，「全局上限」才成立。 */
export const llmConcurrencyGate = new LlmConcurrencyGate(MAX_CONCURRENT_LLM)

// ---------------------------------------------------------------------------
// 统一调用入口
// ---------------------------------------------------------------------------

export interface LlmJsonResponse {
  ok: boolean
  status: number
  /** 上游状态短语。透出是为了让调用方既有的诊断日志一行不改地留着。 */
  statusText: string
  /** 已解析的响应体；解析失败或空包为 null，交给调用方既有的「未返回内容」分支。 */
  data: unknown
}

export interface LlmFetchInit {
  method: string
  headers: Record<string, string>
  body: string
}

export interface LlmFetchOptions {
  timeoutMs: number
  /** 仅供门禁注入；生产调用一律走进程级单例。 */
  gate?: LlmConcurrencyGate
  /** 仅供门禁注入假 fetch，避免门禁真打模型。 */
  fetchImpl?: typeof fetch
}

/**
 * 发一次 OpenAI 兼容的 Chat Completions 请求，并把响应体读完。
 *
 * 抛出：
 *   - `LlmBusyError`    —— 在途已达上限，请求未发出
 *   - `LlmTimeoutError` —— 超时，已主动 abort（**连读包阶段也算**，见下）
 *   - 其余原始错误      —— 网络/DNS/TLS 等，调用方按各自既有分支处理
 *
 * 为什么读包也要包进来：`stream:false` 下 headers 回来 ≈ 模型已生成完，但
 * 「headers 回了、body 挂住」是真实存在的形态。如果只把 `fetch()` 包在超时里、
 * 让调用方自己在外面 `await res.json()`，那一段就是裸奔的 —— 请求照样能永久挂住，
 * 超时形同虚设。所以 signal 一路盖到 body 读完；实测（Node 22）abort 时
 * `res.json()` 会带着我们传进去的 reason 一起 reject。
 */
export async function llmFetchJson(
  url: string,
  init: LlmFetchInit,
  options: LlmFetchOptions,
): Promise<LlmJsonResponse> {
  const gate = options.gate ?? llmConcurrencyGate
  const doFetch = options.fetchImpl ?? fetch
  const { timeoutMs } = options

  // 先过闸门：满了直接抛，不建 controller、不发请求。
  gate.acquire()

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new LlmTimeoutError(timeoutMs))
  }, timeoutMs)

  try {
    const res = await doFetch(url, { ...init, signal: controller.signal })
    let data: unknown = null
    try {
      data = await res.json()
    } catch (error) {
      // 解析失败退化成 null（调用方既有的「未返回内容」分支会接住）；
      // 但**超时不能被吞**成「内容为空」—— 那正是把根因抹掉的写法。
      if (timedOut) throw error
      data = null
    }
    return { ok: res.ok, status: res.status, statusText: res.statusText, data }
  } catch (error) {
    // 分类只看自己设的 timedOut 标记，不看 error.name：
    // AbortError / TimeoutError 的 name 在不同 runtime 上并不稳定
    // （合同审查那边已经踩过，见 contract-review-provider.service.ts）。
    if (timedOut) throw new LlmTimeoutError(timeoutMs)
    // 原始 error 原样外抛给调用方的既有 catch —— 它们一律不记正文。
    throw error
  } finally {
    clearTimeout(timer)
    gate.release()
  }
}

/** 用户可见的「AI 正忙」文案：如实说明发生了什么 + 其他功能没坏。 */
export const LLM_BUSY_MESSAGE = 'AI 当前请求过多，本次未开始处理，请稍后再试；打印、扫描等其他功能不受影响'

/**
 * 用户可见的超时文案：明说「响应超时」和「未生成结果」，不写成含糊的「请稍后重试」。
 *
 * 秒数下取 1：`Math.round` 对亚秒值会算出 0，界面上「已等待 0 秒」是句假话。
 * 生产路径上到不了（env 读取把下限夹在 5 秒），但文案函数不该依赖调用方夹好了值 ——
 * 这是本 PR 与 #698 配额回滚做联合验证时用 400ms 触发出来的。
 */
export function llmTimeoutMessage(label: string, timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000))
  return `${label}响应超时（已等待 ${seconds} 秒），本次未生成结果，请稍后重试`
}
