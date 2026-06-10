-- 阶段1F 合入补档:招聘会改版(feature/jobfair-revamp / feature/fair-detail-5tab,2026-06-08)
-- 的 schema 增量。这些列/表在分支开发时已通过 db push/execute 写入 dev.db,
-- 本文件为迁移记录补档(PostgreSQL 重整时按此并入),在 dev.db 上**不需要重复执行**。
--
-- Additive only:
--   JobFair       + latitude/longitude/trafficInfo(场馆导航深链)
--                 + expectedAttendance/seekerIntentJson(数据大屏;机构录入预计值,标注"预计/来源",非实时)
--   FairCompany   + coverImageUrl/founded/headquarters/registeredCapital/honorTags/zoneId/boothNumber
--   FairCompanyPosition(新表)  参展企业招聘岗位(展示信息;合规:不接收简历、不做投递闭环)

ALTER TABLE "JobFair" ADD COLUMN "latitude" REAL;
ALTER TABLE "JobFair" ADD COLUMN "longitude" REAL;
ALTER TABLE "JobFair" ADD COLUMN "trafficInfo" TEXT;
ALTER TABLE "JobFair" ADD COLUMN "expectedAttendance" INTEGER;
ALTER TABLE "JobFair" ADD COLUMN "seekerIntentJson" TEXT;

ALTER TABLE "FairCompany" ADD COLUMN "coverImageUrl" TEXT;
ALTER TABLE "FairCompany" ADD COLUMN "founded" TEXT;
ALTER TABLE "FairCompany" ADD COLUMN "headquarters" TEXT;
ALTER TABLE "FairCompany" ADD COLUMN "registeredCapital" TEXT;
ALTER TABLE "FairCompany" ADD COLUMN "honorTags" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FairCompany" ADD COLUMN "zoneId" TEXT;
ALTER TABLE "FairCompany" ADD COLUMN "boothNumber" TEXT;

CREATE TABLE "FairCompanyPosition" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fairCompanyId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "headcount" INTEGER NOT NULL DEFAULT 0,
  "salary" TEXT,
  "requirements" TEXT,
  "education" TEXT,
  "experience" TEXT,
  "location" TEXT,
  "positionType" TEXT,
  "department" TEXT,
  "sourceUrl" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FairCompanyPosition_fairCompanyId_fkey"
    FOREIGN KEY ("fairCompanyId") REFERENCES "FairCompany" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FairCompanyPosition_fairCompanyId_idx" ON "FairCompanyPosition"("fairCompanyId");
