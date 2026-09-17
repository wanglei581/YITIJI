-- Durable idempotency ledger for POST /me/print-orders and POST /orders/package.
-- PostgreSQL 侧与 prisma/migrations/20260918120000_add_order_submission_ledger 一一对应.
-- Unique is (endUserId, idempotencyKey). Does not replace Order_endUserId_idempotencyKey_key.
CREATE TABLE "OrderSubmissionLedger" (
  "id" TEXT NOT NULL,
  "endUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "orderKind" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "orderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderSubmissionLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderSubmissionLedger_endUserId_idempotencyKey_key"
  ON "OrderSubmissionLedger"("endUserId", "idempotencyKey");
CREATE INDEX "OrderSubmissionLedger_status_leaseExpiresAt_idx"
  ON "OrderSubmissionLedger"("status", "leaseExpiresAt");
CREATE INDEX "OrderSubmissionLedger_orderId_idx" ON "OrderSubmissionLedger"("orderId");
CREATE INDEX "OrderSubmissionLedger_endUserId_idx" ON "OrderSubmissionLedger"("endUserId");
