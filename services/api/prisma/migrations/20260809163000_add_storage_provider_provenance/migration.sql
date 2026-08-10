-- Record the physical storage provider so COS history remains readable after
-- new uploads switch to BOS. Existing FileObject rows can be inferred from
-- their bucket sentinel; legacy operational assets had no bucket provenance.
ALTER TABLE "FileObject" ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'local';
UPDATE "FileObject"
SET "storageProvider" = CASE WHEN "bucket" = 'local-fs' THEN 'local' ELSE 'cos' END;

ALTER TABLE "FairMaterial" ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "FairMaterial" ADD COLUMN "storageBucket" TEXT;
ALTER TABLE "FairMaterial" ADD COLUMN "storageRegion" TEXT;

ALTER TABLE "AdAsset" ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "AdAsset" ADD COLUMN "storageBucket" TEXT;
ALTER TABLE "AdAsset" ADD COLUMN "storageRegion" TEXT;
