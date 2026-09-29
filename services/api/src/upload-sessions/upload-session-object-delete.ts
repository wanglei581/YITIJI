import type { BindFileRow, MemberBindHost } from './upload-session-member-bind'

function isLiveMember(file: Pick<BindFileRow, 'deletedAt' | 'ownerType' | 'endUserId'>): boolean {
  return !file.deletedAt && (file.ownerType === 'user' || Boolean(file.endUserId))
}

async function loadBindFile(host: MemberBindHost, fileId: string): Promise<BindFileRow | null> {
  const row = await host.prisma.fileObject.findUnique({ where: { id: fileId } })
  return row as BindFileRow | null
}

/**
 * 对象删除失败只记账，不把文件行标成已删。
 * storageDeletePendingAt 的含义是「删这一行的 storageKey」。
 * 删 replacedStorageKey 失败不得调用这里，否则对账会删掉已经换成会员键的有效对象。
 * quarantine 只用于仍是匿名行的失败：对账删掉对象后只给 quarantined 行补墓碑。
 */
export async function noteObjectDeleteFailure(
  host: MemberBindHost,
  row: BindFileRow,
  error: unknown,
  options?: { quarantine?: boolean },
): Promise<void> {
  const errorType = error instanceof Error ? error.name : 'Error'
  const attempts = (row as BindFileRow & { storageDeleteAttempts?: number | null }).storageDeleteAttempts
  await host.prisma.fileObject.updateMany({
    where: {
      id: row.id,
      storageKey: row.storageKey,
      deletedAt: null,
      ...(options?.quarantine ? { endUserId: null, ownerType: { not: 'user' } } : {}),
    },
    data: {
      storageDeletePendingAt: new Date(),
      storageDeleteAttempts: (attempts ?? 0) + 1,
      storageDeleteError: errorType.slice(0, 80),
      ...(options?.quarantine ? { status: 'quarantined' } : {}),
    },
  })
}

/** 删匿名旧键。失败时保留 replacedStorageKey，交给 recoverStorageKeys，不写本行删除账。 */
export async function releaseReplacedObject(host: MemberBindHost, file: BindFileRow): Promise<void> {
  if (!file.replacedStorageKey || file.replacedStorageKey === file.storageKey) return
  await host.files.deleteObjectAtKey(file.replacedStorageKey, file.bucket)
  await host.prisma.fileObject.updateMany({
    where: { id: file.id, storageKey: file.storageKey, replacedStorageKey: file.replacedStorageKey },
    data: { replacedStorageKey: null },
  })
}

/** 先删对象，成功后才墓碑。删失败时把匿名行隔离并留下可重试账本。 */
export async function deleteAnonymousObjectThenTombstone(
  host: MemberBindHost,
  fileId: string,
  reason: string,
): Promise<void> {
  const row = await loadBindFile(host, fileId)
  if (!row || row.deletedAt || isLiveMember(row)) return
  try {
    await host.files.deleteObjectAtKey(row.storageKey, row.bucket)
  } catch (error) {
    await noteObjectDeleteFailure(host, row, error, { quarantine: true })
    throw error
  }
  const current = await loadBindFile(host, fileId)
  if (!current || current.deletedAt || isLiveMember(current) || current.storageKey !== row.storageKey) return
  await host.files.systemDelete(fileId, reason)
}
