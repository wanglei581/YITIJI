# 岗位匹配匿名授权 Kiosk 闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让匿名简历用户能在 `/resume/job-fit` 明确授权、完成一次岗位匹配分析并随时撤回后续分析授权，同时保持会员、打印与既有 IA 不变。

**Architecture:** Kiosk 只调用已存在的 consent 三个 API；`jobFit.ts` 为该三接口强制剥离会员 Bearer，页面仅在服务端匿名 fail-closed 后展示确认弹窗。授权和撤回展示拆进两个 `jobFit/` 小组件，页面持有短暂的待重试请求和授权状态，且只自动重试一次。

**Tech Stack:** React 18、TypeScript、现有 `@ai-job-print/ui`、Vite、Node 静态 verify、GitHub Actions。

---

## 文件结构与边界

| 路径 | 责任 |
|---|---|
| `apps/kiosk/src/services/api/jobFit.ts` | consent HTTP 适配及令牌隔离 |
| `apps/kiosk/src/pages/resume/jobFit/AnonymousJobFitConsentDialog.tsx` | 明确同意/取消的无副作用视图 |
| `apps/kiosk/src/pages/resume/jobFit/AnonymousJobFitConsentCard.tsx` | 已授权时的撤回入口与诚实提示 |
| `apps/kiosk/src/pages/resume/jobFit/MemberJobFitConsentCard.tsx` | 复用既有会员岗位 AI 授权入口的引导 |
| `apps/kiosk/src/pages/resume/JobFitPage.tsx` | 403 分流、一次重试、状态恢复和页面编排 |
| `apps/kiosk/scripts/verify-job-fit-m1-5-ui.mjs` | 防止 consent、IA、令牌与文案回退 |
| `.github/workflows/ci.yml` | 让既有 API 打印守卫进入 CI |
| `docs/progress/current-progress.md`、`docs/progress/next-tasks.md` | 只记录本地代码/验证事实，不宣称预生产或真机完成 |

不改后端、数据库、shared 契约、路由、支付、订单、确认页、Windows Agent、Admin/Partner 或外部投递。

### Task 1: 先建立会失败的回归门禁

**Files:**
- Modify: `apps/kiosk/scripts/verify-job-fit-m1-5-ui.mjs`

- [ ] **Step 1: 增加 RED 断言和组件读取**

读取两个待创建组件，新增断言要求：`JobFitConsentStatus`、`anonymousAccess()` 只保留 `accessToken`、三个 `/resume/job-fit/consent` 调用、403 的 `JOB_FIT_ANONYMOUS_CONSENT_REQUIRED` 分流、`USER_AI_CONSENT_REQUIRED` 引导、一次授权后一次 `analyzeJobFit` 重试、授权状态读取、撤回调用、`role="dialog"`/`aria-modal`、最小 `h-12` 触控按钮、用途/到期/撤回/不向企业共享四项文案。

- [ ] **Step 2: 运行 RED 验证**

Run: `pnpm --filter @ai-job-print/kiosk verify:job-fit-m1-5-ui`

Expected: 退出码 1，缺少匿名 consent API、组件或页面分流断言；不能因脚本错误失败。

### Task 2: 实现令牌隔离和可访问的小组件

**Files:**
- Modify: `apps/kiosk/src/services/api/jobFit.ts`
- Create: `apps/kiosk/src/pages/resume/jobFit/AnonymousJobFitConsentDialog.tsx`
- Create: `apps/kiosk/src/pages/resume/jobFit/AnonymousJobFitConsentCard.tsx`
- Create: `apps/kiosk/src/pages/resume/jobFit/MemberJobFitConsentCard.tsx`

- [ ] **Step 1: 在 `jobFit.ts` 写最小 API 适配**

添加 `JobFitConsentStatus`，并以以下 helper 防止 consent 请求带入会员身份：

```ts
function anonymousAccess(access: JobFitAccess): JobFitAccess {
  return { accessToken: access.accessToken }
}
```

添加 `grantJobFitConsent(taskId, access)`、`getJobFitConsentStatus(taskId, access)`、`revokeJobFitConsent(taskId, access)`；三者分别调用既有 POST/GET/DELETE 端点，mock 模式保持 fail-closed。不得扩展 `call()` 的 header 逻辑，也不得把 token 写入存储或日志。

- [ ] **Step 2: 写授权弹窗和撤回卡片**

弹窗只接收 `busy`、`error`、`onCancel`、`onConfirm`，使用既有 `Card`/`Button`，标注 `role="dialog"`、`aria-modal="true"` 与标题关联；取消不调用 API。文案必须说明：分析使用本次简历诊断内容、结果按诊断到期策略保存、可撤回后续分析授权、不代表招聘结果、不向企业共享简历。

撤回卡片只接收 `busy` 与 `onRevoke`，按钮高度 `h-12`；文字明确“撤回仅影响后续分析，已有报告按诊断到期策略保存”。

- [ ] **Step 3: 运行组件级 GREEN 预检**

Run: `pnpm --filter @ai-job-print/kiosk typecheck`

