-- 合作机构成员账号安全移除：保留历史 User 外键，同时用墓碑状态撤销访问权。
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Admin 机构详情、最后有效账号保护均按机构 / 角色 / 可登录状态查询。
CREATE INDEX "User_orgId_role_enabled_deletedAt_idx"
  ON "User"("orgId", "role", "enabled", "deletedAt");
