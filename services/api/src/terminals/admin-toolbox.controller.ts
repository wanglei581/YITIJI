import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { AuditService } from '../audit/audit.service'
import { TerminalToolboxService } from './terminal-toolbox.service'
import { SaveToolboxConfigDto } from './dto/save-toolbox-config.dto'
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
