import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { resolveClientIp } from '../common/client-ip'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { SaveKioskJobBoardDto } from './dto/save-kiosk-job-board.dto'
import { KioskJobBoardService } from './kiosk-job-board.service'

interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
}

/**
 * 管理端沿用终端配置的写法：按终端读写，另加一条全局开关。
 * 写入记审计。一体机只读下发仍走 GET /terminals/:id/config。
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminKioskJobBoardController {
  constructor(
    private readonly jobBoard: KioskJobBoardService,
    private readonly audit: AuditService,
  ) {}

  @Get('admin/kiosk-job-board')
  getGlobal() {
    return this.jobBoard.getGlobalAdmin()
  }

  @Put('admin/kiosk-job-board')
  async saveGlobal(
    @Body() dto: SaveKioskJobBoardDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const before = await this.jobBoard.getGlobalAdmin()
    const saved = await this.jobBoard.saveGlobal(dto.enabled, user.userId)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'kiosk_job_board.global_update',
      targetType: 'kiosk_job_board',
      targetId: 'global',
      payload: { beforeEnabled: before.enabled, afterEnabled: saved.enabled, scope: 'global' },
      ipAddress: resolveClientIp(req),
      userAgent: userAgentOf(req),
      requestId: req.requestId ?? null,
    })
    return saved
  }

  @Get('admin/terminals/:terminalId/job-board-config')
  getTerminal(@Param('terminalId') terminalId: string) {
    return this.jobBoard.getTerminalAdmin(terminalId)
  }

  @Put('admin/terminals/:terminalId/job-board-config')
  async saveTerminal(
    @Param('terminalId') terminalId: string,
    @Body() dto: SaveKioskJobBoardDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const before = await this.jobBoard.getTerminalAdmin(terminalId)
    const saved = await this.jobBoard.saveTerminal(terminalId, dto.enabled, user.userId)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'kiosk_job_board.terminal_update',
      targetType: 'kiosk_job_board',
      targetId: saved.terminalId,
      payload: {
        beforeEnabled: before.enabled,
        afterEnabled: saved.enabled,
        scope: 'terminal',
        terminalId: saved.terminalId,
      },
      ipAddress: resolveClientIp(req),
      userAgent: userAgentOf(req),
      requestId: req.requestId ?? null,
    })
    return saved
  }
}

function userAgentOf(req: AuditReq): string | null {
  const ua = req.headers['user-agent']
  return typeof ua === 'string' ? ua : null
}
