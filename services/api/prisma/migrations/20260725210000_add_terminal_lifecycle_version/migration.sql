-- Gate 0.3A: monotonic CAS version prevents stale lifecycle requests from
-- reopening a terminal after a newer maintenance cycle has started.
ALTER TABLE "Terminal" ADD COLUMN "lifecycleVersion" INTEGER NOT NULL DEFAULT 0;
