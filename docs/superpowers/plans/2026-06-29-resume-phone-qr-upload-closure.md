# Resume Phone QR Upload Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a commercial-safe phone H5 QR upload path inside the existing Kiosk AI resume upload page, so a phone-uploaded resume becomes a `FileObject` and can continue through the existing `/resume/parse` OCR / AI diagnosis flow.

**Architecture:** Reuse the existing QR-login pattern: Kiosk creates a short-lived ticket, phone H5 opens a URL with `sessionId` + one-time upload token, Kiosk polls status and confirms the uploaded file before using it. Reuse `FilesService.upload()` for storage, validation, retention, and `FileObject` creation; add only an upload-session coordination layer.

**Tech Stack:** NestJS API, Redis-backed short-lived sessions, React/Vite Kiosk + H5 route, `qrcode.react`, existing `FilesService`, existing member token resolver, existing resume parse flow.

---

## Scope

This plan intentionally narrows the broader 2026-06-26 upload plan.

Included:

- `/resume/source` adds one upload method: `手机扫码上传`.
- Phone H5 route uploads to a short-lived upload session.
- Uploaded file is stored through `FilesService.upload()` as `purpose=resume_upload`.
- Kiosk polls session status, shows file metadata, and only after user confirmation stores the uploaded file in page state.
- Existing `/resume/parse` request shape remains unchanged: it still receives `fileId`, `file`, `source`, and `uploadChannel`.

Excluded:

- Print page QR upload.
- U disk / Terminal Agent file bridge.
- Mini program.
- Account file picker.
- Any homepage entry.
- Any recruitment delivery or enterprise-facing resume flow.

## File Budget

Create:

- `packages/shared/src/types/uploadSession.ts`
- `services/api/src/upload-sessions/upload-sessions.module.ts`
- `services/api/src/upload-sessions/upload-sessions.service.ts`
- `services/api/src/upload-sessions/upload-sessions.controller.ts`
- `services/api/src/upload-sessions/dto.ts`
- `services/api/scripts/verify-upload-sessions.ts`
- `apps/kiosk/src/services/api/uploadSessions.ts`
- `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx`
- `apps/kiosk/src/pages/upload/components/UploadSessionQrPanel.tsx`
- `apps/kiosk/scripts/verify-resume-phone-upload-ui.mjs`

Modify:

- `packages/shared/src/index.ts`
- `services/api/src/app.module.ts`
- `services/api/package.json`
- `apps/kiosk/src/routes/index.tsx`
- `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`
- `apps/kiosk/package.json`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/resume-phone-qr-upload-closure/task.json`
- `.ccg/tasks/resume-phone-qr-upload-closure/review.md`

Do not modify in this task:

- `apps/kiosk/src/pages/print/*`
- `apps/terminal-agent/*`
- `services/api/prisma/schema.prisma`
- `services/api/prisma/postgres/schema.prisma`

## Contract Decisions

- The upload session itself is stored in Redis and is not a new Prisma model.
- `FileObject` remains the only persistent file model.
- `mode='member'` requires a valid member token when Kiosk creates the session.
- Phone H5 upload never receives the member token.
- Member-mode phone uploads first create a temporary `FileObject` with `endUserId=null`; Kiosk confirmation binds it to the pending member.
- Anonymous uploads remain `endUserId=null`.
- Session TTL is 10 minutes.
- Resume phone upload uses the existing Kiosk client limit of 10MB, even though lower service layers may permit larger proxy uploads for other contexts.

---

## Task 1: Shared Upload Session Contract

**Files:**
- Create: `packages/shared/src/types/uploadSession.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write shared types**

Create `packages/shared/src/types/uploadSession.ts`:

```ts
import type { FilePurpose, FileUploadResponse } from './file'

export type UploadSessionMode = 'temporary' | 'member'
export type UploadSessionStatus = 'pending' | 'uploading' | 'uploaded' | 'confirmed' | 'expired' | 'cancelled'
export type UploadSessionChannel = 'phone_h5'

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

export interface UploadSessionConfirmResponse {
  sessionId: string
  status: 'confirmed'
  file: FileUploadResponse
}

export interface UploadSessionCancelResponse {
  sessionId: string
  status: 'cancelled'
}
```

- [ ] **Step 2: Export shared types**

Add to `packages/shared/src/index.ts`:

```ts
export * from './types/uploadSession'
```

- [ ] **Step 3: Verify shared package**

Run:

```bash
pnpm --filter @ai-job-print/shared typecheck
```

Expected: exit 0.

---

## Task 2: API Upload Session RED Test

**Files:**
- Create: `services/api/scripts/verify-upload-sessions.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1: Add failing verify script**

Create `services/api/scripts/verify-upload-sessions.ts`:

```ts
/**
 * AI resume phone QR upload session verification.
 *
 * This script must fail before UploadSessionsModule exists.
 */
