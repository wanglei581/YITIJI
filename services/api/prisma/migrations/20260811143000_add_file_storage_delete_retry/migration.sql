-- Durable FileObject physical-deletion retry and completion evidence.
-- Nullable and additive for rolling compatibility with the previous application version.
ALTER TABLE "FileObject" ADD COLUMN "storageDeletePendingAt" DATETIME;
ALTER TABLE "FileObject" ADD COLUMN "storageDeletedAt" DATETIME;

CREATE INDEX "FileObject_storageDeletePendingAt_idx"
  ON "FileObject"("storageDeletePendingAt");

CREATE INDEX "FileObject_status_storageDeletedAt_idx"
  ON "FileObject"("status", "storageDeletedAt");
