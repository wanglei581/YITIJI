# AI 简历优化 Wave 4 语音生成简历 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有简历生成页增加分段语音辅助填表能力，用户确认转写文本后复用既有简历生成、导出、模板和打印确认链路。

**Architecture:** 复用现有 Kiosk `wavRecorder` 和后端 `AsrService`，把 ASR 从模拟面试子域提升为通用模块；新增简历语音转写端点；前端只在长文本字段旁提供语音按钮，转写结果必须确认后才进入表单。首版不做长语音独白解析整份简历。

**Tech Stack:** React + Vite + TypeScript, NestJS, Multer memory upload, existing Tencent/Baidu ASR provider, existing resume generate/export services.

---

## Scope

### Allowed Files

- `services/api/src/asr/asr.module.ts`
- `services/api/src/asr/asr.service.ts`
- `services/api/src/mock-interview/asr/asr.service.ts`
- `services/api/src/mock-interview/mock-interview.module.ts`
- `services/api/src/mock-interview/mock-interview.controller.ts`
- `services/api/src/ai/ai.module.ts`
- `services/api/src/ai/ai.controller.ts`
- `services/api/src/ai/dto/resume-voice.dto.ts`
- `services/api/scripts/verify-resume-voice-generate.ts`
- `services/api/package.json`
- `apps/kiosk/src/pages/resume/ResumeGeneratePage.tsx`
- `apps/kiosk/src/pages/resume/components/ResumeVoiceInputButton.tsx`
- `apps/kiosk/src/pages/resume/components/ResumeTranscriptConfirmDialog.tsx`
- `apps/kiosk/src/services/api/ai.ts`
- `apps/kiosk/src/services/api/aiHttpAdapter.ts`
- `apps/kiosk/src/services/api/aiMockAdapter.ts`
- `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`
- `apps/kiosk/package.json`
- `packages/shared/src/types/ai.ts`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

### Forbidden Files

- `legacy-miaoda/**`
- Payment / pricing modules
- Job URL / JD parsing modules
- `apps/terminal-agent/**`
- Print rendering / PDF renderer unless an existing type compile requires a minimal import update
- Admin template CRUD pages

## Task 1: Extract Common ASR Module

**Files:**
- Create: `services/api/src/asr/asr.module.ts`
- Create: `services/api/src/asr/asr.service.ts`
- Modify: `services/api/src/mock-interview/asr/asr.service.ts`
- Modify: `services/api/src/mock-interview/mock-interview.module.ts`
- Modify: `services/api/src/mock-interview/mock-interview.controller.ts`

- [ ] **Step 1: Move the ASR implementation**

Use `git mv services/api/src/mock-interview/asr/asr.service.ts services/api/src/asr/asr.service.ts`.

Keep exported symbols:

```ts
export const ASR_MAX_AUDIO_BYTES = 4 * 1024 * 1024
export class AsrService {
  async recognizeWav(buffer: Buffer): Promise<AsrResult>
}
```

- [ ] **Step 2: Add module wrapper**

Create `services/api/src/asr/asr.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AsrService } from './asr.service'

@Module({
  providers: [AsrService],
  exports: [AsrService],
})
export class AsrModule {}
```

- [ ] **Step 3: Leave a compatibility re-export**

Create `services/api/src/mock-interview/asr/asr.service.ts` as a re-export:

```ts
export { ASR_MAX_AUDIO_BYTES, AsrService } from '../../asr/asr.service'
export type { AsrResult } from '../../asr/asr.service'
```

- [ ] **Step 4: Wire MockInterviewModule through AsrModule**

Update `services/api/src/mock-interview/mock-interview.module.ts` to import `AsrModule` and remove direct `AsrService` provider registration if present.

- [ ] **Step 5: Verify compile**

Run:

```bash
pnpm --filter @ai-job-print/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/asr/asr.module.ts services/api/src/asr/asr.service.ts services/api/src/mock-interview/asr/asr.service.ts services/api/src/mock-interview/mock-interview.module.ts services/api/src/mock-interview/mock-interview.controller.ts
git commit -m "refactor(api): share asr service for resume voice"
```

## Task 2: Add Resume Voice Transcription API

**Files:**
- Create: `services/api/src/ai/dto/resume-voice.dto.ts`
- Modify: `services/api/src/ai/ai.module.ts`
- Modify: `services/api/src/ai/ai.controller.ts`
- Modify: `packages/shared/src/types/ai.ts`

- [ ] **Step 1: Add shared response type**

Add to `packages/shared/src/types/ai.ts`:

```ts
export interface ResumeVoiceTranscribeResponse {
  text: string
  providerName: string
}
```

- [ ] **Step 2: Add DTO constants**

Create `services/api/src/ai/dto/resume-voice.dto.ts`:

```ts
export const RESUME_VOICE_AUDIO_FIELD = 'audio'
export const RESUME_VOICE_MAX_AUDIO_BYTES = 4 * 1024 * 1024
```

