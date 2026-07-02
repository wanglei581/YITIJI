import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { AuditService } from '../audit/audit.service'
import { TerminalToolboxService } from './terminal-toolbox.service'
import { ToolboxGovernanceService } from './toolbox-governance.service'
import { SaveToolboxConfigDto } from './dto/save-toolbox-config.dto'
import {
  CreateToolboxAppDto,
  CreateToolboxAppVersionDto,
  PublishToolboxAppVersionDto,
  RejectToolboxAppVersionDto,
  ReviewToolboxAllowedHostDto,
  UpsertToolboxAllowedHostDto,
} from './dto/toolbox-governance.dto'
import type { KioskToolboxItemView, TerminalToolboxConfigView } from './terminal-toolbox.types'

interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminToolboxController {
  constructor(
    private readonly toolbox: TerminalToolboxService,
    private readonly governance: ToolboxGovernanceService,
    private readonly audit: AuditService,
  ) {}

  @Get('admin/toolbox/terminals')
  listTerminals() {
    return this.toolbox.listToolboxTerminals()
  }

  @Get('admin/toolbox/launch-summary')
  getLaunchSummary(
    @Query('days') days?: string,
    @Query('terminalId') terminalId?: string,
  ) {
    return this.toolbox.getLaunchSummary({ days, terminalId })
  }

  @Get('admin/toolbox/apps')
  listApps() {
    return this.governance.listApps()
  }

  @Get('admin/toolbox/apps/:appKey/versions')
  listVersions(@Param('appKey') appKey: string) {
    return this.governance.listVersions(appKey)
  }

  @Get('admin/toolbox/allowed-hosts')
  listAllowedHosts() {
    return this.governance.listAllowedHostsForAdmin()
  }

  @Get('admin/terminals/:terminalId/toolbox-config')
  getConfig(@Param('terminalId') terminalId: string) {
    return this.toolbox.getTerminalConfig(terminalId)
  }

  @Put('admin/terminals/:terminalId/toolbox-config')
  async saveConfig(
    @Param('terminalId') terminalId: string,
    @Body() dto: SaveToolboxConfigDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const beforeConfig = await this.toolbox.getTerminalConfig(terminalId)
    const config = await this.toolbox.saveTerminalConfig(
      terminalId,
      {
        enabled: dto.enabled,
        items: dto.items.map((item, index) => ({
          key: item.key,
          title: item.title,
          description: item.description ?? '',
          icon: item.icon ?? 'wrench',
          to: item.to ?? null,
          disabled: item.disabled ?? false,
          sortOrder: item.sortOrder ?? index,
          placements: item.placements,
          launchMode: item.launchMode,
          externalUrl: item.externalUrl ?? null,
          qrImageUrl: item.qrImageUrl ?? null,
          qrTargetUrl: item.qrTargetUrl ?? null,
        })),
      },
      user.userId,
    )
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'toolbox_config.update',
      targetType: 'toolbox_config',
      targetId: terminalId,
      payload: buildToolboxAuditPayload(beforeConfig, config),
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return config
  }

  @Post('admin/toolbox/apps')
  async createApp(
    @Body() dto: CreateToolboxAppDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.governance.createApp(dto, user.userId)
    await this.writeAudit(user, req, 'toolbox_app.create', 'toolbox_app', result.appKey, result)
    return result
  }

  @Post('admin/toolbox/apps/:appKey/versions')
  async createVersion(
    @Param('appKey') appKey: string,
    @Body() dto: CreateToolboxAppVersionDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.governance.createVersion(appKey, dto, user.userId)
    await this.writeAudit(user, req, 'toolbox_version.create', 'toolbox_app_version', `${result.appKey}:${result.version}`, result)
    return result
  }

  @Post('admin/toolbox/apps/:appKey/versions/:version/submit')
  async submitVersion(
    @Param('appKey') appKey: string,
    @Param('version') version: string,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.governance.submitVersion(appKey, parseVersion(version), user.userId)
    await this.writeAudit(user, req, 'toolbox_version.submit', 'toolbox_app_version', `${result.appKey}:${result.version}`, result)
    return result
  }

  @Post('admin/toolbox/apps/:appKey/versions/:version/approve')
  async approveVersion(
    @Param('appKey') appKey: string,
    @Param('version') version: string,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.governance.approveVersion(appKey, parseVersion(version), user.userId)
    await this.writeAudit(user, req, 'toolbox_version.approve', 'toolbox_app_version', `${result.appKey}:${result.version}`, result)
    return result
  }

  @Post('admin/toolbox/apps/:appKey/versions/:version/reject')
  async rejectVersion(
    @Param('appKey') appKey: string,
    @Param('version') version: string,
    @Body() dto: RejectToolboxAppVersionDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.governance.rejectVersion(appKey, parseVersion(version), dto, user.userId)
    await this.writeAudit(user, req, 'toolbox_version.reject', 'toolbox_app_version', `${result.appKey}:${result.version}`, {
      ...result,
      rejectionReason: dto.reason,
    })
    return result
  }

  @Post('admin/toolbox/apps/:appKey/versions/:version/publish')
  async publishVersion(
    @Param('appKey') appKey: string,
    @Param('version') version: string,
    @Body() dto: PublishToolboxAppVersionDto | undefined,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.governance.publishVersion(appKey, parseVersion(version), dto ?? {}, user.userId)
    await this.writeAudit(user, req, 'toolbox_version.publish', 'toolbox_app_version', `${result.appKey}:${result.version}`, result)
    return result
  }

  @Post('admin/toolbox/apps/:appKey/suspend')
  async suspendApp(
    @Param('appKey') appKey: string,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.governance.suspendApp(appKey, user.userId)
    await this.writeAudit(user, req, 'toolbox_app.suspend', 'toolbox_app', result.appKey, result)
    return result
  }

  @Post('admin/toolbox/allowed-hosts')
  async upsertAllowedHost(
    @Body() dto: UpsertToolboxAllowedHostDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.governance.upsertAllowedHost(dto, user.userId)
    await this.writeAudit(user, req, 'toolbox_allowed_host.upsert', 'toolbox_allowed_host', `${result.host}:${result.purpose}`, result)
    return result
  }

  @Post('admin/toolbox/allowed-hosts/:hostId/review')
  async reviewAllowedHost(
    @Param('hostId') hostId: string,
    @Body() dto: ReviewToolboxAllowedHostDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const result = await this.governance.reviewAllowedHost(hostId, dto, user.userId)
    await this.writeAudit(user, req, 'toolbox_allowed_host.review', 'toolbox_allowed_host', hostId, result)
    return result
  }

  private async writeAudit(
    user: AuthedUser,
    req: AuditReq,
    action: string,
    targetType: string,
    targetId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action,
      targetType,
      targetId,
      payload,
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
  }
}

