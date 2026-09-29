import { Injectable, NestMiddleware } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { NextFunction, Request, Response } from 'express'
import { RedisService } from '../../common/redis/redis.service'
import { PrismaService } from '../../prisma/prisma.service'
import { TerminalSessionService } from '../../terminals/terminal-session.service'
import { lazyAiRequestContext, resolveAiCaller, runWithAiRequestContext } from './ai-usage-context'

/**
 * 给每个请求放一个「调用方是谁」的惰性解析器（见 ai-usage-context.ts）。
 *
 * 挂在 app.module 的同一条 consumer.apply(...) 链上。这里只建闭包、不做任何 I/O：
 * 只有 AI 额度检查或 LLM 计量真的问到身份时才解析，其余请求零额外开销。
 */
@Injectable()
export class AiRequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly terminalSessions: TerminalSessionService,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const headers = req.headers
    const deps = { jwt: this.jwt, redis: this.redis, prisma: this.prisma, terminalSessions: this.terminalSessions }
    runWithAiRequestContext(lazyAiRequestContext(() => resolveAiCaller(headers, deps)), () => next())
  }
}
