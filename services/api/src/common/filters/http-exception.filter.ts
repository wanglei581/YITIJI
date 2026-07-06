import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { ErrorResponseBody } from '../dto/api-response.dto'

function isMachineErrorCode(value: string): boolean {
  return /^[A-Z][A-Z0-9_]+$/.test(value)
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request  = ctx.getRequest<Request & { requestId?: string }>()

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

    const errorBody: ErrorResponseBody = {
      success: false,
      error: details ? { code, message, details } : { code, message },
      requestId: request.requestId,
    }
    response.status(status).json(errorBody)
  }
}
