-- P21 政策条件核对（S3-2）：政策「申领条件」的结构化表达。
--
-- 改动前，政策的申领条件只存在于 PolicyPost.content 富文本里，机器读不出来；
-- 要做条件核对就只剩「让模型猜」这一条路，违反 CLAUDE.md §9「不伪造能力」。
-- 本迁移把条件显式建模，使每条判定都能追回一段入库的政策原文摘录。
--
-- 全部 additive，不删列、不改既有列语义、不重建表：
--   1. PolicyPost.externalId（可空）：补齐 CLAUDE.md §10 的「外部ID」来源要素。
--      Job / JobFair / Company 都有该字段，PolicyPost 此前没有。存量行落 NULL，
--      消费方按 NULL 展示「来源未提供编号」，不得伪造。
--      不加 UNIQUE：PolicyPost 无 (sourceOrgId, externalId) 去重语义，
--      存量行全为 NULL，强加唯一约束只会在未来回填时反过来卡住。
--   2. 新表 PolicyEligibilityRule：一行一条申领条件。
--      sourceText 存政策原文摘录（判定依据，一字不改）；
--      clauses 存 JSON 文本（本库全库不用 Json 列类型，SQLite/PG 同构）。
--      ON DELETE CASCADE：政策删除时条件一并删除，避免留下无主判定依据。

ALTER TABLE "PolicyPost" ADD COLUMN "externalId" TEXT;

CREATE TABLE "PolicyEligibilityRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyPostId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "matchMode" TEXT NOT NULL DEFAULT 'all',
    "clauses" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PolicyEligibilityRule_policyPostId_fkey" FOREIGN KEY ("policyPostId") REFERENCES "PolicyPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PolicyEligibilityRule_policyPostId_orderIndex_idx" ON "PolicyEligibilityRule"("policyPostId", "orderIndex");
