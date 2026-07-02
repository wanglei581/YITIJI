CREATE TABLE "ToolboxLaunchEvent" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "itemTitle" TEXT,
    "launchMode" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "placement" TEXT,
    "targetHost" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolboxLaunchEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ToolboxLaunchEvent_terminalId_createdAt_idx" ON "ToolboxLaunchEvent"("terminalId", "createdAt");
CREATE INDEX "ToolboxLaunchEvent_itemKey_createdAt_idx" ON "ToolboxLaunchEvent"("itemKey", "createdAt");
CREATE INDEX "ToolboxLaunchEvent_action_createdAt_idx" ON "ToolboxLaunchEvent"("action", "createdAt");
CREATE INDEX "ToolboxLaunchEvent_createdAt_idx" ON "ToolboxLaunchEvent"("createdAt");
CREATE INDEX "ToolboxLaunchEvent_expiresAt_idx" ON "ToolboxLaunchEvent"("expiresAt");
