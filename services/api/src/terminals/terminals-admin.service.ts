// ============================================================
// TerminalAdminService — Admin 管理端
//
// 职责：listTerminalsForAdmin, listOrganizationOptions,
//        assignTerminalOrg, updateTerminalProfile,
//        getKioskTerminalConfig, listPrintersForAdmin,
//        listPrintTasks, getTerminalPrinterStatus。
// Agent 生命周期见 TerminalAgentService。
// ============================================================

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalToolboxService } from './terminal-toolbox.service'
import { TerminalAgentService } from './terminals-agent.service'
import { isHealthyPrinterStatus } from './printer-status'
import type { KioskTerminalConfigView } from './terminal-config.types'
import {
  cleanNullable,
  normalizeMacAddress,
  tryNormalizeMacAddress,
  parseSmartCampusModules,
  CONFIG_REFRESH_INTERVAL_MS,
} from './terminal-utils'
import { DEFAULT_SMART_CAMPUS_MODULES } from '../smart-campus/smart-campus.types'

// ── Admin view types ───────────────────────────────────────────────────────────

export interface AdminTerminalView {
  id: string
  terminalCode: string
  displayName: string | null
  macAddress: string | null
  locationLabel: string | null
  enabled: boolean
  orgId: string | null
  orgName: string | null
  registeredAt: string
  lastSeenAt: string
  online: boolean
  lastHeartbeatAt: string | null
  agentStatus: string | null
  localTaskDatabaseAvailable: boolean | null
  printerStatus: string | null
  agentVersion: string | null
  ipAddress: string | null
  diskFreeGb: number | null
}

export interface AdminOrganizationOption {
  id: string
  name: string
  type: string
}

export interface AssignTerminalOrgResult {
  terminalId: string
  terminalCode: string
  oldOrgId: string | null
  newOrgId: string | null
  orgName: string | null
}

export interface UpdateTerminalProfileResult {
  terminalId: string
  terminalCode: string
  displayName: string | null
  macAddress: string | null
  locationLabel: string | null
  enabled: boolean
}

export interface AdminPrinterView {
  id: string
  terminalId: string
  terminalCode: string
  name: string
  model: string | null
  serialNumber: string | null
  status: 'online' | 'offline' | 'error'
  printerStatus: string | null
  currentTask: string | null
  tonerLevel: number | null
  paperTrayLevel: number | null
  paperStatus: 'normal' | 'low' | 'empty' | 'jam' | 'unknown' | null
  fault: string | null
  lastHeartbeatAt: string | null
  lastSyncAt: string | null
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function toAdminPrinterStatus(online: boolean, printerStatus: string | null): AdminPrinterView['status'] {
  if (!online) return 'offline'
  if (!printerStatus || printerStatus === 'unknown') return 'offline'
  if (isHealthyPrinterStatus(printerStatus)) return 'online'
  return 'error'
}

function describePrinterFault(online: boolean, printerStatus: string | null): string | null {
  if (!online) return '终端离线，打印机状态未知'
  switch (printerStatus) {
    case 'paper_empty': return '纸盒已空，请补充 A4 纸张'
    case 'offline': return '打印机离线'
    case 'not_found': return '未检测到配置的打印机'
    case 'error': return '打印机故障，需人工处理'
    case null:
    case undefined:
    case 'unknown': return '打印机状态未上报'
    default: return null
  }
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class TerminalAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: TerminalAgentService,
    private readonly toolbox: TerminalToolboxService,
  ) {}

  listTerminals() {
    return this.prisma.terminal.findMany({ orderBy: { registeredAt: 'desc' } })
  }

