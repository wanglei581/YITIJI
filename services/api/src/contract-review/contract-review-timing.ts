/**
 * 合同审查的时间口径 —— **全链路唯一来源**。
 *
 * ── 修复前的矛盾（2026-08-17 生产故障） ─────────────────────────────────────
 *
 * `contract-review-provider.service.ts` 同一个文件里一边把模型锁死为
 * `deepseek-v4-pro`（推理模型，返回 content 之前要先烧掉大量 reasoning token），
 * 一边把 HTTP 超时钉死在 30 秒，而且 `DEFAULT_TIMEOUT_MS` 同时充当**硬上限**
 * —— 传入更大的值直接抛 `CONTRACT_PROVIDER_TRANSPORT_CONFIG_INVALID`，
 * 连配置调高的余地都没有。
 *
 * 生产实测：一段**仅数十字**的极简合同文本调用该模型耗时 **13.2 秒**（HTTP 200），
 * 已占 30 秒预算的 44%。真实合同单页文字量远大于此，再加完整 system prompt
 * 与结构化输出要求，`controller.abort()` 必然先到 —— 于是每次都是
 * `CONTRACT_PROVIDER_TRANSPORT_FAILED`，用户拿不到任何结果。
 *
 * ── 为什么不是「把 30 秒换成 120 秒」 ───────────────────────────────────────
 *
 * 换一个更大的常量只是把同样的故障推给更长的合同。产品要求是：
 * 「读取时间不要写死、不要有上限，根据上传的文件大小和字数给一个预计时间，
 *   在这个时间内完成；超出预计时间模型还没调成功，就返回超时失败」。
 * 所以这里给的是**函数**，不是常量。
 *
 * ── 与小程序预估口径的对齐（这是本模块存在的主要理由） ─────────────────────
 *
 * 小程序 `pages/contract-review/contract-review.js` 已经实现了对应的一半：
 *
 *     _estimate(pages) { return 20 + pages * 15 }      // 秒
 *     maxTries = ceil((eta * 4) / (POLL_MS / 1000))    // 轮询兜底 = 预计时间 4 倍
 *
 * 若服务端自己另定一套，就会出现「前端说预计 80 秒、服务端 30 秒就 abort」——
 * 用户看到的仍然是失败。因此本模块**逐字复刻**前端那条公式（`etaMs`），
 * 再由它派生出服务端的两个上限，并保证下面这条包含链恒成立：
 *
 *     providerTimeout(pages) ≤ analyzeStageBudget(pages) < clientGiveUp(pages)
 *      模型单次调用上限        analyze 整段预算            小程序放弃轮询的时刻
 *
 * 左边保证：模型还没超时，整段预算不会先到（不会把模型超时误报成阶段超时）。
 * 右边保证：**服务端一定先落终态**，小程序总能拿到 completed / failed，
 * 而不是等到自己放弃并把任务删掉。这条链由
 * `scripts/verify-contract-review-timeout.mjs` 对 1..50 页逐页断言。
 *
 * ── 为什么按页数而不是按字数 ───────────────────────────────────────────────
 *
 * 「随提取出的文本长度伸缩」听起来更准，但客户端手里只有 `analyzedPages`，
 * 它的预计时间也只能按页数算。服务端若改用字数，两边的口径就再也对不上了
 * —— 一份 2 页但极密的合同，服务端会算出很长的预算，客户端却按 2 页在
 * 200 秒就放弃。**对齐比精确更重要**，页内密度的波动由「模型只占整段预算的
 * 60%」和「服务端 2 倍 vs 客户端 4 倍」这两层余量吸收。
 *
 * 为了让客户端将来不必再自己维护公式，`ContractReviewTaskView` 现在直接回
 * `estimatedSeconds`（见 contract-review-task-view.mapper.ts）。
 */

/** 与小程序 `_estimate()` 逐字对应：固定开销（排队 + 文字识别）。 */
export const CONTRACT_REVIEW_ETA_BASE_MS = 20_000
/** 与小程序 `_estimate()` 逐字对应：每页增量。依据 13.2 秒单次实测取的整数。 */
export const CONTRACT_REVIEW_ETA_PER_PAGE_MS = 15_000

/** 小程序放弃轮询的倍数（`maxTries = eta * 4`）。服务端只读不改。 */
export const CONTRACT_REVIEW_CLIENT_GIVE_UP_FACTOR = 4
/** 服务端整段预算取客户端放弃点的一半 —— 服务端必须先落终态。 */
export const CONTRACT_REVIEW_STAGE_FACTOR = 2
/** 模型单次调用在整段预算里的占比；其余留给抽取重跑 / 规则引擎 / 安全闸门。 */
export const CONTRACT_REVIEW_MODEL_SHARE = 0.6

