// ============================================================================
// LLM 调用失败的错误码分类
//
// 为什么要有这个文件 —— 2026-08-19 的结论：
//
//   仓库里 10 个 LLM service 都写着同一段三段式（连不上 / 上游非 2xx / 空回复），
//   而三段全部抛同一个 `*_UNAVAILABLE` 码。`!res.ok` 那段**包含 429 限流**，
//   于是「你被限流了，等会儿再试」和「模型根本连不上」在前端是同一个信号。
//   前端因此陷入两难：把这个码判成「能力不可用」→ 限流时把可重试的入口置灰，
//   等于告诉用户功能坏了（伪造能力）；不判 → 模型真挂时不给诚实降级态，
//   违反「AI 挂了要明确说 AI 暂时无法使用」。2026-08-19 的 PR #727 选了后者，
//   并在注释里把这笔债记成「等后端拆码」。这个文件就是来还债的。
//
// 分类原则：
//
//   - 连不上（fetch 抛异常）、账户级（上游 401 / 402 / 403）、模型名无效
//     （上游 404，或 400 且响应体能看出是模型名问题）：配置恢复前每一次都会
//     失败，算能力级。一体机白名单见 `apps/kiosk/src/ai/aiOutage.ts`。
//   - 429 与 5xx：上游已经响应，常见于排队、瞬时过载、网关抖动。单次失败，
//     必须保留重试，不能靠这一次状态判「能力不可用」。
//   - 其余 4xx：这一次请求本身有问题。单次失败，不进能力级白名单
//     （`AI_PROVIDER_REQUEST_ERROR` 刻意留在外面）。
//   - 2xx 但没有内容：单次失败。
//
// 给用户看的账户级 / 模型名文案不带状态码。状态码只留在调用方日志里，
// 日志不得写入响应正文（正文可能回显用户原文）。本文件不记日志。
//
// 本文件只负责**造错误对象**，刻意不碰 `onLlmCall` 成本记账 ——
// 10 个 service 的记账时机并不一致（有的在抛错前记、有的只在 !res.ok 与成功时记），
// 由 helper 顺手「统一」会悄悄改变计费行为。记账仍留在各 service 原处。
// ============================================================================
import { ServiceUnavailableException } from '@nestjs/common'

/** 连不上：fetch 本身抛异常（DNS / TLS / 连接被拒 / 网络不可达）。能力级。 */
export const AI_PROVIDER_UNREACHABLE = 'AI_PROVIDER_UNREACHABLE'
/** 上游 401 / 402 / 403：密钥或账户侧拒绝。配置恢复前每次都失败，能力级。 */
export const AI_PROVIDER_ACCOUNT_UNAVAILABLE = 'AI_PROVIDER_ACCOUNT_UNAVAILABLE'
/**
 * 上游 404，或 400 且响应体能看出是模型名问题（不存在 / 已停用）。
 * 配置恢复前每次都失败，能力级。
 */
export const AI_PROVIDER_MODEL_INVALID = 'AI_PROVIDER_MODEL_INVALID'
/** 上游 429：限流。可重试，绝不能置灰入口。 */
export const AI_RATE_LIMITED = 'AI_RATE_LIMITED'
/** 上游 5xx：服务端错误。可能是瞬时过载，单次失败。 */
export const AI_PROVIDER_ERROR = 'AI_PROVIDER_ERROR'
/** 上游其它 4xx：这一次请求有问题。单次失败，不进能力级白名单。 */
export const AI_PROVIDER_REQUEST_ERROR = 'AI_PROVIDER_REQUEST_ERROR'
/** 2xx 但没有内容：模型返回了空回复。单次失败。 */
export const AI_EMPTY_RESPONSE = 'AI_EMPTY_RESPONSE'
/** 模型未配置或未启用。请求没发出，重试没有用。 */
export const AI_PROVIDER_NOT_CONFIGURED = 'AI_PROVIDER_NOT_CONFIGURED'
/** 异常体里读不到机器码时，200-failed 用它占位。 */
export const AI_UNKNOWN = 'AI_UNKNOWN'
/**
 * 模型地址不在已核准的出站白名单里（common/outbound/ai-endpoint-allowlist.ts），
 * 请求**根本没发出**。配置级问题：重试没有用，要管理员改地址或运维改白名单。
 * 不许糊进 AI_PROVIDER_UNREACHABLE —— 那等于把「我们没发」说成「对方连不上」。
 */
export const AI_ENDPOINT_NOT_ALLOWED = 'AI_ENDPOINT_NOT_ALLOWED'
/** 用户可见文案：如实说没发出、内容没外发，并说明其他功能没坏（对齐 LLM_BUSY_MESSAGE）。 */
export const AI_ENDPOINT_NOT_ALLOWED_MESSAGE =
  'AI 服务地址未通过核准，本次未发出请求，内容没有被发送；打印、扫描等其他功能不受影响'

/** 账户级与模型名问题给用户看的同一句。状态码不进这句话。 */
export const AI_ACCOUNT_OR_MODEL_MESSAGE = 'AI 服务暂时不可用'

/**
 * 200-failed 里「我们这边的原因」：公共次数要退。
 * 用户文件本身的问题（无法识别、为空）不在这里。
 * 限流、空回复、普通 4xx、输出不合格也不在这里 —— 那些不是「模型账户挂了」。
 */
const OUR_SIDE_PROVIDER_FAILURES: ReadonlySet<string> = new Set([
  AI_PROVIDER_ACCOUNT_UNAVAILABLE,
  AI_PROVIDER_MODEL_INVALID,
  AI_PROVIDER_ERROR,
  AI_PROVIDER_UNREACHABLE,
])

export function isOurSideProviderFailure(code: string | null | undefined): boolean {
  return typeof code === 'string' && OUR_SIDE_PROVIDER_FAILURES.has(code)
}

