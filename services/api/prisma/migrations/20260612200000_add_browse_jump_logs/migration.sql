-- P1 浏览/外部跳转记录:只记录浏览与「打开来源平台入口」行为,无任何投递/预约结果状态字段
-- CreateTable
CREATE TABLE "BrowseLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endUserId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetTitle" TEXT,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "externalId" TEXT,
    "terminalId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "BrowseLog_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExternalJumpLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endUserId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetTitle" TEXT,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "externalId" TEXT,
    "terminalId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "ExternalJumpLog_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BrowseLog_endUserId_createdAt_idx" ON "BrowseLog"("endUserId", "createdAt");

-- CreateIndex
CREATE INDEX "BrowseLog_endUserId_targetType_targetId_createdAt_idx" ON "BrowseLog"("endUserId", "targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "BrowseLog_expiresAt_idx" ON "BrowseLog"("expiresAt");

-- CreateIndex
CREATE INDEX "ExternalJumpLog_endUserId_createdAt_idx" ON "ExternalJumpLog"("endUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalJumpLog_endUserId_targetType_createdAt_idx" ON "ExternalJumpLog"("endUserId", "targetType", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalJumpLog_expiresAt_idx" ON "ExternalJumpLog"("expiresAt");

