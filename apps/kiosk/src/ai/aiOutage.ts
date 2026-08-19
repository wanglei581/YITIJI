/**
 * 「AI 到底可不可用」的判定来源（S2 接线共用）。
 *
 * 为什么需要这一份：`useAiTask` 要求调用方给 `availability` 的**真值**，
 * 但简历链 / 岗位匹配 / 模拟面试三条链路**都没有就绪探测端点**
 * （全站只有 `GET /assistant/advisor/availability` 一个，且只覆盖顾问）。
 *
 * 因此可用性只能从**真实往返的结果**反推，判据固定为三档：
 *
 *   unavailable ← 观测到能力级故障（未配置 / 连不上 / 演示模式 / 网络断）
 *   unknown     ← 还没做过任何一次真实往返（fail-closed：不假设正常）
 *   available   ← 至少一次真实往返拿到了结构化响应
 *
 * 这套判据由 `CareerPlanPage`（S2-6, PR #627）先行验证，此处原样提取为共享实现。
 * 提取的直接原因：S2-1 / S2-2 再各抄一份的话，同一个常量会出现四处，
 * 而「哪些错误码算能力不可用」一旦各页漂移，降级行为就会各不相同。
 */
import type { AiAvailability } from './useAiTask'

/**
 * 会把**整条 AI 能力**判成不可用的错误码。
 *
 * 其余错误（限流 429、参数错误 400、鉴权 401 等）只是**本次调用**失败，
 * 不是能力不可用 —— 那些必须保留重试入口，
 * 不许拿去把按钮永久置灰（置灰了用户就再也点不动，而服务其实是好的）。
 *
 * 准入标准只有一条：**这个码只可能由「能力没配好 / 根本没接真模型」产生**。
 * 只要后端同一个码还会用于「这次没成」（超时、限流、空回复、上游 4xx/5xx），
 * 就不能进这张表 —— 把限流显示成「这个功能不可用」本身就是伪造能力。
 *
 * 移出记录（2026-08-19，四家只读审查 3:1）：
 * - `AI_UNAVAILABLE`：后端把「连不上」「上游任意非 2xx（含 429 限流）」「模型没返回内容」
 *   三种情况抛成同一个码（`llm-fair-visit-plan.service.ts:318/323/329`，同型复用见
 *   `llm-career-plan` / `llm-job-fit` / `mock-interview-llm` / `job-ai-llm`）。留在表里
 *   等于把被限流的用户告知「功能死了」。
 * - `NETWORK_ERROR`：连服务端都没够着，天然瞬态，与「AI 能力」无关；它还是
 *   `CareerPlanPage` 粘滞死锁的直接来源（首屏抖一下就永久置灰）。
 *
 * 已知代价：模型真正连不上时，上述四条链不再进诚实降级态，只会给一个可重试的错误。
 * 根治要在**后端**把 `*_UNAVAILABLE` 拆成「未配置 / 连不上 / 限流 / 空回复」四个码，
 * 那是独立一刀（涉及 5+ 处 service），不在本次范围。
 *
 * 同类 `AI_DIAGNOSIS_UNAVAILABLE` / `AI_GENERATE_UNAVAILABLE` / `AI_OPTIMIZE_UNAVAILABLE`
 * 是真实的 503 错误码（不是 `status:'failed'`），但复用形态与 `AI_UNAVAILABLE` 完全一致，
 * 因此同样不进表，等后端拆码。
 */
export const AI_OUTAGE_CODES: ReadonlySet<string> = new Set([
  // 功能位未启用 / 无密钥：只可能是没配好，不可能是「这次没成」。
  'AI_NOT_CONFIGURED',
  // 简历诊断 / 生成 / 优化的模型未配置（ai.service.ts、llm-resume-optimize.service.ts）。
  // 与 AI_NOT_CONFIGURED 同义，只是简历链用了另一个名字。
  'AI_PROVIDER_NOT_CONFIGURED',
  // 演示模式：前端 mock 适配器主动拒绝，代表「这里根本没接真模型」。
  // 由 verify-ai-down-fallbacks.mjs 运行时钉死必须正好是这个值。
  'MOCK_MODE',
])

/** 从任意 API error 上取错误码；取不到时归为 `UNKNOWN_ERROR`（= 不判定能力不可用）。 */
export function aiErrorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
  }
  return 'UNKNOWN_ERROR'
}

/** 该错误是否足以判定「这条 AI 能力当前不可用」。 */
export function isAiOutage(error: unknown): boolean {
  return AI_OUTAGE_CODES.has(aiErrorCodeOf(error))
}

/** 取用户可读的错误文案；没有可读信息时用调用方给的兜底句。 */
export function aiErrorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/**
 * 把「观测到的故障」+「是否已做过真实往返」折算成 `useAiTask` 要的 `availability`。
 *
 * 注意 `probed` 为 false 时返回 `unknown` 而不是 `available` —— 这是 fail-closed：
 * 没探过就不许当作正常，否则 AI 其实是挂的、页面却先渲染成「可以生成」，
 * 用户点下去才发现不行（`interface-handoff.md` §0②）。
 */
export function deriveAiAvailability(input: {
  /** 已观测到的能力级故障原因；无故障传 null。 */
  outage: string | null
  /** 是否已完成至少一次真实往返（成功，或失败但不属于能力级故障）。 */
  probed: boolean
}): AiAvailability {
  if (input.outage) return 'unavailable'
  return input.probed ? 'available' : 'unknown'
}
