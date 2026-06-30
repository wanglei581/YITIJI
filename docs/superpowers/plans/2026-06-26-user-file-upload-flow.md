# User File Upload Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a commercial-safe file upload flow for the kiosk that works before the mini program exists, while preserving clear temporary-vs-member ownership and future mini-program reuse.

**Architecture:** Add a small upload-session layer in the API for phone H5 uploads, keep `FileObject` as the only persisted file model, and let Kiosk upload pages consume uploaded file metadata through existing business flows. Production local/U-disk upload should be mediated by Terminal Agent rather than a browser system file picker.

**Tech Stack:** NestJS API, Redis or database-backed upload sessions, React/Vite Kiosk and H5 upload page, Terminal Agent Node/TypeScript, existing `FileObject` / `EndUser` / retention policy.

---

## Scope

This plan implements the design in [2026-06-26-user-file-upload-flow-design.md](../specs/2026-06-26-user-file-upload-flow-design.md).

Allowed layers:

- API: `services/api/src/files`, upload-session module, verify script.
- Kiosk: `apps/kiosk/src/pages/resume`, `apps/kiosk/src/pages/print`, upload session service and H5 upload route.
- Terminal Agent: local file listing/upload bridge only.
- Shared types: upload-session DTOs and optional new account document purpose only if approved during Task 1.
- Docs: progress and product docs.

Explicit non-goals:

- No platform delivery of resumes to enterprises.
- No new homepage entry.
- No automatic anonymous-to-member file claiming.
- No mini-program-specific code in this phase.
- No payment, package purchase, or recruitment workflow changes.

## File Map

Planned new files:

- `packages/shared/src/types/uploadSession.ts`: shared upload-session contracts.
- `services/api/src/upload-sessions/upload-sessions.module.ts`: API module wiring.
- `services/api/src/upload-sessions/upload-sessions.controller.ts`: Kiosk create/poll and H5 upload endpoints.
- `services/api/src/upload-sessions/upload-sessions.service.ts`: session creation, token validation, status transitions.
- `services/api/scripts/verify-upload-sessions.ts`: ownership, TTL, format, and one-time session checks.
- `apps/kiosk/src/services/api/uploadSessions.ts`: Kiosk/H5 API adapter.
- `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx`: mobile H5 upload page.
- `apps/kiosk/src/pages/upload/components/UploadSessionQrPanel.tsx`: QR/session panel shared by resume and print pages.
- `apps/kiosk/scripts/verify-upload-flow-ui.mjs`: static UI guard.
- `apps/terminal-agent/src/local-files/LocalFileService.ts`: whitelist local file discovery.
- `apps/terminal-agent/scripts/verify-local-file-upload.ts`: Agent local file guard.

Planned modified files:

- `packages/shared/src/index.ts`: export upload-session contracts.
- `services/api/src/app.module.ts`: import upload-session module.
- `services/api/package.json`: add `verify:upload-sessions`.
- `apps/kiosk/src/routes/index.tsx`: add H5 upload route.
- `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`: add account file choice; add QR upload only after explicit product approval.
- `apps/kiosk/src/pages/print/PrintUploadPage.tsx`: replace disabled QR/USB placeholders with real session panels as tasks land.
- `apps/kiosk/package.json`: add `verify:upload-flow-ui`.
- `apps/terminal-agent/src/index.ts`: expose local file command/API if implementation uses HTTP bridge.
- `apps/terminal-agent/package.json`: add `verify:local-file-upload`.
- `docs/progress/current-progress.md`: record actual completion after implementation.
- `docs/progress/next-tasks.md`: update remaining upload follow-ups.

## Task 1: Shared Contracts And Purpose Decision

**Files:**
- Create: `packages/shared/src/types/uploadSession.ts`
- Modify: `packages/shared/src/index.ts`
- Optional modify if approved: `packages/shared/src/types/file.ts`, `services/api/src/files/file.types.ts`, `services/api/src/files/file-validation.ts`, `services/api/src/files/retention-policy.ts`
- Test: `packages/shared` typecheck

- [ ] **Step 1: Define upload-session shared contracts**

Create `packages/shared/src/types/uploadSession.ts`:

