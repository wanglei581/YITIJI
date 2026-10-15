import type { BindFileRow, MemberBindHost } from './upload-session-member-bind'

export async function recoverStorageKeys(
  host: MemberBindHost,
  now: number,
): Promise<number> {
  const where = {
    OR: [
      { pendingStorageKey: { not: null } },
      { replacedStorageKey: { not: null } },
    ],
  }
  const total = await host.prisma.fileObject.count({ where })
  const pageCount = Math.ceil(total / host.cleanupBatchLimit)
  const page = pageCount > 0 ? Math.floor(now / 60_000) % pageCount : 0
  const rows = await host.prisma.fileObject.findMany({
    where,
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    skip: page * host.cleanupBatchLimit,
    take: host.cleanupBatchLimit,
  })
  let failed = 0
  const staleBefore = now - host.sessionRedisTtlSeconds() * 1000
  for (const row of rows) {
    try {
      await recoverOneStorageKey(host, row as BindFileRow, staleBefore)
    } catch {
      failed += 1
    }
  }
  return failed
}

export async function recoverOneStorageKey(
  host: MemberBindHost,
  row: BindFileRow,
  staleBefore: number,
): Promise<void> {
  if (row.replacedStorageKey && row.replacedStorageKey !== row.storageKey) {
    await host.files.deleteObjectAtKey(row.replacedStorageKey, row.bucket)
    await host.prisma.fileObject.updateMany({
      where: { id: row.id, replacedStorageKey: row.replacedStorageKey },
      data: { replacedStorageKey: null },
    })
    return
  }
  // 行已墓碑时，pendingStorageKey 是还没切成 storageKey 的复制件。
  // 删除失败必须留下指针；不得删除行当前指向的对象。
  if (row.deletedAt && row.pendingStorageKey && row.pendingStorageKey !== row.storageKey) {
    await host.files.deleteObjectAtKey(row.pendingStorageKey, row.bucket)
    await host.prisma.fileObject.updateMany({
      where: {
        id: row.id,
        pendingStorageKey: row.pendingStorageKey,
        storageKey: row.storageKey,
      },
      data: { pendingStorageKey: null },
    })
    return
  }
  if (
    row.pendingStorageKey
    && row.pendingStorageKey !== row.storageKey
    && row.ownerType !== 'user'
    && !row.deletedAt
    && row.updatedAt
    && row.updatedAt.getTime() < staleBefore
  ) {
    const claimed = await host.prisma.fileObject.updateMany({
      where: {
        id: row.id,
        pendingStorageKey: row.pendingStorageKey,
        storageKey: row.storageKey,
        deletedAt: null,
      },
      data: { pendingStorageKey: null, replacedStorageKey: row.pendingStorageKey },
    })
    if (claimed.count !== 1) return
    await host.files.deleteObjectAtKey(row.pendingStorageKey, row.bucket)
    await host.prisma.fileObject.updateMany({
      where: { id: row.id, replacedStorageKey: row.pendingStorageKey },
      data: { replacedStorageKey: null },
    })
  }
}
