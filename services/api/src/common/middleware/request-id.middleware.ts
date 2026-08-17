import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'crypto'

/**
 * 给每个请求挂一个 requestId。
 *
 * - 优先尊重客户端传入的 `X-Request-Id`(便于跨服务链路追踪)
 * - 否则随机生成一个 UUID v4
 * - 注入到 `req.requestId`,并通过响应头 `X-Request-Id` 回传
 * - HttpExceptionFilter 会把它写入错误响应体**并写进服务端日志**,
 *   两边用同一个 id 才能真的对上（此前只回给客户端、从不落日志，
 *   运维拿着 requestId 什么也查不到）
 * - 同时记下请求起点，异常日志据此给出耗时（区分「立刻失败」与「等外部依赖等死」）
 */
/** 追踪 id 允许的字符集：UUID / traceparent / 短横线风格 id 都覆盖得到，且不含空白与中文。 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // requestId 现在会进服务端日志，因此不能原样采信客户端传入的任意字符串
    // （否则等于给了外部一条把任意文本写进日志的通道）。只接受可打印的追踪 id 字符集。
    const incoming = req.header('x-request-id')
    const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID()
    const typed = req as Request & { requestId?: string; requestStartedAt?: number }
    typed.requestId = id
    typed.requestStartedAt = Date.now()
    res.setHeader('X-Request-Id', id)
    next()
  }
}