import 'reflect-metadata'

function fail(message: string): never {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

const expected = [
  'temporary phone session creates an anonymous resume_upload FileObject',
  'member phone session creation requires a member token',
  'member phone upload stays anonymous before kiosk confirmation',
  'member kiosk confirmation binds the file to pendingEndUserId',
  'expired session rejects phone upload',
  'uploaded session rejects token reuse',
  'resume phone upload rejects files larger than 10MB',
  'unsupported file type is rejected through existing upload validation',
]

for (const name of expected) console.log(`PENDING ${name}`)
fail('upload session implementation missing')
```

- [ ] **Step 2: Add API script**

In `services/api/package.json`, add:

```json
"verify:upload-sessions": "node -r @swc-node/register scripts/verify-upload-sessions.ts"
```

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm --filter @ai-job-print/api verify:upload-sessions
```

Expected: FAIL with `upload session implementation missing`.

---

## Task 3: API Upload Session Implementation

**Files:**
- Create: `services/api/src/upload-sessions/dto.ts`
- Create: `services/api/src/upload-sessions/upload-sessions.service.ts`
- Create: `services/api/src/upload-sessions/upload-sessions.controller.ts`
- Create: `services/api/src/upload-sessions/upload-sessions.module.ts`
- Modify: `services/api/src/app.module.ts`

- [ ] **Step 1: Add DTOs**

Create `services/api/src/upload-sessions/dto.ts`:

```ts
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

export class CreateUploadSessionDto {
  @IsEnum(['resume_upload'])
  purpose!: 'resume_upload'

  @IsEnum(['temporary', 'member'])
  mode!: 'temporary' | 'member'

  @IsEnum(['phone_h5'])
  channel!: 'phone_h5'

  @IsOptional()
  @IsString()
  @MaxLength(64)
  terminalId?: string | null
}
```

- [ ] **Step 2: Implement service**

Implement `UploadSessionsService` with Redis keys:

```ts
const SESSION_TTL_SECONDS = 10 * 60
const MAX_RESUME_PHONE_UPLOAD_BYTES = 10 * 1024 * 1024
const key = (sessionId: string) => `upload-session:${sessionId}`
```

Record shape:

```ts
interface UploadSessionRecord {
  id: string
  uploadTokenHash: string
  purpose: 'resume_upload'
  mode: 'temporary' | 'member'
  channel: 'phone_h5'
  terminalId: string | null
  pendingEndUserId: string | null
  confirmedEndUserId: string | null
  status: 'pending' | 'uploading' | 'uploaded' | 'confirmed' | 'expired' | 'cancelled'
  fileId: string | null
  file: import('../files/file.types').FileUploadResponse | null
  expiresAt: string
  createdAt: string
}
```

Required methods:

```ts
create(input, endUserId, publicBaseUrl): UploadSessionCreateResponse
get(sessionId): UploadSessionStatusResponse
uploadFile(sessionId, uploadToken, file): UploadSessionStatusResponse
confirm(sessionId, endUserId): UploadSessionConfirmResponse
cancel(sessionId): UploadSessionCancelResponse
```

Rules:

- Hash upload token with SHA-256 before storing.
- `mode='member'` and missing member token throws `UnauthorizedException`.
- `uploadFile` rejects expired, cancelled, uploaded, or confirmed sessions.
- `uploadFile` rejects size > 10MB before calling `FilesService.upload`.
- Phone upload calls `FilesService.upload({ endUserId: null, purpose: 'resume_upload' })`.
- `confirm` for member mode verifies current member equals `pendingEndUserId`, then updates the `FileObject` owner fields through Prisma in a transaction.
- `confirm` for temporary mode returns the file without binding.

- [ ] **Step 3: Implement controller**

Create endpoints:

```text
POST /api/v1/upload-sessions
GET /api/v1/upload-sessions/:sessionId
POST /api/v1/upload-sessions/:sessionId/files
POST /api/v1/upload-sessions/:sessionId/confirm
POST /api/v1/upload-sessions/:sessionId/cancel
```

Controller requirements:

- `POST /upload-sessions` uses optional member auth from request headers.
- `POST /:sessionId/files` accepts multipart field name `file` and `uploadToken` form field.
- `POST /:sessionId/files` must not use member token.
- `confirm` uses member token only when mode is member.
- Add `@Throttle({ default: { ttl: 60_000, limit: 20 } })` to create and upload endpoints.

- [ ] **Step 4: Wire module**

Add `UploadSessionsModule` to `services/api/src/app.module.ts` imports after `FilesModule`.

- [ ] **Step 5: Replace verify script with real assertions**

Update `services/api/scripts/verify-upload-sessions.ts` to instantiate the service/controller with fake Redis, fake files service, and Prisma test rows. Assert the cases listed in Task 2.

- [ ] **Step 6: Verify API**

Run:

```bash
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api typecheck
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api verify:upload-sessions
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api verify-real-resume-diagnosis
```

Expected: all exit 0.

---

## Task 4: Kiosk H5 Upload Page And API Adapter

**Files:**
- Create: `apps/kiosk/src/services/api/uploadSessions.ts`
- Create: `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx`

- [ ] **Step 1: Add adapter**

Create `apps/kiosk/src/services/api/uploadSessions.ts` with these functions:

```ts
import type {
  UploadSessionCancelResponse,
  UploadSessionConfirmResponse,
  UploadSessionCreateRequest,
  UploadSessionCreateResponse,
  UploadSessionStatusResponse,
} from '@ai-job-print/shared'
import { API_BASE_URL } from './config'

async function readEnvelope<T>(res: Response): Promise<T> {
  const json = await res.json()
  if (!res.ok || !json.success || !json.data) {
    throw new Error(json?.message ?? `upload session request failed: ${res.status}`)
  }
  return json.data as T
}

export async function createUploadSession(input: UploadSessionCreateRequest, token?: string | null) {
  const res = await fetch(`${API_BASE_URL}/upload-sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  })
  return readEnvelope<UploadSessionCreateResponse>(res)
}