function buildToolboxAuditPayload(
  before: TerminalToolboxConfigView,
  after: TerminalToolboxConfigView,
): Record<string, unknown> {
  const beforeItems = new Map(before.items.map((item) => [item.key, item]))
  const afterItems = new Map(after.items.map((item) => [item.key, item]))
  const beforeKeys = [...beforeItems.keys()]
  const afterKeys = [...afterItems.keys()]
  const addedItemKeys = afterKeys.filter((key) => !beforeItems.has(key))
  const removedItemKeys = beforeKeys.filter((key) => !afterItems.has(key))
  const changedItemKeys = afterKeys.filter((key) => {
    const oldItem = beforeItems.get(key)
    const newItem = afterItems.get(key)
    return !!oldItem && !!newItem && itemSignature(oldItem) !== itemSignature(newItem)
  })

  return {
    before: summarizeToolboxConfig(before),
    after: summarizeToolboxConfig(after),
    addedItemKeys,
    removedItemKeys,
    changedItemKeys,
  }
}

function summarizeToolboxConfig(config: TerminalToolboxConfigView): Record<string, unknown> {
  return {
    enabled: config.enabled,
    itemCount: config.items.length,
    itemKeys: config.items.map((item) => item.key),
    launchModeCounts: config.items.reduce<Record<string, number>>((acc, item) => {
      const launchMode = item.launchMode ?? 'internal_route'
      acc[launchMode] = (acc[launchMode] ?? 0) + 1
      return acc
    }, {}),
  }
}

function itemSignature(item: KioskToolboxItemView): string {
  return JSON.stringify({
    key: item.key,
    title: item.title,
    description: item.description,
    icon: item.icon,
    to: item.to,
    disabled: item.disabled,
    sortOrder: item.sortOrder,
    placements: [...(item.placements ?? ['toolbox'])].sort(),
    launchMode: item.launchMode ?? 'internal_route',
    riskLevel: item.riskLevel ?? null,
    disclaimers: item.disclaimers ?? [],
    externalUrl: item.externalUrl ?? null,
    qrImageUrl: item.qrImageUrl ?? null,
    qrTargetUrl: item.qrTargetUrl ?? null,
  })
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

function parseVersion(value: string): number {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1 || version > 9999) {
    throw new BadRequestException({ error: { code: 'INVALID_TOOLBOX_VERSION', message: '微应用版本号必须是 1-9999 的整数' } })
  }
  return version
}
