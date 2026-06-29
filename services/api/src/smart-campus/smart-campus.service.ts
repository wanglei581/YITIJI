import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
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
      // 校园大数据本期严格冻结：读写两侧都强制 false，避免历史残留配置泄露为 true。
      bigdata: false,
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
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalId }, { terminalCode: terminalId }] },
      select: { enabled: true },
    })
    if (terminal && !terminal.enabled) {
      return { enabled: false, modules: { ...DEFAULT_SMART_CAMPUS_MODULES } }
    }
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
      // 校园大数据本期冻结：任何端传入 true 都强制落 false，避免误展示未授权统计。
      bigdata: false,
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
      this.prisma.terminal.findMany({ include: { org: { select: { id: true, name: true } } }, orderBy: { registeredAt: 'desc' }, take: 500 }),
      this.prisma.terminalSmartCampusConfig.findMany(),
    ])
    const byTerminal = new Map(configs.map((c) => [c.terminalId, c]))
    const now = Date.now()

    const rows: SmartCampusTerminalView[] = terminals.map((t) => {
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

    // 预置但尚未注册的终端配置也展示（terminalCode 未知）
    const seen = new Set(terminals.flatMap((t) => [t.id, t.terminalCode]))
    for (const c of configs) {
      if (!seen.has(c.terminalId)) {
        rows.push({ terminalId: c.terminalId, terminalCode: null, isOnline: false, config: toConfigView(c) })
      }
    }
    return rows
  }

  // ── Partner：只能读写归属自己机构的终端（学校账号，按 orgId 硬隔离）──────────
  //
  // 三层判定（smart-campus-integration-design §13）的后端兜底，前端隐藏菜单只是 UX：
  //   ① orgId 非空      → 否则 403 PARTNER_ORG_REQUIRED
  //   ② 机构存在且启用  → 否则 403 PARTNER_ORG_NOT_FOUND
  //   ③ 机构类型为学校  → 否则 403 PARTNER_NOT_SCHOOL（非学校 partner 不得碰智慧校园）
  //   ④ 终端归属本机构  → 否则 403 TERMINAL_NOT_IN_ORG（防跨校用 path 里 terminalId 改别人）
  // 错误体统一 { error: { code, message } }，与 jobs.service 同口径，前端 / verify 可读 code。
  async listPartnerSmartCampusTerminals(orgId: string | null): Promise<SmartCampusTerminalView[]> {
    const org = await this.assertSchoolOrg(orgId)

    const [terminals, configs] = await Promise.all([
      this.prisma.terminal.findMany({
        where: { orgId: org.id },
        orderBy: { registeredAt: 'desc' },
        take: 500,
      }),
      this.prisma.terminalSmartCampusConfig.findMany(),
    ])
    const byTerminal = new Map(configs.map((c) => [c.terminalId, c]))
    const now = Date.now()

    return terminals.map((t) => {
      const config = byTerminal.get(t.terminalCode) ?? byTerminal.get(t.id)
      return {
        terminalId: t.terminalCode,
        terminalCode: t.terminalCode,
        orgId: t.orgId,
        orgName: org.name,
        isOnline: now - t.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS,
        config: config ? toConfigView(config) : null,
      }
    })
  }

  async savePartnerTerminalConfig(
    terminalId: string,
    input: SaveSmartCampusConfigInput,
    user: { userId: string; orgId: string | null },
  ): Promise<TerminalSmartCampusConfigView> {
    const org = await this.assertSchoolOrg(user.orgId)

    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalId }, { terminalCode: terminalId }] },
      select: { id: true, terminalCode: true, orgId: true },
    })
    if (!terminal) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
    }
    if (terminal.orgId !== org.id) {
      throw new ForbiddenException({ error: { code: 'TERMINAL_NOT_IN_ORG', message: '该终端不归属本机构，无法配置' } })
    }

    // bigdata 本期冻结由 saveTerminalConfig 统一强制 false；此处直接复用其落库逻辑
    // （含「无任何子模块开启 → enabled 落 false」与 modulesJson 落库）。
    return this.saveTerminalConfig(terminal.terminalCode, input, user.userId)
  }

  /** Partner 学校机构校验：orgId 非空 + 机构存在/启用 + 类型为 school_employment_center。 */
  private async assertSchoolOrg(orgId: string | null): Promise<{ id: string; name: string }> {
    if (!orgId) {
      throw new ForbiddenException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, type: true, enabled: true },
    })
    if (!org || !org.enabled) {
      throw new ForbiddenException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    if (org.type !== 'school_employment_center') {
      throw new ForbiddenException({ error: { code: 'PARTNER_NOT_SCHOOL', message: '仅学校就业中心机构可管理智慧校园' } })
    }
    return { id: org.id, name: org.name }
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
