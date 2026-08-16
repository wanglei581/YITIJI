-- S1 匿名一体机反馈：受限的免登录提交面，复用 FeedbackTicket。
--
-- 为什么必须改列而不是只加表：一体机是公共位设备，绝大多数用户不登录，
-- 而 FeedbackTicket.endUserId 原本 NOT NULL —— 打印完成页的「问题上报 / 满意度」和
-- 打印 Hub 的「缺纸 / 质量 / 费用」在匿名场景下无处可落。
--
-- 变更四项，全部 additive（不删列、不改既有列语义）：
--   1. endUserId → nullable。SQLite 不支持 DROP NOT NULL，只能重建表。
--      存量行 endUserId 全部非空，重建后语义不变。
--   2. submitterType（默认 'member'）：区分会员工单与匿名一体机工单，后台分开处置。
--      存量行按默认值落 'member' —— 这是真值：改动前唯一的提交面就是 POST /me/feedback。
--   3. relatedScanTaskId：与 relatedPrintTaskId 对称，允许关联扫描任务。
--   4. satisfaction：打印完成页满意度三档（good/fair/bad），独立成列以便按终端聚合。
--   5. dedupKey + UNIQUE：匿名提交幂等键。会员提交恒为 NULL，
--      SQLite 的 UNIQUE 索引允许多个 NULL，因此不影响存量行。

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_FeedbackTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endUserId" TEXT,
    "submitterType" TEXT NOT NULL DEFAULT 'member',
    "terminalId" TEXT,
    "relatedPrintTaskId" TEXT,
    "relatedScanTaskId" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "contactPhoneEnc" TEXT,
    "satisfaction" TEXT,
    "dedupKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeedbackTicket_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_FeedbackTicket" (
    "id",
    "endUserId",
    "terminalId",
    "relatedPrintTaskId",
    "category",
    "title",
    "content",
    "contactPhoneEnc",
    "status",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "endUserId",
    "terminalId",
    "relatedPrintTaskId",
    "category",
    "title",
    "content",
    "contactPhoneEnc",
    "status",
    "createdAt",
    "updatedAt"
FROM "FeedbackTicket";

DROP TABLE "FeedbackTicket";
ALTER TABLE "new_FeedbackTicket" RENAME TO "FeedbackTicket";

CREATE UNIQUE INDEX "FeedbackTicket_dedupKey_key" ON "FeedbackTicket"("dedupKey");
CREATE INDEX "FeedbackTicket_endUserId_createdAt_idx" ON "FeedbackTicket"("endUserId", "createdAt");
CREATE INDEX "FeedbackTicket_status_createdAt_idx" ON "FeedbackTicket"("status", "createdAt");
CREATE INDEX "FeedbackTicket_category_createdAt_idx" ON "FeedbackTicket"("category", "createdAt");
CREATE INDEX "FeedbackTicket_submitterType_terminalId_createdAt_idx" ON "FeedbackTicket"("submitterType", "terminalId", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
