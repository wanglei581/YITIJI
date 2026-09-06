import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Request } from 'express'
import { TerminalSessionService } from './terminal-session.service'

@Injectable()
export class TerminalIdentityGuard implements CanActivate {
  constructor(private readonly sessions: TerminalSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const terminalId = request.header('x-terminal-id')
    const sessionToken = request.header('x-terminal-session-token')
    const routeTerminalId = request.params['terminalId'] as string | undefined
    const bodyTerminalId = (request.body as { terminalId?: unknown } | undefined)?.terminalId
    // 路由参数、请求体里的 terminalId 都必须与已验签的 x-terminal-id 一致，
    // 否则持 A 机令牌的客户端可以把打印任务归属到 B 机（越过终端隔离）。
    if (routeTerminalId && terminalId !== routeTerminalId) {
      await this.sessions.validate(undefined, undefined)
    }
    if (typeof bodyTerminalId === 'string' && bodyTerminalId !== terminalId) {
      await this.sessions.validate(undefined, undefined)
    }
    await this.sessions.validate(terminalId, sessionToken)
    return true
  }
}
