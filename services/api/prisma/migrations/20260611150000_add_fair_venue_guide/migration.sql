-- 招聘会场馆导览(本轮新增):FairVenueGuide / FairVenueHall / FairVenueHallCompany / FairVenueFacility。
--
-- Additive only(非破坏性建表)。沿用本项目既有约定:dev.db 存在历史 drift,
-- 本迁移通过 `prisma db execute --file ...` 非破坏性执行;PostgreSQL 迁移时统一重整。
--
-- 合规:只做会场位置导览与信息查看,不形成投递/收简历闭环;
-- 企业绑定关联既有 FairCompany,不复制企业信息。

CREATE TABLE "FairVenueGuide" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "jobFairId" TEXT NOT NULL,
  "venueName" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FairVenueGuide_jobFairId_fkey"
    FOREIGN KEY ("jobFairId") REFERENCES "JobFair" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FairVenueGuide_jobFairId_key" ON "FairVenueGuide"("jobFairId");

CREATE TABLE "FairVenueHall" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guideId" TEXT NOT NULL,
  "hallCode" TEXT NOT NULL,
  "hallName" TEXT NOT NULL,
  "industryCategory" TEXT,
  "description" TEXT,
  "boothRange" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FairVenueHall_guideId_fkey"
    FOREIGN KEY ("guideId") REFERENCES "FairVenueGuide" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FairVenueHall_guideId_hallCode_key" ON "FairVenueHall"("guideId", "hallCode");
CREATE INDEX "FairVenueHall_guideId_idx" ON "FairVenueHall"("guideId");

CREATE TABLE "FairVenueHallCompany" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "hallId" TEXT NOT NULL,
  "fairCompanyId" TEXT NOT NULL,
  "boothNo" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FairVenueHallCompany_hallId_fkey"
    FOREIGN KEY ("hallId") REFERENCES "FairVenueHall" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FairVenueHallCompany_fairCompanyId_fkey"
    FOREIGN KEY ("fairCompanyId") REFERENCES "FairCompany" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FairVenueHallCompany_hallId_fairCompanyId_key" ON "FairVenueHallCompany"("hallId", "fairCompanyId");
CREATE INDEX "FairVenueHallCompany_hallId_idx" ON "FairVenueHallCompany"("hallId");
CREATE INDEX "FairVenueHallCompany_fairCompanyId_idx" ON "FairVenueHallCompany"("fairCompanyId");

CREATE TABLE "FairVenueFacility" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guideId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "locationLabel" TEXT,
  "relatedHallCode" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FairVenueFacility_guideId_fkey"
    FOREIGN KEY ("guideId") REFERENCES "FairVenueGuide" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FairVenueFacility_guideId_idx" ON "FairVenueFacility"("guideId");
