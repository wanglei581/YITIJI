// ============================================================
// TerminalAdminService — Admin 管理端
//
// 职责：listTerminalsForAdmin, listOrganizationOptions,
//        assignTerminalOrg, updateTerminalProfile,
//        getKioskTerminalConfig, listPrintersForAdmin,
//        listPrintTasks, getTerminalPrinterStatus。
// Agent 生命周期见 TerminalAgentService。
// ============================================================

import crypto from 'crypto'
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
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
  PLANNED_CREDENTIAL_PREFIX,
  isUniqueConstraintError,
  normalizeLifecycleStatus,
  CREDENTIAL_SENTINEL_PREFIX,
  type TerminalLifecycleStatus,
} from './terminal-utils'
import type { CreatePlannedTerminalDto } from './dto/create-planned-terminal.dto'
import { DEFAULT_SMART_CAMPUS_MODULES } from '../smart-campus/smart-campus.types'

// ── Admin view types ───────────────────────────────────────────────────────────

export interface AdminTerminalView {
  id: string
  terminalCode: string
  displayName: string | null
  macAddress: string | null
  locationLabel: string | null
  enabled: boolean
  lifecycleStatus: TerminalLifecycleStatus
  lifecycleVersion: number
  credentialGeneration: number
  hasActiveCredential: boolean
  orgId: string | null
  orgName: string | null
  registeredAt: string
  lastSeenAt: string
  online: boolean
  lastHeartbeatAt: string | null
  agentStatus: string | null
  localTaskDatabaseAvailable: boolean | null
  printerStatus: string | null
  wiredNetworkStatus: string | null
  printerNetworkStatus: string | null
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

export interface PlannedTerminalCreated {
  terminalId: string
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  orgId: string | null
  orgName: string | null
  enabled: boolean
  lifecycleStatus: 'planned'
}

export interface UpdateTerminalLifecycleResult {
  terminalId: string
  terminalCode: string
  oldStatus: TerminalLifecycleStatus
  newStatus: 'active' | 'maintenance' | 'suspended' | 'retired'
  inFlightTaskCount: number
  activeScanTaskCount: number
  revokedCredentialCount: number
  revokedBindCodeCount: number
  lifecycleVersion: number
}

const ALLOWED_LIFECYCLE_TRANSITIONS: Record<TerminalLifecycleStatus, readonly TerminalLifecycleStatus[]> = {
  planned: [],
  commissioning: ['suspended', 'retired'],
  active: ['maintenance', 'suspended'],
  maintenance: ['active', 'suspended', 'retired'],
  suspended: ['maintenance', 'retired'],
  retired: [],
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

  async createPlannedTerminal(dto: CreatePlannedTerminalDto): Promise<PlannedTerminalCreated> {
    if (process.env['TERMINAL_PLANNED_PROVISIONING_ENABLED'] !== 'true') {
      throw new ForbiddenException({
        error: {
          code: 'TERMINAL_PLANNED_PROVISIONING_DISABLED',
          message: 'planned 设备预创建尚未启用；请先完成所有 API 实例升级并关闭旧注册',
        },
      })
    }
    const terminalCode = dto.terminalCode.trim()
    const orgId = dto.orgId?.trim() || null
    let orgName: string | null = null
    if (orgId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { name: true, enabled: true },
      })
      if (!org) {
        throw new NotFoundException({ error: { code: 'ORG_NOT_FOUND', message: '机构不存在' } })
      }
      if (!org.enabled) {
        throw new BadRequestException({ error: { code: 'ORG_DISABLED', message: '机构已停用，不能预创建设备' } })
      }
      orgName = org.name
    }

