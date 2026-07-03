# AI Resume Diagnosis Context Phase 1 Implementation Plan

> For agentic workers: execute this plan exactly. Keep changes scoped to the files named below. Do not add new homepage entries, new resume routes, database migrations, hardware behavior, QR upload, Word/image export, or UI redesign in this phase.

## Goal

Make `selectedDimensions` and `targetContext` flow through the existing AI resume diagnosis path:

`ResumeSourcePage -> ResumeParsePage -> submitResumeParse -> ResumeParseRequestDto -> AiService -> LlmResumeProvider -> LlmResumeService -> ResumeReport.requestContext -> ResumeReportPage`.

The report output schema must remain the existing fixed 6 scoring dimensions. User-selected dimensions are only diagnosis emphasis and UI/report metadata, not a variable scoring schema.

## Architecture Constraints

- Keep the fixed 6 section keys: `basic`, `objective`, `experience`, `quantification`, `keyword`, `readability`.
- Do not store or audit raw resume text.
- Do not audit `targetContext.targetJob` raw text; audit only booleans/counts and safe enum-like fields.
- Nested DTOs must be explicitly validated because the API uses whitelist + forbidNonWhitelisted.
- Old parse requests without the new fields must remain valid.
- Report refresh must recover target context from backend `report.requestContext`, not only router state.

## Files In Scope

- `packages/shared/src/types/ai.ts`
- `services/api/src/ai/interfaces/ai-provider.interface.ts`
- `services/api/src/ai/dto/resume-parse.dto.ts`
- `services/api/src/ai/providers/llm.provider.ts`
- `services/api/src/ai/resume/llm-resume.service.ts`
- `services/api/src/ai/ai.controller.ts`
- `services/api/scripts/verify-real-resume-diagnosis.ts`
- `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`
- `apps/kiosk/src/pages/resume/ResumeParsePage.tsx`
- `apps/kiosk/src/pages/resume/ResumeReportPage.tsx`
- Progress docs if implementation completes.

## Task 1: Red Tests

Add failing coverage before implementation:

1. Extend the local LLM stub in `verify-real-resume-diagnosis.ts` to capture request bodies.
2. Add assertions that a parse request with `selectedDimensions` and `targetContext`:
   - still returns exactly 6 canonical sections,
   - sends the selected dimension labels and target context into the LLM messages,
   - attaches sanitized `report.requestContext`.
3. Add DTO validation checks:
   - legacy requests remain valid,
   - invalid dimension keys are rejected,
   - too-long `targetJob` is rejected.

Expected red state: TypeScript compile/verification fails because shared/API DTO/provider/report types and LLM options do not exist yet.

## Task 2: Shared And API Contract

1. Add shared canonical dimension keys and context request types in `packages/shared/src/types/ai.ts`.
2. Mirror the same contract in `services/api/src/ai/interfaces/ai-provider.interface.ts`.
3. Extend `ResumeParseRequestDto` with:
   - `selectedDimensions?: ResumeScoringDimensionKey[]`
   - `targetContext?: ResumeTargetContextDto`
   - optional `uploadSource`, `consent`, and `reportSchemaVersion` metadata.
4. Keep every new request field optional.

## Task 3: LLM And Audit Wiring

1. Update `LlmResumeProvider.parseResume` to pass `selectedDimensions` and `targetContext` into `LlmResumeService.diagnose`.
2. Update `LlmResumeService` to:
   - accept optional diagnosis context,
   - add context to the user prompt only,
   - preserve fixed 6-section parsing,
   - attach sanitized `requestContext` to the returned report.
3. Update `AiController.submitResumeParse` audit payload with safe metadata:
   - `dimensionCount`,
   - `targetContextProvided`,
   - `targetJobProvided`,
   - `industry`, `experience`, `scene`, `skipped`,
   - `uploadSourceChannel`, `consentVersion`, `reportSchemaVersion`.

## Task 4: Kiosk Wiring

1. Reuse the existing upload page; do not add a route or redesign the flow.
2. Send default canonical selected dimensions and a default `targetContext: { skipped: true }` from `ResumeSourcePage`.
3. Pass these fields through `ResumeParsePage.submitResumeParse`.
4. In `ResumeReportPage`, prefer router state but fall back to `report.requestContext.targetContext` after refresh.

## Task 5: Verification

Run, in order:

1. `pnpm --filter @ai-job-print/api verify-real-resume-diagnosis`
2. `pnpm --filter @ai-job-print/shared typecheck`
3. `pnpm --filter @ai-job-print/api typecheck`
4. `pnpm --filter @ai-job-print/kiosk typecheck`
5. `pnpm --filter @ai-job-print/api verify:ai-result-ownership`
6. Targeted lint/build only if typecheck or changed imports require it.

## Review Gate

After implementation and verification, run dual-model review on `git diff` with Antigravity and Claude. Critical issues must be fixed and reviewed again before reporting completion.
