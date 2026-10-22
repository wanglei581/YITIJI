import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import type { FirstOrderOverview, FirstOrderProjectInput } from '../../../../packages/shared/src/types/firstOrder.contract'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { PrismaService } from '../prisma/prisma.service'
import { FirstOrderAccessService, firstOrderMissing, firstOrderOrg } from './first-order-access.service'
import { FirstOrderIncidentsService } from './first-order-incidents.service'
import { deploymentView, projectView, reportView } from './first-order-mappers'
import { TERMINAL_ONLINE_WINDOW_MS } from '../terminals/printer-availability'

function conflict(message: string): never {
  throw new ConflictException({ error: { code: 'FIRST_ORDER_CONFLICT', message } })
}

function projectData(input: FirstOrderProjectInput) {
  const name = input.name.trim(), reference = input.reference.trim()
  const serviceScope = input.serviceScope.trim(), supportContact = input.supportContact.trim()
  const serviceStartAt = new Date(input.serviceStartAt), serviceEndAt = new Date(input.serviceEndAt)
  if (!name || !reference || !serviceScope || !supportContact ||
      !Number.isFinite(serviceStartAt.getTime()) || !Number.isFinite(serviceEndAt.getTime()) || serviceEndAt <= serviceStartAt) {
    throw new BadRequestException({ error: { code: 'FIRST_ORDER_INVALID_PROJECT', message: '请填写完整项目资料，服务结束时间须晚于开始时间' } })
  }
  return { name, reference, serviceScope, supportContact, serviceStartAt, serviceEndAt }
}

