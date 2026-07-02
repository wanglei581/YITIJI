-- CreateTable
CREATE TABLE "ToolboxApp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ToolboxAppVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "submittedBy" TEXT,
    "approvedBy" TEXT,
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "reviewedAt" DATETIME,
    "publishedAt" DATETIME,
    CONSTRAINT "ToolboxAppVersion_appId_fkey" FOREIGN KEY ("appId") REFERENCES "ToolboxApp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ToolboxAllowedHost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "host" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ToolboxApp_appKey_key" ON "ToolboxApp"("appKey");

-- CreateIndex
CREATE INDEX "ToolboxApp_status_idx" ON "ToolboxApp"("status");

-- CreateIndex
CREATE INDEX "ToolboxApp_category_idx" ON "ToolboxApp"("category");

-- CreateIndex
CREATE UNIQUE INDEX "ToolboxAppVersion_appId_version_key" ON "ToolboxAppVersion"("appId", "version");

-- CreateIndex
CREATE INDEX "ToolboxAppVersion_appId_idx" ON "ToolboxAppVersion"("appId");

-- CreateIndex
CREATE INDEX "ToolboxAppVersion_status_idx" ON "ToolboxAppVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ToolboxAllowedHost_host_purpose_key" ON "ToolboxAllowedHost"("host", "purpose");

-- CreateIndex
CREATE INDEX "ToolboxAllowedHost_status_idx" ON "ToolboxAllowedHost"("status");
