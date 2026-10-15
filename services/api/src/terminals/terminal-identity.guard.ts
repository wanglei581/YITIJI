import { CanActivate, ExecutionContext, Injectable, Optional, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Request } from 'express'
import { TerminalSessionService } from './terminal-session.service'

/** 只读配置可以认「已停用但仍持有本机有效会话」的终端，以便把暂停文案下发回去。其它接口不挂这个标记。 */
export const ALLOW_DISABLED_TERMINAL_IDENTITY = 'allowDisabledTerminalIdentity'
export const AllowDisabledTerminalIdentity = () => SetMetadata(ALLOW_DISABLED_TERMINAL_IDENTITY, true)

@Injectable()
export class TerminalIdentityGuard implements CanActivate {
  constructor(
    private readonly sessions: TerminalSessionService,
    @Optional() private readonly reflector?: Reflector,
  ) {}

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
    const allowDisabled = this.reflector?.getAllAndOverride<boolean>(ALLOW_DISABLED_TERMINAL_IDENTITY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
    await this.sessions.validate(terminalId, sessionToken, { allowDisabled })
    return true
  }
}
