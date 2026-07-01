-- Terminal device profile for commercial per-device configuration.
ALTER TABLE "Terminal" ADD COLUMN "displayName" TEXT;
ALTER TABLE "Terminal" ADD COLUMN "macAddress" TEXT;
ALTER TABLE "Terminal" ADD COLUMN "locationLabel" TEXT;
ALTER TABLE "Terminal" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "Terminal_macAddress_key" ON "Terminal"("macAddress");
CREATE INDEX "Terminal_enabled_idx" ON "Terminal"("enabled");
