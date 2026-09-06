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
    if (routeTerminalId && terminalId !== routeTerminalId) {
      await this.sessions.validate(undefined, undefined)
    }
    await this.sessions.validate(terminalId, sessionToken)
    return true
  }
}
