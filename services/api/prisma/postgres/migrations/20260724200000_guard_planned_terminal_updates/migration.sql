-- Gate 0 batch 2: a planned terminal may only be activated through bind-code exchange.
-- This protects against older API binaries that do not know lifecycleStatus.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Terminal" t
    WHERE t."lifecycleStatus" = 'planned'
      AND (
        t."agentToken" NOT LIKE 'planned$%'
        OR t."credentialGeneration" <> 0
        OR EXISTS (SELECT 1 FROM "TerminalCredential" c WHERE c."terminalId" = t."id")
      )
  ) THEN
    RAISE EXCEPTION 'invalid planned terminal credential state; repair before deployment'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_planned_terminal_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."lifecycleStatus" = 'planned'
    AND (NEW."agentToken" NOT LIKE 'planned$%' OR NEW."credentialGeneration" <> 0)
  THEN
    RAISE EXCEPTION 'invalid planned terminal credential state'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Terminal_planned_insert_invariant"
BEFORE INSERT ON "Terminal"
FOR EACH ROW EXECUTE FUNCTION "guard_planned_terminal_insert"();

CREATE OR REPLACE FUNCTION "guard_planned_terminal_credential_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Terminal" t
    WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'planned'
  ) THEN
    RAISE EXCEPTION 'planned terminal cannot own a credential'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Terminal_planned_credential_insert_guard"
BEFORE INSERT ON "TerminalCredential"
FOR EACH ROW EXECUTE FUNCTION "guard_planned_terminal_credential_insert"();

CREATE TRIGGER "Terminal_planned_credential_update_guard"
BEFORE UPDATE OF "terminalId" ON "TerminalCredential"
FOR EACH ROW EXECUTE FUNCTION "guard_planned_terminal_credential_insert"();

CREATE OR REPLACE FUNCTION "guard_planned_terminal_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."lifecycleStatus" = 'planned'
    AND (
      NEW."agentToken" IS DISTINCT FROM OLD."agentToken"
      OR NEW."credentialGeneration" IS DISTINCT FROM OLD."credentialGeneration"
      OR NEW."lifecycleStatus" NOT IN ('planned', 'commissioning')
    )
    AND NOT (
      NEW."lifecycleStatus" = 'commissioning'
      AND NEW."agentToken" IS DISTINCT FROM OLD."agentToken"
      AND NEW."credentialGeneration" = OLD."credentialGeneration" + 1
    )
  THEN
    RAISE EXCEPTION 'planned terminal requires bind-code exchange'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."lifecycleStatus" = 'planned'
    AND (
      NEW."agentToken" NOT LIKE 'planned$%'
      OR NEW."credentialGeneration" <> 0
      OR EXISTS (SELECT 1 FROM "TerminalCredential" c WHERE c."terminalId" = NEW."id")
    )
  THEN
    RAISE EXCEPTION 'invalid planned terminal credential state'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Terminal_planned_update_guard"
BEFORE UPDATE OF "agentToken", "lifecycleStatus", "credentialGeneration" ON "Terminal"
FOR EACH ROW EXECUTE FUNCTION "guard_planned_terminal_update"();