function serviceUnavailable(code: string, message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ error: { code, message } })
}

/** 从 Nest 异常体里取机器码。没有就是 undefined。 */
export function llmExceptionCode(err: unknown): string | undefined {
  const body = exceptionBody(err)
  const code = body?.error?.code
  return typeof code === 'string' && code.trim() ? code : undefined
}

/** 从 Nest 异常体里取给用户看的句子。裸字符串异常退回 Error.message。 */
export function llmExceptionMessage(err: unknown): string {
  const message = exceptionBody(err)?.error?.message
  if (typeof message === 'string' && message.trim()) return message
  return err instanceof Error ? err.message : String(err)
}

function exceptionBody(err: unknown): { error?: { code?: unknown; message?: unknown } } | undefined {
  const ex = err as { getResponse?: () => unknown }
  if (typeof ex?.getResponse !== 'function') return undefined
  const resp = ex.getResponse()
  if (!resp || typeof resp !== 'object') return undefined
  return resp as { error?: { code?: unknown; message?: unknown } }
}

/**
 * fetch 抛异常（连不上）。
 *
 * 调用方仍需自己在抛出前做日志与成本记账 —— 见文件头说明。
 */
export function llmUnreachableError(label: string): ServiceUnavailableException {
  return serviceUnavailable(AI_PROVIDER_UNREACHABLE, `${label}连接失败，请稍后重试`)
}

/** 模型未配置或未启用。默认句子给小青；诊断 / 优化 / 生成各自写更具体的句子。 */
export function llmNotConfiguredError(message = 'AI 模型未配置或未启用'): ServiceUnavailableException {
  return serviceUnavailable(AI_PROVIDER_NOT_CONFIGURED, message)
}

/**
 * 上游返回了非 2xx。按状态码分流。
 *
 * `body` 只用于判断 400 是不是模型名问题（读 error.message / error.code）。
 * 不记录、不回显正文。401 / 402 / 403 与 404 不看正文。
 */
export function llmUpstreamStatusError(
  label: string,
  status: number,
  body?: unknown,
): ServiceUnavailableException {
  if (status === 429) {
    return serviceUnavailable(AI_RATE_LIMITED, `${label}当前排队较多，请稍后重试`)
  }
  if (status >= 500) {
    return serviceUnavailable(AI_PROVIDER_ERROR, `${label}返回错误 (${status})，请稍后重试`)
  }
  if (status === 401 || status === 402 || status === 403) {
    return serviceUnavailable(AI_PROVIDER_ACCOUNT_UNAVAILABLE, AI_ACCOUNT_OR_MODEL_MESSAGE)
  }
  if (status === 404 || (status === 400 && modelNameProblem(body))) {
    return serviceUnavailable(AI_PROVIDER_MODEL_INVALID, AI_ACCOUNT_OR_MODEL_MESSAGE)
  }
  return serviceUnavailable(AI_PROVIDER_REQUEST_ERROR, `${label}请求未被接受 (${status})`)
}

/**
 * 合同审查等不走 ServiceUnavailableException 的调用方，用同一套状态判断。
 * 401 / 402 / 403 / 404，以及「模型名有问题」的 400，返回 true。
 */
export function isAccountOrModelUpstream(status: number, body?: unknown): boolean {
  if (status === 401 || status === 402 || status === 403 || status === 404) return true
  return status === 400 && modelNameProblem(body)
}

/** 2xx 但 content 为空。 */
export function llmEmptyResponseError(label: string): ServiceUnavailableException {
  return serviceUnavailable(AI_EMPTY_RESPONSE, `${label}未返回内容，请稍后重试`)
}

/**
 * 出站白名单拒绝（AiEndpointNotAllowedError）→ 503 + AI_ENDPOINT_NOT_ALLOWED。
 *
 * 调用方在 catch 里**先于**通用「连不上」分支处理它，且**不落账**（onLlmCall）：
 * 请求没发出，记一次调用就是凭空多算一笔没花过的钱。
 */
export function llmEndpointNotAllowedError(): ServiceUnavailableException {
  return serviceUnavailable(AI_ENDPOINT_NOT_ALLOWED, AI_ENDPOINT_NOT_ALLOWED_MESSAGE)
}

/**
 * 只读响应 JSON 的 error.message / error.code。
 * 必须同时像「模型」又像「不存在 / 无效 / 已停用」。大小写不敏感。
 * 解析不了的正文不当成模型名问题，避免把用户原文扫进去。
 */
function modelNameProblem(body: unknown): boolean {
  const text = errorFields(body)
  if (!text) return false
  const normalized = text.toLowerCase().replace(/[_-]+/g, ' ')
  if (!normalized.includes('model')) return false
  return (
    normalized.includes('not exist') ||
    normalized.includes('not found') ||
    normalized.includes('invalid') ||
    normalized.includes('deprecated') ||
    normalized.includes('unsupported') ||
    normalized.includes('unknown') ||
    normalized.includes('discontinued') ||
    normalized.includes('no longer') ||
    normalized.includes('retired')
  )
}

function errorFields(body: unknown): string {
  const record = asRecord(body)
  if (!record) return ''
  const error = record.error
  const parts: string[] = []
  if (typeof error === 'string') parts.push(error)
  else if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>
    if (typeof err.message === 'string') parts.push(err.message)
    if (typeof err.code === 'string') parts.push(err.code)
  }
  return parts.join(' ')
}

function asRecord(body: unknown): Record<string, unknown> | null {
  if (typeof body === 'string') {
    const trimmed = body.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
    try {
      return asRecord(JSON.parse(trimmed) as unknown)
    } catch {
      return null
    }
  }
  if (!body || typeof body !== 'object') return null
  return body as Record<string, unknown>
}
