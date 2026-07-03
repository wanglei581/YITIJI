-- P0a 支付域底座（无 live 网关）：新增服务端价目 SSOT + Order 支付/退款/取件/计费页数字段。
-- 全部 additive：仅 add table / add column / create unique index；不 drop / 不 rename / 不改既有列。
-- Order 新增列均可空，不破坏现有行。

-- CreateTable
CREATE TABLE "PriceConfig" (
    "id" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "unitCents" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceConfig_serviceKey_key" ON "PriceConfig"("serviceKey");

-- CreateIndex
CREATE INDEX "PriceConfig_active_idx" ON "PriceConfig"("active");

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "paymentSource" TEXT;
ALTER TABLE "Order" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "paidBy" TEXT;
ALTER TABLE "Order" ADD COLUMN "pickupCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "billablePages" INTEGER;
ALTER TABLE "Order" ADD COLUMN "billingPageSource" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_pickupCode_key" ON "Order"("pickupCode");
