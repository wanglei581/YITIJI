-- CreateTable
CREATE TABLE "JobMaterialTemplate" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "JobMaterialTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobMaterialTemplate_status_sortOrder_idx" ON "JobMaterialTemplate"("status", "sortOrder");
