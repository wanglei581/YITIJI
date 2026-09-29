-- 机构 / 来源熔断规则。单向，不提供撤销。与 postgres 同名迁移同形。

CREATE TABLE "RecruitmentCircuitBreak" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "RecruitmentCircuitBreak_scope_targetId_key" ON "RecruitmentCircuitBreak"("scope", "targetId");
CREATE INDEX "RecruitmentCircuitBreak_scope_createdAt_idx" ON "RecruitmentCircuitBreak"("scope", "createdAt");
