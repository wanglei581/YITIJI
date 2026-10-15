import type { PrismaService } from '../prisma/prisma.service'

/** 在删除任务前收集无 FK 的源/派生文件引用；不删除另一会员的资产。 */
export async function discoverClosureFiles(prisma: PrismaService, id: string): Promise<string[]> {
  const rows = await prisma.fileObject.findMany({ where: { OR: [{ endUserId: id }, { ownerType: 'user', ownerId: id }] }, select: { id: true } })
  const [documents, contracts, scans, interviews, artifacts] = await Promise.all([
    prisma.documentProcessTask.findMany({ where: { endUserId: id }, select: { sourceFileId: true, resultFileId: true } }),
    prisma.contractReviewTask.findMany({ where: { endUserId: id }, select: { sourceFileId: true, resultFileId: true } }),
    prisma.scanTask.findMany({ where: { endUserId: id }, select: { fileId: true } }),
    prisma.mockInterviewSession.findMany({ where: { endUserId: id }, select: { resumeFileId: true } }),
    prisma.advisorArtifact.findMany({ where: { session: { endUserId: id } }, select: { fileId: true } }),
  ])
  const references = [...documents.flatMap((row) => [row.sourceFileId, row.resultFileId]),
    ...contracts.flatMap((row) => [row.sourceFileId, row.resultFileId]), ...scans.map((row) => row.fileId),
    ...interviews.map((row) => row.resumeFileId), ...artifacts.map((row) => row.fileId)]
    .filter((x): x is string => Boolean(x))
  const linked = await prisma.fileObject.findMany({ where: { id: { in: references },
    OR: [{ endUserId: id }, { endUserId: null, ownerId: null }] }, select: { id: true } })
  const ids = new Set([...rows, ...linked].map((row) => row.id))
  let frontier = [...ids]
  while (frontier.length) {
    const derived = await prisma.fileObject.findMany({ where: { sourceFileId: { in: frontier },
      OR: [{ endUserId: id }, { endUserId: null, ownerId: null }] }, select: { id: true } })
    frontier = derived.map((row) => row.id).filter((fileId) => !ids.has(fileId))
    frontier.forEach((fileId) => ids.add(fileId))
  }
  return [...ids]
}
