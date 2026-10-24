-- CreateTable
CREATE TABLE "ServiceProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "serviceStartAt" DATETIME NOT NULL,
    "serviceEndAt" DATETIME NOT NULL,
    "serviceScope" TEXT NOT NULL,
    "supportContact" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceProject_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "activeTerminalId" TEXT,
    "terminalCode" TEXT NOT NULL,
    "locationLabel" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "ServiceDeployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ServiceProject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceDeployment_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceIncident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "terminalCode" TEXT NOT NULL,
    "issueCode" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignee" TEXT,
    "resolution" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceIncident_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ServiceProject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceIncident_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "ServiceDeployment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceIncidentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceIncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ServiceIncident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "acknowledgedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ServiceProject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ServiceProject_orgId_createdAt_idx" ON "ServiceProject"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceProject_orgId_reference_key" ON "ServiceProject"("orgId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDeployment_activeTerminalId_key" ON "ServiceDeployment"("activeTerminalId");

-- CreateIndex
CREATE INDEX "ServiceDeployment_projectId_startedAt_idx" ON "ServiceDeployment"("projectId", "startedAt");

-- CreateIndex
CREATE INDEX "ServiceDeployment_terminalId_startedAt_endedAt_idx" ON "ServiceDeployment"("terminalId", "startedAt", "endedAt");

-- CreateIndex
CREATE INDEX "ServiceDeployment_orgId_startedAt_idx" ON "ServiceDeployment"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "ServiceIncident_orgId_createdAt_idx" ON "ServiceIncident"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceIncident_projectId_status_idx" ON "ServiceIncident"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceIncident_orgId_requestKey_key" ON "ServiceIncident"("orgId", "requestKey");

-- CreateIndex
CREATE INDEX "ServiceIncidentEvent_incidentId_createdAt_idx" ON "ServiceIncidentEvent"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceReport_orgId_month_idx" ON "ServiceReport"("orgId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceReport_projectId_month_key" ON "ServiceReport"("projectId", "month");
