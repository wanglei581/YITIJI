# OCR Live Verify Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使百度 OCR live verify 复用已验证的 Node PDF 渲染兼容层。

**Architecture:** 运行时 `ResumeExtractionService` 已通过 `openPdfForRender()` 注入 `NapiCanvasFactory` 绕开 `unpdf.renderPageAsImage` 的 Node canvas 不兼容。live verify 只替换其合成 PDF 的首屏渲染方式，并由离线 OCR verify 对脚本源代码设防回退断言。

**Tech Stack:** TypeScript、NestJS verify scripts、unpdf、@napi-rs/canvas、Baidu OCR。

---

### Task 1: Add the failing regression guard

**Files:**
- Modify: `services/api/scripts/verify-ocr-baidu.ts`
- Test: `services/api/scripts/verify-ocr-baidu.ts`

- [x] Add a source guard that requires the live verify to import `openPdfForRender` and rejects `renderPageAsImage`.
- [x] Run `pnpm --filter @ai-job-print/api verify:ocr-baidu`; expect failure mentioning the live verify renderer guard.

### Task 2: Reuse the runtime-compatible renderer

**Files:**
- Modify: `services/api/scripts/verify-ocr-baidu-live.ts:55-70`
- Test: `services/api/scripts/verify-ocr-baidu.ts`

- [x] Replace the local unpdf wrapper with `openPdfForRender(pdf)`, `renderPage(1, 2)`, and `destroy()` in a `finally` block.
- [x] Run `pnpm --filter @ai-job-print/api verify:ocr-baidu`, API typecheck, API lint, and `git diff --check`.
- [x] Commit the scoped change as `fix: reuse compatible renderer in OCR live verify`.