export async function getUploadSession(sessionId: string) {
  const res = await fetch(`${API_BASE_URL}/upload-sessions/${encodeURIComponent(sessionId)}`)
  return readEnvelope<UploadSessionStatusResponse>(res)
}

export async function confirmUploadSession(sessionId: string, token?: string | null) {
  const res = await fetch(`${API_BASE_URL}/upload-sessions/${encodeURIComponent(sessionId)}/confirm`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  return readEnvelope<UploadSessionConfirmResponse>(res)
}

export async function cancelUploadSession(sessionId: string) {
  const res = await fetch(`${API_BASE_URL}/upload-sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' })
  return readEnvelope<UploadSessionCancelResponse>(res)
}
```

- [ ] **Step 2: Add phone page**

`PhoneUploadPage` reads `sessionId` and `uploadToken` from URL query. It renders:

- `临时上传不会保存到账号`
- `如一体机已登录，仍需在一体机上确认后才会保存到账号`
- file input accepting resume formats
- 10MB limit copy
- upload progress / success / error states

It posts multipart to:

```text
POST ${API_BASE_URL}/upload-sessions/${sessionId}/files
field file
field uploadToken
```

- [ ] **Step 3: Add route**

In `apps/kiosk/src/routes/index.tsx`, import and add top-level route:

```ts
import { PhoneUploadPage } from '../pages/upload/PhoneUploadPage'

{ path: '/upload/phone', element: <PhoneUploadPage /> },
```

- [ ] **Step 4: Verify Kiosk**

Run:

```bash
pnpm --filter @ai-job-print/kiosk typecheck
```

Expected: exit 0.

---

## Task 5: Kiosk Resume Source QR Panel

**Files:**
- Create: `apps/kiosk/src/pages/upload/components/UploadSessionQrPanel.tsx`
- Modify: `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`
- Create: `apps/kiosk/scripts/verify-resume-phone-upload-ui.mjs`
- Modify: `apps/kiosk/package.json`

- [ ] **Step 1: Add failing UI guard**

Create `apps/kiosk/scripts/verify-resume-phone-upload-ui.mjs`:

```js
import { readFileSync } from 'node:fs'

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8') }
function assertIncludes(src, marker, label) {
  if (!src.includes(marker)) throw new Error(`${label}: missing ${marker}`)
  console.log(`PASS ${label}`)
}
function assertNotIncludes(src, marker, label) {
  if (src.includes(marker)) throw new Error(`${label}: unexpected ${marker}`)
  console.log(`PASS ${label}`)
}

const source = read('src/pages/resume/ResumeSourcePage.tsx')
const panel = read('src/pages/upload/components/UploadSessionQrPanel.tsx')
const phone = read('src/pages/upload/PhoneUploadPage.tsx')
const routes = read('src/routes/index.tsx')

assertIncludes(source, '手机扫码上传', 'resume source exposes phone upload')
assertIncludes(source, 'UploadSessionQrPanel', 'resume source uses QR panel')
assertIncludes(panel, 'QRCodeSVG', 'QR panel renders real QR')
assertIncludes(panel, 'confirmUploadSession', 'Kiosk confirmation is explicit')
assertIncludes(panel, 'requiresKioskConfirmation', 'panel understands confirmation state')
assertIncludes(phone, '一体机上确认', 'phone page explains kiosk confirmation')
assertIncludes(routes, '/upload/phone', 'phone upload route is registered')
assertNotIncludes(source, '/print/upload', 'resume phone upload must not route through print flow')
```

Add to `apps/kiosk/package.json`:

```json
"verify:resume-phone-upload-ui": "node scripts/verify-resume-phone-upload-ui.mjs"
```

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:resume-phone-upload-ui
```

Expected: FAIL before implementation.

- [ ] **Step 2: Add QR panel**

`UploadSessionQrPanel` responsibilities:

- Call `createUploadSession({ purpose: 'resume_upload', mode, channel: 'phone_h5' }, token)`.
- Render `QRCodeSVG` with `uploadUrl`.
- Poll `getUploadSession(sessionId)` every 2 seconds while pending/uploading.
- When uploaded, show filename, size, and `确认使用这份简历`.
- On confirm, call `confirmUploadSession(sessionId, token)` and call `onUploaded(file)`.
- On cancel, call `cancelUploadSession(sessionId)`.

- [ ] **Step 3: Wire ResumeSourcePage**

In `ResumeSourcePage`:

- Extend `UploadChannel` to include `phone`.
- Add upload option:

```ts
{
  type: 'phone',
  label: '手机扫码上传',
  description: '手机扫码选择简历文件',
  helper: '适合文件在手机微信、浏览器或聊天记录中的场景；上传后需在一体机上确认。',
  icon: QrCodeIcon,
}
```

- When `option.type === 'phone'`, do not open file input. Show `UploadSessionQrPanel`.
- On panel upload success, set:

```ts
setUploadedFile({
  name: file.filename,
  size: formatSize(file.sizeBytes),
  format: inferFormat(file.mimeType || file.filename),
  fileId: file.fileId,
  channel: 'phone',
})
```

- Preserve existing local/cloud file picker behavior.
- `handleStartDiagnosis` remains unchanged except `uploadChannel` can now be `phone`.

- [ ] **Step 4: Verify Kiosk**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:resume-phone-upload-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
```

Expected: verify and typecheck pass; lint has no new errors.

---

## Task 6: Documentation, Final Verification, Review

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.ccg/tasks/resume-phone-qr-upload-closure/task.json`
- Create/modify: `.ccg/tasks/resume-phone-qr-upload-closure/review.md`

- [ ] **Step 1: Update progress docs**

Record:

- AI 简历扫码上传已接入 `/resume/source`.
- H5 上传只拿一次性 upload token.
- 会员归属必须 Kiosk 二次确认.
- 打印扫码、U 盘 Agent、小程序仍是后续任务.

- [ ] **Step 2: Run final verification**

Run:

```bash
pnpm --filter @ai-job-print/shared typecheck
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api typecheck
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api verify:upload-sessions
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api verify-real-resume-diagnosis
pnpm --filter @ai-job-print/kiosk verify:resume-phone-upload-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
git diff --check
```

- [ ] **Step 3: Browser verification**

Start or reuse Kiosk dev server and verify:

- `/resume/source?intent=diagnose` shows `手机扫码上传`.
- QR panel renders a real QR.
- `/upload/phone?...` renders the phone upload page.
- The phone page copy includes `一体机上确认`.

- [ ] **Step 4: Dual-model review**

Call Claude and Antigravity reviewers on final diff. Record:

- Critical / Warning / Info.
- Any Antigravity tool failure if no `agent_message` output is returned.

- [ ] **Step 5: Mark task completed**

Update `.ccg/tasks/resume-phone-qr-upload-closure/task.json`:

```json
{
  "status": "completed",
  "currentPhase": "completed",
  "nextAction": "等待用户确认是否继续打印扫码上传、U盘Agent或我的文件选择"
}
```
