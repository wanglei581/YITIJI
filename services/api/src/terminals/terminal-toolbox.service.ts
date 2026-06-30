import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type {
  KioskAppLaunchModeView,
  KioskAppPlacementView,
  KioskToolboxConfigView,
  KioskToolboxItemView,
  SaveToolboxConfigInput,
  TerminalToolboxConfigView,
  ToolboxTerminalView,
} from './terminal-toolbox.types'

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000
const MAX_TOOLBOX_ITEMS = 24
const DEFAULT_TOOLBOX: KioskToolboxConfigView = { enabled: true, items: [] }
const TOOLBOX_LOGGER = new Logger('TerminalToolboxService')
const ALLOWED_TOOLBOX_ICONS = new Set(['wrench', 'file-text', 'printer', 'sparkles', 'book-open', 'help-circle'])
const ALLOWED_APP_PLACEMENTS = new Set<KioskAppPlacementView>(['toolbox', 'smart_campus'])
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

function allowedExternalHosts(): Set<string> {
  const hosts = (process.env.KIOSK_EXTERNAL_APP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
  return new Set(hosts)
}

function assertAllowedHttpsUrl(rawUrl: string, code: string, label: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new BadRequestException({ error: { code, message: `${label}必须是合法 HTTPS URL` } })
  }
  if (url.protocol !== 'https:') {
    throw new BadRequestException({ error: { code, message: `${label}必须使用 HTTPS` } })
  }
  const hosts = allowedExternalHosts()
  if (!hosts.has(url.hostname.toLowerCase())) {
    throw new BadRequestException({
      error: { code: 'TOOLBOX_EXTERNAL_HOST_NOT_ALLOWED', message: `${label}域名未加入 Kiosk 外部应用白名单` },
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

function cleanReadableExternalUrl(value: unknown): string | null {
  const rawUrl = cleanText(value, 512)
  if (!rawUrl) return null
  try {
    return cleanExternalUrl(rawUrl, false)
  } catch {
    TOOLBOX_LOGGER.warn('Stored toolbox external URL failed validation and was hidden from public Kiosk config')
    return null
  }
}

function cleanReadableQrImageUrl(value: unknown): string | null {
  const rawUrl = cleanText(value, 512)
  if (!rawUrl) return null
  try {
    return cleanQrImageUrl(rawUrl, false)
  } catch {
    TOOLBOX_LOGGER.warn('Stored toolbox QR image URL failed validation and was hidden from public Kiosk config')
    return null
  }
}

function normalizeItems(rawItems: unknown, options: { strict: boolean } = { strict: false }): KioskToolboxItemView[] {
  if (!Array.isArray(rawItems)) return []
  const seen = new Set<string>()
  return rawItems.slice(0, MAX_TOOLBOX_ITEMS).map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const title = cleanText(item.title, 32)
    const fallbackKey = title ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : `tool-${index + 1}`
    let key = cleanText(item.key, 64) || fallbackKey || `tool-${index + 1}`
    const baseKey = key
    let suffix = index + 1
    while (seen.has(key)) {
      key = `${baseKey}-${suffix}`
      suffix += 1
    }
    seen.add(key)
    const disabled = Boolean(item.disabled)
    const launchMode = cleanLaunchMode(item.launchMode)
    const placements = cleanPlacements(item.placements)
    const to = launchMode === 'internal_route' ? cleanRoute(item.to) : null
    const externalUrl = launchMode === 'external_url'
      ? (options.strict ? cleanExternalUrl(item.externalUrl, !disabled) : cleanReadableExternalUrl(item.externalUrl))
      : null
    const qrImageUrl = launchMode === 'qr_code' || launchMode === 'mini_program_qr'
      ? (options.strict ? cleanQrImageUrl(item.qrImageUrl, !disabled) : cleanReadableQrImageUrl(item.qrImageUrl))
      : null
    return {
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
    }
  }).filter((item) => item.title.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'zh-Hans-CN'))
}

function parseItems(json: string): KioskToolboxItemView[] {
  try {
    return normalizeItems(JSON.parse(json))
  } catch {
    return []
  }
}

function toConfigView(row: ConfigRow): TerminalToolboxConfigView {
  return {
    terminalId: row.terminalId,
    enabled: row.enabled,
    items: parseItems(row.itemsJson),
    updatedAt: row.updatedAt.toISOString(),
  }
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
    return toConfigView(config)
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
    return toConfigView(saved)
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
        config: config ? toConfigView(config) : null,
      }
    })

    const seen = new Set(terminals.flatMap((t) => [t.id, t.terminalCode]))
    for (const c of configs) {
      if (!seen.has(c.terminalId)) {
        rows.push({ terminalId: c.terminalId, terminalCode: null, isOnline: false, config: toConfigView(c) })
      }
    }
    return rows
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
