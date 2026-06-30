import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type {
  KioskToolboxConfigView,
  KioskToolboxItemView,
  SaveToolboxConfigInput,
  TerminalToolboxConfigView,
  ToolboxTerminalView,
} from './terminal-toolbox.types'

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000
const MAX_TOOLBOX_ITEMS = 24
const DEFAULT_TOOLBOX: KioskToolboxConfigView = { enabled: true, items: [] }
const ALLOWED_TOOLBOX_ICONS = new Set(['wrench', 'file-text', 'printer', 'sparkles', 'book-open', 'help-circle'])
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
  if (route.startsWith('//') || route.includes('://')) {
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

function normalizeItems(rawItems: unknown): KioskToolboxItemView[] {
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
    return {
      key,
      title,
      description: cleanText(item.description, 80),
      icon: cleanIcon(item.icon),
      to: cleanRoute(item.to),
      disabled: Boolean(item.disabled),
      sortOrder: Number.isInteger(item.sortOrder) ? Number(item.sortOrder) : index,
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
  ): Promise<KioskToolboxConfigView & { version: string }> {
    const config = await this.findConfigByTerminalRef(terminalRef, terminal)
    const enabled = Boolean(terminal?.enabled) && (config?.enabled ?? DEFAULT_TOOLBOX.enabled)
    const items = enabled && config ? parseItems(config.itemsJson) : []
    return {
      enabled,
      items,
      version: config?.updatedAt.toISOString() ?? 'toolbox:none',
    }
  }

  async getTerminalConfig(terminalId: string): Promise<TerminalToolboxConfigView> {
    const publicTerminalId = await this.resolvePublicTerminalId(terminalId)
    const config = await this.findConfigByTerminalRef(terminalId)
    if (!config) {
      return { terminalId: publicTerminalId, enabled: true, items: [], updatedAt: null }
    }
    return toConfigView(config)
  }

  async saveTerminalConfig(
    terminalId: string,
    input: SaveToolboxConfigInput,
    updatedBy: string | null,
  ): Promise<TerminalToolboxConfigView> {
    const publicTerminalId = await this.resolvePublicTerminalId(terminalId)
    const items = normalizeItems(input.items)
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
