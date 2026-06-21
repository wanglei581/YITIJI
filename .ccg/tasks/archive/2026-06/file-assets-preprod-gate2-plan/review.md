# Gate 2 Plan Review

## Scope

This branch is documentation and execution-plan only. It did not execute any preproduction deployment, database migration, PM2 restart, COS operation, account operation, or file upload.

Reviewed files:

- `docs/superpowers/plans/2026-06-22-file-assets-preprod-gate2-refresh.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-preprod-gate2-plan/requirements.md`

## Review Findings and Resolutions

Initial Claude and Antigravity review found that Gate 2 could not be a Git checkout flow because Gate 1 proved `/srv/ai-job-print` is a `local-git-archive` deployment. The plan was updated to use a locally generated `git archive`, upload to `/srv`, unpack a candidate directory, preserve runtime/build env files, build, back up PostgreSQL, apply additive candidate migrations, atomically promote the candidate, restart PM2, and verify health.

The review cycle also found and resolved these execution risks:

- Candidate `9146fa1c` requires PostgreSQL additive migrations. The plan now includes DB backup followed by candidate `db:pg:deploy`; without this, file-asset code could boot against an incompatible schema.
- `awk "{print \\$1}"` inside nested ssh quoting was replaced with `cut`.
- Node heredocs were removed from command substitution and now write temporary fingerprint files.
- JavaScript template literals were removed from heredoc content to avoid shell parsing hazards.
- The DB target parser no longer depends on root-level `dotenv`; it reads `services/api/.env` directly.
- `.pgpass` and target env values are written mode `0600`, cleaned by `trap`, and libpq variables are exported with `set -a`.
- URL components are decoded exactly once before `.pgpass` escaping; passwords containing `%` are not decoded twice.
- `pg_dump` uses `-w` fail-fast mode and never places the DB URL on the command line.
- Ambient DB/libpq variables are unset before deriving the backup target from the candidate API `.env`.
- `pm2 describe` was removed to avoid printing environment variables. Final PM2 verification only checks `pm2 status` online plus API dist hash and health.
- Disk space preflight now computes `APP_MB`, `AVAIL_MB`, and `REQUIRED_MB` mechanically.
- Public health curl uses `-L` and the local verification block uses `set -euo pipefail`.

## Final Review Status

- Claude final review: APPROVE. No Critical or Warning issues; remaining notes were informational.
- Antigravity final review: the final targeted calls completed without valid `agent_message` output after prior Antigravity findings had been addressed. Earlier Antigravity findings were not ignored; the plan was revised for its shell escaping, `.pgpass`, PM2 leakage, checksum, curl, and fail-fast concerns, and local verification was rerun after the changes.

Because the last Antigravity invocation did not return a valid final verdict, this review record does not claim a final Antigravity APPROVE. The practical blocking issues it previously raised were resolved and independently verified locally.

## Local Verification

Fresh verification after the final plan changes:

```bash
bash -n /tmp/yitiji-gate2-step5-inner.sh
bash -n /tmp/yitiji-gate2-health-block.sh
git diff --check
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
```

All commands passed. The `verify:file-assets-trial-acceptance` output explicitly remains a static document check only and does not prove production or trial acceptance.
