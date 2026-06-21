# File Assets Preproduction Gate 2 Refresh Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after explicit user confirmation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the Baidu Cloud preproduction application package from the current self-reported `6b055d6b` deployment to the file-assets candidate `9a702981`, including the candidate's required additive PostgreSQL schema migrations, without changing business data, COS objects, secrets, nginx, DNS, or Windows hardware.

**Architecture:** The preproduction server is not a Git checkout; it is a `local-git-archive` unpacked application directory. Deployment therefore uses a locally generated pruned runtime archive from `9a702981`, uploads it to `/srv`, unpacks the candidate, preserves runtime and build-time env files without printing them, installs dependencies, generates both Prisma clients, builds API/Kiosk/Admin, backs up PostgreSQL, applies candidate migrations, atomically renames the current app directory as the rollback copy, promotes the candidate, restarts the existing PM2 process, and validates health plus build fingerprints.

**Tech Stack:** Git archive, scp/ssh, pnpm workspace, NestJS API, Prisma SQLite/PostgreSQL clients and migrations, pg_dump, React/Vite Kiosk/Admin builds, PM2, PostgreSQL health endpoint.

---

## Approval Gate

Do not execute this plan until the user explicitly confirms Gate 2 deployment refresh.

Before executing, restate:

- **Target:** preproduction only, refresh `/srv/ai-job-print` to candidate `9a702981`.
- **Non-target:** production domain/cert, business data writes, COS objects, secrets, nginx, SMS/OCR/TRTC/ASR/TTS config, Windows hardware.
- **Allowed remote changes:** `/srv/yitiji-preprod-9a702981.tar.gz`, `/srv/db-backups/pre-file-assets-gate2-<timestamp>.dump`, `/srv/ai-job-print-prev-<timestamp>`, `/srv/ai-job-print`, generated dependencies/build output, candidate PostgreSQL additive migrations, PM2 restart of `ai-job-print-api`.
- **Verification:** artifact sha256, DB backup file, migration status/deploy output, API dist hash, `DEPLOY_SOURCE.txt` metadata, PM2 online, local/public health `db=postgres`, no secret output.
- **Rollback:** restore `/srv/ai-job-print-prev-<timestamp>` and restart PM2.

## Task 1: Local Candidate Artifact

**Files:**
- Read: local Git repository
- Output outside Git: `/tmp/yitiji-preprod-9a702981.tar.gz`
- Output outside Git: `/tmp/yitiji-preprod-9a702981.sha256`

- [ ] **Step 1: Confirm local clean base**

Run:

```bash
git status --short --branch
git rev-parse --short 9a702981
git cat-file -e 9a702981^{commit}
```

Expected:

- Current branch is the Gate 2 execution branch.
- `9a702981` exists locally.
- No unrelated uncommitted changes.

- [ ] **Step 2: Generate pruned runtime archive from the candidate commit**

Run:

```bash
git archive --format=tar --prefix=ai-job-print/ 9a702981 -- \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json \
  apps services packages \
  ':(exclude)**/.env.example' \
  | gzip -n -9 > /tmp/yitiji-preprod-9a702981.tar.gz
(cd /tmp && shasum -a 256 yitiji-preprod-9a702981.tar.gz > yitiji-preprod-9a702981.sha256)
ls -lh /tmp/yitiji-preprod-9a702981.tar.gz /tmp/yitiji-preprod-9a702981.sha256
```

Expected:

- Archive exists outside the repo.
- sha256 is recorded in the execution record.
- The archive is pruned to build/runtime source paths only: root workspace manifests plus `apps/`, `services/`, and `packages/`.
- `docs/`, `.ccg/`, `.github/`, `.claude/`, README/agent instruction files, `.env.example`, `.env`, `node_modules`, `dist`, real user files, logs, screenshots, DB backups, and secrets are not included.
- `gzip -n -9` is used so repeated local generation produces the same bytes and sha256.

## Task 2: Remote Preflight

**Remote target:** `<PREPROD_HOST>`

- [ ] **Step 1: Check current deployment metadata**

Run:

```bash
ssh root@<PREPROD_HOST> 'set -e; hostname; date; sed -n "1,40p" /srv/ai-job-print/DEPLOY_SOURCE.txt; pm2 status ai-job-print-api || true; curl -fsS http://127.0.0.1:3010/api/v1/health'
```

Expected:

- Host matches Gate 1.
- Current self-reported commit is `6b055d6b`.
- PM2 is online.
- health returns `db=postgres`.

- [ ] **Step 2: Check disk and protected files without printing secrets**

Run:

