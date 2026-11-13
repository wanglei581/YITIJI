-- 屏上扫描轮次。旧行取 0。
-- 只在终端程序回报从 ready 或 error 转到 scanning（新一轮开始扫描）时加一。
-- 同状态重发、page_ready 与 scanning 之间翻页、用户改设置回到 ready，都不加。
ALTER TABLE "ScanTask" ADD COLUMN "deviceRound" INTEGER NOT NULL DEFAULT 0;
