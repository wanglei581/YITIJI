-- Repair migration: TerminalBindCode was added to both Prisma schemas in 20260705193000,
-- but the PostgreSQL migration tree did not receive the matching table migration.
-- A pre-existing manual table is accepted only when its critical shape is exactly compatible;
-- incomplete or divergent tables fail closed instead of being silently treated as repaired.

DO $$
DECLARE
  table_oid oid;
  shape_count integer;
BEGIN
  SELECT c.oid INTO table_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema()
    AND c.relname = 'TerminalBindCode'
    AND c.relkind IN ('r', 'p');
  IF table_oid IS NULL THEN
    CREATE TABLE "TerminalBindCode" (
      "id" TEXT NOT NULL,
      "terminalId" TEXT NOT NULL,
      "terminalCode" TEXT NOT NULL,
      "codeHash" TEXT NOT NULL,
      "createdBy" TEXT,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "usedAt" TIMESTAMP(3),
      "revokedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "TerminalBindCode_pkey" PRIMARY KEY ("id")
    );
    SELECT c.oid INTO table_oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'TerminalBindCode';
  ELSE
    SELECT count(*) INTO shape_count
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'TerminalBindCode'
      AND (
        (column_name = 'id' AND data_type = 'text' AND is_nullable = 'NO') OR
        (column_name = 'terminalId' AND data_type = 'text' AND is_nullable = 'NO') OR
        (column_name = 'terminalCode' AND data_type = 'text' AND is_nullable = 'NO') OR
        (column_name = 'codeHash' AND data_type = 'text' AND is_nullable = 'NO') OR
        (column_name = 'createdBy' AND data_type = 'text' AND is_nullable = 'YES') OR
        (column_name = 'expiresAt' AND data_type = 'timestamp without time zone' AND is_nullable = 'NO') OR
        (column_name = 'usedAt' AND data_type = 'timestamp without time zone' AND is_nullable = 'YES') OR
        (column_name = 'revokedAt' AND data_type = 'timestamp without time zone' AND is_nullable = 'YES') OR
        (column_name = 'createdAt' AND data_type = 'timestamp without time zone' AND is_nullable = 'NO')
      );
    IF shape_count <> 9 OR (
      SELECT count(*) FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'TerminalBindCode'
    ) <> 9 THEN
      RAISE EXCEPTION 'TerminalBindCode exists with an incompatible column shape; repair it explicitly before deploy';
    END IF;
    IF (
      SELECT count(*)
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = table_oid
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND (
          (a.attname = 'createdAt' AND lower(regexp_replace(COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), '\s', '', 'g')) IN ('current_timestamp', 'now()')) OR
          (a.attname <> 'createdAt' AND d.oid IS NULL)
        )
    ) <> 9 THEN
      RAISE EXCEPTION 'TerminalBindCode exists with incompatible column defaults; only createdAt DEFAULT CURRENT_TIMESTAMP is allowed';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.conrelid = table_oid
        AND c.contype = 'p'
        AND cardinality(c.conkey) = 1
        AND a.attname = 'id'
    ) THEN
      RAISE EXCEPTION 'TerminalBindCode exists without the expected id primary key';
    END IF;
  END IF;

  IF EXISTS (
    SELECT "codeHash" FROM "TerminalBindCode" GROUP BY "codeHash" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'TerminalBindCode contains duplicate codeHash values';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "TerminalBindCode" b
    LEFT JOIN "Terminal" t ON t."id" = b."terminalId"
    WHERE t."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'TerminalBindCode contains orphan terminalId values';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TerminalBindCode_codeHash_key" ON "TerminalBindCode"("codeHash");
CREATE INDEX IF NOT EXISTS "TerminalBindCode_terminalId_idx" ON "TerminalBindCode"("terminalId");
CREATE INDEX IF NOT EXISTS "TerminalBindCode_terminalCode_idx" ON "TerminalBindCode"("terminalCode");
CREATE INDEX IF NOT EXISTS "TerminalBindCode_expiresAt_idx" ON "TerminalBindCode"("expiresAt");
CREATE INDEX IF NOT EXISTS "TerminalBindCode_usedAt_idx" ON "TerminalBindCode"("usedAt");
CREATE INDEX IF NOT EXISTS "TerminalBindCode_revokedAt_idx" ON "TerminalBindCode"("revokedAt");

DO $$
DECLARE
  table_oid oid;
  index_oid oid;
BEGIN
  SELECT c.oid INTO table_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relname = 'TerminalBindCode';

  SELECT c.oid INTO index_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema()
    AND c.relname = 'TerminalBindCode_codeHash_key'
    AND c.relkind = 'i';

  IF index_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indexrelid = index_oid
      AND i.indrelid = table_oid
      AND i.indisunique
      AND i.indisvalid
      AND i.indisready
      AND i.indnkeyatts = 1
      AND i.indnatts = 1
      AND i.indexprs IS NULL
      AND i.indpred IS NULL
      AND a.attname = 'codeHash'
  ) THEN
    RAISE EXCEPTION 'TerminalBindCode_codeHash_key has an incompatible definition';
  END IF;
END $$;

DO $$
DECLARE
  table_oid oid;
  terminal_oid oid;
BEGIN
  SELECT c.oid INTO table_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relname = 'TerminalBindCode';

  SELECT c.oid INTO terminal_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relname = 'Terminal';

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = table_oid AND contype = 'f' AND conname = 'TerminalBindCode_terminalId_fkey'
  ) THEN
    ALTER TABLE "TerminalBindCode"
      ADD CONSTRAINT "TerminalBindCode_terminalId_fkey"
      FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint fk
    JOIN pg_attribute source_column
      ON source_column.attrelid = fk.conrelid AND source_column.attnum = fk.conkey[1]
    JOIN pg_attribute target_column
      ON target_column.attrelid = fk.confrelid AND target_column.attnum = fk.confkey[1]
    WHERE fk.conrelid = table_oid
      AND fk.contype = 'f'
      AND fk.conname = 'TerminalBindCode_terminalId_fkey'
      AND fk.confrelid = terminal_oid
      AND cardinality(fk.conkey) = 1
      AND cardinality(fk.confkey) = 1
      AND source_column.attname = 'terminalId'
      AND target_column.attname = 'id'
      AND fk.confupdtype = 'c'
      AND fk.confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'TerminalBindCode_terminalId_fkey has an incompatible definition';
  END IF;
END $$;