```bash
ssh root@<PREPROD_HOST> 'set -e; APP_MB=$(du -sm /srv/ai-job-print | cut -f1); AVAIL_MB=$(df -Pm /srv | tail -n 1 | tr -s " " | cut -d " " -f4); REQUIRED_MB=$((APP_MB * 2 + 2048)); printf "app_mb=%s avail_mb=%s required_mb=%s\n" "$APP_MB" "$AVAIL_MB" "$REQUIRED_MB"; test "$AVAIL_MB" -ge "$REQUIRED_MB"; test -f /srv/ai-job-print/services/api/.env; stat -c "%a %U:%G %n" /srv/ai-job-print/services/api/.env'
```

Expected:

- Enough free space for current app, candidate app, new archive, and DB backup. As a concrete gate, record `du -sm /srv/ai-job-print` and `df -Pm /srv`; stop unless available MB is at least `current_app_mb * 2 + 2048`.
- `.env` exists.
- `.env` content is not printed.

- [ ] **Step 3: Confirm preproduction resource isolation by fingerprint only**

Run a redacted check that prints only labels/fingerprints, never values:

```bash
ssh root@<PREPROD_HOST> 'node - <<'"'"'NODE'"'"'
const fs = require("fs");
const crypto = require("crypto");
const envPath = "/srv/ai-job-print/services/api/.env";
const env = Object.fromEntries(fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter(Boolean).filter((line) => !line.trim().startsWith("#")).map((line) => {
  const idx = line.indexOf("=");
  return idx === -1 ? [line, ""] : [line.slice(0, idx), line.slice(idx + 1)];
}));
const keys = ["DATABASE_URL", "POSTGRES_URL", "REDIS_URL", "FILE_STORAGE_DRIVER", "COS_BUCKET", "COS_REGION", "NODE_ENV"];
for (const key of keys) {
  const value = env[key] || "";
  const fingerprint = value ? crypto.createHash("sha256").update(value).digest("hex").slice(0, 10) : "missing";
  let hint = "set";
  if (key === "DATABASE_URL") hint = value.includes("postgres") ? "postgres" : "not-postgres";
  if (key === "POSTGRES_URL") hint = value ? (value.includes("postgres") ? "postgres" : "not-postgres") : "missing";
  if (key === "FILE_STORAGE_DRIVER") hint = value || "missing";
  if (key === "NODE_ENV") hint = value || "missing";
  console.log(`${key}: ${hint} fp=${fingerprint}`);
}
NODE'
```

Expected:

- `DATABASE_URL` hint is `postgres`, or `POSTGRES_URL` is present and `postgres`; Prisma PostgreSQL migration target is `POSTGRES_URL ?? DATABASE_URL`.
- `FILE_STORAGE_DRIVER` hint is `cos`.
- `NODE_ENV` hint is acceptable for current preproduction startup policy.
- The output contains no URLs, passwords, usernames, secret IDs, secret keys, bucket full names, or tokens.

Stop if resource isolation cannot be proven from existing deployment notes and redacted fingerprints.

- [ ] **Step 4: Create a shared timestamp for this Gate 2 attempt**

Run:

```bash
ssh root@<PREPROD_HOST> 'date +%Y%m%d%H%M%S > /srv/yitiji-gate2-ts; cat /srv/yitiji-gate2-ts'
```

Expected:

- Timestamp is recorded.
- This timestamp is used consistently for DB backup, app rollback directory, failed app directory, and metadata.

## Task 3: Upload and Prepare Candidate

- [ ] **Step 1: Upload archive and checksum**

Run:

```bash
scp /tmp/yitiji-preprod-9a702981.tar.gz /tmp/yitiji-preprod-9a702981.sha256 root@<PREPROD_HOST>:/srv/
```

Expected:

- Files appear in `/srv`.
- No application state changes yet.

- [ ] **Step 2: Verify checksum remotely**

Run:

```bash
ssh root@<PREPROD_HOST> 'cd /srv && sha256sum -c yitiji-preprod-9a702981.sha256'
```

Expected:

- sha256 check passes.

- [ ] **Step 3: Unpack candidate into a temporary directory**

Run:

```bash
ssh root@<PREPROD_HOST> 'set -e; rm -rf /srv/ai-job-print-candidate-9a702981; mkdir -p /srv/ai-job-print-candidate-9a702981; tar -xzf /srv/yitiji-preprod-9a702981.tar.gz -C /srv/ai-job-print-candidate-9a702981 --strip-components=1; test -f /srv/ai-job-print-candidate-9a702981/package.json'
```

Expected:

- Candidate directory exists and contains the app.
- Current `/srv/ai-job-print` is untouched.