    const placeholder = `${PLANNED_CREDENTIAL_PREFIX}${crypto.randomBytes(32).toString('hex')}`
    try {
      const terminal = await this.prisma.terminal.create({
        data: {
          id: `t_${crypto.randomBytes(8).toString('hex')}`,
          terminalCode,
          agentToken: placeholder,
          credentialGeneration: 0,
          lifecycleStatus: 'planned',
          deviceFingerprint: `planned:${crypto.randomBytes(16).toString('hex')}`,
          displayName: cleanNullable(dto.displayName),
          locationLabel: cleanNullable(dto.locationLabel),
          orgId,
        },
      })
      return {
        terminalId: terminal.id,
        terminalCode: terminal.terminalCode,
        displayName: terminal.displayName ?? null,
        locationLabel: terminal.locationLabel ?? null,
        orgId: terminal.orgId,
        orgName,
        enabled: terminal.enabled,
        lifecycleStatus: 'planned',
      }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException({
          error: { code: 'TERMINAL_CODE_ALREADY_EXISTS', message: '终端编号已存在' },
        })
      }
      throw error
    }
  }

  async listTerminalsForAdmin(): Promise<{ terminals: AdminTerminalView[] }> {
    const ONLINE_WINDOW_MS = 3 * 60 * 1000
    const now = Date.now()

    const rows = await this.prisma.terminal.findMany({
      orderBy: { registeredAt: 'desc' },
      include: {
        org: { select: { id: true, name: true } },
        credentials: {
          where: { revokedAt: null, expiresAt: { gt: new Date(now) } },
          take: 1,
          select: { id: true },
        },
        heartbeats: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            status: true,
            printerStatus: true,
            wiredNetworkStatus: true,
            printerNetworkStatus: true,
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
        lifecycleStatus: normalizeLifecycleStatus(t.lifecycleStatus),
        lifecycleVersion: t.lifecycleVersion,
        credentialGeneration: t.credentialGeneration,
        hasActiveCredential: t.credentials.length > 0,
        orgId: t.orgId,
        orgName: t.org?.name ?? null,
        registeredAt: t.registeredAt.toISOString(),
        lastSeenAt: lastSeen.toISOString(),
        online: !!lastHeartbeatAt && now - lastSeen.getTime() < ONLINE_WINDOW_MS,
        lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
        agentStatus: hb?.status ?? null,
        localTaskDatabaseAvailable: hb?.localTaskDatabaseAvailable ?? null,
        printerStatus: hb?.printerStatus ?? null,
        wiredNetworkStatus: hb?.wiredNetworkStatus ?? null,
        printerNetworkStatus: hb?.printerNetworkStatus ?? null,
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
      select: { id: true, terminalCode: true, lifecycleStatus: true },
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
    if (dto.enabled === true && normalizeLifecycleStatus(terminal.lifecycleStatus) === 'retired') {
      throw new BadRequestException({
        error: { code: 'TERMINAL_RETIRED', message: '终端已永久退役，不能重新启用' },
      })
    }
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

  async updateTerminalLifecycle(
    terminalRef: string,
    lifecycleStatus: 'active' | 'maintenance' | 'suspended' | 'retired',
    auditContext: {
      actorId: string
      actorRole: string
      reason: string
      ipAddress?: string | null
      userAgent?: string | null
      requestId?: string | null
      confirmationText?: string
    },
    expected: {
      expectedStatus: Exclude<TerminalLifecycleStatus, 'retired'>
      expectedVersion: number
    },
  ): Promise<UpdateTerminalLifecycleResult> {
    const normalizedReason = auditContext.reason.trim()
    if (normalizedReason.length < 8 || normalizedReason.length > 500) {
      throw new BadRequestException({
        error: { code: 'LIFECYCLE_REASON_INVALID', message: '运维原因须为 8–500 个有效字符' },
      })
    }
    return this.prisma.$transaction(async (tx) => {
      const terminal = await tx.terminal.findFirst({
        where: this.agent.terminalRefWhere(terminalRef),
        select: { id: true, terminalCode: true, lifecycleStatus: true, lifecycleVersion: true },
      })
      if (!terminal) {
        throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
      }
      const currentStatus = normalizeLifecycleStatus(terminal.lifecycleStatus)
      if (currentStatus === 'retired') {
        throw new BadRequestException({
          error: {
            code: 'TERMINAL_RETIRED',
            message: '终端已退役，生命周期不可恢复',
          },
        })
      }
      if (
        currentStatus !== expected.expectedStatus || terminal.lifecycleVersion !== expected.expectedVersion
      ) {
        throw new ConflictException({
          error: { code: 'TERMINAL_LIFECYCLE_CONFLICT', message: '终端运维状态或版本已变化，请刷新后重试' },
        })
      }
      if (lifecycleStatus === 'retired' && auditContext.confirmationText !== terminal.terminalCode) {
        throw new BadRequestException({
          error: { code: 'TERMINAL_RETIRE_CONFIRMATION_INVALID', message: '请输入完整终端编号确认永久退役' },
        })
      }
      if (currentStatus === lifecycleStatus) {
        const inFlightTaskCount = await tx.printTask.count({
          where: { terminalId: terminal.id, status: { in: ['claimed', 'printing'] } },
        })
        const activeScanTaskCount = await tx.scanTask.count({
          where: { terminalId: terminal.id, status: { in: ['waiting', 'matched'] } },
        })
        return {
          terminalId: terminal.id,
          terminalCode: terminal.terminalCode,
          oldStatus: lifecycleStatus,
          newStatus: lifecycleStatus,
          inFlightTaskCount,
          activeScanTaskCount,
          revokedCredentialCount: 0,
          revokedBindCodeCount: 0,
          lifecycleVersion: terminal.lifecycleVersion,
        }
      }

      if (!ALLOWED_LIFECYCLE_TRANSITIONS[currentStatus].includes(lifecycleStatus)) {
        throw new BadRequestException({
          error: {
            code: 'TERMINAL_LIFECYCLE_TRANSITION_INVALID',
            message: `终端当前状态 ${currentStatus} 不允许进入 ${lifecycleStatus}`,
          },
        })
      }

      // 两个方向均先取得与建单/claim 相同的 no-op CAS 行锁。
      const lifecycleLock = await tx.terminal.updateMany({
        where: {
          id: terminal.id,
          lifecycleStatus: currentStatus,
          lifecycleVersion: terminal.lifecycleVersion,
        },
        data: { lifecycleStatus: terminal.lifecycleStatus },
      })
      if (lifecycleLock.count !== 1) {
        throw new ConflictException({
          error: { code: 'TERMINAL_LIFECYCLE_CONFLICT', message: '终端运维状态已变化，请刷新后重试' },
        })
      }
      const inFlightTaskCount = await tx.printTask.count({
        where: { terminalId: terminal.id, status: { in: ['claimed', 'printing'] } },
      })
      const activeScanTaskCount = await tx.scanTask.count({
        where: { terminalId: terminal.id, status: { in: ['waiting', 'matched'] } },
      })
      if (currentStatus === 'maintenance' && lifecycleStatus === 'active' && inFlightTaskCount > 0) {
        throw new BadRequestException({
          error: { code: 'TERMINAL_IN_FLIGHT_TASKS', message: '终端仍有在途任务，排空前不能恢复 active' },
        })
      }
      if (lifecycleStatus === 'retired') {
        const nonTerminalPrintTaskCount = await tx.printTask.count({
          where: { terminalId: terminal.id, status: { in: ['pending', 'claimed', 'printing'] } },
        })
        if (nonTerminalPrintTaskCount > 0 || activeScanTaskCount > 0) {
          throw new BadRequestException({
            error: {
              code: 'TERMINAL_ACTIVE_TASKS',
              message: '终端仍有未终结打印或扫描任务，不能退役',
            },
          })
        }
      }
      const now = new Date()
      let revokedCredentialCount = 0
      // 先在已持有 Terminal 行锁的同一事务内撤销身份材料，再进入 retired。
      // 数据库 entry guard 会验证不存在有效凭证/未使用绑定码；子表 retired guard
      // 则使进入 retired 后的身份材料永久不可改写。
      if (lifecycleStatus === 'retired') {
        const revokedCredentials = await tx.terminalCredential.updateMany({
          where: { terminalId: terminal.id, revokedAt: null },
          data: { revokedAt: now },
        })
        revokedCredentialCount = revokedCredentials.count
      }
      const revokedBindCodes = await tx.terminalBindCode.updateMany({
        where: { terminalId: terminal.id, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      })
      const updated = await tx.terminal.updateMany({
        where: {
          id: terminal.id,
          lifecycleStatus: currentStatus,
          lifecycleVersion: terminal.lifecycleVersion,
        },
        data: {
          lifecycleStatus,
          lifecycleVersion: { increment: 1 },
          ...(lifecycleStatus === 'retired'
            ? {
                enabled: false,
                credentialGeneration: { increment: 1 },
                agentToken: `${CREDENTIAL_SENTINEL_PREFIX}retired$${crypto.randomBytes(32).toString('hex')}`,
              }
            : {}),
        },
      })
      if (updated.count !== 1) {
        throw new ConflictException({
          error: { code: 'TERMINAL_LIFECYCLE_CONFLICT', message: '终端运维状态已变化，请刷新后重试' },
        })
      }
      // 每次维护轮次切换都撤销未使用绑定码，防止旧 maintenance 轮次的换机码在 ABA 后复活。
      const result: UpdateTerminalLifecycleResult = {
        terminalId: terminal.id,
        terminalCode: terminal.terminalCode,
        oldStatus: currentStatus,
        newStatus: lifecycleStatus,
        inFlightTaskCount,
        activeScanTaskCount,
        revokedCredentialCount,
        revokedBindCodeCount: revokedBindCodes.count,
        lifecycleVersion: terminal.lifecycleVersion + 1,
      }
      await tx.auditLog.create({
        data: {
          actorId: auditContext.actorId,
          actorRole: auditContext.actorRole,
          action: 'terminal.lifecycle.update',
          targetType: 'terminal',
          targetId: terminal.terminalCode,
          payloadJson: JSON.stringify({
            terminalCode: terminal.terminalCode,
            oldStatus: currentStatus,
            newStatus: lifecycleStatus,
            inFlightTaskCount,
            activeScanTaskCount,
            oldLifecycleVersion: terminal.lifecycleVersion,
            newLifecycleVersion: terminal.lifecycleVersion + 1,
            revokedBindCodeCount: revokedBindCodes.count,
            revokedCredentialCount,
            reason: normalizedReason,
          }),
          ipAddress: auditContext.ipAddress ?? null,
          userAgent: auditContext.userAgent ?? null,
          requestId: auditContext.requestId ?? null,
        },
      })
      return result
    })
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
  // ── C 端：公开终端列表（小程序「选择门店」用）──────────────────────────
  // GET /api/v1/terminals/public  — 无需鉴权，返回上线状态与位置信息
  async listPublic(): Promise<PublicTerminalView[]> {
    const ONLINE_MS = 5 * 60 * 1000
    const rows = await this.prisma.terminal.findMany({
      where: { enabled: true, lifecycleStatus: 'active' },
      select: { id: true, displayName: true, locationLabel: true, lastSeenAt: true },
      orderBy: { lastSeenAt: 'desc' },
      take: 30,
    })
    const now = Date.now()
    return rows.map(t => ({
      id:            t.id,
      displayName:   t.displayName ?? '服务终端',
      locationLabel: t.locationLabel ?? '位置待配置',
      isOnline:      now - t.lastSeenAt.getTime() < ONLINE_MS,
      lastSeenAt:    t.lastSeenAt.toISOString(),
    }))
  }

}
