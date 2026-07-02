import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  evaluateToolboxPublishGate,
  type ToolboxAllowedHostInput,
} from './toolbox-governance'
import {
  normalizeToolboxItemsForConfig,
  withTerminalToolboxConfigMutationLock,
} from './terminal-toolbox.service'
import {
  removeProjectedToolboxItem,
  snapshotToKioskToolboxItem,
  toolboxProjectionKey,
  upsertProjectedToolboxItem,
} from './toolbox-projection'
import {
  assertComplianceCopy,
  assertHostPurpose,
  assertHostStatus,
  assertReviewer,
  assertTransition,
  asGovernanceStatus,
  badRequest,
  cleanAppKey,
  cleanText,
  isExternalUrlAllowed,
  type NormalizedToolboxSnapshot,
  normalizeHostInput,
  normalizeSnapshot,
  parseOptionalDate,
  parseSnapshot,
  parseStoredItems,
} from './toolbox-governance.helpers'
import type {
  CreateToolboxAppDto,
  CreateToolboxAppVersionDto,
  PublishToolboxAppVersionDto,
  RejectToolboxAppVersionDto,
  ReviewToolboxAllowedHostDto,
  UpsertToolboxAllowedHostDto,
} from './dto/toolbox-governance.dto'

export interface ToolboxGovernanceResult extends Record<string, unknown> {
  appKey: string
  version?: number
  status: string
  affectedTerminalCount?: number
  projectionKey?: string
}

export interface ToolboxAdminAppView {
  id: string
  appKey: string
  title: string
  category: string
  priority: string
  status: string
  riskLevel: string
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  versionCount: number
  latestVersion: number | null
  latestVersionStatus: string | null
}

export interface ToolboxAdminVersionView {
  id: string
  appId: string
  version: number
  status: string
  snapshot: NormalizedToolboxSnapshot
  submittedBy: string | null
  approvedBy: string | null
  rejectedBy: string | null
  rejectionReason: string | null
  createdAt: string
  submittedAt: string | null
  reviewedAt: string | null
  publishedAt: string | null
}

