-- Durable idempotency for POST /me/print-orders (miniapp Order-only create).
-- Historical rows stay NULL; unique is scoped to (endUserId, idempotencyKey).
ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Order" ADD COLUMN "idempotencyPayloadHash" TEXT;
CREATE UNIQUE INDEX "Order_endUserId_idempotencyKey_key" ON "Order"("endUserId", "idempotencyKey");
