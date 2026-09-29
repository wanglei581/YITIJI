-- 一体机岗位板块开关。terminalId='__global__' 为全局行，其它值为终端 terminalCode。
-- 无行表示开。与 prisma/postgres/migrations 下同名迁移同形。

-- CreateTable
CREATE TABLE "KioskJobBoardConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "terminalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "KioskJobBoardConfig_terminalId_key" ON "KioskJobBoardConfig"("terminalId");