- [ ] **Step 3: Import AsrModule into AiModule**

Update `services/api/src/ai/ai.module.ts`:

```ts
imports: [
  // existing imports
  AsrModule,
]
```

- [ ] **Step 4: Add endpoint**

Add to `services/api/src/ai/ai.controller.ts`:

```ts
@Post('resume/voice/transcribe')
@Throttle({ default: { limit: 6, ttl: 60_000 } })
@UseInterceptors(FileInterceptor(RESUME_VOICE_AUDIO_FIELD, { limits: { fileSize: RESUME_VOICE_MAX_AUDIO_BYTES } }))
async transcribeResumeVoice(@UploadedFile() audio: Express.Multer.File | undefined) {
  if (!audio?.buffer?.length) {
    throw new BadRequestException({ error: { code: 'AUDIO_MISSING', message: '缺少音频内容' } })
  }
  const result = await this.asr.recognizeWav(audio.buffer)
  if (!result.ok) {
    throw new BadRequestException({ error: { code: result.errorCode ?? 'ASR_FAILED', message: result.errorMessage ?? '语音转写失败，请改用文字输入' } })
  }
  return ApiResponse.ok({ text: result.text, providerName: this.asr.providerName })
}
```

If `providerName` is private, add a public getter or return `providerName` from `AsrService` through an existing public getter. Do not expose credentials.

- [ ] **Step 5: Verify disabled provider behavior**

Run with `ASR_PROVIDER=disabled` in the verify script from Task 3. Expected endpoint returns `ASR_NOT_CONFIGURED`, not mock text.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/ai.ts services/api/src/ai/dto/resume-voice.dto.ts services/api/src/ai/ai.module.ts services/api/src/ai/ai.controller.ts
git commit -m "feat(api): add resume voice transcription endpoint"
```

## Task 3: Add Backend Verify Gate

**Files:**
- Create: `services/api/scripts/verify-resume-voice-generate.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1: Write verify script**

Create `services/api/scripts/verify-resume-voice-generate.ts` that statically asserts:

```ts
const mustContain = [
  'resume/voice/transcribe',
  'FileInterceptor',
  'RESUME_VOICE_MAX_AUDIO_BYTES',
  'ASR_NOT_CONFIGURED',
  'AUDIO_MISSING',
]

const mustNotContain = [
  'upload(',
  'FileObject',
  'signedUrl',
  'console.log(result.text)',
  'logger.log(result.text)',
]
```

The script must fail if the new endpoint writes audio into FileObject / COS or logs transcript text.

- [ ] **Step 2: Add package script**

Add:

```json
"verify:resume-voice-generate": "tsx scripts/verify-resume-voice-generate.ts"
```

- [ ] **Step 3: Run verify**

```bash
pnpm --filter @ai-job-print/api verify:resume-voice-generate
pnpm --filter @ai-job-print/api typecheck
```

Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add services/api/scripts/verify-resume-voice-generate.ts services/api/package.json
git commit -m "test(api): guard resume voice transcription privacy"
```

## Task 4: Add Kiosk API Adapter

**Files:**
- Modify: `apps/kiosk/src/services/api/ai.ts`
- Modify: `apps/kiosk/src/services/api/aiHttpAdapter.ts`
- Modify: `apps/kiosk/src/services/api/aiMockAdapter.ts`

- [ ] **Step 1: Add wrapper function**

Expose:

```ts
export function transcribeResumeVoice(audio: Blob): Promise<ResumeVoiceTranscribeResponse>
```

- [ ] **Step 2: Implement HTTP adapter**

Use multipart:

```ts
const form = new FormData()
form.append('audio', audio, 'resume-voice.wav')
```

POST to `/resume/voice/transcribe`. On error, surface backend message and do not synthesize transcript text.

- [ ] **Step 3: Implement mock adapter as honest failure**

Mock mode should reject with:

```ts
new Error('演示模式不支持语音识别，请使用文字输入')
```

Do not return fake speech text.

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @ai-job-print/kiosk typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/services/api/ai.ts apps/kiosk/src/services/api/aiHttpAdapter.ts apps/kiosk/src/services/api/aiMockAdapter.ts
git commit -m "feat(kiosk): add resume voice transcription adapter"
```

## Task 5: Add Voice UI Components

**Files:**
- Create: `apps/kiosk/src/pages/resume/components/ResumeVoiceInputButton.tsx`
- Create: `apps/kiosk/src/pages/resume/components/ResumeTranscriptConfirmDialog.tsx`

- [ ] **Step 1: Add microphone button component**

Props:

```ts
interface ResumeVoiceInputButtonProps {
  label: string
  disabled?: boolean
  onConfirm: (text: string) => void
}
```

Use lucide `Mic` icon and a concise tooltip/title. The button opens the confirm dialog.

- [ ] **Step 2: Add transcript dialog**

State machine:

