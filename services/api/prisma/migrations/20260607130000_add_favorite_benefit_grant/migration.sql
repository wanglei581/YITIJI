-- Phase C-2C: 会员收藏 + 权益底座（CLAUDE.md §10/§18, next-tasks §一/§五/§六）。
--
-- Additive only：
--   - Favorite      —— 会员对外部来源岗位/招聘会/政策的收藏标记（服务端化，替换 localStorage）。
--   - BenefitGrant  —— 发放给会员的权益（券/免费次数/套餐额度/补贴资格提示）只读底座。
--
-- 合规：
--   - 收藏只记录"浏览/收藏"行为，绝不记录投递结果/投递状态/面试/Offer/候选人数据。
--   - subsidy_eligibility_hint 仅 info-only 资格提示，绝不承诺到账/已发放金额。
--   - 本阶段不接发放/核销真实逻辑、不接支付；表中不含任何支付凭证。
--
-- 非破坏性建表。沿用本项目既有约定（见 20260607120000_add_ai_resume_result_access_token_hash）：
-- 因 dev.db 存在历史 migration drift，本迁移通过 `prisma db execute --file ...` 非破坏性执行，
-- 不跑破坏性 `migrate reset`。PostgreSQL 迁移时随 dev.db drift 统一重整。

CREATE TABLE "Favorite" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "endUserId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "title" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Favorite_endUserId_fkey"
    FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Favorite_endUserId_targetType_targetId_key"
  ON "Favorite"("endUserId", "targetType", "targetId");
CREATE INDEX "Favorite_endUserId_idx" ON "Favorite"("endUserId");
CREATE INDEX "Favorite_targetType_targetId_idx" ON "Favorite"("targetType", "targetId");

CREATE TABLE "BenefitGrant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "endUserId" TEXT NOT NULL,
  "benefitType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "quantityTotal" INTEGER,
  "quantityRemaining" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'active',
  "sourceType" TEXT NOT NULL DEFAULT 'platform',
  "sourceRef" TEXT,
  "validFrom" DATETIME,
  "validUntil" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BenefitGrant_endUserId_fkey"
    FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BenefitGrant_endUserId_idx" ON "BenefitGrant"("endUserId");
CREATE INDEX "BenefitGrant_endUserId_status_idx" ON "BenefitGrant"("endUserId", "status");
