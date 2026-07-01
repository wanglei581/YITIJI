// ============================================================
// Admin Terminals Controller — 契约 C1 (HIGH-4) + 终端机构归属
//
// Routes (prefixed with /api/v1，全部 admin-only)：
//   GET   /admin/terminals                  — 终端列表 + 最近心跳 + 在线 + 所属机构
//   GET   /admin/terminals/org-options       — 可绑定机构下拉（仅 enabled）
//   PATCH /admin/terminals/:terminalId/org     — 绑定/解绑终端机构归属（写审计）
//   PATCH /admin/terminals/:terminalId/profile — 设备档案/MAC/启停（写审计）
//
// 消费方：Agent3 admin 设备页。响应字段/类型必须严格匹配契约 C1。
// ============================================================

import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { AuditService } from '../audit/audit.service'
import {
  TerminalsService,
  type AdminTerminalView,
  type AdminOrganizationOption,
  type AssignTerminalOrgResult,
  type UpdateTerminalProfileResult,
} from './terminals.service'
import { AssignTerminalOrgDto } from './dto/assign-terminal-org.dto'
import { UpdateTerminalProfileDto } from './dto/update-terminal-profile.dto'

interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}

@Controller('admin/terminals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminTerminalsController {
  constructor(
    private readonly terminalsService: TerminalsService,
    private readonly audit: AuditService,
  ) {}

  // GET /api/v1/admin/terminals
  @Get()
  async list(): Promise<ApiResponse<{ terminals: AdminTerminalView[] }>> {
    return ApiResponse.ok(await this.terminalsService.listTerminalsForAdmin())
  }

  // GET /api/v1/admin/terminals/org-options
  // 静态段，必须声明在 :terminalId 动态路由之前（本控制器无 GET :terminalId，故顺序无碍，仍保持清晰）。
  @Get('org-options')
  async orgOptions(): Promise<ApiResponse<{ organizations: AdminOrganizationOption[] }>> {
    return ApiResponse.ok(await this.terminalsService.listOrganizationOptions())
  }

  // PATCH /api/v1/admin/terminals/:terminalId/org
  @Patch(':terminalId/org')
  async assignOrg(
    @Param('terminalId') terminalId: string,
    @Body() dto: AssignTerminalOrgDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<AssignTerminalOrgResult>> {
    const result = await this.terminalsService.assignTerminalOrg(terminalId, dto.orgId)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'terminal.org.update',
      targetType: 'terminal',
      targetId: result.terminalCode,
      payload: {
        terminalCode: result.terminalCode,
        oldOrgId: result.oldOrgId,
        newOrgId: result.newOrgId,
      },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(result)
  }

  // PATCH /api/v1/admin/terminals/:terminalId/profile
  @Patch(':terminalId/profile')
  async updateProfile(
    @Param('terminalId') terminalId: string,
    @Body() dto: UpdateTerminalProfileDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<UpdateTerminalProfileResult>> {
    const result = await this.terminalsService.updateTerminalProfile(terminalId, dto)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'terminal.profile.update',
      targetType: 'terminal',
      targetId: result.terminalCode,
      payload: {
        terminalCode: result.terminalCode,
        displayName: result.displayName,
        macAddress: result.macAddress,
        locationLabel: result.locationLabel,
        enabled: result.enabled,
      },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(result)
  }
}

function extractIp(req: AuditReq): string | null {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim()
  return req.ip ?? req.socket?.remoteAddress ?? null
}

function extractUa(req: AuditReq): string | null {
  const ua = req.headers['user-agent']
  return typeof ua === 'string' ? ua : null
}
