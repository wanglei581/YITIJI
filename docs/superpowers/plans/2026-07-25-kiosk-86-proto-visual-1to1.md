# Kiosk 86 屏视觉 1:1 对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 按方案 B 把 Kiosk 全页视觉与 86 原型对齐到前端商用标准（诚实态、不伪造）。

**Architecture:** 共享 shell/token 已就绪；按 W7→W11 逐域修内页 CSS/JSX，每波验证后再进下一波。不重迁路由。

**Tech Stack:** React + Vite + 现有 kiosk-shell tokens + Playwright 1080×1920

**Spec:** `docs/superpowers/specs/2026-07-25-kiosk-86-proto-visual-1to1-design.md`

---

## File map

| Wave | Touch |
|------|-------|
| W7 | `assistant-batch8.css`, `profile-lightflow-shell.css`, `login-form.css`, `login-batch8.css`, `prototype-v1.css`, `help-service-desk.css`, `CampusPage.tsx` |
| W8 | `print-prototype.css`, interview CSS, me gate CTAs |
| W9 | assistant/profile/resume lightflow shells → fusion classes |
| W10 | PrintParams / ResumeSource / ResumeReport dual-column |
| W11 | benefits / settings / generate-preview / empty states |

---

### Task 1: W7 — Profile CTA token

- [ ] Fix `--lf-blue: var(--k-teal)` in `profile-lightflow-shell.css`
- [ ] Browser: `/profile` 「手机号登录」高对比

### Task 2: W7 — Assistant send

- [ ] Pin `.assistant-send` color + bg to `--k-teal` / `--k-surface` in `assistant-batch8.css`
- [ ] Browser: `/assistant` 有输入时可点发送清晰

### Task 3: W7 — Login disabled

- [ ] Remove stacked opacity on `.k-cta:disabled` (`login-form.css` + `login-batch8.css`)
- [ ] Browser: `/login` 禁用钮仍可读

### Task 4: W7 — Home / Help / Campus

- [ ] `.kpv1--content-only` 适度 `padding-bottom`
- [ ] Help filters `flex-wrap`
- [ ] Remove `campus-topbar` duplicate in `CampusPage.tsx`
- [ ] Run typecheck + lint + verify:kiosk-visual-unity

### Task 5–8: W8–W11

- [ ] W8 主色
- [ ] W9 lightflow 退役
- [ ] W10 A 类双栏
- [ ] W11 VISUAL_DIFF

---

## Verification (every wave)

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/kiosk verify:kiosk-visual-unity
# sample routes at http://127.0.0.1:5288 1080×1920
```