```ts
import type { FilePurpose, FileUploadResponse } from './file'

export type UploadSessionMode = 'temporary' | 'member'
export type UploadSessionStatus = 'pending' | 'uploading' | 'uploaded' | 'confirmed' | 'consumed' | 'expired' | 'cancelled'
export type UploadSessionChannel = 'phone_h5' | 'terminal_agent' | 'mini_program'

export interface UploadSessionCreateRequest {
  purpose: FilePurpose
  mode: UploadSessionMode
  channel: UploadSessionChannel
  terminalId?: string | null
}

export interface UploadSessionCreateResponse {
  sessionId: string
  uploadUrl: string
  uploadToken: string
  expiresAt: string
}

export interface UploadSessionStatusResponse {
  sessionId: string
  status: UploadSessionStatus
  purpose: FilePurpose
  mode: UploadSessionMode
  file: FileUploadResponse | null
  requiresKioskConfirmation: boolean
  expiresAt: string
}

export interface UploadSessionCancelResponse {
  sessionId: string
  status: 'cancelled'
}

export interface UploadSessionConfirmResponse {
  sessionId: string
  status: 'confirmed'
  file: FileUploadResponse
}
```

- [ ] **Step 2: Export the contracts**

Add this line to `packages/shared/src/index.ts`:

```ts
export * from './types/uploadSession'
```

- [ ] **Step 3: Decide account-saved print documents**

For first implementation, do not change `FilePurpose`. Keep:

```text
print_doc = only this print session by default
cover_letter = account-saved job material currently supported by retention policy
```

If product requires a generic account document purpose, create a separate branch to add `job_material` to both shared and API file types, validation, and retention policy.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @ai-job-print/shared typecheck
```

Expected: PASS.

## Task 2: API Upload Sessions

**Files:**
- Create: `services/api/src/upload-sessions/upload-sessions.module.ts`
- Create: `services/api/src/upload-sessions/upload-sessions.controller.ts`
- Create: `services/api/src/upload-sessions/upload-sessions.service.ts`
- Create: `services/api/scripts/verify-upload-sessions.ts`
- Modify: `services/api/src/app.module.ts`
- Modify: `services/api/package.json`
- Test: `pnpm --filter @ai-job-print/api verify:upload-sessions`

- [ ] **Step 1: Add a failing verify script skeleton**

Create `services/api/scripts/verify-upload-sessions.ts` with assertions for:

```ts
const expectedCases = [
  'temporary session creates endUserId=null file',
  'temporary uploaded session can be consumed by downstream business action',
  'member session without valid member token is rejected',
  'member phone session keeps uploaded file staged until kiosk confirmation',
  'member kiosk confirmation binds uploaded file to endUserId',
  'member kiosk confirmation recalculates retentionPolicy and expiresAt',
  'untrusted terminal or over-quota anonymous session creation is rejected',
  'expired session rejects upload',
  'uploaded session cannot be reused',
  'oversized file is rejected',
  'unsupported file purpose or MIME is rejected through existing file validation',
]

for (const name of expectedCases) {
  console.log(`PENDING: ${name}`)
}

