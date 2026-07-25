-- Gate 0 batch 2: additive terminal lifecycle for admin pre-provisioning.
-- Existing terminals are already commissioned, so they default to active.

ALTER TABLE "Terminal" ADD COLUMN "lifecycleStatus" TEXT NOT NULL DEFAULT 'active';

CREATE INDEX "Terminal_lifecycleStatus_idx" ON "Terminal"("lifecycleStatus");
