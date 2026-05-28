-- CreateTable
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "terminalCode" TEXT NOT NULL,
    "agentToken" TEXT NOT NULL,
    "deviceFingerprint" TEXT NOT NULL,
    "registeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PrintTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "terminalId" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileMd5" TEXT NOT NULL,
    "paramsJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimedAt" DATETIME,
    "claimExpiry" DATETIME,
    "completedAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PrintTask_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TerminalHeartbeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "terminalId" TEXT NOT NULL,
    "printerStatus" TEXT,
    "agentVersion" TEXT,
    "ipAddress" TEXT,
    "diskFreeGb" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TerminalHeartbeat_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrintTaskStatusLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrintTaskStatusLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PrintTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_terminalCode_key" ON "Terminal"("terminalCode");
