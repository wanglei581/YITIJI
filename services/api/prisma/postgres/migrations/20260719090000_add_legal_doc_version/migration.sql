-- CreateTable
CREATE TABLE "LegalDocVersion" (
    "id" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalDocVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalDocVersion_docType_isActive_idx" ON "LegalDocVersion"("docType", "isActive");
