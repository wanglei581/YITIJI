ALTER TABLE "User" ADD COLUMN "passwordProofState" TEXT NOT NULL DEFAULT 'legacy'
  CHECK ("passwordProofState" IN ('legacy', 'temporary', 'owner_managed'));