@Injectable()
export class FirstOrderProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: FirstOrderAccessService,
    private readonly incidents: FirstOrderIncidentsService,
  ) {}

  async overview(user: AuthedUser, requestedOrg?: string): Promise<FirstOrderOverview> {
    const orgId = firstOrderOrg(user, requestedOrg)
    const [projects, terminals, incidents, reports] = await Promise.all([
      this.prisma.serviceProject.findMany({ where: { orgId }, include: { deployments: true }, orderBy: { createdAt: 'desc' }, take: 201 }),
      this.prisma.terminal.findMany({ where: { orgId }, select: {
        id: true, terminalCode: true, displayName: true, locationLabel: true, lastHeartbeatAt: true, enabled: true, lifecycleStatus: true,
        heartbeats: { orderBy: { createdAt: 'desc' }, take: 1, select: { printerStatus: true } },
      }, take: 201 }),
      this.incidents.list(user, orgId),
      this.prisma.serviceReport.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 201 }),
    ])
    if (projects.length > 200 || terminals.length > 200 || reports.length > 200) {
      throw new BadRequestException({ error: { code: 'FIRST_ORDER_LIMIT', message: '资料数量超出首单视图范围，请联系平台分批核对，不显示不完整结果' } })
    }
    return {
      projects: projects.map(projectView), incidents, reports: reports.map(reportView),
      terminals: terminals.map((t) => ({
        id: t.id, terminalCode: t.terminalCode, displayName: t.displayName, locationLabel: t.locationLabel,
        lastHeartbeatAt: t.lastHeartbeatAt?.toISOString() ?? null,
        online: t.enabled && t.lifecycleStatus === 'active' && !!t.lastHeartbeatAt && Date.now() - t.lastHeartbeatAt.getTime() < TERMINAL_ONLINE_WINDOW_MS,
        printerStatus: t.heartbeats[0]?.printerStatus ?? null,
      })),
    }
  }

  async create(user: AuthedUser, orgId: string, input: FirstOrderProjectInput) {
    const data = projectData(input)
    const org = await this.prisma.organization.findFirst({ where: { id: orgId, enabled: true, archivedAt: null } })
    if (!org) return firstOrderMissing()
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.serviceProject.create({ data: { ...data, orgId } })
        await this.audit.writeRequired(tx, { actorId: user.userId, actorRole: user.role,
          action: 'first_order.project_created', targetType: 'service_project', targetId: created.id, payload: { orgId } })
        return created
      })
      return projectView({ ...row, deployments: [] })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return conflict('该机构已有相同项目编号，请刷新后核对')
      throw error
    }
  }

  async update(user: AuthedUser, id: string, input: FirstOrderProjectInput, version: number) {
    await this.access.project(user, id)
    const data = projectData(input)
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.serviceProject.update({ where: { id }, data: { id } })
        const current = await tx.serviceProject.findUniqueOrThrow({ where: { id }, include: { deployments: { take: 1, select: { id: true } } } })
        if (current.deployments.length && (data.serviceStartAt.getTime() !== current.serviceStartAt.getTime() || data.serviceEndAt.getTime() !== current.serviceEndAt.getTime())) {
          throw new ConflictException({ error: { code: 'FIRST_ORDER_PROJECT_DATES_LOCKED', message: '已有设备登记，服务日期不可追溯修改；续期请新建项目，历史数据保持原归属' } })
        }
        const updated = await tx.serviceProject.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } })
        if (updated.count !== 1) return conflict('项目已被其他人更新，请刷新后重试')
        await this.audit.writeRequired(tx, { actorId: user.userId, actorRole: user.role,
          action: 'first_order.project_updated', targetType: 'service_project', targetId: id, payload: { version } })
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return conflict('项目编号已存在，请更换后重试')
      throw error
    }
    return projectView(await this.access.project(user, id))
  }

  async deploy(user: AuthedUser, projectId: string, terminalId: string, location: string) {
    const project = await this.access.project(user, projectId)
    const locationLabel = location.trim()
    if (!locationLabel) {
      throw new BadRequestException({ error: { code: 'FIRST_ORDER_DEPLOYMENT_INVALID', message: '请填写点位；只能在约定服务期内登记设备' } })
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Lock the same terminal row used by reassignment, before reading its binding.
        const locked = await tx.terminal.updateMany({ where: { id: terminalId, orgId: project.orgId, enabled: true }, data: { orgId: project.orgId } })
        if (locked.count !== 1) return firstOrderMissing()
        const terminal = await tx.terminal.findUniqueOrThrow({ where: { id: terminalId } })
        const latest = await tx.serviceDeployment.findFirst({ where: { terminalId, endedAt: { not: null } }, orderBy: { endedAt: 'desc' }, select: { endedAt: true } })
        await tx.serviceProject.update({ where: { id: projectId }, data: { id: projectId } })
        const currentProject = await tx.serviceProject.findUniqueOrThrow({ where: { id: projectId } })
        const now = new Date(Math.max(Date.now(), latest?.endedAt?.getTime() ?? 0, terminal.orgBoundAt?.getTime() ?? 0))
        if (now < currentProject.serviceStartAt || now >= currentProject.serviceEndAt) {
          throw new BadRequestException({ error: { code: 'FIRST_ORDER_DEPLOYMENT_INVALID', message: '当前时间不在约定服务期内，不能登记设备' } })
        }
        const created = await tx.serviceDeployment.create({ data: {
          projectId, orgId: project.orgId, terminalId, activeTerminalId: terminalId,
          terminalCode: terminal.terminalCode, locationLabel, startedAt: now,
        } })
        await this.audit.writeRequired(tx, { actorId: user.userId, actorRole: user.role,
          action: 'first_order.deployment_created', targetType: 'service_deployment', targetId: created.id, payload: { projectId, terminalId } })
        return created
      })
      return deploymentView(row)
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return conflict('该终端已有有效项目登记，请先结束旧登记')
      throw error
    }
  }

  async endDeployment(user: AuthedUser, id: string) {
    const deployment = await this.access.deployment(user, id)
    if (deployment.endedAt) return deploymentView(deployment)
    await this.prisma.$transaction(async (tx) => {
      await tx.terminal.update({ where: { id: deployment.terminalId }, data: { id: deployment.terminalId } })
      const current = await tx.serviceDeployment.findUniqueOrThrow({ where: { id } })
      if (current.endedAt) return
      const now = new Date(Math.max(Date.now(), current.startedAt.getTime()))
      const updated = await tx.serviceDeployment.updateMany({ where: { id, endedAt: null }, data: { endedAt: now, activeTerminalId: null } })
      if (updated.count === 0) return
      await this.audit.writeRequired(tx, { actorId: user.userId, actorRole: user.role,
        action: 'first_order.deployment_ended', targetType: 'service_deployment', targetId: id })
    })
    return deploymentView(await this.access.deployment(user, id))
  }
}
