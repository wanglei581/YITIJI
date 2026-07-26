# Kiosk 82 个视觉目标证据与真实性第二批 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 先关闭打印与扫描的假成功、可见死按钮和无真实来源状态，再为 77 个主视觉目标与 5 个 Fusion 状态参考建立可执行证据清单；本批不宣称 82 个目标已经逐屏像素验收完成。

**Architecture:** 生产 UI 只展示后端可确认的状态。打印完成页以 `GET /print/jobs/:taskId` 为真相，扫描页以真实会话创建结果为真相；线下机构搜索复用既有 `keyword` 查询，场馆导览复用既有材料页。视觉证据层复用唯一迁移矩阵，显式登记 `PRIMARY`、`SUBVIEW_STATE`、`ROUTE_STATE`、`REUSE`、`REDIRECT`、`NO_INDEPENDENT_PROTOTYPE`，截图产物留在 ignored `test-results/`。

**Tech Stack:** React 18、React Router、TypeScript、Vite、Playwright、Node.js 静态 verify、pnpm。

---

## 文件预算与禁止范围

本批允许修改：

- 打印真实性：`apps/kiosk/src/pages/print/PrintDonePage.tsx`、打印完成专用测试/verify、必要的 W6 直达预期。
- 扫描真实性：`apps/kiosk/src/pages/scan/ScanStartPage.tsx`、`apps/kiosk/src/pages/scan/ScanSettingsPage.tsx`、扫描专用测试/verify。
- 已知死按钮与诚实空态：`OfflineAgenciesPage.tsx`、`FairMapPage.tsx`、`ResumeExportPage.tsx` 及各自专用测试/verify。
- 证据基础：`apps/kiosk/tests/visual/fixtures/kiosk-p1-visual-evidence-targets.ts`、`apps/kiosk/scripts/verify-visual-evidence-manifest.mjs`、Kiosk package scripts、现有视觉验收 runbook。
- 集成门禁与唯一映射合同：现有 W2 浏览器测试、W2 静态 verify、`docs/design/kiosk-proto-2026-07-migration-matrix.md` 中仅与 34A 真相冲突的行。
- 本计划、CCG task、必要的 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`。

禁止修改：

- `ProfilePage`、`apps/kiosk/src/pages/profile/me/**` 和 `/me/*` 页面实现。
- API、DTO、Prisma、数据库、认证、权限、支付、打印/扫描硬件协议、Terminal Agent、AI/TRTC、岗位投递或招聘会合规语义。
- 冻结原型 HTML、Fusion `sources/**`、`SOURCE-MANIFEST.md`。
- 原型假数据、演示登录、localStorage 假持久化、客户端临时 PDF/截图打印。

## Task 1：打印完成页只接受真实任务状态

**Owner 独占文件：**

- Modify: `apps/kiosk/src/pages/print/PrintDonePage.tsx`
- Modify: `apps/kiosk/tests/visual/fixtures/fusion-w6-route-cases.ts`
- Create: `apps/kiosk/scripts/verify-print-done-truth.mjs`
- Create/Modify: `apps/kiosk/tests/visual/print-done-truth.spec.ts`

1. 先写 RED：直达 `/print/done` 不得出现“打印完成”；伪造 `success:true` 但真实状态为 pending/failed 不得成功；仅 completed 成功；网络未知不可重打；帮助跳 `/help`；有任务 ID 的异常反馈跳到带准确参数的既有 `/me/feedback`；无真实持久化来源的评分控件不得存在。
2. 运行专用静态 verify 与 Playwright 用例，保存失败输出到 task 记录。
3. 最小 GREEN：有 `taskId` 时查询既有打印任务状态；只有 `completed` 显示成功，进行中返回进度页，失败显示失败，缺上下文/404/网络错误显示“无法确认打印结果”。
4. 不修改反馈页面；只链接既有入口。无任务 ID 时不创建孤立反馈。
5. 运行专用 verify、浏览器用例、Kiosk typecheck。

## Task 2：扫描页以真实会话创建结果为准

**Owner 独占文件：**

- Modify: `apps/kiosk/src/pages/scan/ScanStartPage.tsx`
- Modify: `apps/kiosk/src/pages/scan/ScanSettingsPage.tsx`
- Create: `apps/kiosk/scripts/verify-scan-session-truth.mjs`
- Create/Modify: `apps/kiosk/tests/visual/scan-session-truth.spec.ts`

1. 先写 RED：生产代码不得依赖不存在的 `/kiosk/device/status`；直达 settings 不 POST；创建失败不显示任务 ID、已创建或操作步骤；网络未知不自动重试；成功只显示服务端 instructions/token 对应状态。
2. 运行专用 verify/Playwright，记录 RED。
3. 最小 GREEN：开始页只说明下一步将创建真实扫描会话；必须通过合法的可见入口携带显式 state 才允许 settings 创建。
4. settings 严格区分 loading/success/error；失败和未知状态只允许安全返回，不提供盲目重试；继续保持 controlToken 仅内存保存和 StrictMode 单次创建/取消。
5. 运行专用 verify、浏览器用例、Kiosk typecheck。

## Task 3：关闭线下机构、场馆导览和简历导出页的误导控件

**Owner 独占文件：**

- Modify: `apps/kiosk/src/pages/offline-agencies/OfflineAgenciesPage.tsx`
- Modify: `apps/kiosk/src/pages/job-fairs/FairMapPage.tsx`
- Modify: `apps/kiosk/src/pages/resume/ResumeExportPage.tsx`
- Create: `apps/kiosk/scripts/verify-kiosk-visible-actions-truth.mjs`
- Create/Modify: `apps/kiosk/tests/visual/kiosk-visible-actions-truth.spec.ts`

1. 先写 RED：机构搜索提交 trim 后的 `keyword`、清空移除 keyword、翻页保持 keyword；导览按钮不得无 handler、不得把地图预览 URL 当打印 URL；导出直达无真实产物时下载/保存/打印保持禁用。
2. 运行专用 verify/Playwright，记录 RED。
3. 最小 GREEN：机构搜索改成受控表单并复用既有服务端过滤；不添加距离、定位、岗位数或固定虚假行政区。
4. 导览按钮改为“查看可打印导览资料”，进入既有 `/job-fairs/:id/materials`，由材料页决定是否有真实 `venue_map` 可打印。
5. `/resume/export` 只做原型层级与间距对齐，保留诚实无产物状态；主 CTA 指向既有简历制作入口，不新增原型外入口，不构造 Blob、fileId、signedUrl 或 printFileUrl。
6. 运行专用 verify、浏览器用例、Kiosk typecheck。

## Task 4：冻结 82 目标与 87 路由的证据合同

**Owner 独占文件：**

- Create: `apps/kiosk/tests/visual/fixtures/kiosk-p1-visual-evidence-targets.ts`
- Create: `apps/kiosk/scripts/verify-visual-evidence-manifest.mjs`
- Modify: `docs/acceptance/kiosk-8177-5299-fusion-visual-runbook.md`

1. 先写 RED verifier：要求 77 个主视觉目标、5 个 Fusion 状态参考；要求 87 路由逐一处置；`34A` 必须分别覆盖 `/scan/start` 与 `/scan/settings`；73 必须为 `/assistant` 页内子状态；5 个重定向不生成伪视觉 pair；`/me/privacy-requests` 必须标记 `NO_INDEPENDENT_PROTOTYPE`。
2. 运行 verifier，确认目标清单缺失时失败。
3. 最小 GREEN：填写显式 target manifest，包含 prototype path、reference kind、route/state、capture URL、viewport、fixture/precondition、ready marker、claim scope 和 known limits。
4. 所有 fixture 记录必须标记 `contract-fixture`，不得写“真实链路”；截图输出仅指向 ignored `test-results/kiosk-p1-visual-evidence/<sha>/`。
5. 运行 manifest verifier 与现有 baseline/W6 verifier。

## Task 5：集成、视觉复核与审查

**Owner：主代理。**

1. 精确合并 package scripts，不用 `git add .`。
2. 运行所有新增 verify；运行现有 W2/W4/W6 静态门禁与必要浏览器回归。
3. 运行 Kiosk/Admin/Partner 的 typecheck、lint、build，以及 `git diff --check`。
4. 用 1080×1920 同视口重新截取本批代表页原型/当前页配对，人工检查结构、间距、字号、边界、错误态与主 CTA；不得把截图本身称为全量 QA。
5. 先由独立子代理做 spec 审查，再做质量审查；变更超过 30 行时并行调用 Antigravity 与 Claude。Critical 修复后重审。
6. 更新进度文档，明确“本批只完成真实性修复与证据合同；82 目标逐屏对照、预生产、手机/27 寸真机仍需后续执行”。
7. 归档 CCG task，精确 stage 并提交本地候选；不 push、不合并、不部署。

## 验收命令

具体脚本名以 package 中现有命名风格为准，但至少执行：

```bash
pnpm --filter @ai-job-kiosk run verify:print-done-truth
pnpm --filter @ai-job-kiosk run verify:scan-session-truth
pnpm --filter @ai-job-kiosk run verify:visible-actions-truth
pnpm --filter @ai-job-kiosk run verify:visual-evidence-manifest
pnpm --filter @ai-job-kiosk run verify:fusion-w2
pnpm --filter @ai-job-kiosk run verify:fusion-w4
pnpm --filter @ai-job-kiosk run verify:fusion-w6
pnpm --filter @ai-job-kiosk typecheck
pnpm --filter @ai-job-kiosk lint
pnpm --filter @ai-job-kiosk build
pnpm --filter @ai-job-admin typecheck
pnpm --filter @ai-job-admin lint
pnpm --filter @ai-job-admin build
pnpm --filter @ai-job-partner typecheck
pnpm --filter @ai-job-partner lint
pnpm --filter @ai-job-partner build
git diff --check
```

浏览器结论必须区分：production build + contract fixture、预生产真实 API、Windows 打印/扫描真机；本批前两者若未实际运行，不得写 PASS。
