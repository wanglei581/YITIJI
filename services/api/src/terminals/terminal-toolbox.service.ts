import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import type {
  KioskAppLaunchModeView,
  KioskAppPlacementView,
  KioskToolboxConfigView,
  KioskToolboxItemView,
  RecordToolboxLaunchEventInput,
  SaveToolboxConfigInput,
  TerminalToolboxConfigView,
  ToolboxLaunchActionView,
  ToolboxLaunchSummaryView,
  ToolboxTerminalView,
} from './terminal-toolbox.types'

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000
const MAX_TOOLBOX_ITEMS = 24
const TOOLBOX_EVENT_RETENTION_DAYS = 90
const DEFAULT_TOOLBOX: KioskToolboxConfigView = { enabled: true, items: [] }
const TOOLBOX_LOGGER = new Logger('TerminalToolboxService')
const ALLOWED_TOOLBOX_ICONS = new Set(['wrench', 'file-text', 'printer', 'sparkles', 'book-open', 'help-circle'])
const ALLOWED_APP_PLACEMENTS = new Set<KioskAppPlacementView>(['toolbox', 'smart_campus'])
const TOOLBOX_LAUNCH_ACTIONS: ToolboxLaunchActionView[] = [
  'show_qr',
  'open_external_notice',
  'open_external_confirmed',
  'cancel_external',
]
const ALLOWED_LAUNCH_MODES = new Set<KioskAppLaunchModeView>([
  'internal_route',
  'external_url',
  'qr_code',
  'mini_program_qr',
])
const ALLOWED_TOOLBOX_ROUTE_PATTERNS = [
  /^\/assistant(?:[?#].*)?$/,
  /^\/campus(?:[?#].*)?$/,
  /^\/help(?:[?#].*)?$/,
  /^\/interview\/(?:setup|tips|reports)(?:[?#].*)?$/,
  /^\/job-fairs(?:\/[^?#]+(?:\/(?:companies(?:\/[^?#]+)?|map|materials|stats))?)?(?:[?#].*)?$/,
  /^\/jobs(?:\/[^?#]+)?(?:[?#].*)?$/,
  /^\/me\/(?:activity|ai-records|benefits|documents|favorites|feedback|notifications|print-orders|resumes|settings)(?:[?#].*)?$/,
  /^\/print(?:\/(?:confirm|material-check|preview|progress|done|upload))?(?:[?#].*)?$/,
  /^\/print-scan(?:\/feature\/[^?#]+)?(?:[?#].*)?$/,
  /^\/profile(?:[?#].*)?$/,
  /^\/renshi(?:[?#].*)?$/,
  /^\/resume(?:\/(?:career-plan|export|generate(?:\/preview)?|job-fit|parse|report|source|templates|upload))?(?:[?#].*)?$/,
  /^\/scan\/(?:progress|result|settings|start)(?:[?#].*)?$/,
  /^\/smart-campus(?:\/(?:freshman-insights|service\/[^?#]+|welcome))?(?:[?#].*)?$/,
]

interface ConfigRow {
  terminalId: string
  enabled: boolean
  itemsJson: string
  updatedAt: Date
}

interface TerminalRef {
  id: string
  terminalCode: string
  enabled: boolean
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function cleanRoute(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const route = cleanText(value, 128)
  if (!route) return null
  if (!route.startsWith('/')) {
    throw new BadRequestException({ error: { code: 'INVALID_TOOLBOX_ROUTE', message: '百宝箱功能路径必须是站内路径' } })
  }
  if (route.startsWith('//') || route.includes('://') || route.includes('\\')) {
    throw new BadRequestException({ error: { code: 'INVALID_TOOLBOX_ROUTE', message: '百宝箱功能路径不得使用外部链接' } })
  }
  if (!ALLOWED_TOOLBOX_ROUTE_PATTERNS.some((pattern) => pattern.test(route))) {
    throw new BadRequestException({ error: { code: 'INVALID_TOOLBOX_ROUTE', message: '百宝箱功能路径不在允许的 Kiosk 功能范围内' } })
  }
  return route
}

function cleanIcon(value: unknown): string {
  const icon = cleanText(value, 32)
  return ALLOWED_TOOLBOX_ICONS.has(icon) ? icon : 'wrench'
}

function cleanPlacements(value: unknown): KioskAppPlacementView[] {
  const raw = Array.isArray(value) ? value : ['toolbox']
  const placements = raw.filter((item): item is KioskAppPlacementView =>
    typeof item === 'string' && ALLOWED_APP_PLACEMENTS.has(item as KioskAppPlacementView),
  )
  const deduped = [...new Set(placements)]
  return deduped.length > 0 ? deduped : ['toolbox']
}

function cleanLaunchMode(value: unknown): KioskAppLaunchModeView {
  return typeof value === 'string' && ALLOWED_LAUNCH_MODES.has(value as KioskAppLaunchModeView)
    ? value as KioskAppLaunchModeView
    : 'internal_route'
}

function allowedHostsFromEnv(name: string): Set<string> {
  const hosts = (process.env[name] ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
  return new Set(hosts)
}

function allowedExternalHosts(): Set<string> {
  return allowedHostsFromEnv('KIOSK_EXTERNAL_APP_ALLOWED_HOSTS')
}

function allowedQrTargetHosts(): Set<string> {
  const qrHosts = allowedHostsFromEnv('KIOSK_QR_TARGET_ALLOWED_HOSTS')
  return qrHosts.size > 0 ? qrHosts : allowedExternalHosts()
}

function assertAllowedHttpsUrl(
  rawUrl: string,
  code: string,
  label: string,
  hosts = allowedExternalHosts(),
  hostListLabel = 'Kiosk 外部应用白名单',
): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new BadRequestException({ error: { code, message: `${label}必须是合法 HTTPS URL` } })
  }
  if (url.protocol !== 'https:') {
    throw new BadRequestException({ error: { code, message: `${label}必须使用 HTTPS` } })
  }
  if (!hosts.has(url.hostname.toLowerCase())) {
    throw new BadRequestException({
      error: { code: 'TOOLBOX_EXTERNAL_HOST_NOT_ALLOWED', message: `${label}域名未加入${hostListLabel}` },
    })
  }
  return url.toString()
}

function cleanExternalUrl(value: unknown, required: boolean): string | null {
  const rawUrl = cleanText(value, 512)
  if (!rawUrl) {
    if (required) {
      throw new BadRequestException({ error: { code: 'INVALID_TOOLBOX_EXTERNAL_URL', message: '外部 H5 应用必须填写 HTTPS URL' } })
    }
    return null
  }
  return assertAllowedHttpsUrl(rawUrl, 'INVALID_TOOLBOX_EXTERNAL_URL', '外部 H5 应用 URL')
}

function cleanQrImageUrl(value: unknown, required: boolean): string | null {
  const rawUrl = cleanText(value, 512)
  if (!rawUrl) {
    if (required) {
      throw new BadRequestException({ error: { code: 'INVALID_TOOLBOX_QR_URL', message: '二维码应用必须填写二维码图片地址' } })
    }
    return null
  }
  if (rawUrl.startsWith('/')) {
    if (rawUrl.startsWith('//') || rawUrl.includes('://') || rawUrl.includes('\\')) {
      throw new BadRequestException({ error: { code: 'INVALID_TOOLBOX_QR_URL', message: '二维码图片地址格式不合法' } })
    }
    return rawUrl
  }
  return assertAllowedHttpsUrl(rawUrl, 'INVALID_TOOLBOX_QR_URL', '二维码图片地址')
}

function cleanQrTargetUrl(value: unknown, launchMode: KioskAppLaunchModeView): string | null {
  const rawValue = cleanText(value, 512)
  if (!rawValue) return null
  if (launchMode === 'qr_code') {
    return assertAllowedHttpsUrl(rawValue, 'INVALID_TOOLBOX_QR_TARGET_URL', '二维码目标地址', allowedQrTargetHosts(), '二维码目标白名单')
  }
  if (/^(?:javascript|file|data|vbscript|https?):/i.test(rawValue) || rawValue.includes('://') || rawValue.includes('\\') || rawValue.includes('<') || rawValue.includes('>')) {
    throw new BadRequestException({ error: { code: 'INVALID_TOOLBOX_QR_TARGET_URL', message: '小程序目标说明格式不合法' } })
  }
  return rawValue
}

function validationErrorCode(error: unknown): string {
  const resp = error instanceof BadRequestException ? error.getResponse() : null
  if (resp && typeof resp === 'object' && 'error' in resp) {
    const body = resp as { error?: { code?: string } }
    return body.error?.code ?? 'INVALID_TOOLBOX_ITEM'
  }
  return error instanceof Error ? error.name : 'UNKNOWN_ERROR'
}

function normalizeItems(
  rawItems: unknown,
  options: { strict: boolean; preserveInvalidUrls?: boolean } = { strict: false },
): KioskToolboxItemView[] {
  if (!Array.isArray(rawItems)) return []
  const seen = new Set<string>()
  const normalized: KioskToolboxItemView[] = []

  for (const [index, raw] of rawItems.slice(0, MAX_TOOLBOX_ITEMS).entries()) {
    try {
      const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
      const title = cleanText(item.title, 32)
      if (!title) continue
      const fallbackKey = title ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : `tool-${index + 1}`
      let key = cleanText(item.key, 64) || fallbackKey || `tool-${index + 1}`
      const disabled = Boolean(item.disabled)
      const launchMode = cleanLaunchMode(item.launchMode)
      const placements = cleanPlacements(item.placements)
      const shouldValidateUrls = !options.preserveInvalidUrls
      const to = launchMode === 'internal_route'
        ? shouldValidateUrls
          ? cleanRoute(item.to)
          : cleanText(item.to, 128) || null
        : null
      const externalUrl = launchMode === 'external_url'
        ? shouldValidateUrls
          ? cleanExternalUrl(item.externalUrl, options.strict ? !disabled : false)
          : cleanText(item.externalUrl, 512) || null
        : null
      const qrImageUrl = launchMode === 'qr_code' || launchMode === 'mini_program_qr'
        ? shouldValidateUrls
          ? cleanQrImageUrl(item.qrImageUrl, options.strict ? !disabled : false)
          : cleanText(item.qrImageUrl, 512) || null
        : null
      const qrTargetUrl = launchMode === 'qr_code' || launchMode === 'mini_program_qr'
        ? shouldValidateUrls
          ? cleanQrTargetUrl(item.qrTargetUrl, launchMode)
          : cleanText(item.qrTargetUrl, 512) || null
        : null

      if (!options.strict && !disabled) {
        if (launchMode === 'external_url' && !externalUrl) {
          throw new BadRequestException({ error: { code: 'INVALID_TOOLBOX_EXTERNAL_URL', message: '外部 H5 应用必须填写 HTTPS URL' } })
        }
        if ((launchMode === 'qr_code' || launchMode === 'mini_program_qr') && !qrImageUrl) {
          throw new BadRequestException({ error: { code: 'INVALID_TOOLBOX_QR_URL', message: '二维码应用必须填写二维码图片地址' } })
        }
      }

      const baseKey = key
      let suffix = index + 1
      while (seen.has(key)) {
        key = `${baseKey}-${suffix}`
        suffix += 1
      }
      seen.add(key)
      normalized.push({
        key,
        title,
        description: cleanText(item.description, 80),
        icon: cleanIcon(item.icon),
        to,
        disabled,
        sortOrder: Number.isInteger(item.sortOrder) ? Number(item.sortOrder) : index,
        placements,
        launchMode,
        externalUrl,
        qrImageUrl,
        qrTargetUrl,
      })
    } catch (error) {
      if (options.strict) throw error
      const itemKey = raw && typeof raw === 'object' ? cleanText((raw as Record<string, unknown>).key, 64) : ''
      const itemRef = itemKey || `index:${index}`
      TOOLBOX_LOGGER.warn(`Stored toolbox item ${itemRef} failed validation and was hidden from public Kiosk config: ${validationErrorCode(error)}`)
    }
  }

  return normalized.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'zh-Hans-CN'))
}

function parseItems(json: string): KioskToolboxItemView[] {
  try {
    return normalizeItems(JSON.parse(json))
  } catch {
    return []
  }
}

function parseItemsForAdmin(json: string): KioskToolboxItemView[] {
  try {
    return normalizeItems(JSON.parse(json), { strict: false, preserveInvalidUrls: true })
  } catch {
    return []
  }
}

function toPublicConfigView(row: ConfigRow): TerminalToolboxConfigView {
  return {
    terminalId: row.terminalId,
    enabled: row.enabled,
    items: parseItems(row.itemsJson),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toAdminConfigView(row: ConfigRow): TerminalToolboxConfigView {
  return {
    terminalId: row.terminalId,
    enabled: row.enabled,
    items: parseItemsForAdmin(row.itemsJson),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function actionAllowedForItem(action: ToolboxLaunchActionView, item: KioskToolboxItemView): boolean {
  const launchMode = item.launchMode ?? 'internal_route'
  if (action === 'show_qr') return launchMode === 'qr_code' || launchMode === 'mini_program_qr'
  if (action === 'open_external_notice' || action === 'open_external_confirmed' || action === 'cancel_external') {
    return launchMode === 'external_url'
  }
  return false
}

function targetHostFromItem(item: KioskToolboxItemView): string | null {
  const launchMode = item.launchMode ?? 'internal_route'
  const rawTarget = launchMode === 'external_url'
    ? item.externalUrl
    : launchMode === 'qr_code'
      ? item.qrTargetUrl
      : null
  if (!rawTarget) return null
  try {
    const host = new URL(rawTarget).hostname.toLowerCase()
    return /^[a-z0-9.-]{1,128}$/.test(host) ? host : null
  } catch {
    return null
  }
}

function eventExpiresAt(now: Date): Date {
  return new Date(now.getTime() + TOOLBOX_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

function parseSummaryDays(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 7
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(raw) || raw < 1 || raw > 90) {
    throw new BadRequestException({ error: { code: 'INVALID_TOOLBOX_SUMMARY_DAYS', message: '统计天数必须是 1-90 的整数' } })
  }
  return raw
}

@Injectable()
export class TerminalToolboxService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicConfig(
    terminalRef: string,
    terminal: TerminalRef | null,
  ): Promise<KioskToolboxConfigView & { smartCampusItems: KioskToolboxItemView[]; version: string }> {
    const config = await this.findConfigByTerminalRef(terminalRef, terminal)
    const enabled = Boolean(terminal?.enabled) && (config?.enabled ?? DEFAULT_TOOLBOX.enabled)
    const items = enabled && config ? parseItems(config.itemsJson) : []
    return {
      enabled,
      items: items.filter((item) => (item.placements ?? ['toolbox']).includes('toolbox')),
      smartCampusItems: items.filter((item) => (item.placements ?? []).includes('smart_campus')),
      version: config?.updatedAt.toISOString() ?? 'toolbox:none',
    }
  }

  async getTerminalConfig(terminalId: string): Promise<TerminalToolboxConfigView> {
    const publicTerminalId = await this.resolvePublicTerminalId(terminalId)
    const config = await this.findConfigByTerminalRef(terminalId)
    if (!config) {
      return { terminalId: publicTerminalId, enabled: false, items: [], updatedAt: null }
    }
    return toAdminConfigView(config)
  }

  async saveTerminalConfig(
    terminalId: string,
    input: SaveToolboxConfigInput,
    updatedBy: string | null,
  ): Promise<TerminalToolboxConfigView> {
    const publicTerminalId = await this.resolvePublicTerminalId(terminalId)
    const items = normalizeItems(input.items, { strict: true })
    const saved = await this.prisma.terminalToolboxConfig.upsert({
      where: { terminalId: publicTerminalId },
      create: { terminalId: publicTerminalId, enabled: input.enabled, itemsJson: JSON.stringify(items), updatedBy },
      update: { enabled: input.enabled, itemsJson: JSON.stringify(items), updatedBy },
    })
    return toPublicConfigView(saved)
  }

  async listToolboxTerminals(): Promise<ToolboxTerminalView[]> {
    const [terminals, configs] = await Promise.all([
      this.prisma.terminal.findMany({
        include: { org: { select: { id: true, name: true } } },
        orderBy: { registeredAt: 'desc' },
        take: 500,
      }),
      this.prisma.terminalToolboxConfig.findMany(),
    ])
    const byTerminal = new Map(configs.map((c) => [c.terminalId, c]))
    const now = Date.now()
    const rows: ToolboxTerminalView[] = terminals.map((t) => {
      const config = byTerminal.get(t.terminalCode) ?? byTerminal.get(t.id)
      return {
        terminalId: t.terminalCode,
        terminalCode: t.terminalCode,
        orgId: t.orgId,
        orgName: t.org?.name ?? null,
        isOnline: now - t.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS,
        config: config ? toAdminConfigView(config) : null,
      }
    })

    const seen = new Set(terminals.flatMap((t) => [t.id, t.terminalCode]))
    for (const c of configs) {
      if (!seen.has(c.terminalId)) {
        rows.push({ terminalId: c.terminalId, terminalCode: null, isOnline: false, config: toAdminConfigView(c) })
      }
    }
    return rows
  }

  async recordLaunchEvent(
    terminalId: string,
    input: RecordToolboxLaunchEventInput,
  ): Promise<{ recorded: boolean }> {
    const terminalRef = cleanText(terminalId, 128)
    const itemKey = cleanText(input.itemKey, 64)
    if (!terminalRef || !itemKey || !TOOLBOX_LAUNCH_ACTIONS.includes(input.action)) {
      return { recorded: false }
    }
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] },
      select: { id: true, terminalCode: true, enabled: true },
    })
    if (!terminal?.enabled) return { recorded: false }

    const config = await this.findConfigByTerminalRef(terminal.terminalCode, terminal)
    if (!config?.enabled) return { recorded: false }

    const item = parseItems(config.itemsJson).find((candidate) => candidate.key === itemKey)
    if (!item || item.disabled || !actionAllowedForItem(input.action, item)) {
      return { recorded: false }
    }
    const placements = item.placements ?? ['toolbox']
    const placement = input.placement && placements.includes(input.placement) ? input.placement : placements[0] ?? 'toolbox'
    const now = new Date()
    await this.prisma.toolboxLaunchEvent.create({
      data: {
        terminalId: terminal.terminalCode,
        itemKey: item.key,
        itemTitle: item.title,
        launchMode: item.launchMode ?? 'internal_route',
        action: input.action,
        placement,
        targetHost: targetHostFromItem(item),
        createdAt: now,
        expiresAt: eventExpiresAt(now),
      },
    })
    return { recorded: true }
  }

  async getLaunchSummary(input: { days?: string | number | null; terminalId?: string | null }): Promise<ToolboxLaunchSummaryView> {
    const days = parseSummaryDays(input.days)
    const terminalFilter = cleanText(input.terminalId, 128)
    const terminalId = terminalFilter ? await this.resolvePublicTerminalId(terminalFilter) : null
    const to = new Date()
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
    const where = {
      createdAt: { gte: from, lte: to },
      ...(terminalId ? { terminalId } : {}),
    }
    const [totalCount, actionRows, itemRows] = await Promise.all([
      this.prisma.toolboxLaunchEvent.count({ where }),
      this.prisma.toolboxLaunchEvent.groupBy({ by: ['action'], where, _count: { _all: true } }),
      this.prisma.toolboxLaunchEvent.groupBy({ by: ['itemKey', 'itemTitle'], where, _count: { _all: true } }),
    ])
    const byAction = TOOLBOX_LAUNCH_ACTIONS.reduce<Record<ToolboxLaunchActionView, number>>((acc, action) => {
      acc[action] = 0
      return acc
    }, {} as Record<ToolboxLaunchActionView, number>)
    for (const row of actionRows) {
      if (TOOLBOX_LAUNCH_ACTIONS.includes(row.action as ToolboxLaunchActionView)) {
        byAction[row.action as ToolboxLaunchActionView] = row._count._all
      }
    }
    const topItems = itemRows
      .map((row) => ({ itemKey: row.itemKey, itemTitle: row.itemTitle, count: row._count._all }))
      .sort((a, b) => b.count - a.count || a.itemKey.localeCompare(b.itemKey))
      .slice(0, 5)
    return {
      days,
      terminalId,
      from: from.toISOString(),
      to: to.toISOString(),
      totalCount,
      qrShownCount: byAction.show_qr,
      externalNoticeCount: byAction.open_external_notice,
      externalConfirmedCount: byAction.open_external_confirmed,
      externalCancelledCount: byAction.cancel_external,
      byAction,
      topItems,
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredLaunchEvents(): Promise<void> {
    await this.prisma.toolboxLaunchEvent.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  }

  private async resolvePublicTerminalId(terminalId: string): Promise<string> {
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalId }, { terminalCode: terminalId }] },
      select: { terminalCode: true },
    })
    return terminal?.terminalCode ?? terminalId
  }

  private async findConfigByTerminalRef(terminalId: string, terminal?: TerminalRef | null): Promise<ConfigRow | null> {
    const resolved = terminal ?? await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalId }, { terminalCode: terminalId }] },
      select: { id: true, terminalCode: true, enabled: true },
    })
    const keys = [...new Set([terminalId, resolved?.terminalCode, resolved?.id].filter((v): v is string => !!v))]
    const configs = await this.prisma.terminalToolboxConfig.findMany({ where: { terminalId: { in: keys } } })
    return configs.sort((a, b) => keys.indexOf(a.terminalId) - keys.indexOf(b.terminalId))[0] ?? null
  }
}
