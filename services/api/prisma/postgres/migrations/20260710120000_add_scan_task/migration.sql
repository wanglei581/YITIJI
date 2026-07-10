-- 首期真实扫描：新增 ScanTask 表（PostgreSQL）。
-- 全部 additive：仅 create table / create index；不 drop / 不 rename / 不改既有列。

-- CreateTable
CREATE TABLE "ScanTask" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "scanType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "endUserId" TEXT,
    "fileId" TEXT,
    "matchedFileMtime" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanTask_terminalId_status_createdAt_idx" ON "ScanTask"("terminalId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ScanTask_endUserId_idx" ON "ScanTask"("endUserId");

-- AddForeignKey
ALTER TABLE "ScanTask" ADD CONSTRAINT "ScanTask_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanTask" ADD CONSTRAINT "ScanTask_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
