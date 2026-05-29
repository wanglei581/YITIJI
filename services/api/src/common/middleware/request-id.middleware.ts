import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'crypto'

/**
 * 给每个请求挂一个 requestId。
 *
 * - 优先尊重客户端传入的 `X-Request-Id`(便于跨服务链路追踪)
 * - 否则随机生成一个 UUID v4
 * - 注入到 `req.requestId`,并通过响应头 `X-Request-Id` 回传
 * - HttpExceptionFilter 会把它写入错误响应体,方便排障
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id')
    const id = incoming && incoming.length <= 128 ? incoming : randomUUID()
    ;(req as Request & { requestId?: string }).requestId = id
    res.setHeader('X-Request-Id', id)
    next()
  }
}
