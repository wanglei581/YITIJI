-- Gate 0.3B: retired is a database-level terminal state.
CREATE TRIGGER "Terminal_retired_update_guard"
BEFORE UPDATE OF "lifecycleStatus", "enabled", "agentToken", "credentialGeneration" ON "Terminal"
WHEN OLD."lifecycleStatus" = 'retired'
  AND (
    NEW."lifecycleStatus" <> 'retired'
    OR NEW."enabled" <> 0
    OR NEW."agentToken" NOT LIKE 'cred$retired$%'
    OR NEW."credentialGeneration" <> OLD."credentialGeneration"
  )
BEGIN
  SELECT RAISE(ABORT, 'retired terminal is irreversible');
END;

CREATE TRIGGER "Terminal_retired_credential_insert_guard"
BEFORE INSERT ON "TerminalCredential"
WHEN EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'retired')
BEGIN
  SELECT RAISE(ABORT, 'retired terminal cannot own a new credential');
END;

CREATE TRIGGER "Terminal_retired_credential_move_guard"
BEFORE UPDATE OF "terminalId" ON "TerminalCredential"
WHEN EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'retired')
BEGIN
  SELECT RAISE(ABORT, 'retired terminal cannot own a new credential');
END;

CREATE TRIGGER "Terminal_retired_bind_code_insert_guard"
BEFORE INSERT ON "TerminalBindCode"
WHEN EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'retired')
BEGIN
  SELECT RAISE(ABORT, 'retired terminal cannot own a new bind code');
END;

CREATE TRIGGER "Terminal_retired_bind_code_move_guard"
BEFORE UPDATE OF "terminalId" ON "TerminalBindCode"
WHEN EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'retired')
BEGIN
  SELECT RAISE(ABORT, 'retired terminal cannot own a new bind code');
END;