throw new Error('upload session implementation missing')
```

- [ ] **Step 2: Add package script**

Add to `services/api/package.json`:

```json
"verify:upload-sessions": "node -r @swc-node/register scripts/verify-upload-sessions.ts"
```

Run:

```bash
pnpm --filter @ai-job-print/api verify:upload-sessions
```

Expected: FAIL with `upload session implementation missing`.

- [ ] **Step 3: Implement UploadSessionsService**

Implement a service that stores sessions with:

```ts
interface UploadSessionRecord {
  id: string
  uploadTokenHash: string
  purpose: FilePurpose
  mode: 'temporary' | 'member'
  channel: 'phone_h5' | 'terminal_agent' | 'mini_program'
  terminalId: string | null
  pendingEndUserId: string | null
  confirmedEndUserId: string | null
  status: 'pending' | 'uploading' | 'uploaded' | 'confirmed' | 'consumed' | 'expired' | 'cancelled'
  fileId: string | null
  expiresAt: Date
  createdAt: Date
}
```

Use Redis for TTL storage and store only `uploadTokenHash`, not the clear token. Avoid a Prisma model in the first implementation unless Redis is proven unavailable in the current deployment target.

- [ ] **Step 4: Implement controller endpoints**

Add endpoints:

```text
POST /api/v1/upload-sessions
GET /api/v1/upload-sessions/:sessionId
POST /api/v1/upload-sessions/:sessionId/files
POST /api/v1/upload-sessions/:sessionId/confirm
POST /api/v1/upload-sessions/:sessionId/cancel
```

Rules:

- `POST /upload-sessions` may be called by Kiosk. If Authorization carries a valid member token and mode is `member`, store that member as `pendingEndUserId`.
- `POST /upload-sessions` must validate trusted terminal context instead of trusting arbitrary `terminalId` from the public request body. Add rate limits / quotas by terminal, IP, member and active session count.
- `mode=member` without a valid member token must return 401; never silently downgrade to `temporary`.
- `POST /:sessionId/files` accepts multipart file plus upload token, calls existing `FilesService.upload`.
- `POST /:sessionId/files` must enforce existing MIME/extension validation and the same per-purpose maximum file size limit as current file upload flows. For resume uploads, keep the existing 10MB user-facing limit unless the central validator is intentionally changed.
- Temporary sessions call `FilesService.upload` with `endUserId=null`.
- Member `phone_h5` sessions call `FilesService.upload` with `endUserId=null` first, then wait for Kiosk confirmation before binding the file to the stored member.
- Member non-phone flows may bind directly only when the action happens on the authenticated Kiosk session.
- `POST /:sessionId/confirm` is called by the authenticated Kiosk after the user sees the uploaded filename, size, type and preview metadata. It binds the staged file to `pendingEndUserId`, recalculates and persists `retentionPolicy` / `expiresAt` / `assetCategory` for the now-member-owned file, changes status to `confirmed`, and returns safe file metadata.
- `consumed` is set by the downstream business action that actually uses the file, such as resume parse or print order creation, so an uploaded file cannot be reused by polling alone. Temporary sessions may transition directly from `uploaded` to `consumed`; member phone sessions transition from `confirmed` to `consumed`.
- Do not accept `endUserId` from H5 request body.

- [ ] **Step 5: Complete verify script**

Replace the skeleton with real service-level checks that create sessions, upload small buffers, assert ownership and status transitions, verify Kiosk confirmation, verify member retention recalculation, verify terminal/rate guard rejection, verify oversized rejection, and verify one-time reuse is blocked.

- [ ] **Step 6: Run checks**

Run:

```bash
pnpm --filter @ai-job-print/api verify:upload-sessions
pnpm --filter @ai-job-print/api typecheck
```

Expected: PASS.

## Task 3: Kiosk Phone H5 Upload

**Files:**
- Create: `apps/kiosk/src/services/api/uploadSessions.ts`
- Create: `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx`
- Create: `apps/kiosk/src/pages/upload/components/UploadSessionQrPanel.tsx`
- Create: `apps/kiosk/scripts/verify-upload-flow-ui.mjs`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Optional modify after explicit product approval: `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`
- Modify: `apps/kiosk/src/pages/print/PrintUploadPage.tsx`
- Modify: `apps/kiosk/package.json`
- Test: `pnpm --filter @ai-job-print/kiosk verify:upload-flow-ui`

- [ ] **Step 1: Add static UI guard first**

Create `apps/kiosk/scripts/verify-upload-flow-ui.mjs` to assert:

```js
import fs from 'node:fs'

const files = {
  print: 'src/pages/print/PrintUploadPage.tsx',
  phone: 'src/pages/upload/PhoneUploadPage.tsx',
}

for (const [label, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) throw new Error(`${label} upload file missing: ${file}`)
}

const print = fs.readFileSync(files.print, 'utf8')
const phone = fs.readFileSync(files.phone, 'utf8')

if (!print.includes('手机扫码上传')) throw new Error('print page must expose phone QR upload')
if (!phone.includes('临时上传不会保存到账号')) throw new Error('phone upload page must explain temporary ownership')
if (!phone.includes('一体机上确认')) throw new Error('member phone upload must explain kiosk confirmation')
if (phone.includes('一键投递') || phone.includes('立即投递')) throw new Error('upload page must not contain recruiting closure copy')

console.log('UPLOAD_FLOW_UI_VERIFY_PASS')
```

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:upload-flow-ui
```

Expected: FAIL because files are not wired yet.

- [ ] **Step 2: Add Kiosk upload session adapter**

Implement `apps/kiosk/src/services/api/uploadSessions.ts` with:

```ts
import type {
  UploadSessionCreateRequest,
  UploadSessionCreateResponse,
  UploadSessionStatusResponse,
  UploadSessionCancelResponse,
  UploadSessionConfirmResponse,
} from '@ai-job-print/shared'
import { API_BASE_URL } from './client'

export async function createUploadSession(
  input: UploadSessionCreateRequest,
  token?: string | null,
): Promise<UploadSessionCreateResponse> {
  const res = await fetch(`${API_BASE_URL}/upload-sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`createUploadSession failed: ${res.status}`)
  const json = await res.json()
  if (!json.success || !json.data) throw new Error(json.message ?? 'createUploadSession failed')
  return json.data
}

