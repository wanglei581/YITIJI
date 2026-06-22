# Requirements: file-assets-gate2-readiness-recheck

## Goal

Before asking the user to approve Gate 2 remote mutation again, produce an up-to-date read-only readiness recheck for the user file/resume assets commercial-closure path.

## Target

- Local repository state on branch `codex/file-assets-gate2-readiness-recheck`.
- Frozen Gate 2 candidate `2187f6a7`.
- Preproduction host only, read-only checks only.

## Non-targets

- Do not upload archives.
- Do not unpack or replace `/srv/ai-job-print`.
- Do not write `/srv/yitiji-gate2-ts`.
- Do not run `pnpm install`, build, `prisma migrate deploy`, `pg_dump`, or PM2 restart.
- Do not write PostgreSQL, Redis, COS, user accounts, test files, retention policy, deletion state, AuditLog, nginx, DNS, secrets, SMS/OCR/TRTC/ASR/TTS, Windows hardware, printer, or scanner configuration.
- Do not claim Gate 2, Gate 3/Gate 4, formal production, trial operation, or Windows acceptance complete.

## Allowed files

- `.ccg/tasks/file-assets-gate2-readiness-recheck/*`
- `docs/superpowers/plans/2026-06-22-file-assets-gate2-readiness-recheck.md`
- `docs/superpowers/plans/2026-06-22-file-assets-preprod-gate2-refresh.md` only for correcting read-only env fingerprint key names discovered by this recheck.
- `docs/acceptance/user-file-assets-gate2-readiness-recheck.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `services/api/scripts/verify-file-assets-trial-acceptance.ts` only if adding static guards for the new readiness report is necessary.

## Read-only evidence to collect

- Local branch/status and frozen candidate reachability.
- `verify:file-assets-trial-acceptance`, API typecheck, and diff/secret/compliance scans.
- Existing local `/tmp/yitiji-preprod-2187f6a7.tar.gz` and `.sha256` presence/hash if present; do not regenerate unless explicitly needed.
- Preproduction host/time, current deployment metadata, PM2 online status, local/public health, disk budget, API env file presence/permissions, redacted resource fingerprints, and availability of tools needed by Gate 2.

## Validation

- Run local static gates.
- Run only read-only remote commands.
- Redact host, env values, URLs with secrets, phone numbers, and credentials in committed docs.
- Before running remote commands, mechanically scan the exact command strings for mutation tokens and stop on any unexpected match.
- Treat candidate drift, non-postgres health, `NODE_ENV=production`, disk shortfall, or sensitive output as no-go.
- Claude + Antigravity analysis before remote read-only checks, and Claude + Antigravity review before commit.

## Rollback

Local docs-only changes can be reverted by deleting this task/report/plan and restoring progress files. No remote rollback should be required because this task must not mutate remote state.
