# File Assets Gate 2 Readiness Recheck Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after this plan has passed review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconfirm, without mutating preproduction, whether the frozen Gate 2 candidate `2187f6a7` is still ready for a user-approved deployment refresh.

**Architecture:** The recheck separates local repository/candidate evidence from preproduction host evidence. It only runs static local gates and read-only SSH/curl commands; it records redacted evidence in a dedicated acceptance report and leaves Gate 2 execution blocked until the user explicitly approves the mutation step.

**Tech Stack:** Git, pnpm, NestJS API verify scripts, SSH, PM2 status, curl health checks, redacted environment fingerprinting.

---

## Scope

Target:

- Local branch `codex/file-assets-gate2-readiness-recheck`.
- Frozen candidate `2187f6a7`.
- Preproduction host read-only status.

Non-target:

- No archive upload.
- No remote file writes.
- No app directory switch.
- No dependency install or build on the server.
- No PostgreSQL migration or backup creation.
- No PM2 restart.
- No COS/DB/account/test-file writes.
- No production domain, nginx, DNS, secret, SMS/OCR/TRTC/ASR/TTS, Windows, printer, or scanner changes.

## Hard Stops

Stop the recheck and do not proceed to any Gate 2 confirmation request if any of these occur:

- `verify:file-assets-trial-acceptance` is no longer static/read-only.
- `git diff --name-only 2187f6a7` or `git ls-files --others --exclude-standard` shows runtime-impacting paths outside `docs/`, `.ccg/`, or `services/api/scripts/verify-file-assets-trial-acceptance.ts`.
- Any planned remote command contains mutating tokens such as `>`, `tee`, `touch`, `mkdir`, `rm`, `mv`, `cp`, `scp`, `rsync`, `restart`, `reload`, `start`, `stop`, `migrate`, `deploy`, `pg_dump`, `psql -c`, `INSERT`, `UPDATE`, `DELETE`, `DROP`, `PUT`, or `POST`.
- Local or public health does not return `db=postgres`.
- `NODE_ENV` hint is `production` on the preproduction check.
- Disk budget is below `current_app_mb * 2 + 2048`.
- `DEPLOY_SOURCE.txt` or command output contains secrets, tokens, complete URLs with credentials, signed URL query strings, full phone numbers, or resume text.

## Task 1: Local Static Readiness

**Files:**

- Read: repository state
- Modify later: `docs/acceptance/user-file-assets-gate2-readiness-recheck.md`

- [ ] **Step 1: Confirm branch and frozen candidate**

Run:

```bash
git status --short --branch
git rev-parse --short HEAD
git cat-file -e 2187f6a7^{commit}
git diff --name-only 2187f6a7
git ls-files --others --exclude-standard
```

Expected:

- Branch is `codex/file-assets-gate2-readiness-recheck`.
- `2187f6a7` is reachable.
- Changes since `2187f6a7` are governance-only unless the deployment candidate is intentionally refreshed.
- Untracked files are only this task's `.ccg/` records while the task is in progress.
- If any runtime-impacting path appears, stop and refresh the deployment candidate instead of continuing this recheck.

- [ ] **Step 2: Run local gates**

Run:

```bash
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
pnpm --filter @ai-job-print/api typecheck
git diff --check
```

Expected:

- All commands pass.
- The static gate still prints that it does not prove production/trial acceptance.
- `services/api/scripts/verify-file-assets-trial-acceptance.ts` remains local static/read-only: it imports `assert`, `child_process.execSync`, `fs.existsSync/readFileSync`, and `path.join`; it must not import DB clients, COS clients, Redis clients, HTTP clients, or filesystem write APIs.

- [ ] **Step 3: Check existing local candidate artifact without regenerating**

Run:

```bash
test -f /tmp/yitiji-preprod-2187f6a7.tar.gz && shasum -a 256 /tmp/yitiji-preprod-2187f6a7.tar.gz || true
test -f /tmp/yitiji-preprod-2187f6a7.sha256 && cat /tmp/yitiji-preprod-2187f6a7.sha256 || true
```

Expected:

- If files exist, the report records their sha256 and whether it matches the previously documented value.
- If files do not exist, the report records that local artifact regeneration remains a Gate 2 execution prerequisite. Do not regenerate in this read-only task.

## Task 2: Preproduction Read-Only Recheck

**Files:**

- Modify: `docs/acceptance/user-file-assets-gate2-readiness-recheck.md`

- [ ] **Step 0: Mechanically scan remote commands for mutation tokens**

Before running SSH/curl commands, compare the exact command strings to be executed against the Hard Stops token list above. Do not run the recheck if a command contains mutation tokens. Expected exceptions: `POSTGRES_URL` is an environment key name and is not an HTTP `POST` operation; `date`, `sed`, `pm2 status`, `pm2 describe`, `curl -fsS`, `du`, `df`, `test -f`, `stat`, `command -v`, and `node` read-only fingerprinting are allowed.

- [ ] **Step 1: Confirm remote app status without changing it**

