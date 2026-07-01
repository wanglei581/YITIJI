CREATE TABLE "TerminalToolboxConfig" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "itemsJson" TEXT NOT NULL DEFAULT '[]',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerminalToolboxConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TerminalToolboxConfig_terminalId_key" ON "TerminalToolboxConfig"("terminalId");
