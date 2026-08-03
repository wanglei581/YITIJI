-- G6: Add missing columns to LegalDocVersion (title, publishedBy)
-- and replace unique(docType, version) with index(docType, isActive)
ALTER TABLE "LegalDocVersion" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LegalDocVersion" ADD COLUMN "publishedBy" TEXT;

-- Drop old unique constraint, add operational index
DROP INDEX IF EXISTS "LegalDocVersion_docType_version_key";
CREATE INDEX IF NOT EXISTS "LegalDocVersion_docType_isActive_idx" ON "LegalDocVersion"("docType", "isActive");