/**
 * analyze 整段预算的下限。
 *
 * 1 页时 `2 × eta = 70s`，扣掉抽取重跑（analyze 会重新抽一次做指纹比对）
 * 和规则引擎之后留给模型的太少，所以给一个不随页数缩到更低的地板。
 * 注意它必须仍然小于 1 页的客户端放弃点 `4 × 35s = 140s`。
 */
export const CONTRACT_REVIEW_STAGE_MIN_MS = 120_000
/** analyze 整段预算的上限；50 页时 `2 × eta = 1540s` 会被这里截住。 */
export const CONTRACT_REVIEW_STAGE_MAX_MS = 900_000

/** 模型单次调用的下限。低于此值等于回到「短合同也可能被 abort」的老问题。 */
export const CONTRACT_PROVIDER_MIN_TIMEOUT_MS = 60_000
/**
 * 模型单次调用的上限。
 *
 * 保留上限不是为了限制长合同 —— 长合同由公式自己伸缩到这里。它的作用是：
 * 上游若挂起不返回，必须有一个确定的时刻让本次调用失败并如实告知用户，
 * 而不是把连接一直挂着。产品要求的「不要有上限」指的是不要**写死**，
 * 不是指永不超时；「超出预计时间模型还没调成功，就返回超时失败」正是这条。
 */
export const CONTRACT_PROVIDER_MAX_TIMEOUT_MS = 300_000

/** extract 阶段预算保持原值（5 分钟）。该阶段本就正常，本次不动它。 */
export const CONTRACT_REVIEW_EXTRACT_BUDGET_MS = 5 * 60 * 1_000

/** 页数定义域：与 `validateReviewInput` / `MAX_PDF_PAGES` 一致。 */
const MIN_PAGES = 1
const MAX_PAGES = 50

/** 把任意输入夹到合法页数。页数不可信时按 1 页算（最保守的预算）。 */
export function normalizeContractPageCount(pages: unknown): number {
  if (typeof pages !== 'number' || !Number.isSafeInteger(pages) || pages < MIN_PAGES) return MIN_PAGES
  return pages > MAX_PAGES ? MAX_PAGES : pages
}

/**
 * 预计耗时（毫秒）。**必须与小程序 `_estimate()` 保持逐字一致**，
 * 改这里就要同步改那边，否则两侧口径立刻分叉。
 */
export function contractReviewEtaMs(pages: number): number {
  return CONTRACT_REVIEW_ETA_BASE_MS
    + normalizeContractPageCount(pages) * CONTRACT_REVIEW_ETA_PER_PAGE_MS
}

/** 给客户端展示的预计秒数（`ContractReviewTaskView.estimatedSeconds`）。 */
export function contractReviewEtaSeconds(pages: number): number {
  return Math.round(contractReviewEtaMs(pages) / 1_000)
}

/** 小程序放弃轮询的时刻。服务端只用来断言「自己一定更早落终态」。 */
export function contractReviewClientGiveUpMs(pages: number): number {
  return contractReviewEtaMs(pages) * CONTRACT_REVIEW_CLIENT_GIVE_UP_FACTOR
}

/** analyze 整段预算：抽取重跑 + 规则 + 模型 + 安全闸门 的总时限。 */
export function contractReviewAnalyzeBudgetMs(pages: number): number {
  const scaled = contractReviewEtaMs(pages) * CONTRACT_REVIEW_STAGE_FACTOR
  return clamp(scaled, CONTRACT_REVIEW_STAGE_MIN_MS, CONTRACT_REVIEW_STAGE_MAX_MS)
}

/**
 * 模型单次调用的超时。
 *
 * 这是替代原 `DEFAULT_TIMEOUT_MS = 30_000` 的那个值 —— 它现在随页数伸缩，
 * 且**不再兼任上限校验的阈值**（原代码 `timeoutMs > DEFAULT_TIMEOUT_MS` 就抛错，
 * 这才是 30 秒调不高的直接原因）。
 */
export function contractProviderTimeoutMs(pages: number): number {
  const share = Math.floor(contractReviewAnalyzeBudgetMs(pages) * CONTRACT_REVIEW_MODEL_SHARE)
  return clamp(share, CONTRACT_PROVIDER_MIN_TIMEOUT_MS, CONTRACT_PROVIDER_MAX_TIMEOUT_MS)
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}