```ts
type VoiceState =
  | { kind: 'idle' }
  | { kind: 'requesting_permission' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'transcribing' }
  | { kind: 'ready'; text: string }
  | { kind: 'error'; message: string }
```

Rules:

- Max recording seconds: 58.
- Always call recorder `release()` on stop, cancel, error, or unmount.
- Transcribed text is editable before confirmation.
- No localStorage/sessionStorage.
- Dialog includes privacy warning for public places and sensitive data.

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @ai-job-print/kiosk typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/kiosk/src/pages/resume/components/ResumeVoiceInputButton.tsx apps/kiosk/src/pages/resume/components/ResumeTranscriptConfirmDialog.tsx
git commit -m "feat(kiosk): add resume voice input dialog"
```

## Task 6: Wire Voice Into ResumeGeneratePage

**Files:**
- Modify: `apps/kiosk/src/pages/resume/ResumeGeneratePage.tsx`

- [ ] **Step 1: Add voice buttons only to long text fields**

Allowed fields:

- 求职意向补充说明 / 自我介绍
- 教育经历描述
- 工作 / 实习经历描述
- 项目经历描述
- 技能证书总结

Forbidden fields:

- name
- phone
- email
- exact dates
- certificate number

- [ ] **Step 2: Append transcript to target field**

Use pure state updates:

```ts
setExperience((items) =>
  items.map((item, idx) =>
    idx === targetIndex ? { ...item, description: appendTranscript(item.description, transcript) } : item,
  ),
)
```

Do not mutate existing arrays.

- [ ] **Step 3: Keep existing generate flow unchanged**

`handleGenerate()` must still call:

```ts
const input = buildInput()
const result = await submitResumeGenerate(input, getToken())
```

No voice-specific branch should bypass `/resume/generate`.

- [ ] **Step 4: Run UI verify**

```bash
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui
pnpm --filter @ai-job-print/kiosk typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/pages/resume/ResumeGeneratePage.tsx
git commit -m "feat(kiosk): wire voice input into resume generation form"
```

## Task 7: Extend Frontend Verify

**Files:**
- Modify: `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`
- Modify: `apps/kiosk/package.json` if a dedicated script is created

- [ ] **Step 1: Add static assertions**

Assert:

- `ResumeGeneratePage.tsx` imports `ResumeVoiceInputButton`.
- Voice buttons exist near long text fields.
- `name`, `phone`, and `email` sections do not contain voice button labels.
- `ResumeTranscriptConfirmDialog.tsx` imports `startWavRecorder`.
- The dialog contains privacy warning text.
- The dialog calls `transcribeResumeVoice`.
- No `localStorage` or `sessionStorage` appears in the two voice components.
- Mock adapter does not return fake transcript text.

- [ ] **Step 2: Run verify**

```bash
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs apps/kiosk/package.json
git commit -m "test(kiosk): guard resume voice input ui"
```

## Task 8: Docs, Review, And Final Verification

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: Sync progress docs**

Record that Wave 4 code side is complete only after all local verification passes. Do not claim preproduction or true hardware acceptance.

- [ ] **Step 2: Run complete local gates**

```bash
pnpm --filter @ai-job-print/api verify:resume-voice-generate
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/kiosk build
git diff --check
```

- [ ] **Step 3: Dual model review**

Run Antigravity + Claude review on `git diff`. Required focus:

- audio not persisted;
- transcript not logged;
- PII fields not silently populated by voice;
- ASR disabled fails honestly;
- existing `/resume/generate` and export paths unchanged.

- [ ] **Step 4: Fix Critical findings**

If either model returns Critical, fix and rerun Task 8 Step 2 and Step 3.

- [ ] **Step 5: Commit docs**

```bash
git add docs/progress/current-progress.md docs/progress/next-tasks.md
git commit -m "docs: record resume voice generation wave4 status"
```

- [ ] **Step 6: Open PR**

```bash
git push -u origin codex/resume-voice-wave4-implementation
gh pr create --base main --head codex/resume-voice-wave4-implementation --title "feat: add resume voice generation" --body "Adds Wave 4 resume voice-assisted generation with short audio transcription, transcript confirmation, privacy guards, and existing resume generation/export reuse."
```

## Preproduction Acceptance Plan

Only after PR merge:

1. Deploy merged candidate to preproduction with backup and `DEPLOY_SOURCE`.
2. Confirm `ASR_PROVIDER` state.
3. If ASR is configured, run short synthetic WAV transcription.
4. If ASR is disabled, verify Kiosk hides or honestly fails voice entry.
5. Fill a resume form from confirmed transcript text.
6. Run `/resume/generate`.
7. Export PDF and confirm `printFileUrl`.
8. Use nonexistent terminal ID for safe print probe; expect `PRINT_TERMINAL_NOT_FOUND` and unchanged `PrintTask` count.

Do not claim Windows true paper output until real Terminal Agent + Pantum hardware acceptance is performed.

