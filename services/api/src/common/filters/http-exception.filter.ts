import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { ErrorResponseBody } from '../dto/api-response.dto'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request  = ctx.getRequest<Request & { requestId?: string }>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let code = 'INTERNAL_SERVER_ERROR'
    let message = '服务器内部错误'

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const body = exception.getResponse()

      if (typeof body === 'string') {
        message = body
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>

        // Priority: body.error.code / body.error.message (our convention)
        const errField = b['error']
        if (typeof errField === 'object' && errField !== null) {
          const err = errField as Record<string, unknown>
          if (typeof err['code'] === 'string')    code    = err['code']
          if (typeof err['message'] === 'string') message = err['message']
        } else if (typeof errField === 'string') {
          code = errField
        }

        // Fallback: body.message (NestJS built-in format)
        if (code === 'INTERNAL_SERVER_ERROR' && typeof b['message'] === 'string') {
          message = b['message']
        }
      }
    }

    const errorBody: ErrorResponseBody = {
      success: false,
      error: { code, message },
      requestId: request.requestId,
    }
    response.status(status).json(errorBody)
  }
}