export async function getUploadSession(sessionId: string): Promise<UploadSessionStatusResponse> {
  const res = await fetch(`${API_BASE_URL}/upload-sessions/${encodeURIComponent(sessionId)}`)
  if (!res.ok) throw new Error(`getUploadSession failed: ${res.status}`)
  const json = await res.json()
  if (!json.success || !json.data) throw new Error(json.message ?? 'getUploadSession failed')
  return json.data
}

export async function confirmUploadSession(
  sessionId: string,
  token?: string | null,
): Promise<UploadSessionConfirmResponse> {
  const res = await fetch(`${API_BASE_URL}/upload-sessions/${encodeURIComponent(sessionId)}/confirm`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) throw new Error(`confirmUploadSession failed: ${res.status}`)
  const json = await res.json()
  if (!json.success || !json.data) throw new Error(json.message ?? 'confirmUploadSession failed')
  return json.data
}

export async function cancelUploadSession(sessionId: string): Promise<UploadSessionCancelResponse> {
  const res = await fetch(`${API_BASE_URL}/upload-sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' })
  if (!res.ok) throw new Error(`cancelUploadSession failed: ${res.status}`)
  const json = await res.json()
  if (!json.success || !json.data) throw new Error(json.message ?? 'cancelUploadSession failed')
  return json.data
}
```

- [ ] **Step 3: Add H5 upload page**

Add `PhoneUploadPage.tsx` that:

- Reads `sessionId` and `token` from query string.
- Shows ownership copy:
  - temporary: `临时上传不会保存到账号`
  - member: `上传后需在一体机上确认，确认后保存到当前登录账号`
- Accepts only file types allowed for the session purpose.
- Uploads to `POST /upload-sessions/:sessionId/files`.
- Shows success, expired, failed states.

- [ ] **Step 4: Add QR panel component**

Implement `UploadSessionQrPanel.tsx` that:

- Creates a session on mount or user click.
- Renders QR with `qrcode.react`.
- Polls `getUploadSession(sessionId)` every 2 seconds while pending or uploading.
- When status is `uploaded`, shows file name, size, type and preview metadata on Kiosk.
- Calls `confirmUploadSession(sessionId, getToken())` only after the user taps the Kiosk confirmation button.
- Calls `onUploaded(file)` once status is `confirmed`.
- Cancels session on unmount if still pending.

- [ ] **Step 5: Wire print page first, then decide resume page**

In `PrintUploadPage.tsx`, replace the existing disabled QR placeholder with the QR panel using:

```ts
purpose: 'print_doc'
mode: isLoggedIn ? 'member' : 'temporary'
channel: 'phone_h5'
```

For `ResumeSourcePage.tsx`, do not silently add a new upload entry under the frozen entrance rules. If product approves adding phone QR upload inside the existing resume source page, wire the same panel using:

```ts
purpose: 'resume_upload'
mode: isLoggedIn ? 'member' : 'temporary'
channel: 'phone_h5'
```

If approval is not granted, keep resume upload on the existing local/cloud/account choices and leave phone QR upload for a separate approved task.

- [ ] **Step 6: Run checks**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:upload-flow-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
```

Expected: PASS.

## Task 4: Terminal Agent Local / U-Disk Upload Bridge

**Files:**
- Create: `apps/terminal-agent/src/local-files/LocalFileService.ts`
- Create: `apps/terminal-agent/scripts/verify-local-file-upload.ts`
- Modify: `apps/terminal-agent/src/index.ts`
- Modify: `apps/terminal-agent/package.json`
- Test: `pnpm --filter terminal-agent verify:local-file-upload`

- [ ] **Step 1: Add verify script**

Create a script that constructs a temporary directory with:

```text
ok/resume.pdf
ok/photo.png
blocked/script.exe
blocked/large.bin
```

It should assert the local file service returns only allowed PDF/image files and never returns absolute paths to Kiosk.
It should also assert missing `localAuthToken` and missing or reused `actionToken` are rejected.

- [ ] **Step 2: Implement LocalFileService**

Implement a service with:

```ts
export interface LocalFileItem {
  id: string
  displayName: string
  sizeBytes: number
  mimeType: string
  source: 'usb' | 'local_drop'
}

export class LocalFileService {
  listFiles(): LocalFileItem[] {
    return []
  }

  openFile(id: string): NodeJS.ReadableStream {
    throw new Error('not implemented')
  }
}
```

Implementation requirements:

- Keep path mapping inside Agent memory.
- Do not expose absolute paths over the Kiosk API.
- Only allow configured directories and removable drives.
- Only allow MIME/extension pairs matching API file validation.
- Add a new local file bridge auth layer. The current local Agent server has an Origin allowlist, but file listing and upload actions need explicit token checks and must never be exposed to unauthenticated browser requests.

- [ ] **Step 3: Expose local bridge**

Add local-only routes under the existing Terminal Agent local HTTP service. Reuse the current `127.0.0.1:9527` server shape and `/local/*` route namespace instead of starting a second bridge server:

```text
GET  http://127.0.0.1:9527/local/files
POST http://127.0.0.1:9527/local/files/:id/upload-session
```

Security requirements:

- Both routes require `Authorization: Bearer <localAuthToken>`.
- `POST /local/files/:id/upload-session` also requires a one-time signed `actionToken`; add HMAC / nonce verification for this file bridge and reject replay.
- Update the local server CORS / preflight allowlist to include the required auth headers, such as `Authorization` and the chosen action-token header if the token is passed in a header.
- The upload call receives `sessionId` and `uploadToken` from the authenticated Kiosk flow, then streams the selected file into the API upload session.
- The response returns only safe metadata and upload status, not absolute paths or raw local filesystem errors.

- [ ] **Step 4: Run checks**

Run:

```bash
pnpm --filter terminal-agent verify:local-file-upload
pnpm --filter terminal-agent typecheck
```

Expected: PASS.

## Task 5: Account File Picker

**Files:**
- Create: `apps/kiosk/src/pages/upload/components/AccountFilePicker.tsx`
- Modify: `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`
- Modify: `apps/kiosk/src/pages/print/PrintUploadPage.tsx`
- Test: `apps/kiosk/scripts/verify-upload-flow-ui.mjs`

- [ ] **Step 1: Extend UI guard**

Add assertions:

```js
if (!fs.existsSync('src/pages/upload/components/AccountFilePicker.tsx')) {
  throw new Error('AccountFilePicker missing')
}
const picker = fs.readFileSync('src/pages/upload/components/AccountFilePicker.tsx', 'utf8')
if (!picker.includes('getMyDocuments')) throw new Error('Account file picker must use member document API')
if (!picker.includes('getMyResumes')) throw new Error('Resume picker must use member resume API')
if (picker.includes('payloadJson') || picker.includes('storageKey')) throw new Error('Account file picker must not expose sensitive internals')
```

- [ ] **Step 2: Implement picker**

The picker must:

- Render only when `isLoggedIn`.
- For resume flows, call `getMyResumes(getToken(), { pageSize: 50 })` first, then `getMyDocuments(getToken(), { pageSize: 50 })` for document fallbacks.
- For print flows, call `getMyDocuments(getToken(), { pageSize: 50 })`.
- Filter by business purpose:
  - resume: PDF, DOC, DOCX, JPG, PNG, WEBP
  - print: PDF, JPG, PNG
- Return selected file metadata to the host page.
- Never fetch signed URLs until user starts preview or print.

- [ ] **Step 3: Wire pages**

Resume page uses selected file `fileId` to continue to `/resume/parse`.

Print page uses selected file `fileId` by requesting a fresh preview/download URL, then continues through material check and print confirmation.

- [ ] **Step 4: Run checks**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:upload-flow-ui
pnpm --filter @ai-job-print/kiosk typecheck
```

Expected: PASS.

## Task 6: End-To-End Verification And Docs

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `docs/product/user-data-flow-matrix.md`
- Test: API/Kiosk/Agent checks from previous tasks

- [ ] **Step 1: Run full targeted verification**

Run:

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api verify:upload-sessions
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/api verify:member-assets-c2d
pnpm --filter @ai-job-print/kiosk verify:upload-flow-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter terminal-agent verify:local-file-upload
pnpm --filter terminal-agent typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 2: Update product matrix**

Update `docs/product/user-data-flow-matrix.md` to mark:

- Phone H5 upload as current upload channel.
- Mini program upload as future channel reusing UploadSession / FileObject.
- Temporary upload as not account-bound.
- Member upload as account-bound.

- [ ] **Step 3: Update progress docs**

Add a concise entry to `docs/progress/current-progress.md` with:

```text
完成用户文件上传通道设计与首批实现：手机 H5 扫码上传、会员/临时上传归属分离、Kiosk 上传页接线、Terminal Agent 本地文件中转守卫和账号文件选择入口。小程序仍为后续接入，不作为当前上传前置。
```

Update `docs/progress/next-tasks.md` to keep mini-program integration as future work.

- [ ] **Step 4: Review**

Because this crosses API, Kiosk, Terminal Agent, and file privacy, run Claude + Antigravity review on the final diff before staging.

Expected verdict: no Critical findings.
