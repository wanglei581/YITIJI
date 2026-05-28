-- Add unique constraint on agentToken to prevent token-collision authentication bug
CREATE UNIQUE INDEX IF NOT EXISTS "Terminal_agentToken_key" ON "Terminal"("agentToken");