export interface ToolboxAdminAllowedHostView extends ToolboxAllowedHostInput {
  id: string
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

interface ToolboxAppRow {
  id: string
  appKey: string
  title: string
  category: string
  priority: string
  status: string
  riskLevel: string
}

interface ToolboxVersionRow {
  id: string
  appId: string
  version: number
  status: string
  snapshotJson: string
  submittedBy: string | null
  approvedBy: string | null
}

@Injectable()
export class ToolboxGovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  async listApps(): Promise<ToolboxAdminAppView[]> {
    const apps = await this.prisma.toolboxApp.findMany({
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        versions: {
          orderBy: { version: 'desc' },
          select: { version: true, status: true },
        },
      },
    })
    return apps.map((app) => {
      const latest = app.versions[0] ?? null
      return {
        id: app.id,
        appKey: app.appKey,
        title: app.title,
        category: app.category,
        priority: app.priority,
        status: app.status,
        riskLevel: app.riskLevel,
        createdBy: app.createdBy,
        updatedBy: app.updatedBy,
        createdAt: app.createdAt.toISOString(),
        updatedAt: app.updatedAt.toISOString(),
        versionCount: app.versions.length,
        latestVersion: latest?.version ?? null,
        latestVersionStatus: latest?.status ?? null,
      }
    })
  }

  async listVersions(appKey: string): Promise<ToolboxAdminVersionView[]> {
    const app = await this.findApp(appKey)
    const versions = await this.prisma.toolboxAppVersion.findMany({
      where: { appId: app.id },
      orderBy: { version: 'desc' },
    })
    return versions.map((version) => ({
      id: version.id,
      appId: version.appId,
      version: version.version,
      status: version.status,
      snapshot: parseSnapshot(version.snapshotJson),
      submittedBy: version.submittedBy,
      approvedBy: version.approvedBy,
      rejectedBy: version.rejectedBy,
      rejectionReason: version.rejectionReason,
      createdAt: version.createdAt.toISOString(),
      submittedAt: version.submittedAt?.toISOString() ?? null,
      reviewedAt: version.reviewedAt?.toISOString() ?? null,
      publishedAt: version.publishedAt?.toISOString() ?? null,
    }))
  }

  async listAllowedHostsForAdmin(): Promise<ToolboxAdminAllowedHostView[]> {
    const hosts = await this.prisma.toolboxAllowedHost.findMany({
      where: { status: { not: 'archived' } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    })
    return hosts.map((host) => ({
      id: host.id,
      host: host.host,
      purpose: assertHostPurpose(host.purpose),
      status: assertHostStatus(host.status),
      owner: host.owner,
      reason: host.reason,
      createdBy: host.createdBy,
      updatedBy: host.updatedBy,
      reviewedBy: host.reviewedBy,
      reviewedAt: host.reviewedAt?.toISOString() ?? null,
      expiresAt: host.expiresAt?.toISOString() ?? null,
      createdAt: host.createdAt.toISOString(),
      updatedAt: host.updatedAt.toISOString(),
    }))
  }

  async createApp(dto: CreateToolboxAppDto, userId: string): Promise<ToolboxGovernanceResult> {
    const appKey = cleanAppKey(dto.appKey)
    assertComplianceCopy(dto.title, dto.shortDescription)
    const app = await this.prisma.toolboxApp.create({
      data: {
        appKey,
        title: cleanText(dto.title, 32),
        category: dto.category,
        priority: dto.priority,
        status: 'draft',
        riskLevel: dto.riskLevel,
        createdBy: userId,
        updatedBy: userId,
      },
    })
    return { appKey: app.appKey, status: app.status }
  }

  async createVersion(appKey: string, dto: CreateToolboxAppVersionDto, userId: string): Promise<ToolboxGovernanceResult> {
    const app = await this.findApp(appKey)
    const snapshot = normalizeSnapshot(app.appKey, dto.snapshot)
    assertComplianceCopy(snapshot.title, snapshot.shortDescription)
    const latest = await this.prisma.toolboxAppVersion.findFirst({
      where: { appId: app.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const version = (latest?.version ?? 0) + 1
    await this.prisma.$transaction([
      this.prisma.toolboxAppVersion.create({
        data: {
          appId: app.id,
          version,
          status: 'draft',
          snapshotJson: JSON.stringify({ ...snapshot, status: 'draft' }),
        },
      }),
      this.prisma.toolboxApp.update({
        where: { id: app.id },
        data: {
          title: snapshot.title,
          category: snapshot.category,
          priority: snapshot.priority,
          status: 'draft',
          riskLevel: snapshot.riskLevel,
          updatedBy: userId,
        },
      }),
    ])
    return { appKey: app.appKey, version, status: 'draft' }
  }

  async submitVersion(appKey: string, version: number, userId: string): Promise<ToolboxGovernanceResult> {
    const { app, versionRow } = await this.findVersion(appKey, version)
    assertTransition(versionRow.status, 'submitted')
    await this.prisma.$transaction([
      this.prisma.toolboxAppVersion.update({
        where: { appId_version: { appId: app.id, version } },
        data: { status: 'submitted', submittedBy: userId, submittedAt: new Date() },
      }),
      this.prisma.toolboxApp.update({ where: { id: app.id }, data: { status: 'submitted', updatedBy: userId } }),
    ])
    return { appKey: app.appKey, version, status: 'submitted' }
  }

  async approveVersion(appKey: string, version: number, reviewerId: string): Promise<ToolboxGovernanceResult> {
    const { app, versionRow } = await this.findVersion(appKey, version)
    assertTransition(versionRow.status, 'approved')
    assertReviewer(versionRow.submittedBy, reviewerId)
    await this.prisma.$transaction([
      this.prisma.toolboxAppVersion.update({
        where: { appId_version: { appId: app.id, version } },
        data: { status: 'approved', approvedBy: reviewerId, reviewedAt: new Date() },
      }),
      this.prisma.toolboxApp.update({ where: { id: app.id }, data: { status: 'approved', updatedBy: reviewerId } }),
    ])
    return { appKey: app.appKey, version, status: 'approved' }
  }

  async rejectVersion(
    appKey: string,
    version: number,
    dto: RejectToolboxAppVersionDto,
    reviewerId: string,
  ): Promise<ToolboxGovernanceResult> {
    const { app, versionRow } = await this.findVersion(appKey, version)
    assertTransition(versionRow.status, 'rejected')
    assertReviewer(versionRow.submittedBy, reviewerId)
    const reason = cleanText(dto.reason, 200)
    await this.prisma.$transaction([
      this.prisma.toolboxAppVersion.update({
        where: { appId_version: { appId: app.id, version } },
        data: { status: 'rejected', rejectedBy: reviewerId, rejectionReason: reason, reviewedAt: new Date() },
      }),
      this.prisma.toolboxApp.update({ where: { id: app.id }, data: { status: 'rejected', updatedBy: reviewerId } }),
    ])
    return { appKey: app.appKey, version, status: 'rejected' }
  }

  async publishVersion(
    appKey: string,
    version: number,
    dto: PublishToolboxAppVersionDto,
    publisherId: string,
  ): Promise<ToolboxGovernanceResult> {
    const { app, versionRow } = await this.findVersion(appKey, version)
    assertTransition(versionRow.status, 'published')
    const snapshot = parseSnapshot(versionRow.snapshotJson)
    const allowedHosts = await this.listAllowedHosts()
    const gate = evaluateToolboxPublishGate(
      {
        id: app.appKey,
        title: snapshot.title,
        shortDescription: snapshot.shortDescription,
        status: 'approved',
        riskLevel: snapshot.riskLevel,
        permissions: snapshot.permissions,
        launch: {
          entryType: snapshot.launch.entryType,
          externalUrl: snapshot.launch.externalUrl ?? null,
          qrTargetUrl: snapshot.launch.qrTargetUrl ?? null,
          requiresHostAllowlist: snapshot.launch.requiresHostAllowlist ?? false,
        },
        dataPolicy: {
          sensitiveDataAllowed: snapshot.dataPolicy.sensitiveDataAllowed,
          requiresExplicitConsent: snapshot.dataPolicy.requiresExplicitConsent,
        },
        disclaimers: snapshot.disclaimers,
        submittedBy: versionRow.submittedBy,
        approvedBy: versionRow.approvedBy,
      },
      { allowedHosts, now: new Date(), externalUrlAllowed: isExternalUrlAllowed() },
    )
    if (!gate.allowed) {
      throw badRequest('TOOLBOX_PUBLISH_BLOCKED', `百宝箱微应用未通过发布门禁: ${gate.reason}`, { reason: gate.reason })
    }

    const projected = normalizeToolboxItemsForConfig(
      [snapshotToKioskToolboxItem(app.appKey, snapshot)],
      { strict: true },
    )[0]
    if (!projected) throw badRequest('TOOLBOX_PROJECTION_EMPTY', '百宝箱微应用投影为空')

    const targetTerminalIds = await this.resolveTargetTerminalIds(dto.terminalIds)
    await withTerminalToolboxConfigMutationLock('publishVersion', async () => this.prisma.$transaction(async (tx) => {
      await tx.toolboxAppVersion.update({
        where: { appId_version: { appId: app.id, version } },
        data: { status: 'published', publishedAt: new Date() },
      })
      await tx.toolboxApp.update({ where: { id: app.id }, data: { status: 'published', updatedBy: publisherId } })
      for (const terminalId of targetTerminalIds) {
        const existing = await tx.terminalToolboxConfig.findUnique({ where: { terminalId } })
        const existingItems = parseStoredItems(existing?.itemsJson)
        const items = upsertProjectedToolboxItem(existingItems, projected)
        await tx.terminalToolboxConfig.upsert({
          where: { terminalId },
          create: { terminalId, enabled: true, itemsJson: JSON.stringify(items), updatedBy: publisherId },
          update: { itemsJson: JSON.stringify(items), updatedBy: publisherId },
        })
      }
    }, { timeout: 30_000, maxWait: 10_000 }))

    return {
      appKey: app.appKey,
      version,
      status: 'published',
      affectedTerminalCount: targetTerminalIds.length,
      projectionKey: projected.key,
    }
  }

  async suspendApp(appKey: string, userId: string): Promise<ToolboxGovernanceResult> {
    const app = await this.findApp(appKey)
    if (asGovernanceStatus(app.status) === 'archived') {
      throw badRequest('TOOLBOX_APP_ARCHIVED', '已归档的百宝箱微应用不能熔断')
    }
    let affectedTerminalCount = 0
    // 熔断是应急 kill-switch,允许从非 published 状态直接进入 suspended。
    await withTerminalToolboxConfigMutationLock('suspendApp', async () => this.prisma.$transaction(async (tx) => {
      await tx.toolboxApp.update({ where: { id: app.id }, data: { status: 'suspended', updatedBy: userId } })
      await tx.toolboxAppVersion.updateMany({
        where: { appId: app.id, status: { in: ['approved', 'published'] } },
        data: { status: 'suspended' },
      })
      const configs = await tx.terminalToolboxConfig.findMany()
      for (const config of configs) {
        const before = parseStoredItems(config.itemsJson)
        const items = removeProjectedToolboxItem(before, app.appKey)
        if (items.length === before.length) continue
        affectedTerminalCount += 1
        await tx.terminalToolboxConfig.update({
          where: { terminalId: config.terminalId },
          data: { itemsJson: JSON.stringify(items), updatedBy: userId },
        })
      }
    }, { timeout: 30_000, maxWait: 10_000 }))
    return {
      appKey: app.appKey,
      status: 'suspended',
      affectedTerminalCount,
      projectionKey: toolboxProjectionKey(app.appKey),
    }
  }

  async upsertAllowedHost(dto: UpsertToolboxAllowedHostDto, userId: string): Promise<{ host: string; purpose: string; status: string }> {
    const host = normalizeHostInput(dto.host)
    const purpose = assertHostPurpose(dto.purpose)
    const expiresAt = parseOptionalDate(dto.expiresAt)
    const saved = await this.prisma.toolboxAllowedHost.upsert({
      where: { host_purpose: { host, purpose } },
      create: {
        host,
        purpose,
        status: 'pending_review',
        owner: cleanText(dto.owner, 80),
        reason: cleanText(dto.reason, 200),
        createdBy: userId,
        updatedBy: userId,
        reviewedBy: null,
        reviewedAt: null,
        expiresAt,
      },
      update: {
        status: 'pending_review',
        owner: cleanText(dto.owner, 80),
        reason: cleanText(dto.reason, 200),
        updatedBy: userId,
        reviewedBy: null,
        reviewedAt: null,
        expiresAt,
      },
    })
    return { host: saved.host, purpose: saved.purpose, status: saved.status }
  }

  async reviewAllowedHost(
    id: string,
    dto: ReviewToolboxAllowedHostDto,
    reviewerId: string,
  ): Promise<{ host: string; purpose: string; status: string }> {
    const host = await this.prisma.toolboxAllowedHost.findUnique({ where: { id } })
    if (!host) throw new NotFoundException({ error: { code: 'TOOLBOX_HOST_NOT_FOUND', message: '允许域名不存在' } })
    assertReviewer(host.updatedBy ?? host.createdBy, reviewerId)
    const status = assertHostStatus(dto.status)
    const saved = await this.prisma.toolboxAllowedHost.update({
      where: { id },
      data: {
        status,
        reason: dto.reason ? cleanText(dto.reason, 200) : host.reason,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        expiresAt: parseOptionalDate(dto.expiresAt) ?? host.expiresAt,
      },
    })
    return { host: saved.host, purpose: saved.purpose, status: saved.status }
  }

  private async findApp(appKey: string): Promise<ToolboxAppRow> {
    const app = await this.prisma.toolboxApp.findUnique({ where: { appKey: cleanAppKey(appKey) } })
    if (!app) throw new NotFoundException({ error: { code: 'TOOLBOX_APP_NOT_FOUND', message: '百宝箱微应用不存在' } })
    return app
  }

  private async findVersion(appKey: string, version: number): Promise<{ app: ToolboxAppRow; versionRow: ToolboxVersionRow }> {
    const app = await this.findApp(appKey)
    const versionRow = await this.prisma.toolboxAppVersion.findUnique({
      where: { appId_version: { appId: app.id, version } },
    })
    if (!versionRow) throw new NotFoundException({ error: { code: 'TOOLBOX_VERSION_NOT_FOUND', message: '百宝箱微应用版本不存在' } })
    return { app, versionRow }
  }

  private async listAllowedHosts(): Promise<ToolboxAllowedHostInput[]> {
    const hosts = await this.prisma.toolboxAllowedHost.findMany({ where: { status: { not: 'archived' } } })
    return hosts.map((host) => ({
      host: host.host,
      purpose: assertHostPurpose(host.purpose),
      status: assertHostStatus(host.status),
      owner: host.owner,
      reason: host.reason,
      reviewedBy: host.reviewedBy,
      reviewedAt: host.reviewedAt?.toISOString() ?? null,
      expiresAt: host.expiresAt?.toISOString() ?? null,
    }))
  }

  private async resolveTargetTerminalIds(input: readonly string[] | undefined): Promise<string[]> {
    if (input && input.length > 0) {
      const requested = [...new Set(input.map((item) => cleanText(item, 128)).filter(Boolean))]
      const terminals = await this.prisma.terminal.findMany({
        where: { OR: [{ id: { in: requested } }, { terminalCode: { in: requested } }] },
        select: { id: true, terminalCode: true },
      })
      const resolved = new Map<string, string>()
      for (const terminal of terminals) {
        resolved.set(terminal.id, terminal.terminalCode)
        resolved.set(terminal.terminalCode, terminal.terminalCode)
      }
      const missing = requested.filter((terminalId) => !resolved.has(terminalId))
      if (missing.length > 0) {
        throw badRequest('TOOLBOX_TERMINAL_NOT_FOUND', `发布目标终端不存在: ${missing.slice(0, 5).join(', ')}`)
      }
      return [...new Set(requested.map((terminalId) => resolved.get(terminalId)!))]
    }
    const terminals = await this.prisma.terminal.findMany({
      where: { enabled: true },
      select: { terminalCode: true },
      orderBy: { registeredAt: 'desc' },
    })
    return [...new Set(terminals.map((terminal) => terminal.terminalCode))]
  }
}
