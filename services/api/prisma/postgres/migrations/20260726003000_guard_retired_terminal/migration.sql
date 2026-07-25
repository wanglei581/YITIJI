-- Gate 0.3B: retired is a database-level terminal state.
CREATE OR REPLACE FUNCTION "guard_retired_terminal_insert"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."lifecycleStatus" = 'retired' THEN
    RAISE EXCEPTION 'retired terminal identity cannot be inserted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Terminal_retired_insert_guard"
BEFORE INSERT ON "Terminal"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_insert"();

CREATE OR REPLACE FUNCTION "guard_retired_terminal_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."lifecycleStatus" IS DISTINCT FROM 'retired'
    AND NEW."lifecycleStatus" = 'retired'
    AND (
      NEW."enabled" IS DISTINCT FROM FALSE
      OR NEW."agentToken" !~ '^cred\$retired\$.+'
      OR NEW."credentialGeneration" IS DISTINCT FROM OLD."credentialGeneration" + 1
      OR NEW."lifecycleVersion" IS DISTINCT FROM OLD."lifecycleVersion" + 1
      OR NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."terminalCode" IS DISTINCT FROM OLD."terminalCode"
      OR NEW."deviceFingerprint" IS DISTINCT FROM OLD."deviceFingerprint"
      OR NEW."macAddress" IS DISTINCT FROM OLD."macAddress"
      OR EXISTS (SELECT 1 FROM "TerminalCredential" c WHERE c."terminalId" = OLD."id" AND c."revokedAt" IS NULL)
      OR EXISTS (SELECT 1 FROM "TerminalBindCode" b WHERE b."terminalId" = OLD."id" AND b."usedAt" IS NULL AND b."revokedAt" IS NULL)
      OR EXISTS (SELECT 1 FROM "PrintTask" p WHERE p."terminalId" = OLD."id" AND p."status" IN ('pending', 'claimed', 'printing'))
      OR EXISTS (SELECT 1 FROM "ScanTask" s WHERE s."terminalId" = OLD."id" AND s."status" IN ('waiting', 'matched'))
    )
  THEN
    RAISE EXCEPTION 'retired terminal invariant is incomplete' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."lifecycleStatus" = 'retired'
    AND (
      NEW."lifecycleStatus" IS DISTINCT FROM OLD."lifecycleStatus"
      OR NEW."enabled" IS DISTINCT FROM OLD."enabled"
      OR NEW."agentToken" IS DISTINCT FROM OLD."agentToken"
      OR NEW."credentialGeneration" IS DISTINCT FROM OLD."credentialGeneration"
      OR NEW."lifecycleVersion" IS DISTINCT FROM OLD."lifecycleVersion"
      OR NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."terminalCode" IS DISTINCT FROM OLD."terminalCode"
      OR NEW."deviceFingerprint" IS DISTINCT FROM OLD."deviceFingerprint"
      OR NEW."macAddress" IS DISTINCT FROM OLD."macAddress"
    )
  THEN
    RAISE EXCEPTION 'retired terminal is irreversible' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Terminal_retired_update_guard"
BEFORE UPDATE ON "Terminal"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_update"();

CREATE OR REPLACE FUNCTION "guard_retired_terminal_delete"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."lifecycleStatus" = 'retired' THEN
    RAISE EXCEPTION 'retired terminal cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "Terminal_retired_delete_guard"
BEFORE DELETE ON "Terminal"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_delete"();

CREATE OR REPLACE FUNCTION "guard_retired_terminal_credential"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_terminal_id TEXT;
BEGIN
  target_terminal_id := NEW."terminalId";
  -- FOR UPDATE makes legacy writers serialize with the retirement Terminal row lock.
  IF TG_OP = 'UPDATE' THEN
    PERFORM 1 FROM "Terminal" t WHERE t."id" IN (OLD."terminalId", target_terminal_id) FOR UPDATE;
    IF EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" IN (OLD."terminalId", target_terminal_id) AND t."lifecycleStatus" = 'retired') THEN
      RAISE EXCEPTION 'retired terminal credential is immutable' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    PERFORM 1 FROM "Terminal" t WHERE t."id" = target_terminal_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = target_terminal_id AND t."lifecycleStatus" = 'retired') THEN
      RAISE EXCEPTION 'retired terminal cannot own a new credential' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Terminal_retired_credential_insert_guard"
BEFORE INSERT ON "TerminalCredential"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_credential"();

CREATE TRIGGER "Terminal_retired_credential_update_guard"
BEFORE UPDATE ON "TerminalCredential"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_credential"();

CREATE OR REPLACE FUNCTION "guard_retired_terminal_credential_delete"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = OLD."terminalId" AND t."lifecycleStatus" = 'retired') THEN
    RAISE EXCEPTION 'retired terminal credential is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "Terminal_retired_credential_delete_guard"
BEFORE DELETE ON "TerminalCredential"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_credential_delete"();

CREATE OR REPLACE FUNCTION "guard_retired_terminal_bind_code"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_terminal_id TEXT;
BEGIN
  target_terminal_id := NEW."terminalId";
  -- FOR UPDATE makes legacy writers serialize with the retirement Terminal row lock.
  IF TG_OP = 'UPDATE' THEN
    PERFORM 1 FROM "Terminal" t WHERE t."id" IN (OLD."terminalId", target_terminal_id) FOR UPDATE;
    IF EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" IN (OLD."terminalId", target_terminal_id) AND t."lifecycleStatus" = 'retired') THEN
      RAISE EXCEPTION 'retired terminal bind code is immutable' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    PERFORM 1 FROM "Terminal" t WHERE t."id" = target_terminal_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = target_terminal_id AND t."lifecycleStatus" = 'retired') THEN
      RAISE EXCEPTION 'retired terminal cannot own a new bind code' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Terminal_retired_bind_code_insert_guard"
BEFORE INSERT ON "TerminalBindCode"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_bind_code"();

CREATE TRIGGER "Terminal_retired_bind_code_update_guard"
BEFORE UPDATE ON "TerminalBindCode"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_bind_code"();

CREATE OR REPLACE FUNCTION "guard_retired_terminal_bind_code_delete"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = OLD."terminalId" AND t."lifecycleStatus" = 'retired') THEN
    RAISE EXCEPTION 'retired terminal bind code is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "Terminal_retired_bind_code_delete_guard"
BEFORE DELETE ON "TerminalBindCode"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_bind_code_delete"();

-- Legacy writers that do not use the application no-op CAS still serialize new work
-- with retirement and fail closed once the Terminal row is retired.
CREATE OR REPLACE FUNCTION "guard_retired_terminal_task_write"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."terminalId" IS NOT NULL THEN
    PERFORM 1 FROM "Terminal" t WHERE t."id" = NEW."terminalId" FOR UPDATE;
    IF EXISTS (SELECT 1 FROM "Terminal" t WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'retired') THEN
      RAISE EXCEPTION 'retired terminal cannot receive new work' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Terminal_retired_print_task_insert_guard"
BEFORE INSERT ON "PrintTask"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_task_write"();

CREATE TRIGGER "Terminal_retired_print_task_move_guard"
BEFORE UPDATE OF "terminalId" ON "PrintTask"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_task_write"();

CREATE TRIGGER "Terminal_retired_scan_task_insert_guard"
BEFORE INSERT ON "ScanTask"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_task_write"();

CREATE TRIGGER "Terminal_retired_scan_task_move_guard"
BEFORE UPDATE OF "terminalId" ON "ScanTask"
FOR EACH ROW EXECUTE FUNCTION "guard_retired_terminal_task_write"();
