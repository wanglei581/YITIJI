-- AlterTable: FileObject 增加手机上传会员确认的两个对象键
--
-- pendingStorageKey：复制发生前记下即将写入的会员 key。
-- replacedStorageKey：storageKey 换成会员 key 的同一次更新里记下匿名旧键。
-- 两列可空且不设默认值。null 表示没有待完成的复制或待删除的旧键。
-- 清扫只捞非 null 行，避免在 Redis 清理记录过期后留下无人认领的对象。
ALTER TABLE "FileObject" ADD COLUMN "pendingStorageKey" TEXT;
ALTER TABLE "FileObject" ADD COLUMN "replacedStorageKey" TEXT;

CREATE INDEX "FileObject_pendingStorageKey_idx" ON "FileObject"("pendingStorageKey");
CREATE INDEX "FileObject_replacedStorageKey_idx" ON "FileObject"("replacedStorageKey");
