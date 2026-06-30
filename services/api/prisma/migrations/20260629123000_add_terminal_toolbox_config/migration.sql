CREATE TABLE "TerminalToolboxConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "terminalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "itemsJson" TEXT NOT NULL DEFAULT '[]',
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "TerminalToolboxConfig_terminalId_key" ON "TerminalToolboxConfig"("terminalId");
