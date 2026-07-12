# Node 20 PDF Renderer Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Node 20 的 OCR PDF 渲染链路安全兼容 `transferToFixedLength` 缺失情况。

**Architecture:** `openPdfForRender()` 是所有运行时扫描 PDF 渲染的共同入口。它在取得 pdfjs 前调用一个幂等兼容函数；函数只在宿主 API 缺失时定义内容拷贝版本。现有 `verify:ocr-baidu` 在临时移除 Node 22 原生 API 后安装兼容函数，复用已有扫描 PDF 渲染断言覆盖实际渲染。

**Tech Stack:** TypeScript、Node.js ArrayBuffer、unpdf/pdfjs、@napi-rs/canvas、NestJS verify scripts。

---

### Task 1: Add a failing Node 20 simulation regression

**Files:**
- Modify: `services/api/scripts/verify-ocr-baidu.ts`
- Test: `services/api/scripts/verify-ocr-baidu.ts`

- [x] Add a verify block that dynamically imports `ensureArrayBufferTransferToFixedLength`, temporarily replaces `ArrayBuffer.prototype.transferToFixedLength` with `undefined`, calls the function, and asserts a 4-byte buffer transferred to 2 bytes retains `[7, 9]`.
- [x] Preserve the original property descriptor in the test `finally` block so the Node process has no cross-test global mutation.
- [x] Run `pnpm --filter @ai-job-print/api verify:ocr-baidu`; expect RED because the compatibility export does not exist.

### Task 2: Implement the smallest runtime compatibility boundary

**Files:**
- Modify: `services/api/src/ai/resume/ocr/pdf-page-renderer.ts:13-121`
- Test: `services/api/scripts/verify-ocr-baidu.ts`

- [x] Add `ensureArrayBufferTransferToFixedLength()` that leaves an existing native function intact, otherwise defines a configurable/writable method that validates a non-negative safe integer length, allocates a new `ArrayBuffer`, copies the bounded prefix, and returns it.
- [x] Call it as the first operation in `openPdfForRender()` before loading pdfjs.
- [x] Re-run `pnpm --filter @ai-job-print/api verify:ocr-baidu`; expect the simulated fallback and existing scan PDF OCR checks to pass.

### Task 3: Verify and deploy the scoped fix

**Files:**
- Modify: `docs/superpowers/specs/2026-07-12-node20-pdf-renderer-compatibility-design.md`
- Modify: `docs/superpowers/plans/2026-07-12-node20-pdf-renderer-compatibility.md`

- [x] Run API typecheck, API lint, and `git diff --check`; review only the four scoped source/docs files.
- [x] Request Claude and Antigravity read-only reviews; both were invoked, but neither returned a valid final report and are recorded as unavailable rather than approvals.
- [x] After an explicit staging authorization, back up and update only `pdf-page-renderer.ts` plus the two OCR verify scripts, run the Node 20 no-network rendering probe, then run `verify:ocr-baidu-live` with the synthetic document.
- [ ] Commit the scoped change as `fix: support PDF rendering on Node 20`.
