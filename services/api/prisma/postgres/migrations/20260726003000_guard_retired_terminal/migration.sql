-- Gate 0.3B: retired is a database-level terminal state.
CREATE OR REPLACE FUNCTION "guard_retired_terminal_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."lifecycleStatus" = 'retired'
    AND (
      NEW."lifecycleStatus" IS DISTINCT FROM 'retired'
      OR NEW."enabled" IS DISTINCT FROM FALSE
      OR NEW."agentToken" NOT LIKE 'cred$retired$%'
      OR NEW."credentialGeneration" IS DISTINCT FROM OLD."credentialGeneration"
    )
  THEN
    RAISE EXCEPTION 'retired terminal is irreversible' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Terminal_retired_update_guard"
BEFORE UPDATE OF "lifecycleStatus", "enabled", "agentToken", "credentialGeneration" ON "Terminal"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_update"();

CREATE OR REPLACE FUNCTION "guard_retired_terminal_credential"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'retired') THEN
    RAISE EXCEPTION 'retired terminal cannot own a new credential' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Terminal_retired_credential_insert_guard"
BEFORE INSERT ON "TerminalCredential"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_credential"();

CREATE TRIGGER "Terminal_retired_credential_move_guard"
BEFORE UPDATE OF "terminalId" ON "TerminalCredential"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_credential"();

CREATE OR REPLACE FUNCTION "guard_retired_terminal_bind_code"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'retired') THEN
    RAISE EXCEPTION 'retired terminal cannot own a new bind code' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Terminal_retired_bind_code_insert_guard"
BEFORE INSERT ON "TerminalBindCode"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_bind_code"();

CREATE TRIGGER "Terminal_retired_bind_code_move_guard"
BEFORE UPDATE OF "terminalId" ON "TerminalBindCode"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_bind_code"();
