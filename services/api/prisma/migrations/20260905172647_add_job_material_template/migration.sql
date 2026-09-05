-- CreateTable
CREATE TABLE "JobMaterialTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disabled',
    "recommendedFor" TEXT NOT NULL,
    "outputFilename" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "resumeLayoutPreset" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "updatedByUserId" TEXT
);

-- CreateIndex
CREATE INDEX "JobMaterialTemplate_status_sortOrder_idx" ON "JobMaterialTemplate"("status", "sortOrder");
