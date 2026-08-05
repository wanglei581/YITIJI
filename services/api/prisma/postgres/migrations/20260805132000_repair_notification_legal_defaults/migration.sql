-- Align the migrated PostgreSQL defaults with prisma/postgres/schema.prisma.
-- These changes are metadata-only and preserve all existing rows.
ALTER TABLE "BroadcastReadState" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "FeedbackTicket" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "SystemBroadcast" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "LegalDocVersion" ALTER COLUMN "title" SET DEFAULT '';
