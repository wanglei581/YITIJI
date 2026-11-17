import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { resolveClientIp } from '../common/client-ip'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { CreateTerminalBatchDto, TerminalBatchSelectionDto } from './dto/terminal-batch.dto'
import {
  TerminalBatchService,
  type TerminalBatchBindCodeResult,
  type TerminalBatchCreated,
  type TerminalBatchRevokeResult,
} from './terminal-batch.service'

interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}

@Controller('admin/terminals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Throttle({ default: { ttl: 60_000, limit: 10 } })
export class AdminTerminalBatchController {
  constructor(private readonly batches: TerminalBatchService) {}

  @Post('batches')
  async create(
    @Body() dto: CreateTerminalBatchDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<TerminalBatchCreated>> {
    return ApiResponse.ok(await this.batches.create(dto, actor(user, req)))
  }

  @Post('batches/bind-codes')
  async issue(
    @Body() dto: TerminalBatchSelectionDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<TerminalBatchBindCodeResult>> {
    return ApiResponse.ok(await this.batches.issue(dto, actor(user, req)))
  }

  @Post('batches/bind-codes/revoke')
  async revoke(
    @Body() dto: TerminalBatchSelectionDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<TerminalBatchRevokeResult>> {
    return ApiResponse.ok(await this.batches.revoke(dto, actor(user, req)))
  }

  @Post('batches/bind-codes/reissue')
  async reissue(
    @Body() dto: TerminalBatchSelectionDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<TerminalBatchBindCodeResult>> {
    return ApiResponse.ok(await this.batches.reissue(dto, actor(user, req)))
  }
}

function actor(user: AuthedUser, req: AuditReq) {
  const userAgent = req.headers['user-agent']
  return {
    actorId: user.userId,
    actorRole: user.role,
    ipAddress: resolveClientIp(req),
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    requestId: req.requestId ?? null,
  }
}
