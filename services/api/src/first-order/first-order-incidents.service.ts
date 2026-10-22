import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import type { FirstOrderIncident, FirstOrderIncidentInput, FirstOrderIncidentUpdate, FirstOrderIncidentStatus, FirstOrderIssue } from '../../../../packages/shared/src/types/firstOrder.contract'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { PrismaService } from '../prisma/prisma.service'
import { FirstOrderAccessService, firstOrderMissing, firstOrderOrg } from './first-order-access.service'
import type { ServiceIncident, ServiceIncidentEvent } from '../generated/prisma/client'

const eventsInclude = { events: { orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }], take: 51 } }
type IncidentRow = ServiceIncident & { events: ServiceIncidentEvent[] }

function incidentView(row: IncidentRow): FirstOrderIncident {
  return {
    id: row.id, projectId: row.projectId, deploymentId: row.deploymentId, terminalCode: row.terminalCode,
    issueCode: row.issueCode as FirstOrderIssue, note: row.note, status: row.status as FirstOrderIncidentStatus,
    assignee: row.assignee, resolution: row.resolution, version: row.version,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null, closedAt: row.closedAt?.toISOString() ?? null,
    events: row.events.slice(0, 50).reverse().map((e) => ({ action: e.action, note: e.note,
      actorRole: e.actorRole as 'admin' | 'partner', createdAt: e.createdAt.toISOString() })),
    historyTruncated: row.events.length > 50,
  }
}
function conflict(message: string): never {
  throw new ConflictException({ error: { code: 'FIRST_ORDER_INCIDENT_CONFLICT', message } })
}
function required(text: string | undefined): string {
  if (!text?.trim()) throw new BadRequestException({ error: { code: 'FIRST_ORDER_INCIDENT_NOTE_REQUIRED', message: '请填写负责人或处理说明，不要包含群众个人材料' } })
  return text.trim()
}

@Injectable()
export class FirstOrderIncidentsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly access: FirstOrderAccessService) {}

  async list(user: AuthedUser, requestedOrg: string): Promise<FirstOrderIncident[]> {
    const orgId = firstOrderOrg(user, requestedOrg)
    const rows = await this.prisma.serviceIncident.findMany({ where: { orgId }, include: eventsInclude, orderBy: { createdAt: 'desc' }, take: 201 })
    if (rows.length > 200) throw new BadRequestException({ error: { code: 'FIRST_ORDER_LIMIT', message: '工单数量超出首单视图范围，请联系平台分批核对' } })
    return rows.map(incidentView)
  }

  async create(user: AuthedUser, input: FirstOrderIncidentInput): Promise<FirstOrderIncident> {
    const deployment = await this.access.deployment(user, input.deploymentId)
    const note = input.note.trim()
    const key = { orgId_requestKey: { orgId: deployment.orgId, requestKey: input.requestKey } }
    const replay = async () => {
      const row = await this.prisma.serviceIncident.findUnique({ where: key, include: eventsInclude })
      if (!row) return null
      if (row.deploymentId !== input.deploymentId || row.issueCode !== input.issueCode || row.note !== note) {
        return conflict('同一次报障标识已用于其他内容，请刷新后重新报障')
      }
      return incidentView(row)
    }
    const previous = await replay()
    if (previous) return previous
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        // Same terminal lock order as deployment creation and reassignment.
        const locked = await tx.terminal.updateMany({ where: { id: deployment.terminalId, orgId: deployment.orgId, enabled: true }, data: { orgId: deployment.orgId } })
        const current = await tx.serviceDeployment.findUnique({ where: { id: deployment.id }, include: { project: true } })
        const now = new Date()
        if (!locked.count || !current || current.endedAt || !current.activeTerminalId ||
            now < current.project.serviceStartAt || now >= current.project.serviceEndAt) {
          return conflict('该设备登记已结束、归属已变更或不在服务期内，请刷新并联系平台')
        }
        const row = await tx.serviceIncident.create({ data: {
          orgId: current.orgId, projectId: current.projectId, deploymentId: current.id,
          terminalCode: current.terminalCode, issueCode: input.issueCode, note, requestKey: input.requestKey,
          events: { create: { action: 'create', note, actorRole: user.role } },
        } })
        await this.audit.writeRequired(tx, { actorId: user.userId, actorRole: user.role,
          action: 'first_order.incident_created', targetType: 'service_incident', targetId: row.id,
          payload: { deploymentId: current.id, issueCode: input.issueCode } })
        return row.id
      })
      return this.get(user, id)
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const winner = await replay()
        if (winner) return winner
      }
      throw error
    }
  }

  private async get(user: AuthedUser, id: string) {
    const row = await this.prisma.serviceIncident.findFirst({
      where: { id, ...(user.role === 'admin' ? {} : { orgId: firstOrderOrg(user) }) }, include: eventsInclude,
    })
    if (!row) return firstOrderMissing()
    return incidentView(row)
  }

  async update(user: AuthedUser, id: string, input: FirstOrderIncidentUpdate): Promise<FirstOrderIncident> {
    const old = await this.get(user, id)
    const isAdmin = user.role === 'admin'
    if ((input.action === 'confirm' && isAdmin) || (!isAdmin && (input.action === 'start' || input.action === 'resolve'))) {
      throw new ForbiddenException({ error: { code: 'FIRST_ORDER_INCIDENT_ACTION_FORBIDDEN', message: '当前账号不能执行该工单操作' } })
    }
    const now = new Date(), note = input.note.trim()
    let data: { status: string; assignee?: string | null; resolution?: string | null; resolvedAt?: Date | null; closedAt?: Date | null }
    if (input.action === 'start' && ['open', 'processing'].includes(old.status)) {
      data = { status: 'processing', assignee: required(input.assignee) }
    } else if (input.action === 'resolve' && old.status === 'processing') {
      data = { status: 'resolved', resolution: required(note), resolvedAt: now }
    } else if (input.action === 'confirm' && old.status === 'resolved') {
      data = { status: 'closed', closedAt: now }
    } else if (input.action === 'reopen' && ['resolved', 'closed'].includes(old.status)) {
      required(note)
      data = { status: 'open', assignee: null, resolution: null, resolvedAt: null, closedAt: null }
    } else return conflict('工单状态不允许此操作，请刷新后核对')
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.serviceIncident.updateMany({
        where: { id, version: input.version, status: old.status, ...(isAdmin ? {} : { orgId: firstOrderOrg(user) }) },
        data: { ...data, version: { increment: 1 } },
      })
      if (changed.count !== 1) return conflict('工单已被其他人更新，请刷新后重试')
      await tx.serviceIncidentEvent.create({ data: { incidentId: id, action: input.action, note, actorRole: user.role } })
      await this.audit.writeRequired(tx, { actorId: user.userId, actorRole: user.role,
        action: `first_order.incident_${input.action}`, targetType: 'service_incident', targetId: id,
        payload: { version: input.version, status: data.status } })
    })
    return this.get(user, id)
  }
}
