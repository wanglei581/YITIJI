-- Durable idempotency ledger for POST /me/print-orders and POST /orders/package.
-- Unique is (endUserId, idempotencyKey). Does not replace Order_endUserId_idempotencyKey_key.
CREATE TABLE "OrderSubmissionLedger" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "endUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "orderKind" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "leaseToken" TEXT,
  "leaseExpiresAt" DATETIME,
  "orderId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "OrderSubmissionLedger_endUserId_idempotencyKey_key"
  ON "OrderSubmissionLedger"("endUserId", "idempotencyKey");
CREATE INDEX "OrderSubmissionLedger_status_leaseExpiresAt_idx"
  ON "OrderSubmissionLedger"("status", "leaseExpiresAt");
CREATE INDEX "OrderSubmissionLedger_orderId_idx" ON "OrderSubmissionLedger"("orderId");
CREATE INDEX "OrderSubmissionLedger_endUserId_idx" ON "OrderSubmissionLedger"("endUserId");
