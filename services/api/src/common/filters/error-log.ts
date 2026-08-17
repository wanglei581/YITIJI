import type { Request } from 'express'

/**
 * 异常日志的**取材白名单**与格式化。
 *
 * 背景（实测复现，见 PR 正文）：全局异常过滤器此前一行日志都不写。
 * `requestId` 回给了客户端却从不落服务端日志 —— 实测一次 500 返回
 * requestId=7bf03f4f…，在服务端日志里搜到 **0** 次。运维拿着 requestId
 * 查不到任何东西，这直接违反交付章程门槛④「出问题时运维能在日志里看见原因」。
 *
 * ── 为什么不记 error.message / 请求体 / query / headers ──────────────────────
 *
 * 本仓刚做完 PII 脱敏收口（#646 / #649）。异常消息是**已知的泄漏面**：
 * `PrismaClientValidationError.message` 会把参数对象（含字段值）拼进消息，
 * 业务异常也可能把用户输入回显进消息。堆栈的首行同样是 `Name: message`。
 * 因此本模块采取「取材白名单」而不是「事后脱敏」——
 * 日志行只能由下面这些**服务端自有、结构受控**的来源拼成：
 *
 *   requestId（中间件生成或经字符集校验的追踪 id）
 *   method（HTTP 动词）
 *   route（Express 路由模板，如 /admin/orders/:id —— 源码字面量，不含用户数据）
 *   status（数字）
 *   code（机器码，必须匹配 ^[A-Z][A-Z0-9_]*$，否则记为 NON_MACHINE_CODE）
 *   errorName（异常构造函数名）
 *   durationMs（数字）
 *   stack frames（只取 `at …` 帧，**丢掉带 message 的首行**）
 *
 * 用户原话、请求体、query、header、cookie、token、异常消息**没有任何一条路径**
 * 能进到日志里 —— 不是靠正则过滤，而是靠它们从不被读取。
 * 由 `verify:error-observability` 用对抗性输入实测这条性质。
 */

export type ErrorLogLevel = 'error' | 'warn' | 'debug'

export interface ErrorLogFields {
  requestId: string
  method: string
  route: string
  status: number
  code: string
  errorName: string
  durationMs: number | null
}

/** 可搜索前缀。运维 grep 这个词就能捞出全部异常响应。 */
export const REQUEST_ERROR_LOG_MARKER = 'REQUEST_FAILED'

const MACHINE_CODE = /^[A-Z][A-Z0-9_]*$/
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/
/** 路由模板允许的字符：ASCII 路径 + `:param`。中文/空白/查询串一律不在此列。 */
const SAFE_ROUTE = /^[A-Za-z0-9/_:.*-]{1,200}$/
const DEFAULT_MAX_FRAMES = 12

/**
 * 分级：4xx 是客户端问题，不该刷 error 日志把真故障淹掉。
 *
 * - 非 HttpException（预期之外的崩溃）→ 永远 error，无论过滤器把它塌成什么状态码。
 * - HttpException 5xx（服务端自己判定的失败，如 readiness 503）→ error。
 * - 401/403/404/429 → debug：正常运行中就会大量出现（未登录、探测、轮询限流），
 *   放 warn 会变成噪声。
 * - 其余 4xx（400/409/422 …）→ warn：通常意味着前后端契约对不上，值得看见。
 */
export function errorLogLevel(status: number, isHttpException: boolean): ErrorLogLevel {
  if (!isHttpException) return 'error'
  if (status >= 500) return 'error'
  if (status === 401 || status === 403 || status === 404 || status === 429) return 'debug'
  return 'warn'
}

/** 异常构造函数名。取不到时给固定占位，绝不回落到 message。 */
export function safeErrorName(exception: unknown): string {
  if (exception instanceof Error) {
    const name = exception.name || exception.constructor?.name
    return typeof name === 'string' && /^[A-Za-z0-9_$.]{1,64}$/.test(name) ? name : 'Error'
  }
  return typeof exception === 'object' && exception !== null ? 'NonErrorObjectThrown' : 'NonErrorThrown'
}

/** 机器码校验：只有形如 UPPER_SNAKE 的码才允许进日志。 */
export function safeCode(code: string): string {
  return MACHINE_CODE.test(code) ? code : 'NON_MACHINE_CODE'
}

export function safeRequestId(requestId: string | undefined): string {
  return requestId && SAFE_REQUEST_ID.test(requestId) ? requestId : 'unknown'
}

export function safeMethod(method: string | undefined): string {
  return typeof method === 'string' && /^[A-Z]{3,10}$/.test(method) ? method : 'UNKNOWN'
}

/**
 * 路由标识。优先取 Express 路由模板（`/orders/:id` 这类源码字面量，
 * 天然不含用户数据）；未匹配到路由时（404 等）退回请求路径，
 * 但必须先剥掉查询串、再对不在安全字符集内的路径整体降级为占位符 ——
 * 宁可少一点定位信息，也不把用户可控字符串写进日志。
 */
export function safeRoutePattern(req: Pick<Request, 'route' | 'baseUrl' | 'originalUrl' | 'path'>): string {
  const routePath = (req.route as { path?: unknown } | undefined)?.path
  if (typeof routePath === 'string' && routePath.length > 0) {
    const combined = `${typeof req.baseUrl === 'string' ? req.baseUrl : ''}${routePath}`
    if (SAFE_ROUTE.test(combined)) return combined
  }
  const raw = typeof req.originalUrl === 'string' ? req.originalUrl : (req.path ?? '')
  const withoutQuery = raw.split('?')[0] ?? ''
  if (!withoutQuery) return '<unknown-route>'
  return SAFE_ROUTE.test(withoutQuery) ? withoutQuery : '<unsafe-path-omitted>'
}

/**
 * 只保留 `at …` 栈帧，**丢掉 `Name: message` 首行**。
 *
 * 这是本模块最关键的一条：Node 的 `err.stack` 首行就是异常消息，
 * 直接打 stack 等于把消息（可能含用户数据 / Prisma 参数值）写进日志。
 * 栈帧本身只有函数名与文件行号，是定位「原因在哪一行」所需的全部信息。
 */
export function stackFramesOnly(exception: unknown, maxFrames = DEFAULT_MAX_FRAMES): string[] {
  if (!(exception instanceof Error) || typeof exception.stack !== 'string') return []
  return exception.stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .slice(0, maxFrames)
}

/** 拼成一条单行、可 grep、字段稳定的日志。 */
export function formatErrorLogLine(fields: ErrorLogFields): string {
  return [
    REQUEST_ERROR_LOG_MARKER,
    `requestId=${safeRequestId(fields.requestId)}`,
    `method=${safeMethod(fields.method)}`,
    `route=${fields.route}`,
    `status=${Number.isFinite(fields.status) ? fields.status : -1}`,
    `code=${safeCode(fields.code)}`,
    `errorType=${fields.errorName}`,
    `durationMs=${fields.durationMs === null ? 'unknown' : fields.durationMs}`,
  ].join(' ')
}
