# my-documents-delete-action review

## Scope

- Add a two-step self-delete interaction for `/me/documents`.
- Reuse `deleteMyDocument(token, fileId)`.
- Keep backend/API contracts unchanged.
- Keep file content out of the list page and preserve short-lived signed preview links.

## Implementation

- Added delete button with first-click confirmation and 3.5s auto-reset.
- Added global pending lock so preview and delete actions are mutually exclusive across the document list.
- Clears document list when the member session is not logged in.
- On successful delete, removes the item from local state and shows a short status hint.

## Dual-model review

- Claude: approved after recommending `opening === doc.id` should also disable delete.
- Antigravity: requested fixing single-value `opening` / `busyId` race across multiple documents; final review approved after global pending lock was added.

## Verification

- `pnpm --filter @ai-job-print/kiosk typecheck` passed.
- `pnpm --filter @ai-job-print/kiosk lint` passed with existing `KioskBusyContext.tsx` fast-refresh warnings only.
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build` passed with existing large chunk warning only.
- `pnpm --filter @ai-job-print/api verify:member-assets-c2d` passed using temporary SQLite migration DB and isolated env secrets; 9/9 checks passed.
