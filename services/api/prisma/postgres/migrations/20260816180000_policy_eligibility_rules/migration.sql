-- P21 政策条件核对（S3-2）：政策「申领条件」的结构化表达。
-- PostgreSQL 侧与 prisma/migrations/20260816180000_policy_eligibility_rules 一一对应。
--
-- 改动前，政策的申领条件只存在于 PolicyPost.content 富文本里，机器读不出来；
-- 要做条件核对就只剩「让模型猜」这一条路，违反 CLAUDE.md §9「不伪造能力」。
-- 本迁移把条件显式建模，使每条判定都能追回一段入库的政策原文摘录。
--
-- 全部 additive，不删列、不改既有列语义：
--   1. PolicyPost."externalId"（可空）：补齐 CLAUDE.md §10 的「外部ID」来源要素。
--      存量行落 NULL；不加 UNIQUE（PolicyPost 无 (sourceOrgId, externalId) 去重语义）。
--   2. 新表 "PolicyEligibilityRule"：一行一条申领条件。
--      "sourceText" 存政策原文摘录（判定依据，一字不改）；
--      "clauses" 存 JSON 文本（TEXT，与 SQLite 同构；本库全库不用 jsonb 列）。
--      ON DELETE CASCADE：政策删除时条件一并删除，避免留下无主判定依据。

ALTER TABLE "PolicyPost" ADD COLUMN "externalId" TEXT;

CREATE TABLE "PolicyEligibilityRule" (
    "id" TEXT NOT NULL,
    "policyPostId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "matchMode" TEXT NOT NULL DEFAULT 'all',
    "clauses" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyEligibilityRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PolicyEligibilityRule_policyPostId_orderIndex_idx" ON "PolicyEligibilityRule"("policyPostId", "orderIndex");

ALTER TABLE "PolicyEligibilityRule"
  ADD CONSTRAINT "PolicyEligibilityRule_policyPostId_fkey"
  FOREIGN KEY ("policyPostId") REFERENCES "PolicyPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
