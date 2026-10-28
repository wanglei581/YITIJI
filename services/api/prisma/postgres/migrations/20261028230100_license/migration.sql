-- 授权管理第一步（加性迁移，不改任何已有数据）：
--   1. Organization.licenseMode：none（默认，一律不管控）/ required（须有生效授权）。
--      已有机构全部落在 none，所以上线本迁移不会让任何现有点位受影响。
--   2. 新表 License：授权给哪家企业、期限、终端台数、宽限天数、状态。
--      只按「期限 + 台数」授权，没有任何与岗位、招聘会、浏览、投递挂钩的列。
--   库里另加 CHECK 兜底（应用层已校验，这里防绕过应用直接写库）。

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "licenseMode" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_licenseMode_check" CHECK ("licenseMode" IN ('none', 'required'));

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "licenseeName" TEXT NOT NULL,
    "creditCode" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "terminalQuota" INTEGER NOT NULL,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "status" TEXT NOT NULL DEFAULT 'active',
    "note" TEXT,
    "statusReason" TEXT,
    "statusTicketNo" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "License_status_check" CHECK ("status" IN ('active', 'suspended', 'revoked')),
    CONSTRAINT "License_terminalQuota_check" CHECK ("terminalQuota" >= 1 AND "terminalQuota" <= 10000),
    CONSTRAINT "License_graceDays_check" CHECK ("graceDays" >= 0 AND "graceDays" <= 30),
    CONSTRAINT "License_period_check" CHECK ("endsAt" > "startsAt")
);

-- CreateIndex
CREATE INDEX "License_orgId_startsAt_idx" ON "License"("orgId", "startsAt");

-- CreateIndex
CREATE INDEX "License_status_endsAt_idx" ON "License"("status", "endsAt");

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
