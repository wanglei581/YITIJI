// ============================================================================
// LLM 调用失败的错误码分类
//
// 为什么要有这个文件 —— 2026-08-19 的结论：
//
//   仓库里 10 个 LLM service 都写着同一段三段式（连不上 / 上游非 2xx / 空回复），
//   而三段全部抛同一个 `*_UNAVAILABLE` 码。`!res.ok` 那段**包含 429 限流**，
//   于是「你被限流了，等会儿再试」和「模型根本连不上」在前端是同一个信号。
//
//   前端因此陷入两难：把这个码判成「能力不可用」→ 限流时把可重试的入口置灰，
//   等于告诉用户功能坏了（伪造能力）；不判 → 模型真挂时不给诚实降级态，
//   违反「AI 挂了要明确说 AI 暂时无法使用」。2026-08-19 的 PR #727 选了后者，
//   并在注释里把这笔债记成「等后端拆码」。这个文件就是来还债的。
//
// 分类原则：**只有「根本没连上」才算能力级**。上游已经响应（无论 4xx / 5xx），
// 都只能证明这一次失败 —— 502/503/504 常见于瞬时过载、网关抖动、滚动发布，
// 下一次可能就成功。要判「能力不可用」得靠连续失败阈值或健康探针，
// 不能靠单次响应状态。（此判断由 DeepSeek 与 Cursor 两家独立得出，口径一致。）
//
// 只有 AI_PROVIDER_UNREACHABLE 允许进 Kiosk 的能力级白名单
// （`apps/kiosk/src/ai/aiOutage.ts`）；其余四个都必须保留重试入口。
//
// 本文件只负责**造错误对象**，刻意不碰 `onLlmCall` 成本记账 ——
// 10 个 service 的记账时机并不一致（有的在抛错前记、有的只在 !res.ok 与成功时记），
// 由 helper 顺手「统一」会悄悄改变计费行为。记账仍留在各 service 原处。
// ============================================================================
import { ServiceUnavailableException } from '@nestjs/common'

/** 连不上：fetch 本身抛异常（DNS / TLS / 连接被拒 / 网络不可达）。唯一的能力级码。 */
export const AI_PROVIDER_UNREACHABLE = 'AI_PROVIDER_UNREACHABLE'
/** 上游 429：限流。可重试，绝不能置灰入口。 */
export const AI_RATE_LIMITED = 'AI_RATE_LIMITED'
/** 上游 5xx：服务端错误。可能是瞬时过载，单次失败。 */
export const AI_PROVIDER_ERROR = 'AI_PROVIDER_ERROR'
/** 上游其它 4xx：请求本身有问题（参数 / 鉴权 / 模型名）。单次失败。 */
export const AI_PROVIDER_REQUEST_ERROR = 'AI_PROVIDER_REQUEST_ERROR'
/** 2xx 但没有内容：模型返回了空回复。单次失败。 */
export const AI_EMPTY_RESPONSE = 'AI_EMPTY_RESPONSE'

function serviceUnavailable(code: string, message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ error: { code, message } })
}

/**
 * fetch 抛异常（连不上）。
 *
 * 调用方仍需自己在抛出前做日志与成本记账 —— 见文件头说明。
 */
export function llmUnreachableError(label: string): ServiceUnavailableException {
  return serviceUnavailable(AI_PROVIDER_UNREACHABLE, `${label}连接失败，请稍后重试`)
}

/**
 * 上游返回了非 2xx。按状态码分流，**不要**把 5xx 当成能力级。
 *
 * 429 单独成码是这次拆码的核心：它此前和「连不上」共用一个码，
 * 导致被限流的用户看到「这个功能不可用」。
 */
export function llmUpstreamStatusError(label: string, status: number): ServiceUnavailableException {
  if (status === 429) {
    return serviceUnavailable(AI_RATE_LIMITED, `${label}当前排队较多，请稍后重试`)
  }
  if (status >= 500) {
    return serviceUnavailable(AI_PROVIDER_ERROR, `${label}返回错误 (${status})，请稍后重试`)
  }
  return serviceUnavailable(AI_PROVIDER_REQUEST_ERROR, `${label}请求未被接受 (${status})`)
}

/** 2xx 但 content 为空。 */
export function llmEmptyResponseError(label: string): ServiceUnavailableException {
  return serviceUnavailable(AI_EMPTY_RESPONSE, `${label}未返回内容，请稍后重试`)
}
