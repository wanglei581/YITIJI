-- CreateTable
CREATE TABLE "CopyJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "terminalId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "endUserId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'ready',
    "source" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "colorMode" TEXT NOT NULL DEFAULT 'black_white',
    "duplex" TEXT NOT NULL DEFAULT 'simplex',
    "billableSides" INTEGER NOT NULL DEFAULT 0,
    "quoteSnapshot" TEXT,
    "orderId" TEXT,
    "requestKey" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "authorizationVersion" INTEGER NOT NULL DEFAULT 0,
    "resultCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "CopyJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CopyJob_orderId_key" ON "CopyJob"("orderId");

-- CreateIndex
CREATE INDEX "CopyJob_terminalId_state_createdAt_idx" ON "CopyJob"("terminalId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "CopyJob_state_expiresAt_idx" ON "CopyJob"("state", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CopyJob_terminalId_requestKey_key" ON "CopyJob"("terminalId", "requestKey");

