-- C-3A 权益活动中心 MVP。
-- BenefitActivity 是活动模板；BenefitClaim 是领取流水与防重凭证。
-- 用户真正拥有的权益仍写入 BenefitGrant，sourceRef 回填 BenefitActivity.id。

CREATE TABLE "BenefitActivity" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "rulesText" TEXT,
    "benefitType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'platform',
    "quantityTotal" INTEGER,
    "stockTotal" INTEGER,
    "stockRemaining" INTEGER,
    "claimLimitPerUser" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "grantValidDays" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenefitActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BenefitClaim" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "endUserId" TEXT NOT NULL,
    "benefitGrantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitClaim_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BenefitActivity_status_idx" ON "BenefitActivity"("status");
CREATE INDEX "BenefitActivity_sourceType_idx" ON "BenefitActivity"("sourceType");
CREATE INDEX "BenefitActivity_validFrom_validUntil_idx" ON "BenefitActivity"("validFrom", "validUntil");
CREATE UNIQUE INDEX "BenefitClaim_benefitGrantId_key" ON "BenefitClaim"("benefitGrantId");
CREATE UNIQUE INDEX "BenefitClaim_activityId_endUserId_key" ON "BenefitClaim"("activityId", "endUserId");
CREATE INDEX "BenefitClaim_endUserId_idx" ON "BenefitClaim"("endUserId");
CREATE INDEX "BenefitClaim_activityId_createdAt_idx" ON "BenefitClaim"("activityId", "createdAt");

ALTER TABLE "BenefitActivity" ADD CONSTRAINT "BenefitActivity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BenefitClaim" ADD CONSTRAINT "BenefitClaim_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "BenefitActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitClaim" ADD CONSTRAINT "BenefitClaim_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitClaim" ADD CONSTRAINT "BenefitClaim_benefitGrantId_fkey" FOREIGN KEY ("benefitGrantId") REFERENCES "BenefitGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