- [ ] **Step 4: Preserve runtime and build-time environment without printing it**

Run:

```bash
ssh root@<PREPROD_HOST> 'set -e; cd /srv/ai-job-print; for f in services/api/.env .env apps/kiosk/.env apps/kiosk/.env.local apps/admin/.env apps/admin/.env.local apps/partner/.env apps/partner/.env.local; do if [ -f "$f" ]; then mkdir -p "/srv/ai-job-print-candidate-9a702981/$(dirname "$f")"; cp -p "$f" "/srv/ai-job-print-candidate-9a702981/$f"; fi; done; find /srv/ai-job-print-candidate-9a702981 -path "*/node_modules/*" -prune -o \( -name ".env" -o -name ".env.local" \) -print | sed "s#/srv/ai-job-print-candidate-9a702981/##"'
```

Expected:

- API `.env` exists in candidate API directory.
- Any existing frontend build-time `.env` / `.env.local` files are copied by path.
- Only file paths are printed; content is never printed.
- Record which frontend env files were found. If no Kiosk build-time env file is present, stop and confirm whether the prior deployment used inline `VITE_*` variables before building.

## Task 4: Build Candidate Before Switchover

- [ ] **Step 1: Install dependencies**

Run:

```bash
ssh root@<PREPROD_HOST> 'cd /srv/ai-job-print-candidate-9a702981 && pnpm install --frozen-lockfile'
```

Expected:

- Install succeeds.
- Stop and remove candidate directory if it fails.

- [ ] **Step 2: Generate Prisma clients**

Run:

```bash
ssh root@<PREPROD_HOST> 'cd /srv/ai-job-print-candidate-9a702981 && pnpm --filter @ai-job-print/api exec prisma generate && pnpm --filter @ai-job-print/api db:pg:generate'
```

Expected:

- SQLite and PostgreSQL Prisma clients are generated.

- [ ] **Step 3: Build API/Kiosk/Admin**

Run:

```bash
ssh root@<PREPROD_HOST> 'cd /srv/ai-job-print-candidate-9a702981 && pnpm --filter @ai-job-print/api build && VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk build && VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build'
```

Expected:

- Builds pass.
- Stop if Kiosk build fails due missing `VITE_API_MODE=http` or missing TRTC production env. Do not bypass with text-only mode unless separately approved.
- Treat `VITE_API_BASE_URL=/api/v1` as a Gate 2 operator policy requirement: do not rely on the Vite config default fallback for Kiosk/Admin builds.
- Stop if Admin build fails due missing `VITE_API_MODE=http`.

- [ ] **Step 4: Write candidate deploy metadata**

Run:

```bash
ssh root@<PREPROD_HOST> 'set -e; TS=$(cat /srv/yitiji-gate2-ts); SHA=$(cut -d " " -f1 /srv/yitiji-preprod-9a702981.sha256); API_HASH=$(sha256sum /srv/ai-job-print-candidate-9a702981/services/api/dist/main.js | cut -d " " -f1); echo "$API_HASH" > /srv/yitiji-api-main-9a702981.sha256; cat > /srv/ai-job-print-candidate-9a702981/DEPLOY_SOURCE.txt <<EOF
source=local-git-archive
commit=9a702981
artifact=/srv/yitiji-preprod-9a702981.tar.gz
sha256=$SHA
api_dist_main_sha256=$API_HASH
built_at=$(date -Is)
previous=/srv/ai-job-print-prev-$TS
EOF'
```

Expected:

- Metadata exists.
- Metadata uses the shared timestamp and computed hashes; no manual placeholder editing.

- [ ] **Step 5: Back up PostgreSQL and apply candidate migrations**

Run:

