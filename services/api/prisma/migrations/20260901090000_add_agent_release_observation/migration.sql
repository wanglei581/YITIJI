-- F0.5 release observation only. This migration intentionally creates no
-- package location, download instruction, install command, scheduler or remote
-- execution surface.

CREATE TABLE "AgentReleaseArtifact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "version" TEXT NOT NULL,
  "targetPlatform" TEXT NOT NULL DEFAULT 'windows-x64',
  "packageSha256" TEXT NOT NULL,
  "runtimeManifestSha256" TEXT NOT NULL,
  "signerTrustLevel" TEXT NOT NULL,
  "signerCertificateThumbprint" TEXT,
  "observationProtocolVersion" TEXT NOT NULL DEFAULT 'release-observation-v1',
  "createdBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AgentReleasePlan" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "artifactId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "reason" TEXT NOT NULL,
  "observationEndsAt" DATETIME NOT NULL,
  "createdBy" TEXT,
  "activatedBy" TEXT,
  "activatedAt" DATETIME,
  "pausedBy" TEXT,
  "pausedAt" DATETIME,
  "cancelledBy" TEXT,
  "cancelledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AgentReleasePlan_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "AgentReleaseArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AgentReleaseTarget" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "terminalId" TEXT NOT NULL,
  "orgIdSnapshot" TEXT,
  "batchNumber" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentReleaseTarget_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AgentReleasePlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentReleaseTarget_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "TerminalReleaseObservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "targetId" TEXT NOT NULL,
  "seenPlanId" TEXT NOT NULL,
  "seenPlanVersion" INTEGER NOT NULL,
  "runtimeVersion" TEXT,
  "observationProtocolVersion" TEXT NOT NULL,
  "observedAt" DATETIME NOT NULL,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TerminalReleaseObservation_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "AgentReleaseTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ActiveReleaseObservationAssignment" (
  "terminalId" TEXT NOT NULL PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActiveReleaseObservationAssignment_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ActiveReleaseObservationAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AgentReleasePlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ActiveReleaseObservationAssignment_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "AgentReleaseTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentReleaseArtifact_version_packageSha256_key" ON "AgentReleaseArtifact"("version", "packageSha256");
CREATE INDEX "AgentReleaseArtifact_createdAt_idx" ON "AgentReleaseArtifact"("createdAt");
CREATE INDEX "AgentReleasePlan_status_observationEndsAt_idx" ON "AgentReleasePlan"("status", "observationEndsAt");
CREATE INDEX "AgentReleasePlan_createdAt_idx" ON "AgentReleasePlan"("createdAt");
CREATE UNIQUE INDEX "AgentReleaseTarget_planId_terminalId_key" ON "AgentReleaseTarget"("planId", "terminalId");
CREATE INDEX "AgentReleaseTarget_terminalId_createdAt_idx" ON "AgentReleaseTarget"("terminalId", "createdAt");
CREATE UNIQUE INDEX "TerminalReleaseObservation_targetId_key" ON "TerminalReleaseObservation"("targetId");
CREATE INDEX "TerminalReleaseObservation_observedAt_idx" ON "TerminalReleaseObservation"("observedAt");
CREATE UNIQUE INDEX "ActiveReleaseObservationAssignment_targetId_key" ON "ActiveReleaseObservationAssignment"("targetId");
CREATE INDEX "ActiveReleaseObservationAssignment_planId_idx" ON "ActiveReleaseObservationAssignment"("planId");
