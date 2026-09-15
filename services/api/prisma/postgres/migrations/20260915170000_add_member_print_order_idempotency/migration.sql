-- Durable idempotency for POST /me/print-orders (miniapp Order-only create).
-- PostgreSQL 侧与 prisma/migrations/20260915170000_add_member_print_order_idempotency 一一对应。
-- Historical rows stay NULL; unique is scoped to (endUserId, idempotencyKey).
ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Order" ADD COLUMN "idempotencyPayloadHash" TEXT;
CREATE UNIQUE INDEX "Order_endUserId_idempotencyKey_key" ON "Order"("endUserId", "idempotencyKey");
