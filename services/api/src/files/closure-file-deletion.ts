import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import type { StorageService } from '../storage/storage.service'

/**
 * FileObject 硬删前先落无会员关联的物理删除账本，防崩溃丢掉对象键。
 * 只保留删除必需的键和 bucket；不保留 fileId、文件名或原身份映射。
 * 主对象沿用 FilesService 的 tombstone / 删除路径，其余临时对象也要回收。
 */
export async function deleteClosureFile(
  prisma: PrismaService,
  storage: StorageService,
  fileId: string,
  systemDelete: (id: string) => Promise<unknown>,
  onDeleted: (tx: PrismaTransactionClient, failures: number) => Promise<void>,
): Promise<void> {
  const file = await prisma.fileObject.findUnique({ where: { id: fileId } })
  if (!file) return
  const keys = [...new Set([file.storageKey, file.pendingStorageKey, file.replacedStorageKey].filter((key): key is string => Boolean(key)))]
  for (const storageKey of keys) {
    await prisma.storageDeletion.upsert({
      where: { storageKey }, create: { storageKey, bucket: file.bucket }, update: {},
    })
  }
  let failures = 0
  for (const storageKey of keys) {
    try {
      if (storageKey === file.storageKey) await systemDelete(fileId)
      else await storage.deleteObject(storageKey, file.bucket)
    } catch (error) {
      // 数据库/授权错误不能当成对象删除失败吞掉。主路径会先写 pending 事实。
      if (storageKey === file.storageKey) {
        const pending = await prisma.fileObject.findUnique({ where: { id: fileId } })
        if (!pending?.storageDeletePendingAt) throw error
      }
      failures += 1
      await prisma.storageDeletion.update({ where: { storageKey }, data: {
        attempts: { increment: 1 }, lastError: 'OBJECT_DELETE_FAILED',
      } })
      continue
    }
    await prisma.storageDeletion.deleteMany({ where: { storageKey } })
  }
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.fileObject.deleteMany({ where: { id: fileId } })
    if (deleted.count) await onDeleted(tx, failures)
  })
}

/** 接入既有 reconcileStorageDeletions；成功即删除账本，不留长期关联。 */
export async function reconcileDetachedStorageDeletions(prisma: PrismaService, storage: StorageService, limit: number) {
  const pending = await prisma.storageDeletion.findMany({ orderBy: { createdAt: 'asc' }, take: limit })
  let reconciledCount = 0
  let stillPendingCount = 0
  for (const item of pending) {
    try {
      await storage.deleteObject(item.storageKey, item.bucket)
    } catch {
      await prisma.storageDeletion.updateMany({ where: { id: item.id }, data: {
        attempts: { increment: 1 }, lastError: 'OBJECT_DELETE_FAILED',
      } })
      stillPendingCount += 1
      continue
    }
    reconciledCount += (await prisma.storageDeletion.deleteMany({ where: { id: item.id } })).count
  }
  return { reconciledCount, stillPendingCount }
}
