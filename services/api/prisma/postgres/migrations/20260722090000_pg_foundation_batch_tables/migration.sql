-- PostgreSQL 专用迁移流补齐：foundation batch 表（B0）。
--
-- 背景：PG 专用迁移流（prisma/postgres/migrations）结构性落后于
-- prisma/postgres/schema.prisma 与默认/SQLite 迁移流，导致以下 10 张
-- model 表从未在 PG 建出。本迁移按 PG schema 逐字补齐，PG 原生类型。
--
-- 对应默认流来源：
--   OfflineAgency / OfflineJob / HelpItem / KioskSession / PrintMaterialPack /
--   UserNotification / KioskActivity / FairCompanyBooth / ScreensaverContent
--     ← 20260717151246_foundation_batch0（+ 20260718 g1_offline_agencies 字段补齐）
--   TerminalBindCode ← 20260705193000_add_terminal_bind_code
--
-- 不重建 LegalDocVersion（已由 20260719090000_add_legal_doc_version 建出）。

-- CreateTable
CREATE TABLE "TerminalBindCode" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "terminalCode" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerminalBindCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineAgency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orgType" TEXT NOT NULL DEFAULT 'recruitment',
    "address" TEXT NOT NULL,
    "district" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "openHours" TEXT,
    "phone" TEXT,
    "contactEmail" TEXT,
    "website" TEXT,
    "services" TEXT NOT NULL DEFAULT '[]',
    "description" TEXT,
    "logoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "sourceOrgId" TEXT,
    "externalId" TEXT,
    "syncTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflineAgency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineJob" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jobType" TEXT NOT NULL DEFAULT 'fulltime',
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryUnit" TEXT NOT NULL DEFAULT 'month',
    "requirements" TEXT,
    "description" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "location" TEXT,
    "education" TEXT,
    "experience" TEXT,
    "externalUrl" TEXT,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflineJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskSession" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT,
    "memberId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isExpired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintMaterialPack" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "items" TEXT NOT NULL DEFAULT '[]',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintMaterialPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskActivity" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "benefits" TEXT,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FairCompanyBooth" (
    "id" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "boothNumber" TEXT NOT NULL,
    "zone" TEXT,
    "checkinStatus" TEXT NOT NULL DEFAULT 'pending',
    "honors" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FairCompanyBooth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreensaverContent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "duration" INTEGER NOT NULL DEFAULT 5,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreensaverContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TerminalBindCode_codeHash_key" ON "TerminalBindCode"("codeHash");

-- CreateIndex
CREATE INDEX "TerminalBindCode_terminalId_idx" ON "TerminalBindCode"("terminalId");

-- CreateIndex
CREATE INDEX "TerminalBindCode_terminalCode_idx" ON "TerminalBindCode"("terminalCode");

-- CreateIndex
CREATE INDEX "TerminalBindCode_expiresAt_idx" ON "TerminalBindCode"("expiresAt");

-- CreateIndex
CREATE INDEX "TerminalBindCode_usedAt_idx" ON "TerminalBindCode"("usedAt");

-- CreateIndex
CREATE INDEX "TerminalBindCode_revokedAt_idx" ON "TerminalBindCode"("revokedAt");

-- AddForeignKey
ALTER TABLE "TerminalBindCode" ADD CONSTRAINT "TerminalBindCode_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineJob" ADD CONSTRAINT "OfflineJob_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "OfflineAgency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
