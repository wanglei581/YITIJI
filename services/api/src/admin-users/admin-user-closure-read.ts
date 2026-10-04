import type { Prisma } from '../generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import { badRequest } from '../member-privacy/member-data-request.helpers'

export async function closureFilter(prisma: PrismaService, value?: string): Promise<Prisma.EndUserWhereInput> {
  if (!value) return {}
  if (value === 'requested') return { dataRequests: { some: { requestType: 'delete', status: 'pending' } } }
  if (!['offline_executed', 'executed'].includes(value)) throw badRequest('CLOSURE_FILTER_INVALID', '注销筛选无效')
  const audits = await prisma.auditLog.findMany({ where: {
    action: 'member.closure.executed', ...(value === 'offline_executed' ? { payloadJson: { contains: '"offline":true' } } : {}),
  }, select: { targetId: true } })
  return { status: 'anonymized', id: { in: audits.flatMap((row) => row.targetId ? [row.targetId] : []) } }
}

export async function closureRequestOf(prisma: PrismaService, id: string): Promise<{ requestedAt: string; source: 'member_request' | 'offline' } | null> {
  const row = await prisma.userDataRequest.findFirst({ where: { endUserId: id, requestType: 'delete', status: { in: ['pending', 'handling', 'completed'] } }, orderBy: { requestedAt: 'desc' } })
  if (!row) return null
  if (row.status === 'pending') return { requestedAt: row.requestedAt.toISOString(), source: 'member_request' }
  if (row.status === 'handling') {
    const context = JSON.parse(row.progressJson ?? '{}') as { source?: 'member_request' | 'offline' }
    return { requestedAt: row.requestedAt.toISOString(), source: context.source ?? 'member_request' }
  }
  const audit = row.auditRef ? await prisma.auditLog.findUnique({ where: { id: row.auditRef } }) : null
  const payload = JSON.parse(audit?.payloadJson ?? '{}') as { source?: 'member_request' | 'offline' }
  return { requestedAt: row.requestedAt.toISOString(), source: payload.source ?? 'member_request' }
}
