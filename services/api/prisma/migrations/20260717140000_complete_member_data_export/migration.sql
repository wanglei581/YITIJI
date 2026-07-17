-- Wave 1-B Slice 2：在已应用的账本 migration 上补齐导出失败摘要与全局幂等键。
-- delete 仍由应用层在任何副作用前 fail closed；本 migration 不触发账号状态迁移或删除。
ALTER TABLE "UserDataRequest" ADD COLUMN "failureMessage" TEXT;

-- 同一个非空幂等键只能对应一条会员数据权利请求；NULL 历史记录仍可并存。
CREATE UNIQUE INDEX "UserDataRequest_idempotencyKey_key" ON "UserDataRequest"("idempotencyKey");
