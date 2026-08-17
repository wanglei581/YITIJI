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
 */
export const AI_OUTAGE_CODES: ReadonlySet<string> = new Set([
  'AI_NOT_CONFIGURED',
  'AI_UNAVAILABLE',
  'MOCK_MODE',
  'NETWORK_ERROR',
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
