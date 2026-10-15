import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { resolveClientIp } from '../common/client-ip'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { IssueTerminalCommandDto } from './dto/issue-terminal-command.dto'
import { TerminalCommandService, type TerminalCommandView } from './terminal-commands.service'

interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}

@Controller('admin/terminals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminTerminalCommandsController {
  constructor(private readonly commands: TerminalCommandService) {}

  @Post(':terminalId/commands')
  @HttpCode(HttpStatus.OK)
  async issue(
    @Param('terminalId') terminalId: string,
    @Body() dto: IssueTerminalCommandDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<TerminalCommandView>> {
    const view = await this.commands.issue(terminalId, dto.type, { userId: user.userId, role: user.role }, {
      ipAddress: resolveClientIp(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(view)
  }

  @Get(':terminalId/commands')
  async list(
    @Param('terminalId') terminalId: string,
    @Query('limit') limit?: string | string[],
  ): Promise<ApiResponse<TerminalCommandView[]>> {
    const raw = Array.isArray(limit) ? limit[0] : limit
    return ApiResponse.ok(await this.commands.list(terminalId, raw))
  }
}