Run against the preproduction host:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=8 root@<PREPROD_HOST> 'set -e; hostname; date; sed -n "1,40p" /srv/ai-job-print/DEPLOY_SOURCE.txt; pm2 status ai-job-print-api || true; curl -fsS http://127.0.0.1:3010/api/v1/health'
ssh -o BatchMode=yes -o ConnectTimeout=8 root@<PREPROD_HOST> 'pm2 describe ai-job-print-api | grep -Ei "status|restarts" || true'
ssh -o BatchMode=yes -o ConnectTimeout=8 root@<PREPROD_HOST> 'if [ -f /root/.pm2/logs/ai-job-print-api-error.log ]; then printf "recent_error_log_lines="; tail -n 50 /root/.pm2/logs/ai-job-print-api-error.log | wc -l; printf "recent_error_keyword_lines="; tail -n 50 /root/.pm2/logs/ai-job-print-api-error.log | grep -Eci "error|exception|fatal" || true; else echo "recent_error_log_lines=missing"; echo "recent_error_keyword_lines=missing"; fi'
curl -fsS --max-time 8 http://<PREPROD_HOST>/api/v1/health
```

Expected:

- Host/time are recorded with host redacted as `<PREPROD_HOST>`.
- Current self-reported deployment is recorded.
- PM2 is online or any deviation is recorded.
- PM2 restart count and recent error-log counts are recorded; raw log lines are not committed.
- Local and public health return `db=postgres` or any deviation is recorded.
- `DEPLOY_SOURCE.txt` output is treated as redaction-required before committing the report.

- [ ] **Step 2: Confirm disk/env/tool readiness without printing secrets**

Run:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=8 root@<PREPROD_HOST> 'set -e; APP_MB=$(du -sm /srv/ai-job-print | cut -f1); AVAIL_MB=$(df -Pm /srv | tail -n 1 | tr -s " " | cut -d " " -f4); REQUIRED_MB=$((APP_MB * 2 + 2048)); printf "app_mb=%s avail_mb=%s required_mb=%s\n" "$APP_MB" "$AVAIL_MB" "$REQUIRED_MB"; if [ "$AVAIL_MB" -lt "$REQUIRED_MB" ]; then echo "[ERROR] disk budget below Gate 2 requirement" >&2; exit 1; fi; test -f /srv/ai-job-print/services/api/.env; stat -c "%a %U:%G %n" /srv/ai-job-print/services/api/.env; command -v node; command -v pnpm; command -v pg_dump || true; command -v pm2'
```

Expected:

- Disk budget is sufficient or the report marks Gate 2 blocked.
- API env exists and only path/permissions are printed.
- Tool availability is recorded.

- [ ] **Step 3: Confirm resource fingerprints without printing values**

Run:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=8 root@<PREPROD_HOST> 'node - <<'"'"'NODE'"'"'
const fs = require("fs");
const crypto = require("crypto");
const envPath = "/srv/ai-job-print/services/api/.env";
const env = Object.fromEntries(fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter(Boolean).filter((line) => !line.trim().startsWith("#")).map((line) => {
  const idx = line.indexOf("=");
  return idx === -1 ? [line, ""] : [line.slice(0, idx), line.slice(idx + 1)];
}));
const keys = ["DATABASE_URL", "POSTGRES_URL", "REDIS_URL", "FILE_STORAGE_DRIVER", "TENCENT_COS_BUCKET", "TENCENT_COS_REGION", "NODE_ENV"];
for (const key of keys) {
  const value = env[key] || "";
  const fingerprint = value ? crypto.createHash("sha256").update(value).digest("hex").slice(0, 10) : "missing";
  let hint = value ? "set" : "missing";
  if (key === "DATABASE_URL" || key === "POSTGRES_URL") hint = value ? (value.includes("postgres") ? "postgres" : "not-postgres") : "missing";
  if (key === "FILE_STORAGE_DRIVER") hint = value || "missing";
  if (key === "NODE_ENV") hint = value || "missing";
  console.log(`${key}: ${hint} fp=${fingerprint}`);
}
NODE'
```

Expected:

- Only hints and short fingerprints are printed.
- The report records whether PostgreSQL, Redis, COS driver, COS bucket/region, and NODE_ENV are present enough for Gate 2 readiness.
- If `NODE_ENV` hint is `production`, stop and mark Gate 2 no-go until the host/resource target is reverified.
- The committed report may keep only hints and short fingerprints, never raw values.

## Task 3: Report and Review

**Files:**

- Create: `docs/acceptance/user-file-assets-gate2-readiness-recheck.md`
- Modify: `docs/acceptance/user-file-assets-preprod-execution-record.md`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.ccg/tasks/file-assets-gate2-readiness-recheck/task.json`
- Create: `.ccg/tasks/file-assets-gate2-readiness-recheck/review.md`

- [ ] **Step 1: Write the readiness report**

The report must include:

- Status: read-only recheck only, Gate 2 not executed.
- Local gate results.
- Candidate artifact state.
- Redacted preproduction status.
- Go/no-go table for Gate 2 confirmation.
- Remaining user confirmation statement.

- [ ] **Step 2: Update progress entries**

Progress docs must say this task rechecked readiness only and did not execute Gate 2.

- [ ] **Step 3: Run final verification and dual review**

Run:

```bash
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
pnpm --filter @ai-job-print/api typecheck
git diff --check
```

Then run Claude + Antigravity review over the diff. Fix Critical findings before commit.
