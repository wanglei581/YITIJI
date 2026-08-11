-- Durable FileObject physical-deletion retry and completion evidence.
-- Nullable and additive for rolling compatibility with the previous application version.
ALTER TABLE "FileObject"
  ADD COLUMN "storageDeletePendingAt" TIMESTAMP(3),
  ADD COLUMN "storageDeletedAt" TIMESTAMP(3);

CREATE INDEX "FileObject_storageDeletePendingAt_idx"
  ON "FileObject"("storageDeletePendingAt");

CREATE INDEX "FileObject_status_storageDeletedAt_idx"
  ON "FileObject"("status", "storageDeletedAt");
