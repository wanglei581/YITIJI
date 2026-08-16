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
    let code = 'INTERNAL_SERVER_ERROR'
    let message = '服务器内部错误'
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
        if (code === 'INTERNAL_SERVER_ERROR' && typeof b['message'] === 'string' && isMachineErrorCode(b['message'])) {
          code = b['message']
          message = b['message']
        }
      }
    }

    // Nest Throttler 429 的 body.message 含空格/非机器码（如 "ThrottlerException: Too Many Requests"），
    // 旧逻辑会把页面文案塌成「服务器内部错误」，登录页误报为宕机。
    if (
      status === HttpStatus.TOO_MANY_REQUESTS &&
      (code === 'INTERNAL_SERVER_ERROR' || code === 'Too Many Requests')
    ) {
      code = 'RATE_LIMITED'
      message = '尝试过于频繁，请稍后再试'
    }
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      code = 'FILE_TOO_LARGE'
      message = '上传文件过大，请缩小后重试'
    }

    this.log(exception, request, status, code)

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
