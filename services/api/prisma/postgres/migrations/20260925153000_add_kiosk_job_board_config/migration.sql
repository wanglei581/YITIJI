-- 一体机岗位板块开关。terminalId='__global__' 为全局行，其它值为终端 terminalCode。
-- 无行表示开。与 SQLite schema 的 KioskJobBoardConfig 同形。

CREATE TABLE "KioskJobBoardConfig" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskJobBoardConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KioskJobBoardConfig_terminalId_key" ON "KioskJobBoardConfig"("terminalId");
