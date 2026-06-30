# 求职材料库商用闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/resume/templates` 从静态占位改成可生成真实 PDF、进入我的文档并可打印的商用闭环。

**Architecture:** 不新增数据库模板表，先用 shared 内置模板常量作为模板目录；后端新增 `JobMaterialsModule` 生成 PDF 并通过 `FilesService.upload()` 落 `FileObject`；Kiosk 只在拿到真实签名 URL 后进入打印确认页；Admin 先做只读运营视图。

**Tech Stack:** React + Vite + TypeScript + NestJS + Prisma + pdfkit + FileObject + 现有打印链路。

---

### Task 1: Shared Contract And Failing Verifiers

**Files:**
- Create: `packages/shared/src/types/jobMaterials.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `services/api/scripts/verify-job-materials.ts`
- Create: `apps/kiosk/scripts/verify-job-material-library-ui.mjs`
- Create: `apps/admin/scripts/verify-admin-job-materials-ui.mjs`
- Modify: `services/api/package.json`
- Modify: `apps/kiosk/package.json`
- Modify: `apps/admin/package.json`

- [x] Write `jobMaterials` shared types and published template constants.
- [x] Write API verifier that fails until `/src/job-materials` module exists and templates/generation contracts are present.
- [x] Write Kiosk verifier that fails while homepage cards are disabled and template page still contains `打印(待接入)`.
- [x] Write Admin verifier that fails until `/job-materials` route and single nav item exist.
- [x] Run the three verify commands and confirm RED.

### Task 2: Backend Job Materials Module

**Files:**
- Create: `services/api/src/job-materials/job-materials.types.ts`
- Create: `services/api/src/job-materials/job-material-templates.ts`
- Create: `services/api/src/job-materials/dto/generate-job-material.dto.ts`
- Create: `services/api/src/job-materials/job-material-pdf.service.ts`
- Create: `services/api/src/job-materials/job-materials.service.ts`
- Create: `services/api/src/job-materials/job-materials.controller.ts`
- Create: `services/api/src/job-materials/job-materials.module.ts`
- Modify: `services/api/src/app.module.ts`

- [x] Implement published template listing.
- [x] Implement member-only generation with `EndUserAuthGuard`.
- [x] Render A4 PDF with CJK font resolution, input length limits, no HTML rendering.
- [x] Upload generated PDF with `purpose='cover_letter'`, `assetCategory='derived'`, `endUserId`.
- [x] Return only safe metadata and short signed URL; write safe audit summary.
- [x] Implement admin summary with aggregate counts only.
- [x] Run `pnpm --filter @ai-job-print/api verify:job-materials` and confirm GREEN.

### Task 3: Kiosk User Flow

**Files:**
- Create: `apps/kiosk/src/services/api/jobMaterials.ts`
- Modify: `apps/kiosk/src/services/api/index.ts`
- Modify: `apps/kiosk/src/pages/resume/ResumeTemplateLibraryPage.tsx`
- Modify: `apps/kiosk/src/pages/home/HomePage.tsx`
- Modify: `apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx`

- [x] Replace local static placeholder with API/mock backed template list.
- [x] Require login before generation and use `getToken()` only from AuthContext memory.
- [x] Show structured generation form and submit to backend.
- [x] On success, show preview/save/print actions; navigate to `/print/confirm` only with real `signedUrl`.
- [x] Add PDF print action to `/me/documents` using `fetchAccessUrl()` before print.
- [x] Run `pnpm --filter @ai-job-print/kiosk verify:job-material-library-ui` and confirm GREEN.

### Task 4: Admin Readonly Operations View

**Files:**
- Create: `apps/admin/src/services/api/jobMaterials.ts`
- Create: `apps/admin/src/routes/job-materials/index.tsx`
- Modify: `apps/admin/src/routes/index.tsx`
- Modify: `apps/admin/src/layouts/AdminLayoutWrapper.tsx`

- [x] Add single `/job-materials` route and one nav item.
- [x] Show built-in templates, published status, generation totals, last 7 days.
- [x] Keep view readonly; no upload/edit controls in this phase.
- [x] Run `pnpm --filter @ai-job-print/admin verify:admin-job-materials-ui` and confirm GREEN.

### Task 5: Docs, Typecheck, Review

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `docs/product/user-data-flow-matrix.md`
- Modify: `.ccg/tasks/job-materials-commercial-closure/review.md`

- [x] Update progress docs with actual implementation status.
- [x] Run API/Kiosk/Admin typecheck and focused verify scripts.
- [x] Run Claude + Antigravity diff review.
- [x] Fix Critical/High findings and rerun focused verification.
