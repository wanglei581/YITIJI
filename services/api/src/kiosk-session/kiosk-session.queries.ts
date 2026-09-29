import type { PrismaService } from '../prisma/prisma.service'

/**
 * 本机构的终端是否已经开始上报会话。一体机上报挂钩上线之前一条都没有，
 * 这时服务人次应显示「暂无」而不是 0（0 会被读成「没人来」）。
 */
export async function hasKioskVisitsForOrg(
  prisma: Pick<PrismaService, 'kioskSession'>,
  orgId: string,
): Promise<boolean> {
  if (!orgId) return false
  const row = await prisma.kioskSession.findFirst({ where: { orgId }, select: { id: true } })
  return row !== null
}

/**
 * 服务人次：窗口内本机构终端的会话数（按台）。
 * 只算机构快照为本机构、且终端当前仍属本机构的会话（terminalIds 由调用方按当前归属给出），
 * 终端改绑后，前一个机构的历史不会算到新机构头上，反之亦然。
 */
export async function countKioskVisitsByTerminal(
  prisma: Pick<PrismaService, 'kioskSession'>,
  params: { orgId: string; terminalIds: string[]; from: Date; to: Date },
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!params.orgId || params.terminalIds.length === 0) return counts
  const rows = await prisma.kioskSession.groupBy({
    by: ['terminalId'],
    where: {
      orgId: params.orgId,
      terminalId: { in: params.terminalIds },
      startedAt: { gte: params.from, lt: params.to },
    },
    _count: { _all: true },
  })
  for (const row of rows) {
    if (row.terminalId) counts.set(row.terminalId, row._count._all)
  }
  return counts
}
