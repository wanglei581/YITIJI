# Phase 0 Final GO/NO-GO Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task.

**Goal:** 对最新主干签发证据可追溯的正式上线 GO / CONDITIONAL GO / NO-GO 结论，不修改任何产品代码或生产环境。

**Architecture:** 将验收分为用户端、后台端、软件运行门禁、生产/硬件现场门禁四个证据域。每条结论标注证据级别，最后按正式清单硬门槛取最保守结论；本地可复验项运行命令，必须依赖生产或真机的项目只读取既有正式回执并保持未关闭状态。

**Tech Stack:** Git/GitHub Actions、pnpm workspace、Vite/TypeScript、NestJS verify scripts、Playwright、Markdown 审计记录。

---

### Task 1: 固定审计基线与正式口径

**Files:**
- Create: `.ccg/tasks/phase0-final-go-no-go-20260729/task.json`
- Create: `.ccg/tasks/phase0-final-go-no-go-20260729/requirements.md`
- Read: `docs/progress/current-progress.md`
- Read: `docs/progress/next-tasks.md`
- Read: `docs/product/feature-scope.md`
- Read: `docs/compliance/compliance-boundary.md`
- Read: `docs/device/production-deployment-and-windows-host-checklist.md`

- [x] 记录 `origin/main` commit、工作区状态和允许/禁止范围。
- [x] 提取正式上线八项通过标准及仍未勾选项目。
- [x] 标记历史证据、当前主干证据与生产现场证据的时间差。

### Task 2: 并行审计三端与运行门禁

**Files:**
- Read only: `apps/**`, `services/**`, `packages/**`, `.github/workflows/**`
- Modify: `.ccg/tasks/phase0-final-go-no-go-20260729/review.md`

- [x] Kiosk 审计：八大业务域、真实性、合规、1080×1920/移动端。
- [x] Admin/Partner 审计：生产接线、权限隔离、运营闭环；区分 P0/P1。
- [x] Runtime 审计：CI、PG、生产版本、Agent、打印/扫描/U盘、支付、试运营。
- [x] Claude + Antigravity + Cursor Grok 4.5 High Fast 交叉分析，合并去重。

### Task 3: 执行当前主干可复验的软件门禁

**Files:**
- Read only: `package.json`, workspace package scripts, `.github/workflows/ci.yml`

- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm verify:dependency-security`
- [x] `pnpm typecheck`
- [x] 执行与 Phase 0 真值、生产配置、合规和浏览器核心路径相关的聚合 verify。
- [x] 核验最新主干 GitHub Actions；记录 workflow、commit、结论。
- [x] 任何失败必须保留原始失败事实，不以文档解释替代。

### Task 4: 签发正式结论并更新进度

**Files:**
- Create: `docs/reviews/phase0-final-go-no-go-2026-07-29.md`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [x] 结论先行：软件候选、预发/试运营、正式生产分别判定。
- [x] P0 只保留真实上线硬阻塞；P1/P2 单列，不混入阻塞清单。
- [x] 每个 P0 写明关闭动作、责任环境、验收证据和禁止宣称。
- [x] 明确本轮未部署、未改数据库、未操作密钥和真机。

### Task 5: 审查、验证与归档

**Files:**
- Modify: `.ccg/tasks/phase0-final-go-no-go-20260729/review.md`
- Move: `.ccg/tasks/phase0-final-go-no-go-20260729` → `.ccg/tasks/archive/2026-07/`

- [x] Claude 与 Antigravity 并行审查最终 diff，Cursor 独立复核上线判断。
- [x] 修复 Critical/Warning 后重新审查。
- [x] `git diff --check`、文档链接与范围检查通过。
- [x] 更新 task 状态为 completed，归档 CCG task。
- [x] 提交审计文档；是否推送/合并须遵守外部动作授权边界。
