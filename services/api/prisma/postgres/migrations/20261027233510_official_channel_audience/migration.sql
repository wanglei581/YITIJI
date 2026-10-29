-- Additive: official-channel audience. Existing rows stay general and are not grouped.
ALTER TABLE "OnlinePlatformDirectory" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'general';
