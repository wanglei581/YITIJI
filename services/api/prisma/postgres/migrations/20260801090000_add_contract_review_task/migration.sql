CREATE TABLE "ContractReviewTask" (
    "id" TEXT NOT NULL,
    "endUserId" TEXT,
    "accessTokenHash" TEXT,
    "sourceFileId" TEXT NOT NULL,
    "resultFileId" TEXT,
    "contractType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "consentVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "consentScopeHash" TEXT NOT NULL,
    "disclaimerVersion" TEXT NOT NULL,
    "rulePackVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "ocrProvider" TEXT,
    "ocrConfidence" TEXT,
    "analyzedPages" INTEGER NOT NULL DEFAULT 0,
    "totalPages" INTEGER,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "professionalConsultationRecommended" BOOLEAN NOT NULL DEFAULT false,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "resultJson" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractReviewTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContractReviewTask_endUserId_fkey"
      FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ContractReviewTask_endUserId_createdAt_idx"
  ON "ContractReviewTask"("endUserId", "createdAt");

CREATE INDEX "ContractReviewTask_accessTokenHash_idx"
  ON "ContractReviewTask"("accessTokenHash");

CREATE INDEX "ContractReviewTask_status_updatedAt_idx"
  ON "ContractReviewTask"("status", "updatedAt");

CREATE INDEX "ContractReviewTask_expiresAt_idx"
  ON "ContractReviewTask"("expiresAt");

CREATE INDEX "ContractReviewTask_sourceFileId_idx"
  ON "ContractReviewTask"("sourceFileId");
