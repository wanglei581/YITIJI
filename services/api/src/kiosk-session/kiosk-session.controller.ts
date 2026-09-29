import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import { TerminalIdentityGuard } from '../terminals/terminal-identity.guard'
import { EndKioskSessionDto, StartKioskSessionDto, TouchKioskSessionDto } from './dto/kiosk-session.dto'
import { KioskSessionService } from './kiosk-session.service'

/**
 * 一体机会话（服务人次）上报。只认终端验签身份（x-terminal-id + x-terminal-session-token），
 * 限流按台计。一体机上报失败不影响用户操作，也不在本机缓存使用记录。
 */
@Controller('kiosk/session')
@UseGuards(TerminalIdentityGuard)
export class KioskSessionController {
  constructor(private readonly sessions: KioskSessionService) {}

  /** 一个使用周期里第一次有效操作时调用一次；同一 clientSessionId 重放只记一条。 */
  @Post('start')
  @HttpCode(HttpStatus.OK)
  @TerminalScopedThrottle(10)
  async start(@Headers('x-terminal-id') terminalId: string, @Body() dto: StartKioskSessionDto) {
    return ApiResponse.ok(await this.sessions.start(terminalId, dto))
  }

  /** 进入新的服务大类时调用；同一大类由一体机节流到 5 分钟一次。 */
  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @TerminalScopedThrottle(30)
  async heartbeat(@Headers('x-terminal-id') terminalId: string, @Body() dto: TouchKioskSessionDto) {
    return ApiResponse.ok(await this.sessions.touch(terminalId, dto))
  }

  /** 清场或超时时调用；重复调用不改已记下的结束时间。 */
  @Post('end')
  @HttpCode(HttpStatus.OK)
  @TerminalScopedThrottle(10)
  async end(@Headers('x-terminal-id') terminalId: string, @Body() dto: EndKioskSessionDto) {
    return ApiResponse.ok(await this.sessions.end(terminalId, dto))
  }
}
