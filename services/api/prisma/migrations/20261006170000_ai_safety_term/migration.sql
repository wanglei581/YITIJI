-- CreateTable
CREATE TABLE "AiSafetyTerm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AiSafetyTerm_enabled_idx" ON "AiSafetyTerm"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AiSafetyTerm_category_kind_term_key" ON "AiSafetyTerm"("category", "kind", "term");
