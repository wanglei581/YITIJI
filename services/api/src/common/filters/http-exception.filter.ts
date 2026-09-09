import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { ErrorResponseBody } from '../dto/api-response.dto'
import {
  errorLogLevel,
  formatErrorLogLine,
  safeErrorName,
  safeRoutePattern,
  stackFramesOnly,
} from './error-log'

function isMachineErrorCode(value: string): boolean {
  return /^[A-Z][A-Z0-9_]+$/.test(value)
}

/** 500 的兜底句。只有真的是服务端故障时才该出现这句。 */
const DEFAULT_ERROR_CODE = 'INTERNAL_SERVER_ERROR'
const DEFAULT_ERROR_MESSAGE = '服务器内部错误'

/**
 * 4xx 落到兜底时的说法。
 *
 * 一律是**不含任何上游原文**的固定句：这里的输入可能带内网地址、连接串或凭据，
 * 所以只按状态码给话，绝不拼接 exception 的 message。
 */
function clientErrorFallbackMessage(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:  return '请求内容有误，请检查后重试'
    case HttpStatus.UNAUTHORIZED: return '身份校验未通过，请重新登录后再试'
    case HttpStatus.FORBIDDEN:    return '没有权限执行该操作'
    case HttpStatus.NOT_FOUND:    return '请求的内容不存在'
    case HttpStatus.METHOD_NOT_ALLOWED: return '该操作方式不被支持'
    case HttpStatus.CONFLICT:     return '操作发生冲突，请刷新后重试'
    case HttpStatus.GONE:         return '内容已失效'
    case HttpStatus.UNPROCESSABLE_ENTITY: return '请求内容无法处理，请检查后重试'
    default:                      return '请求未能完成，请稍后重试'
  }
}

/**
 * 4xx 落到兜底时的**机器码**。与上面那句话配对：状态码说 4xx，`error.code` 就不能说 500。
 *
 * 2026-09-09 生产实测发现的不一致 —— 一个裸 `throw new NotFoundException()`（响应体里
 * 没有 `error.code`）会得到：
 *   HTTP 404  {"error":{"code":"INTERNAL_SERVER_ERROR","message":"请求的内容不存在"}}
 * message 是对的（那是 #975 修的），`code` 却还挂着 500 的默认值。
 * 调用方按 `code` 分支时会当成「服务端崩了」去重试或报障，而实际是「这个东西不存在」。
 *
 * 只在 code 仍是默认值 `INTERNAL_SERVER_ERROR` 时才改；任何显式设过 code 的错误原样保留。
 * 已经带状态文案（如 Nest 默认的 `Not Found`）的也不动 —— 那本来就与状态一致，
 * 且小程序侧的既有夹具按那个形状写着（apps/miniapp/scripts/verify-user-error-message.mjs:63）。
 */
function clientErrorFallbackCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:  return 'BAD_REQUEST'
    case HttpStatus.UNAUTHORIZED: return 'UNAUTHORIZED'
    case HttpStatus.FORBIDDEN:    return 'FORBIDDEN'
    case HttpStatus.NOT_FOUND:    return 'NOT_FOUND'
    case HttpStatus.METHOD_NOT_ALLOWED: return 'METHOD_NOT_ALLOWED'
    case HttpStatus.CONFLICT:     return 'CONFLICT'
    case HttpStatus.GONE:         return 'GONE'
    case HttpStatus.UNPROCESSABLE_ENTITY: return 'UNPROCESSABLE_ENTITY'
    default:                      return 'CLIENT_ERROR'
  }
}