Expected: 退出码 0；此时完整 M1.5 verify 仍应只因页面编排与 CI 行尚未实现而失败。

### Task 3: 编排匿名/会员状态机，不改变既有入口

**Files:**
- Modify: `apps/kiosk/src/pages/resume/JobFitPage.tsx`

- [ ] **Step 1: 在恢复 effect 中独立读取匿名授权状态**

当 `taskId` 和匿名 `accessToken` 都存在且没有会员 token 时，并行调用 `getLatestJobFit` 与 `getJobFitConsentStatus`；任一读回失败不能取消另一项。状态只保存 `anonymousConsentActive`，任务/令牌变化时重置。不得把会员 Bearer 交给 consent API。

- [ ] **Step 2: 处理两类 403**

`handleAnalyze` 保持原有输入校验和首次分析。仅在匿名 403 时把当前 `JobFitRequest` 保存在 React state 并打开弹窗；仅在会员 403 时显示“先确认岗位 AI 辅助授权”并引导既有 `/jobs` 入口。其他异常继续按现有用户可见错误处理。

- [ ] **Step 3: 授权、单次重试与撤回**

确认授权后顺序执行：grant → 设置 active → 关闭弹窗并清理待重试引用 → 对原始输入调用一次 `analyzeJobFit`。grant 失败留在弹窗显示错误；grant 成功后的分析失败显示页面错误且不再次自动尝试。授权 active 时，在选择态和结果态复用撤回卡片；撤回成功后设为 inactive 并显示“已撤回，重新分析需再次授权”。

- [ ] **Step 4: 运行页面 GREEN 验证**

Run: `pnpm --filter @ai-job-print/kiosk typecheck && pnpm --filter @ai-job-print/kiosk lint && pnpm --filter @ai-job-print/kiosk verify:job-fit-m1-5-ui`

Expected: typecheck 退出码 0；lint 无新增 error（既有 Fast Refresh warning 单独如实记录）；门禁退出码 0。

### Task 4: 加入 CI 回归并如实更新进度

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: 连接已有 API 打印守卫**

在 API verify 队列中紧跟 `verify:governed-job-fit` 执行 `pnpm --filter @ai-job-print/api verify:job-fit-print`；不改变其他 job 顺序或触发条件。

- [ ] **Step 2: 更新正式进度入口**

在 M1.5 记录追加：本分支仅补本地 Kiosk 匿名/会员 consent UI、令牌隔离、撤回入口与 CI 防回退；没有预生产部署、真实 LLM、支付、确认页、出纸或 Windows 真机结论。将下一步明确为“部署后以无个人信息夹具验证浏览器授权/撤回”。

- [ ] **Step 3: 验证 CI 脚本引用与文档格式**

Run: `pnpm --filter @ai-job-print/api verify:job-fit-print && git diff --check`

Expected: API 守卫通过，diff 无 whitespace 错误。

### Task 5: 完整本地验证和审查准备

**Files:**
- Verify only: 所有上述文件

- [ ] **Step 1: 执行最小完整回归**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:job-fit-m1-5-ui
pnpm --filter @ai-job-print/kiosk verify:ai-artifact-print-url-contract
pnpm --filter @ai-job-print/api verify:job-fit-print
pnpm --filter @ai-job-print/api verify:governed-job-fit
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 pnpm --filter @ai-job-print/kiosk build
git diff --check
```

Expected: 每项退出码 0；若 lint 仅保留既有 Fast Refresh warning，记录其来源而不伪称零 warning。

- [ ] **Step 2: 浏览器证据边界**

用 1080×1920 本地 Kiosk 页面检查无简历诚实空态、弹窗触控高度和控制台错误；匿名实际 grant/revoke 需要后续受控预生产无个人信息夹具，不能用真实用户数据或进入打印确认页。

- [ ] **Step 3: 双模型和安全审查**

对最终 diff 调用 Antigravity 与 Claude；若任一服务仍不可用，记录为“未取得有效报告”，不得写成通过。人工复核令牌没有进入 localStorage、URL、日志或会员 consent 请求，且没有改变后端授权、打印或支付路径。

- [ ] **Step 4: 提交边界清晰的实现提交**

Run: `git add .github/workflows/ci.yml apps/kiosk/scripts/verify-job-fit-m1-5-ui.mjs apps/kiosk/src/services/api/jobFit.ts apps/kiosk/src/pages/resume/JobFitPage.tsx apps/kiosk/src/pages/resume/jobFit/AnonymousJobFitConsentDialog.tsx apps/kiosk/src/pages/resume/jobFit/AnonymousJobFitConsentCard.tsx apps/kiosk/src/pages/resume/jobFit/MemberJobFitConsentCard.tsx docs/progress/current-progress.md docs/progress/next-tasks.md docs/superpowers/specs/2026-07-12-job-fit-anonymous-consent-ui-design.md docs/superpowers/plans/2026-07-12-job-fit-anonymous-consent-ui.md && git commit -m "fix: complete job fit anonymous consent UI"`

Expected: 只包含本计划文件；不 push、不建 PR、不部署。
