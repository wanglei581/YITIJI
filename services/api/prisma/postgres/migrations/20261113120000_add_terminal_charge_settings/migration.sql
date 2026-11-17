-- 每台机器谁付钱，以及五个核心功能的配置价。默认 org_pays。没有价目行 = 0。
ALTER TABLE "Terminal" ADD COLUMN "userChargeMode" TEXT NOT NULL DEFAULT 'org_pays';

CREATE TABLE "TerminalServicePrice" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "unitCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,

    CONSTRAINT "TerminalServicePrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TerminalServicePrice_terminalId_serviceKey_key" ON "TerminalServicePrice"("terminalId", "serviceKey");

ALTER TABLE "TerminalServicePrice" ADD CONSTRAINT "TerminalServicePrice_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