/**
 * 全局异常过滤器。除了把异常整形成统一错误响应，还负责**唯一一条**
 * 服务端异常日志 —— 此前这里一行日志都不写，所有 500 在服务端零痕迹。
 *
 * 日志取材严格限定在 `error-log.ts` 的白名单内：不读请求体 / query / header /
 * cookie，也不读异常消息与堆栈首行。三处 LLM 调用外层的裸 `catch {}`
 * （装着用户文本的 request body 从不被引用）这一性质不受本改动影响：
 * 那些错误根本到不了本过滤器，即便到了，本过滤器也不会去碰 body。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException')

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request  = ctx.getRequest<Request & { requestId?: string; requestStartedAt?: number }>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let code = DEFAULT_ERROR_CODE
    let message: string = DEFAULT_ERROR_MESSAGE
    let details: string[] | undefined

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const body = exception.getResponse()

      if (typeof body === 'string') {
        if (isMachineErrorCode(body)) {
          code = body
          message = body
        }
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>

        // Priority: body.error.code / body.error.message / body.error.details
        const errField = b['error']
        if (typeof errField === 'object' && errField !== null) {
          const err = errField as Record<string, unknown>
          if (typeof err['code'] === 'string')    code    = err['code']
          if (typeof err['message'] === 'string') message = err['message']
          if (Array.isArray(err['details'])) {
            details = (err['details'] as unknown[]).filter((d): d is string => typeof d === 'string')
          }
        } else if (typeof errField === 'string') {
          const bodyMessage = b['message']
          if (typeof bodyMessage === 'string' && isMachineErrorCode(bodyMessage)) {
            code = bodyMessage
            message = bodyMessage
          } else {
            code = errField
          }
        }

        // Fallback: only expose machine codes from NestJS/custom shorthand bodies.
        // Human-readable raw messages may contain internal details.
        if (code === DEFAULT_ERROR_CODE && typeof b['message'] === 'string' && isMachineErrorCode(b['message'])) {
          code = b['message']
          message = b['message']
        }
      }
    }

    // Nest Throttler 429 的 body.message 含空格/非机器码（如 "ThrottlerException: Too Many Requests"），
    // 旧逻辑会把页面文案塌成「服务器内部错误」，登录页误报为宕机。
    if (
      status === HttpStatus.TOO_MANY_REQUESTS &&
      (code === DEFAULT_ERROR_CODE || code === 'Too Many Requests')
    ) {
      code = 'RATE_LIMITED'
      message = '尝试过于频繁，请稍后再试'
    }
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      code = 'FILE_TOO_LARGE'
      message = '上传文件过大，请缩小后重试'
    }

    // 4xx 不是服务端故障，却一直在说自己是。
    //
    // 上面所有分支都没命中时，message 还挂着 500 的兜底句「服务器内部错误」。
    // 于是任何没带 `error.code` 的 4xx —— 路由不存在、方法不支持、Nest 默认的
    // BadRequest —— 对外都自称服务端崩了。2026-09-08 对生产实测：
    //   GET /api/v1/definitely-not-a-real-endpoint
    //   → {"error":{"code":"Not Found","message":"服务器内部错误"}}
    //
    // 这不是文案洁癖。kiosk / admin / partner 三端都**没有**本地兜底
    // （`git grep 服务器内部错误 -- apps/*/src` 无命中），拿到什么显示什么；
    // 小程序侧只好自己加了一条门禁把这句话拦下来
    // （apps/miniapp/scripts/verify-user-error-message.mjs B 段）——
    // 下游逐个打补丁，说明根因在这里没修。
    //
    // 关键：**不放松泄露防线**。这里换的只是「兜底句」本身，从不回显原始
    // message —— 原始文案可能带内网地址或凭据（见门禁里那条 redis://user:secret 用例）。
    // 429 / 413 早先各打过一个补丁，这里按状态码统一收口，免得下一个状态码再来一次。
    if (status < HttpStatus.INTERNAL_SERVER_ERROR && message === DEFAULT_ERROR_MESSAGE) {
      message = clientErrorFallbackMessage(status)
    }
    // 同一处漏了机器码：上面只换了给人看的那句，`error.code` 还挂着 500 的默认值。
    // 4xx 里 code 说 INTERNAL_SERVER_ERROR，等于告诉调用方「服务端崩了」，
    // 于是它会去重试、去报障，而真相是「你请求的东西不存在 / 没权限」。
    if (status < HttpStatus.INTERNAL_SERVER_ERROR && code === DEFAULT_ERROR_CODE) {
      code = clientErrorFallbackCode(status)
    }

    // 记日志绝不能反过来把错误响应打掉：过滤器自己抛异常会落到 Nest 默认处理，
    // 客户端拿到的就不再是本仓的统一错误体了。宁可这一条日志丢掉。
    try {
      this.log(exception, request, status, code)
    } catch {
      /* 日志失败不影响响应 */
    }

    const errorBody: ErrorResponseBody = {
      success: false,
      error: details ? { code, message, details } : { code, message },
      requestId: request.requestId,
    }
    response.status(status).json(errorBody)
  }

  private log(
    exception: unknown,
    request: Request & { requestId?: string; requestStartedAt?: number },
    status: number,
    code: string,
  ): void {
    const isHttpException = exception instanceof HttpException
    const level = errorLogLevel(status, isHttpException)
    const startedAt = request.requestStartedAt
    const line = formatErrorLogLine({
      requestId: request.requestId ?? '',
      method: request.method,
      route: safeRoutePattern(request),
      status,
      code,
      errorName: safeErrorName(exception),
      durationMs: typeof startedAt === 'number' ? Date.now() - startedAt : null,
    })

    if (level === 'debug') { this.logger.debug(line); return }
    if (level === 'warn')  { this.logger.warn(line);  return }

    // 只有 error 级才附栈帧：4xx 不需要，5xx 需要「原因在哪一行」。
    // 注意是 frames，不是 err.stack —— 首行含异常消息，见 error-log.ts。
    const frames = stackFramesOnly(exception)
    this.logger.error(frames.length > 0 ? `${line}\n  ${frames.join('\n  ')}` : line)
  }
}
