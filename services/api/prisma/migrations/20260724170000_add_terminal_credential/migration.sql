-- Gate 0 batch 1 (expand): add hash-only per-device credential history.
-- Terminal.agentToken remains the compatibility carrier during the reader-aware rollout.
-- Switching it to cred$<credentialId> and erasing plaintext is a later controlled contract step.

ALTER TABLE "Terminal" ADD COLUMN "credentialGeneration" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "TerminalCredential" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "terminalId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "issueSource" TEXT NOT NULL,
  "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  CONSTRAINT "TerminalCredential_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TerminalCredential_tokenHash_key" ON "TerminalCredential"("tokenHash");
CREATE UNIQUE INDEX "TerminalCredential_terminalId_generation_key" ON "TerminalCredential"("terminalId", "generation");
CREATE INDEX "TerminalCredential_terminalId_revokedAt_expiresAt_idx" ON "TerminalCredential"("terminalId", "revokedAt", "expiresAt");
CREATE INDEX "TerminalCredential_expiresAt_idx" ON "TerminalCredential"("expiresAt");
