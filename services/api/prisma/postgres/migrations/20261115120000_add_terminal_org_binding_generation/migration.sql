-- 终端绑定版本。每次归属真变化加一。已有行是 0，之后的改绑才往上加。
ALTER TABLE "Terminal" ADD COLUMN "orgBindingGeneration" INTEGER NOT NULL DEFAULT 0;
