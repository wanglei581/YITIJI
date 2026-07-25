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

import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common'
import type { TerminalCapabilityView } from './terminal-capabilities.types'
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
  type TerminalBindCodeCreated,
  type PlannedTerminalCreated,
  type UpdateTerminalProfileResult,
  type UpdateTerminalLifecycleResult,
  type EmergencyCredentialRevokeResult,
} from './terminals.service'
import { AssignTerminalOrgDto } from './dto/assign-terminal-org.dto'
import { UpdateTerminalProfileDto } from './dto/update-terminal-profile.dto'
import { CreateTerminalBindCodeDto } from './dto/create-terminal-bind-code.dto'
import { CreatePlannedTerminalDto } from './dto/create-planned-terminal.dto'
import { UpdateTerminalCapabilityDto } from './dto/update-terminal-capability.dto'
import { TerminalCapabilitiesService } from './terminal-capabilities.service'
import { UpdateTerminalLifecycleDto } from './dto/update-terminal-lifecycle.dto'
import { EmergencyRevokeTerminalCredentialsDto } from './dto/emergency-revoke-terminal-credentials.dto'

import { resolveClientIp } from '../common/client-ip'
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
    private readonly capabilities: TerminalCapabilitiesService,
    private readonly audit: AuditService,
  ) {}

  // GET /api/v1/admin/terminals
  @Get()
  async list(): Promise<ApiResponse<{ terminals: AdminTerminalView[] }>> {
    return ApiResponse.ok(await this.terminalsService.listTerminalsForAdmin())
  }

  // POST /api/v1/admin/terminals
  // Admin 先创建 planned 设备资产；此步骤不签发任何可用 Agent 凭证。
  @Post()
  async createPlannedTerminal(
    @Body() dto: CreatePlannedTerminalDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<PlannedTerminalCreated>> {
    const result = await this.terminalsService.createPlannedTerminal(dto)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'terminal.asset.create_planned',
      targetType: 'terminal',
      targetId: result.terminalCode,
      payload: {
        terminalCode: result.terminalCode,
        displayName: result.displayName,
        locationLabel: result.locationLabel,
        orgId: result.orgId,
        lifecycleStatus: result.lifecycleStatus,
        credentialIssued: false,
      },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(result)
  }

  // GET /api/v1/admin/terminals/org-options
  // 静态段，必须声明在 :terminalId 动态路由之前（本控制器无 GET :terminalId，故顺序无碍，仍保持清晰）。
  @Get('org-options')
  async orgOptions(): Promise<ApiResponse<{ organizations: AdminOrganizationOption[] }>> {
    return ApiResponse.ok(await this.terminalsService.listOrganizationOptions())
  }

  // POST /api/v1/admin/terminals/:terminalId/bind-code
  // 生成一次性绑定码；明文仅在本响应返回一次。
  @Post(':terminalId/bind-code')
  async createBindCode(
    @Param('terminalId') terminalId: string,
    @Body() dto: CreateTerminalBindCodeDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<TerminalBindCodeCreated>> {
    const result = await this.terminalsService.createBindCode(terminalId, user.userId, dto.ttlMinutes, {
      actorId: user.userId,
      actorRole: user.role,
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(result)
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

  // GET /api/v1/admin/terminals/:terminalId/capabilities
  // 打印扫描首期能力开关（Task 10 Step 3）：全部能力键 + 是否已配置。
  @Get(':terminalId/capabilities')
  async listCapabilities(
    @Param('terminalId') terminalId: string,
  ): Promise<ApiResponse<{ terminalCode: string; capabilities: TerminalCapabilityView[] }>> {
    return ApiResponse.ok(await this.capabilities.listForTerminal(terminalId))
  }

  // PUT /api/v1/admin/terminals/:terminalId/capabilities/:capabilityKey
  // upsert 单个能力开关（写审计，含旧状态便于追溯）。
  @Put(':terminalId/capabilities/:capabilityKey')
  async updateCapability(
    @Param('terminalId') terminalId: string,
    @Param('capabilityKey') capabilityKey: string,
    @Body() dto: UpdateTerminalCapabilityDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<{ terminalCode: string; capability: TerminalCapabilityView }>> {
    const result = await this.capabilities.upsert(terminalId, capabilityKey, dto.status, dto.note, user.userId)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'terminal.capability.update',
      targetType: 'terminal',
      targetId: result.terminalCode,
      payload: {
        terminalCode: result.terminalCode,
        capabilityKey: result.capability.capabilityKey,
        oldStatus: result.oldStatus,
        newStatus: result.capability.status,
        note: result.capability.note,
      },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok({ terminalCode: result.terminalCode, capability: result.capability })
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

  // PATCH /api/v1/admin/terminals/:terminalId/lifecycle
  // Gate 0.3A 仅允许 active <-> maintenance：maintenance 停止新任务并保留排空回传。
  @Patch(':terminalId/lifecycle')
  async updateLifecycle(
    @Param('terminalId') terminalId: string,
    @Body() dto: UpdateTerminalLifecycleDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<UpdateTerminalLifecycleResult>> {
    const result = await this.terminalsService.updateTerminalLifecycle(terminalId, dto.targetStatus, {
      actorId: user.userId,
      actorRole: user.role,
      reason: dto.reason,
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
      confirmationText: dto.confirmationText,
    }, {
      expectedStatus: dto.expectedStatus,
      expectedVersion: dto.expectedVersion,
    })
    return ApiResponse.ok(result)
  }

  @Post(':terminalId/emergency-revoke')
  async emergencyRevoke(
    @Param('terminalId') terminalId: string,
    @Body() dto: EmergencyRevokeTerminalCredentialsDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<EmergencyCredentialRevokeResult>> {
    const result = await this.terminalsService.emergencyRevokeCredentials(terminalId, {
      actorId: user.userId,
      actorRole: user.role,
      reason: dto.reason,
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    }, {
      expectedStatus: dto.expectedStatus,
      expectedVersion: dto.expectedVersion,
      expectedCredentialGeneration: dto.expectedCredentialGeneration,
      confirmationText: dto.confirmationText,
    })
    return ApiResponse.ok(result)
  }
}

function extractIp(req: unknown): string | null {
  return resolveClientIp(req)
}

function extractUa(req: AuditReq): string | null {
  const ua = req.headers['user-agent']
  return typeof ua === 'string' ? ua : null
}
