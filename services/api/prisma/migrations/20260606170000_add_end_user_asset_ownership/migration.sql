-- Phase A-1: C-end EndUser asset ownership baseline.
--
-- Nullable by design:
--   - Existing anonymous Kiosk flows must continue to work.
--   - Historical files, AI results, and print tasks remain valid.
--   - Logged-in member flows can now bind assets to EndUser.

ALTER TABLE "FileObject" ADD COLUMN "endUserId" TEXT REFERENCES "EndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiResumeResult" ADD COLUMN "endUserId" TEXT REFERENCES "EndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrintTask" ADD COLUMN "endUserId" TEXT REFERENCES "EndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "FileObject_endUserId_idx" ON "FileObject"("endUserId");
CREATE INDEX "AiResumeResult_endUserId_idx" ON "AiResumeResult"("endUserId");
CREATE INDEX "PrintTask_endUserId_idx" ON "PrintTask"("endUserId");
