-- Gate 0.3B: retired is a database-level terminal state.
-- A retired identity may never be inserted directly.
CREATE TRIGGER "Terminal_retired_insert_guard"
BEFORE INSERT ON "Terminal"
WHEN NEW."lifecycleStatus" = 'retired'
BEGIN
  SELECT RAISE(ABORT, 'retired terminal identity cannot be inserted');
END;

-- The first transition must atomically establish the complete retired invariant.
CREATE TRIGGER "Terminal_retired_entry_guard"
BEFORE UPDATE OF "lifecycleStatus", "enabled", "agentToken", "credentialGeneration", "lifecycleVersion" ON "Terminal"
WHEN OLD."lifecycleStatus" <> 'retired'
  AND NEW."lifecycleStatus" = 'retired'
  AND (
    NEW."enabled" <> 0
    OR NEW."agentToken" NOT GLOB 'cred$retired$?*'
    OR NEW."credentialGeneration" <> OLD."credentialGeneration" + 1
    OR NEW."lifecycleVersion" <> OLD."lifecycleVersion" + 1
    OR EXISTS (SELECT 1 FROM "TerminalCredential" c WHERE c."terminalId" = OLD."id" AND c."revokedAt" IS NULL)
    OR EXISTS (SELECT 1 FROM "TerminalBindCode" b WHERE b."terminalId" = OLD."id" AND b."usedAt" IS NULL AND b."revokedAt" IS NULL)
    OR EXISTS (SELECT 1 FROM "PrintTask" p WHERE p."terminalId" = OLD."id" AND p."status" IN ('pending', 'claimed', 'printing'))
    OR EXISTS (SELECT 1 FROM "ScanTask" s WHERE s."terminalId" = OLD."id" AND s."status" IN ('waiting', 'matched'))
  )
BEGIN
  SELECT RAISE(ABORT, 'retired terminal invariant is incomplete');
END;

-- Once retired, the identity carrier and lifecycle fields are immutable.
CREATE TRIGGER "Terminal_retired_update_guard"
BEFORE UPDATE OF "lifecycleStatus", "enabled", "agentToken", "credentialGeneration", "lifecycleVersion" ON "Terminal"
WHEN OLD."lifecycleStatus" = 'retired'
  AND (
    NEW."lifecycleStatus" <> OLD."lifecycleStatus"
    OR NEW."enabled" <> OLD."enabled"
    OR NEW."agentToken" <> OLD."agentToken"
    OR NEW."credentialGeneration" <> OLD."credentialGeneration"
    OR NEW."lifecycleVersion" <> OLD."lifecycleVersion"
  )
BEGIN
  SELECT RAISE(ABORT, 'retired terminal is irreversible');
END;

-- A retired row is itself the permanent identity tombstone.
CREATE TRIGGER "Terminal_retired_delete_guard"
BEFORE DELETE ON "Terminal"
WHEN OLD."lifecycleStatus" = 'retired'
BEGIN
  SELECT RAISE(ABORT, 'retired terminal cannot be deleted');
END;

CREATE TRIGGER "Terminal_retired_credential_insert_guard"
BEFORE INSERT ON "TerminalCredential"
WHEN EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'retired')
BEGIN
  SELECT RAISE(ABORT, 'retired terminal cannot own a new credential');
END;

CREATE TRIGGER "Terminal_retired_credential_update_guard"
BEFORE UPDATE ON "TerminalCredential"
WHEN EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = OLD."terminalId" AND t."lifecycleStatus" = 'retired')
  OR EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'retired')
BEGIN
  SELECT RAISE(ABORT, 'retired terminal credential is immutable');
END;

CREATE TRIGGER "Terminal_retired_credential_delete_guard"
BEFORE DELETE ON "TerminalCredential"
WHEN EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = OLD."terminalId" AND t."lifecycleStatus" = 'retired')
BEGIN
  SELECT RAISE(ABORT, 'retired terminal credential is immutable');
END;

CREATE TRIGGER "Terminal_retired_bind_code_insert_guard"
BEFORE INSERT ON "TerminalBindCode"
WHEN EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'retired')
BEGIN
  SELECT RAISE(ABORT, 'retired terminal cannot own a new bind code');
END;

CREATE TRIGGER "Terminal_retired_bind_code_update_guard"
BEFORE UPDATE ON "TerminalBindCode"
WHEN EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = OLD."terminalId" AND t."lifecycleStatus" = 'retired')
  OR EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'retired')
BEGIN
  SELECT RAISE(ABORT, 'retired terminal bind code is immutable');
END;

CREATE TRIGGER "Terminal_retired_bind_code_delete_guard"
BEFORE DELETE ON "TerminalBindCode"
WHEN EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = OLD."terminalId" AND t."lifecycleStatus" = 'retired')
BEGIN
  SELECT RAISE(ABORT, 'retired terminal bind code is immutable');
END;
