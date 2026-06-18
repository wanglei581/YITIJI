# Review: profile-notifications-feedback-p1-clean

## Scope

Clean-picked P1 "消息通知 + 意见反馈" onto local `main` after P0a/P0b "我的权益" and P2 "权益活动" were already present.

## Verification

- `pnpm --filter @ai-job-print/api verify:feedback-notifications` PASS
- `pnpm --filter @ai-job-print/api verify:benefit-activities` PASS
- `pnpm --filter @ai-job-print/api verify:member-benefits-admin` PASS
- `pnpm --filter @ai-job-print/api typecheck` PASS
- `pnpm --filter @ai-job-print/shared typecheck` PASS
- `pnpm --filter @ai-job-print/kiosk typecheck` PASS
- `pnpm --filter @ai-job-print/admin typecheck` PASS
- `pnpm --filter @ai-job-print/api lint` PASS
- `pnpm --filter @ai-job-print/kiosk lint` PASS with existing Fast Refresh warnings only
- `pnpm --filter @ai-job-print/admin lint` PASS
- `pnpm --filter @ai-job-print/api build` PASS
- `VITE_API_MODE=http VITE_API_BASE_URL=http://localhost:3010/api/v1 pnpm --filter @ai-job-print/kiosk build` PASS
- `VITE_API_MODE=http VITE_API_BASE_URL=http://localhost:3010/api/v1 pnpm --filter @ai-job-print/admin build` PASS

Known non-gate: `verify:member-favorites-benefits` was not used as P1 proof because its external `DATABASE_URL` setup failed at Prisma schema engine initialization. P1's own verifier and benefit regressions passed.

## Dual Review

- Antigravity: APPROVE. Critical 0, Warning 0, Info 0.
- Claude: APPROVE. Critical 0, Warning 0. Info-only notes: `markAllRead` broadcast batch limit of 100, P1 single-page merged notification snapshot, duplicated forbidden recruiting regex could later move to a shared constant.

## Decision

No blocking issues remain for local clean merge. Baidu preproduction remains blocked by SSH public-key access, not by this P1 code.