  async listTerminalsForAdmin(): Promise<{ terminals: AdminTerminalView[] }> {
    const ONLINE_WINDOW_MS = 3 * 60 * 1000
    const now = Date.now()

    const rows = await this.prisma.terminal.findMany({
      orderBy: { registeredAt: 'desc' },
      include: {
        org: { select: { id: true, name: true } },
        heartbeats: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            status: true,
            printerStatus: true,
            localTaskDatabaseAvailable: true,
            agentVersion: true,
            ipAddress: true,
            diskFreeGb: true,
            createdAt: true,
          },
        },
      },
    })

    const terminals: AdminTerminalView[] = rows.map((t: (typeof rows)[number]) => {
      const hb = t.heartbeats[0]
      const lastHeartbeatAt = hb?.createdAt ?? null
      const lastSeen = lastHeartbeatAt ?? t.registeredAt
      return {
        id: t.id,
        terminalCode: t.terminalCode,
        displayName: t.displayName ?? null,
        macAddress: t.macAddress ?? null,
        locationLabel: t.locationLabel ?? null,
        enabled: t.enabled,
        orgId: t.orgId,
        orgName: t.org?.name ?? null,
        registeredAt: t.registeredAt.toISOString(),
        lastSeenAt: lastSeen.toISOString(),
        online: now - lastSeen.getTime() < ONLINE_WINDOW_MS,
        lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
        agentStatus: hb?.status ?? null,
        localTaskDatabaseAvailable: hb?.localTaskDatabaseAvailable ?? null,
        printerStatus: hb?.printerStatus ?? null,
        agentVersion: hb?.agentVersion ?? null,
        ipAddress: hb?.ipAddress ?? null,
        diskFreeGb: hb?.diskFreeGb ?? null,
      }
    })

    return { terminals }
  }

  async listOrganizationOptions(): Promise<{ organizations: AdminOrganizationOption[] }> {
    const organizations = await this.prisma.organization.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true },
    })
    return { organizations }
  }

  async assignTerminalOrg(terminalId: string, orgId: string | null): Promise<AssignTerminalOrgResult> {
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalId }, { terminalCode: terminalId }] },
      select: { id: true, terminalCode: true, orgId: true },
    })
    if (!terminal) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
    }

    let orgName: string | null = null
    if (orgId !== null) {
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { id: true, name: true, enabled: true },
      })
      if (!org) {
        throw new NotFoundException({ error: { code: 'ORG_NOT_FOUND', message: '机构不存在' } })
      }
      if (!org.enabled) {
        throw new BadRequestException({ error: { code: 'ORG_DISABLED', message: '机构已停用，不能绑定' } })
      }
      orgName = org.name
    }

    const oldOrgId = terminal.orgId
    await this.prisma.terminal.update({ where: { id: terminal.id }, data: { orgId } })

    return {
      terminalId: terminal.terminalCode,
      terminalCode: terminal.terminalCode,
      oldOrgId,
      newOrgId: orgId,
      orgName,
    }
  }

  async updateTerminalProfile(
    terminalId: string,
    dto: { displayName?: string | null; macAddress?: string | null; locationLabel?: string | null; enabled?: boolean },
  ): Promise<UpdateTerminalProfileResult> {
    const terminalRefClauses: Array<{ id?: string; terminalCode?: string; macAddress?: string }> = [
      { id: terminalId },
      { terminalCode: terminalId },
    ]
    const macAddressRef = tryNormalizeMacAddress(terminalId)
    if (macAddressRef) terminalRefClauses.push({ macAddress: macAddressRef })

    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: terminalRefClauses },
      select: { id: true, terminalCode: true },
    })
    if (!terminal) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
    }

    const data: {
      displayName?: string | null
      macAddress?: string | null
      locationLabel?: string | null
      enabled?: boolean
    } = {}
    if ('displayName' in dto) data.displayName = cleanNullable(dto.displayName)
    if ('locationLabel' in dto) data.locationLabel = cleanNullable(dto.locationLabel)
    if ('enabled' in dto && dto.enabled !== undefined) data.enabled = dto.enabled
    if ('macAddress' in dto) {
      const macAddress = normalizeMacAddress(dto.macAddress)
      if (macAddress) await this.agent.assertMacAvailable(macAddress, terminal.id)
      data.macAddress = macAddress === undefined ? undefined : macAddress
    }

    const saved = await this.agent.writeWithMacConflictMapping(() =>
      this.prisma.terminal.update({
        where: { id: terminal.id },
        data,
        select: {
          id: true,
          terminalCode: true,
          displayName: true,
          macAddress: true,
          locationLabel: true,
          enabled: true,
        },
      }),
    ) as { id: string; terminalCode: string; displayName: string | null; macAddress: string | null; locationLabel: string | null; enabled: boolean }

    return {
      terminalId: saved.terminalCode,
      terminalCode: saved.terminalCode,
      displayName: saved.displayName ?? null,
      macAddress: saved.macAddress ?? null,
      locationLabel: saved.locationLabel ?? null,
      enabled: saved.enabled,
    }
  }

  async getKioskTerminalConfig(terminalRef: string): Promise<KioskTerminalConfigView> {
    const terminal = await this.agent.findTerminalByRef(terminalRef)
    const [smartCampusConfig, toolboxConfig] = await Promise.all([
      this.agent.findSmartCampusConfigByTerminalRef(terminalRef, terminal),
      this.toolbox.getPublicConfig(terminalRef, terminal),
    ])
    const terminalEnabled = terminal?.enabled ?? false
    const smartCampusEnabled = terminalEnabled && !!smartCampusConfig?.enabled
    const serverTime = new Date().toISOString()

    return {
      smartCampus: {
        enabled: smartCampusEnabled,
        modules: smartCampusEnabled
          ? parseSmartCampusModules(smartCampusConfig!.modulesJson)
          : { ...DEFAULT_SMART_CAMPUS_MODULES },
        items: smartCampusEnabled ? toolboxConfig.smartCampusItems : [],
      },
      toolbox: {
        enabled: toolboxConfig.enabled,
        items: toolboxConfig.items,
      },
      configVersion: [
        terminal?.lastSeenAt.toISOString() ?? 'unregistered',
        smartCampusConfig?.updatedAt.toISOString() ?? 'smart-campus:none',
        toolboxConfig.version,
      ].join('|'),
      refreshIntervalMs: CONFIG_REFRESH_INTERVAL_MS,
      serverTime,
    }
  }

  async listPrintersForAdmin(): Promise<{ printers: AdminPrinterView[] }> {
    const ONLINE_WINDOW_MS = 3 * 60 * 1000
    const now = Date.now()

    const rows = await this.prisma.terminal.findMany({
      orderBy: { registeredAt: 'desc' },
      include: {
        heartbeats: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { printerStatus: true, createdAt: true },
        },
        printTasks: {
          where: { status: { in: ['claimed', 'printing'] } },
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
      },
    })

    const printers = rows.map((t: (typeof rows)[number]): AdminPrinterView => {
      const hb = t.heartbeats[0]
      const activeTask = t.printTasks[0]
      const lastHeartbeatAt = hb?.createdAt ?? null
      const online = lastHeartbeatAt ? now - lastHeartbeatAt.getTime() < ONLINE_WINDOW_MS : false
      const printerStatus = hb?.printerStatus ?? null
      const status = toAdminPrinterStatus(online, printerStatus)

      return {
        id: `printer:${t.terminalCode}`,
        terminalId: t.id,
        terminalCode: t.terminalCode,
        name: `${t.terminalCode} 打印机`,
        model: null,
        serialNumber: null,
        status,
        printerStatus,
        currentTask: activeTask ? `${activeTask.id}（${activeTask.status}）` : null,
        tonerLevel: null,
        paperTrayLevel: null,
        paperStatus: printerStatus === 'paper_empty' ? 'empty' : null,
        fault: describePrinterFault(online, printerStatus),
        lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
        lastSyncAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
      }
    })

    return { printers }
  }

  listPrintTasks() {
    return this.prisma.printTask.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async getTerminalPrinterStatus(terminalId: string): Promise<{
    found: boolean
    printerStatus: string | null
    lastSeenAt: string | null
    isOnline: boolean
  }> {
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalId }, { terminalCode: terminalId }] },
      include: {
        heartbeats: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { printerStatus: true, createdAt: true },
        },
      },
    })
    if (!terminal) {
      return { found: false, printerStatus: null, lastSeenAt: null, isOnline: false }
    }
    const latest = terminal.heartbeats[0]
    const lastSeenAt = latest?.createdAt?.toISOString() ?? null
    const isOnline = latest ? Date.now() - latest.createdAt.getTime() < 5 * 60 * 1000 : false
    return {
      found: true,
      printerStatus: latest?.printerStatus ?? null,
      lastSeenAt,
      isOnline,
    }
  }
}
