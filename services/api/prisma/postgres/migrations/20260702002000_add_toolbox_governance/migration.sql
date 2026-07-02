-- CreateTable
CREATE TABLE "ToolboxApp" (
    "id" TEXT NOT NULL,
    "appKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolboxApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolboxAppVersion" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "submittedBy" TEXT,
    "approvedBy" TEXT,
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "ToolboxAppVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolboxAllowedHost" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolboxAllowedHost_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "ToolboxAppVersion" ADD CONSTRAINT "ToolboxAppVersion_appId_fkey" FOREIGN KEY ("appId") REFERENCES "ToolboxApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
