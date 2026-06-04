-- 阶段 A: EndUser — C 端求职者账号(手机号验证码登录)。
-- 不存明文手机号:phoneHash = HMAC-SHA256(手机号) 唯一查找键;phoneEnc = AES-256-GCM 加密手机号。
-- 与内部运营 User 表完全独立,不参与企业招聘闭环,无外键关联。
--
-- 注:dev.db 存在历史 drift(本地迁移与 _prisma_migrations 表不一致),
-- 沿用 AiResumeResult / FieldMappingRule 的先例,本迁移通过 `prisma db execute` 非破坏性应用,
-- 不做 `migrate dev` 破坏性 reset。

-- CreateTable
CREATE TABLE "EndUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phoneHash" TEXT NOT NULL,
    "phoneEnc" TEXT NOT NULL,
    "nickname" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "EndUser_phoneHash_key" ON "EndUser"("phoneHash");
