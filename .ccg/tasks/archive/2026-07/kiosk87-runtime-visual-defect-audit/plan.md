# Kiosk 87 页运行时与视觉缺陷修复计划

## 已证实问题

1. `/offline-agencies` 在真实 HTTP 接口下硬崩溃。真实列表返回 `{ data: WireOfflineAgency[], total, page, pageSize }`，当前前端错误地把 `body.data` 强转为富页面 DTO；`services` 还是 JSON 字符串，详情端点也存在同源错位。
2. 路由没有全局中文 `errorElement`，未捕获异常和未知路由会暴露 React Router 英文堆栈。
3. 1080×1920 同视口截图确认：
   - `/print-scan` 页头返回键缩成右侧窄按钮，与原型 02 不一致。
   - `/resume/source` 右栏过窄，标题和筛选项发生逐字换行。
   - `/interview/setup` 使用错误的双栏密度，与原型 38 的纵向编排明显不一致。
4. 静态交叉审计确认更多系统性风险：行动条页仍叠加全局底栏；七个 Kiosk 顶级路由绕过固定舞台；打印页页头与正文 gutter 分裂；法律页缺少完整壳层。

## 分层实施与文件所有权

### Layer 1A — 线下机构真实契约（子代理独占）

- `apps/kiosk/src/services/api/offlineAgencies.ts`
- `apps/kiosk/src/pages/offline-agencies/OfflineAgenciesPage.tsx`
- `apps/kiosk/src/pages/offline-agencies/OfflineJobDetailPage.tsx`
- `apps/kiosk/tests/fixtures/fusion-w4-api.ts`
- `apps/kiosk/tests/visual/fusion-w4.spec.ts`
- `apps/kiosk/scripts/verify-fusion-w4.mjs`

先把 fixture 改为真实 wire shape 并扩展 verify，确认 RED；再增加集中 mapper，诚实隐藏后端没有的统计/岗位数/距离，不伪造营业实时性。

### Layer 1B — W2 打印扫描与打印流程几何（子代理独占）

- `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx`
- `apps/kiosk/src/pages/print-scan/styles/print-scan-fusion.css`
- `apps/kiosk/src/pages/print/PrintPrototypeLayout.tsx`
- `apps/kiosk/src/pages/print/print-prototype.css`
- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`

先锁定页头返回键、48px 统一 gutter、actionbar 几何 RED，再修复共享页壳；不动支付、打印任务、设备能力语义。

### Layer 1C — W3 简历/面试舞台与代表页编排（子代理独占）

- `apps/kiosk/src/components/kiosk-shell/KioskFullscreenShell.tsx`
- `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`
- `apps/kiosk/src/pages/resume/JobFitPage.tsx`
- `apps/kiosk/src/pages/resume/CareerPlanPage.tsx`
- `apps/kiosk/src/pages/resume/resume-fusion-youth.css`
- `apps/kiosk/src/pages/interview/InterviewSetupPage.tsx`
- `apps/kiosk/src/pages/interview/InterviewReportsPage.tsx`
- `apps/kiosk/src/pages/interview/styles/interview-shell.css`
- `apps/kiosk/scripts/verify-fusion-w3.mjs`

先把 1080×1920 舞台、ResumeSource 双栏比例、InterviewSetup 纵向编排和 InterviewReports 底栏合同写成 RED，再修复；不改 AI、TRTC、会话或报告数据逻辑。

### Layer 1D — 全局中文错误兜底与导航替代规则（主代理独占）

- `apps/kiosk/src/routes/index.tsx`
- `apps/kiosk/src/layouts/KioskRoot.tsx`
- `apps/kiosk/src/main.tsx`
- `apps/kiosk/src/pages/errors/KioskRouteErrorPage.tsx`（新增）
- `apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs`（新增）
- `apps/kiosk/package.json`

先新增静态 verify 并取得 RED；随后添加覆盖全部顶级路由的父级 `errorElement`，不展示原始 error/stack；行动条页隐藏全局底栏，保留现有业务级 ErrorState。

## Layer 2 — 合并验证与视觉复验

- 逐个运行新增/扩展 verify、typecheck、lint、build、`git diff --check`。
- 用真实浏览器在 1080×1920 复验 `/offline-agencies`、未知路由、`/print-scan`、`/resume/source`、`/interview/setup`，并与原型同视口截图成对检查。
- 重新跑 87 路由运行时扫描和首页入口实点；记录仍未完成的真实硬件/登录态/预生产验收。

## 审查与收口

- Antigravity 与 Claude 对完整 diff 并行审查；Critical 修复后重审。
- 更新 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`。
- 归档 CCG task，精确 stage，禁止 `git add .`。
