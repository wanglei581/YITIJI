# me-resumes-actions-hardening review

## Scope

- Harden `/me/resumes` action recovery for report, optimize, job-fit, and generated resume preview.
- Keep backend/API contracts unchanged.
- Do not expose resume payloads or add any platform delivery flow.

## Implementation

- `/me/resumes` now opens action pages with both `location.state.taskId` and `?taskId=...`, so refresh/direct recovery keeps the intended task.
- `ResumeReportPage`, `ResumeOptimizePage`, and `JobFitPage` only reuse anonymous `session.accessToken` when the task itself came from the anonymous session. Explicit state/query task ids rely on member Bearer token only.
- `ResumeGeneratePreviewPage` initializes restore loading from state or query task id.
- `JobFitPage` uses existing `getLatestJobFit` to recover completed history, clears stale result on task changes/failures, and avoids `/jobs/` empty-route jumps when recovered data lacks an internal job id.

## Dual-model review

- Antigravity: requested changes for stale JobFit result cleanup and generated preview restore loading. Both were fixed.
- Claude: approved final diff; noted that recovered job-fit data lacks internal job id, so hiding the source-platform CTA in recovered mode is an acceptable safe fallback.
- Adjudication: do not invent a `/jobs/:id` target from `sourceUrl` or `externalId`; future recovery of source CTA requires backend to return an internal job id or a dedicated tracked external-jump action.

## Verification

- `pnpm --filter @ai-job-print/kiosk typecheck` passed.
- `pnpm --filter @ai-job-print/kiosk lint` passed with existing `KioskBusyContext.tsx` fast-refresh warnings only.
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build` passed with existing large chunk warning only.
- `pnpm --filter @ai-job-print/api verify:member-assets-c2d` passed using temporary SQLite migration DB and isolated env secrets; 9/9 checks passed.
