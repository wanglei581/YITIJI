import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  DEFAULT_SMART_CAMPUS_MODULES,
  type KioskSmartCampusConfig,
  type SaveSmartCampusConfigInput,
  type SmartCampusModules,
  type SmartCampusTerminalView,
  type TerminalSmartCampusConfigView,
} from './smart-campus.types'

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000

/** 解析 modulesJson 为强类型开关位，缺失/损坏一律按 false（默认全关）。 */
function parseModules(json: string): SmartCampusModules {
  try {
    const raw = JSON.parse(json) as Partial<SmartCampusModules> | null
    return {
      welcome: !!raw?.welcome,
      bigdata: !!raw?.bigdata,
      luggage: !!raw?.luggage,
      panorama: !!raw?.panorama,
    }
  } catch {
    return { ...DEFAULT_SMART_CAMPUS_MODULES }
  }
}

interface ConfigRow {
  terminalId: string
  enabled: boolean
  modulesJson: string
  updatedAt: Date
}

function toConfigView(row: ConfigRow): TerminalSmartCampusConfigView {
  return {
    terminalId: row.terminalId,
    enabled: row.enabled,
    modules: parseModules(row.modulesJson),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * 智慧校园（按终端开关）服务。
 *
 * 设计沿用 screensaver（ContentService）的终端配置范式：terminalId 为自由字符串，
 * 按 id 或 terminalCode 解析；可在终端注册前预置。
 *
 * 合规（compliance-boundary.md §九）：
 *   - 本服务不读写任何学生数据；校园大数据本期冻结，bigdata 仅为开关位。
 *   - Kiosk 拉取（getKioskConfig）返回体白名单：只含 enabled + 子模块开关。
 */
@Injectable()
export class SmartCampusService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Kiosk 拉取（免鉴权，白名单：只含开关，绝不含学生数据）────────────────
  async getKioskConfig(terminalId: string): Promise<KioskSmartCampusConfig> {
    const config = await this.findConfigByTerminalRef(terminalId)
    if (!config || !config.enabled) {
      return { enabled: false, modules: { ...DEFAULT_SMART_CAMPUS_MODULES } }
    }
    return { enabled: true, modules: parseModules(config.modulesJson) }
  }

  // ── 管理员 ────────────────────────────────────────────────────────────────
  async getTerminalConfig(terminalId: string): Promise<TerminalSmartCampusConfigView> {
    const publicTerminalId = await this.resolvePublicTerminalId(terminalId)
    const config = await this.findConfigByTerminalRef(terminalId)
    if (!config) {
      return {
        terminalId: publicTerminalId,
        enabled: false,
        modules: { ...DEFAULT_SMART_CAMPUS_MODULES },
        updatedAt: null,
      }
    }
    return toConfigView(config)
  }

  async saveTerminalConfig(
    terminalId: string,
    input: SaveSmartCampusConfigInput,
    updatedBy: string | null,
  ): Promise<TerminalSmartCampusConfigView> {
    const publicTerminalId = await this.resolvePublicTerminalId(terminalId)
    const modules: SmartCampusModules = {
      welcome: !!input.modules?.welcome,
      bigdata: !!input.modules?.bigdata,
      luggage: !!input.modules?.luggage,
      panorama: !!input.modules?.panorama,
    }
    // 未开启任何子模块时不允许 enabled=true（否则前端拉到"空模块"）。
    const anyModule = modules.welcome || modules.bigdata || modules.luggage || modules.panorama
    const enabled = input.enabled && anyModule
    const modulesJson = JSON.stringify(modules)

    const saved = await this.prisma.terminalSmartCampusConfig.upsert({
      where: { terminalId: publicTerminalId },
      create: { terminalId: publicTerminalId, enabled, modulesJson, updatedBy },
      update: { enabled, modulesJson, updatedBy },
    })
    return toConfigView(saved)
  }

  async listSmartCampusTerminals(): Promise<SmartCampusTerminalView[]> {
    const [terminals, configs] = await Promise.all([
      this.prisma.terminal.findMany({ orderBy: { registeredAt: 'desc' }, take: 500 }),
      this.prisma.terminalSmartCampusConfig.findMany(),
    ])
    const byTerminal = new Map(configs.map((c) => [c.terminalId, c]))
    const now = Date.now()

    const rows: SmartCampusTerminalView[] = terminals.map((t) => {
      const config = byTerminal.get(t.terminalCode) ?? byTerminal.get(t.id)
      return {
        terminalId: t.terminalCode,
        terminalCode: t.terminalCode,
        isOnline: now - t.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS,
        config: config ? toConfigView(config) : null,
      }
    })

    // 预置但尚未注册的终端配置也展示（terminalCode 未知）
    const seen = new Set(terminals.flatMap((t) => [t.id, t.terminalCode]))
    for (const c of configs) {
      if (!seen.has(c.terminalId)) {
        rows.push({ terminalId: c.terminalId, terminalCode: null, isOnline: false, config: toConfigView(c) })
      }
    }
    return rows
  }

  // ── 内部：终端身份解析（与 ContentService 同口径）────────────────────────
  private async resolvePublicTerminalId(terminalId: string): Promise<string> {
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalId }, { terminalCode: terminalId }] },
      select: { terminalCode: true },
    })
    return terminal?.terminalCode ?? terminalId
  }

  private async findConfigByTerminalRef(terminalId: string): Promise<ConfigRow | null> {
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalId }, { terminalCode: terminalId }] },
      select: { id: true, terminalCode: true },
    })
    const keys = [...new Set([terminalId, terminal?.terminalCode, terminal?.id].filter((v): v is string => !!v))]
    const configs = await this.prisma.terminalSmartCampusConfig.findMany({ where: { terminalId: { in: keys } } })
    return configs.sort((a, b) => keys.indexOf(a.terminalId) - keys.indexOf(b.terminalId))[0] ?? null
  }
}
