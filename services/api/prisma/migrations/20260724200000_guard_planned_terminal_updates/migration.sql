-- Gate 0 batch 2: a planned terminal may only be activated through bind-code exchange.
-- This protects against older API binaries that do not know lifecycleStatus.
-- Abort deployment if the lifecycle migration was exposed to an old writer before
-- this guard became active. The application also rejects every planned lifecycle
-- during authentication, so a failed deployment cannot make such rows usable.
CREATE TABLE "_Terminal_planned_invariant_check" (
  "valid" INTEGER NOT NULL CHECK ("valid" = 1)
);

INSERT INTO "_Terminal_planned_invariant_check" ("valid")
SELECT 0
WHERE EXISTS (
  SELECT 1
  FROM "Terminal" t
  WHERE t."lifecycleStatus" = 'planned'
    AND (
      t."agentToken" NOT LIKE 'planned$%'
      OR t."credentialGeneration" <> 0
      OR EXISTS (SELECT 1 FROM "TerminalCredential" c WHERE c."terminalId" = t."id")
    )
);

DROP TABLE "_Terminal_planned_invariant_check";

CREATE TRIGGER "Terminal_planned_insert_invariant"
BEFORE INSERT ON "Terminal"
WHEN NEW."lifecycleStatus" = 'planned'
  AND (NEW."agentToken" NOT LIKE 'planned$%' OR NEW."credentialGeneration" <> 0)
BEGIN
  SELECT RAISE(ABORT, 'invalid planned terminal credential state');
END;

CREATE TRIGGER "Terminal_planned_credential_insert_guard"
BEFORE INSERT ON "TerminalCredential"
WHEN EXISTS (
  SELECT 1 FROM "Terminal" t
  WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'planned'
)
BEGIN
  SELECT RAISE(ABORT, 'planned terminal cannot own a credential');
END;

CREATE TRIGGER "Terminal_planned_credential_update_guard"
BEFORE UPDATE OF "terminalId" ON "TerminalCredential"
WHEN EXISTS (
  SELECT 1 FROM "Terminal" t
  WHERE t."id" = NEW."terminalId" AND t."lifecycleStatus" = 'planned'
)
BEGIN
  SELECT RAISE(ABORT, 'planned terminal cannot own a credential');
END;

CREATE TRIGGER "Terminal_planned_update_guard"
BEFORE UPDATE OF "agentToken", "lifecycleStatus", "credentialGeneration" ON "Terminal"
WHEN (
    NEW."lifecycleStatus" = 'planned'
    AND (
      NEW."agentToken" NOT LIKE 'planned$%'
      OR NEW."credentialGeneration" <> 0
      OR EXISTS (SELECT 1 FROM "TerminalCredential" c WHERE c."terminalId" = NEW."id")
    )
  )
  OR (
    OLD."lifecycleStatus" = 'planned'
    AND (
    NEW."agentToken" <> OLD."agentToken"
    OR NEW."credentialGeneration" <> OLD."credentialGeneration"
    OR NEW."lifecycleStatus" NOT IN ('planned', 'commissioning')
    )
    AND NOT (
      NEW."lifecycleStatus" = 'commissioning'
      AND NEW."agentToken" <> OLD."agentToken"
      AND NEW."credentialGeneration" = OLD."credentialGeneration" + 1
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'planned terminal requires bind-code exchange');
END;