```bash
ssh root@<PREPROD_HOST> 'bash -lc '"'"'
set -euo pipefail
TS=$(cat /srv/yitiji-gate2-ts)
mkdir -p /srv/db-backups
cd /srv/ai-job-print-candidate-9a702981
unset POSTGRES_URL DATABASE_URL PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSSLMODE
PGPASSFILE="/srv/.pgpass-yitiji-gate2-$TS"
PGTARGET_ENV="/srv/yitiji-pg-target-$TS.env"
TARGET_FP_FILE="/srv/yitiji-pg-target-fp-$TS"
CONFIG_FP_FILE="/srv/yitiji-pg-config-fp-$TS"
trap '"'"'rm -f "$PGPASSFILE" "$PGTARGET_ENV" "$TARGET_FP_FILE" "$CONFIG_FP_FILE"'"'"' EXIT
TS="$TS" PGPASSFILE="$PGPASSFILE" PGTARGET_ENV="$PGTARGET_ENV" node - <<'"'"'NODE'"'"' > "$TARGET_FP_FILE"
const fs = require("fs");
const crypto = require("crypto");
const parseEnvFile = (path) => Object.fromEntries(fs.readFileSync(path, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
  const idx = line.indexOf("=");
  if (idx === -1) return [line, ""];
  return [line.slice(0, idx), line.slice(idx + 1).replace(/^['"]|['"]$/g, "")];
}));
const env = parseEnvFile("services/api/.env");
const value = env["POSTGRES_URL"] ?? env["DATABASE_URL"] ?? "";
if (!value) process.exit(2);
const url = new URL(value);
const escapePgpass = (text) => text.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
const host = url.hostname;
const port = url.port || "5432";
const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const pgpassFile = process.env.PGPASSFILE;
const targetFile = process.env.PGTARGET_ENV;
const shellQuote = (text) => {
  if (/[\r\n]/.test(text)) throw new Error("unsafe newline in PostgreSQL URL component");
  return "'" + text.replace(/'/g, "'\\''") + "'";
};
fs.writeFileSync(pgpassFile, escapePgpass(host) + ":" + escapePgpass(port) + ":" + escapePgpass(database) + ":" + escapePgpass(user) + ":" + escapePgpass(password) + "\n", { mode: 0o600 });
const targetRows = [
  ["PGHOST", host],
  ["PGPORT", port],
  ["PGDATABASE", database],
  ["PGUSER", user],
  ["PGPASSFILE", pgpassFile],
];
const sslmode = url.searchParams.get("sslmode");
if (sslmode) targetRows.push(["PGSSLMODE", sslmode]);
fs.writeFileSync(targetFile, targetRows.map(([key, val]) => key + "=" + shellQuote(val)).join("\n") + "\n", { mode: 0o600 });
process.stdout.write(crypto.createHash("sha256").update(value).digest("hex").slice(0, 10));
NODE
TARGET_FP=$(cat "$TARGET_FP_FILE")
node - <<'"'"'NODE'"'"' > "$CONFIG_FP_FILE"
const fs = require("fs");
const crypto = require("crypto");
const parseEnvFile = (path) => Object.fromEntries(fs.readFileSync(path, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
  const idx = line.indexOf("=");
  if (idx === -1) return [line, ""];
  return [line.slice(0, idx), line.slice(idx + 1).replace(/^['"]|['"]$/g, "")];
}));
const env = parseEnvFile("services/api/.env");
const value = env["POSTGRES_URL"] ?? env["DATABASE_URL"] ?? "";
process.stdout.write(crypto.createHash("sha256").update(value).digest("hex").slice(0, 10));
NODE
CONFIG_FP=$(cat "$CONFIG_FP_FILE")
test "$TARGET_FP" = "$CONFIG_FP"
echo "PG_MIGRATION_TARGET fp=$TARGET_FP"
set -a
. "$PGTARGET_ENV"
set +a
pg_dump -w -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -F c -f "/srv/db-backups/pre-file-assets-gate2-$TS.dump"
test -s "/srv/db-backups/pre-file-assets-gate2-$TS.dump"
set +e
pnpm --filter @ai-job-print/api exec prisma migrate status --config prisma.postgres.config.ts > /srv/yitiji-migrate-status-before.txt 2>&1
STATUS=$?
set -e
cat /srv/yitiji-migrate-status-before.txt
if [ "$STATUS" -ne 0 ]; then
  PENDING=$(grep -E "^[[:space:]]*[0-9]{14}_" /srv/yitiji-migrate-status-before.txt || true)
  if [ -z "$PENDING" ]; then
    echo "migrate status failed but no parseable pending migrations were found" >&2
    exit 1
  fi
  UNEXPECTED=$(grep -E "^[[:space:]]*[0-9]{14}_" /srv/yitiji-migrate-status-before.txt | grep -Ev "20260621154500_file_asset_retention_model|20260621162500_file_retention_expires_nullable" || true)
  if [ -n "$UNEXPECTED" ]; then
    echo "unexpected pending migrations:" >&2
    echo "$UNEXPECTED" >&2
    exit 1
  fi
fi
pnpm --filter @ai-job-print/api db:pg:deploy
pnpm --filter @ai-job-print/api exec prisma migrate status --config prisma.postgres.config.ts
'"'"''
```

Expected:

- DB backup exists and is non-empty.
- Backup derives its `pg_dump` host/user/database target from the same configured URL string used by Prisma PostgreSQL deploy: `POSTGRES_URL ?? DATABASE_URL`.
- The script unsets ambient DB/libpq variables, parses the env file with the same `POSTGRES_URL ?? DATABASE_URL` precedence as the Prisma PostgreSQL config, and prints only a redacted fingerprint. `pg_dump` still uses exported decomposed libpq parameters to avoid exposing the URL on the command line.
- `pg_dump` uses a temporary mode-600 `.pgpass` file plus host/user/database args and `-w` fail-fast mode, not a connection URL on the command line.
- Pre-deploy pending migrations are either none or exactly the expected file-asset migrations:
  - `20260621154500_file_asset_retention_model`
  - `20260621162500_file_retention_expires_nullable`
- Expected pending candidate migrations are applied by `db:pg:deploy`.
- Final migrate status reports database schema is up to date.
- No database URL, username, password, or secret is printed.

Stop if `pg_dump`, `db:pg:deploy`, or final migrate status fails.

## Task 5: Switchover and Health

- [ ] **Step 1: Atomically move current app directory to rollback path**

Run:

```bash
ssh root@<PREPROD_HOST> 'set -e; TS=$(cat /srv/yitiji-gate2-ts); test -d /srv/ai-job-print-candidate-9a702981; mv /srv/ai-job-print "/srv/ai-job-print-prev-$TS"; test -d "/srv/ai-job-print-prev-$TS"'
```

Expected:

- Rollback directory exists.
- This uses atomic rename instead of `cp -a`, so it does not duplicate `node_modules` or risk a partial copied backup.

- [ ] **Step 2: Replace app directory**

Run:

```bash
ssh root@<PREPROD_HOST> 'set -e; mv /srv/ai-job-print-candidate-9a702981 /srv/ai-job-print'
```

Expected:

- `/srv/ai-job-print` now contains candidate.
- Rollback directory remains available for immediate rollback.

- [ ] **Step 3: Restart existing PM2 process**

Run:

```bash
ssh root@<PREPROD_HOST> 'pm2 restart ai-job-print-api'
```

Expected:

- PM2 restart succeeds.

- [ ] **Step 4: Verify health**

Run:

```bash
set -euo pipefail
ssh root@<PREPROD_HOST> 'set -e; curl -fsSL http://127.0.0.1:3010/api/v1/health | tee /tmp/yitiji-health-local.json; grep -q "\"success\":true" /tmp/yitiji-health-local.json; grep -q "\"db\":\"postgres\"" /tmp/yitiji-health-local.json'
curl -fsSL --max-time 8 http://<PREPROD_HOST>/api/v1/health | tee /tmp/yitiji-health-public.json
grep -q '"success":true' /tmp/yitiji-health-public.json
grep -q '"db":"postgres"' /tmp/yitiji-health-public.json
ssh root@<PREPROD_HOST> 'bash -lc '"'"'
set -e
EXPECTED=$(cut -d " " -f1 /srv/yitiji-api-main-9a702981.sha256)
ACTUAL=$(sha256sum /srv/ai-job-print/services/api/dist/main.js | cut -d " " -f1)
test "$EXPECTED" = "$ACTUAL"
sed -n "1,40p" /srv/ai-job-print/DEPLOY_SOURCE.txt
pm2 status ai-job-print-api | tee /tmp/yitiji-pm2-status.txt
grep -q "online" /tmp/yitiji-pm2-status.txt
'"'"''
```

Expected:

- Local and public health return `success=true`, `status=ok`, `db=postgres`.
- `DEPLOY_SOURCE.txt` reports `commit=9a702981`, but remains metadata only.
- API dist `main.js` hash matches the candidate build hash.
- PM2 process is online; do not print full `pm2 describe` output because it can expose environment variables. The verification chain is candidate build hash -> promoted disk file hash -> PM2 online -> local/public health.

## Task 6: Rollback Procedure

Use this only if switchover or health fails.

```bash
ssh root@<PREPROD_HOST> 'set -e; TS=$(cat /srv/yitiji-gate2-ts); mv /srv/ai-job-print "/srv/ai-job-print-failed-$TS" 2>/dev/null || true; mv "/srv/ai-job-print-prev-$TS" /srv/ai-job-print; pm2 restart ai-job-print-api; curl -fsS http://127.0.0.1:3010/api/v1/health'
```

Expected:

- Previous app is restored.
- PM2 is online.
- health returns `db=postgres`.
- Additive PostgreSQL migrations are not automatically reverted by code rollback. Old code should ignore the new nullable/defaulted columns; use the DB backup only if there is a verified schema/data emergency.

## Verification Before Commit

For this planning branch only:

```bash
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
git diff --check
```

This plan branch must not run any Gate 2 remote mutation commands.
