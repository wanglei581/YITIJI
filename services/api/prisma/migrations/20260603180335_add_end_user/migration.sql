-- 阶段 A(feat/end-user-account): C 端求职者账号表。
-- 与内部运营账号 User 完全隔离;手机号不存明文(phoneHash 查找 + phoneEnc 加密)。
-- 设计见 docs/product/end-user-account-and-resume-vault-design.md。

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
