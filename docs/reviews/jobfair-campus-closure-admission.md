# 招聘会与校园招聘闭环准入审查

> 日期：2026-06-21
> 分支：`codex/jobfair-campus-closure-admission`
> 范围：只做准入审查、边界确认和首批任务拆分，不修改运行时代码。

## 结论

下一组可以推进，但不能以“补全招聘会功能”为名直接大改页面或扩展招聘业务。正确目标是：在现有招聘会 / 校园招聘真实能力上，补齐本校优先一致性、参展企业外部跳转记录和后续页面拆分准入，同时继续保持第三方 / 官方来源信息入口定位。

首批推荐顺序：

1. `JobFairsPage` 列表页接入 `terminalId`，与 `/campus` 保持本校招聘会优先排序一致。
2. 先定 `fair_company` activity target 模型，再补参展企业详情页真实二维码和外部投递跳转记录。
3. 输出并执行大文件拆分计划，避免继续在 `CampusPage` / `JobFairDetailPage` / `FairCompanyDetailPage` 堆功能。

## 已确认事实

- Kiosk 路由已存在：`/job-fairs`、`/job-fairs/:id`、`/job-fairs/:id/companies`、`/job-fairs/:id/companies/:companyId`、`/job-fairs/:id/map`、`/job-fairs/:id/materials`、`/job-fairs/:id/stats`、`/campus`。
- `CampusPage.tsx` 已读取 `getTerminalId()` 并调用 `getJobFairs(terminalId ? { terminalId } : undefined)`，有终端 ID 时信任后端本校优先排序。
- `JobFairsPage.tsx` 当前调用 `getJobFairs()` 无参，列表页未接入本校优先排序。
- `JobFairDetailPage.tsx` 已记录 `recordBrowse(getToken(), 'job_fair', fair.id)`，扫码预约时记录 `recordExternalJump(..., 'external_appointment')`。
- `FairCompanyDetailPage.tsx` 当前只导入 `getFairCompanyById`，没有 `useAuth` / `recordExternalJump`；“扫码投递”二维码是占位 UI，“去来源平台投递”直接 `window.open(company.sourceUrl)`。
- `activity.types.ts` 只支持 `job`、`job_fair`、`policy`、`company_profile`，且每类 target 只有一个合法 jump action。
- `activity.service.ts` 的 `company_profile` 分支查询 `CompanyProfile`，不能用于 `FairCompany`。
- 现有 verify 覆盖较完整：`verify:jobfair-review`、`verify:admin-fairs`、`verify:jobfair-campus-priority`、`verify:partner-edit`、`verify:partner-smart-campus`。

## 分级审查

### Critical

无需要立即阻塞本准入分支提交的运行时代码问题。本分支不改 runtime。

但后续实现必须把以下事项视为阻塞条件：

- 禁止用 `company_profile` 或 `job_fair` 临时代替参展企业跳转记录。`company_profile` 查不到 `FairCompany`，`job_fair + external_apply` 会污染语义。
- 禁止放宽 `JUMP_ACTION_BY_TARGET`，不得让同一 target 随意记录多种动作。
- 禁止引入报名凭证、签到、入场券、候选人池、企业筛选、面试邀约、Offer、平台内投递或简历回流企业。

### Warning

- `JobFairsPage` 未传 `terminalId`，导致招聘会列表页与 `/campus` 的本校优先排序不一致。
- `FairCompanyDetailPage` 不记录参展企业外部投递跳转，会员“我的记录”无法追溯该类来源入口打开行为。
- `FairCompanyDetailPage` 二维码是占位，不是 `SourceUrlQr(company.sourceUrl)`。
- 普通源码行数已超过规范阈值：`CampusPage.tsx` 896 行、`JobFairDetailPage.tsx` 856 行、`FairCompanyDetailPage.tsx` 628 行。后续触及这些页面时必须先评估拆分，`CampusPage` / `JobFairDetailPage` 不得继续堆新功能。
- `/campus` 仍在前端对公开列表做校园主题启发式过滤。当前已有本校优先排序，但后续若要彻底解决分页漏选，应把 `theme` 过滤下沉到后端。

### Info

- Admin 招聘会审核 / 发布、内容运营、资料签名 URL、审计已有服务和验证基础。
- Partner 招聘会导入 / 编辑 / 下架已具备本机构边界、强制重审和审计。
- 智慧校园与终端学校归属已有 Partner / Kiosk 验证基础。
- 招聘会列表、详情和校园专区的预约文案基本符合合规白名单，保持“扫码预约 / 去来源平台预约”即可。

## 首批独立分支建议

### Branch 1：列表页本校优先接线

- 分支：`codex/jobfairs-list-terminal-priority`
- 目标：`JobFairsPage` 调用 `getTerminalId()`，有终端 ID 时传给 `getJobFairs({ terminalId })`。
- 非目标：不改后端排序算法，不改 UI 结构，不改文案，不新增入口。
- 允许修改文件：`apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx`。
- 验证命令：`pnpm --filter @ai-job-print/kiosk typecheck`、`pnpm --filter @ai-job-print/kiosk lint`、`pnpm --filter @ai-job-print/api verify:jobfair-campus-priority`。
- 审查：低风险小改，可单模型复核；若 diff 超过 30 行仍按 CCG 规则双模型审查。

### Branch 2：参展企业外部投递跳转记录

- 分支：`codex/fair-company-external-jump-logs`
- 目标：新增 `fair_company` activity target，限定 `external_apply`；服务端从 `FairCompany` 及其所属已审核已发布招聘会生成安全快照；前端在扫码投递和去来源平台投递前记录跳转；二维码改用 `SourceUrlQr(company.sourceUrl)`。
- 非目标：不记录投递结果，不接收或转发简历，不改企业 / 招聘会审核流，不把 `FairCompany` 当 `CompanyProfile`。
- 允许修改文件：
  - `services/api/src/activity/activity.types.ts`
  - `services/api/src/activity/activity.service.ts`
  - `services/api/scripts/verify-activity-logs.ts`
  - `apps/kiosk/src/services/api/activity.ts`
  - `apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx`
  - `packages/shared/src/types/memberAssets.ts`
- 验证命令：`pnpm --filter @ai-job-print/api verify:activity-logs`、`pnpm --filter @ai-job-print/api verify:jobfair-review`、`pnpm --filter @ai-job-print/kiosk typecheck`、`pnpm --filter @ai-job-print/kiosk lint`。
- 审查：跨前后端、活动记录模型与合规红线相邻，必须 Claude + Antigravity 双模型审查。

### Branch 3：招聘会页面大文件拆分

- 分支：`codex/jobfair-pages-size-split`
- 目标：按页面现有边界拆分 `CampusPage`、`JobFairDetailPage`、`FairCompanyDetailPage`，优先提取 QR 弹层、ActionBar、Tab 面板、筛选与展示组件；保持零行为变化。
- 非目标：不新增功能，不改路由，不改接口，不改合规文案。
- 允许修改文件：
  - `apps/kiosk/src/pages/campus/CampusPage.tsx`
  - `apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx`
  - `apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx`
  - 同级 `components/`、`types.ts`、`utils.ts` 等拆分文件。
- 验证命令：`pnpm --filter @ai-job-print/kiosk typecheck`、`pnpm --filter @ai-job-print/kiosk lint`、`VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`。
- 审查：大体量结构重构，必须 Claude + Antigravity 双模型审查。

## 推迟事项

- 招聘会报名凭证、签到、入场券、核销：推迟且当前禁止实现。
- Partner 自助维护参展企业、展区、场馆导览：推迟，当前子资源继续由 Admin 内容运营维护。
- 招聘会材料包 / 虚拟手册生成：推迟；现阶段只允许基于真实 `FairMaterial` 签名资料打印。
- 后端 `theme` 过滤：可作为 Branch 4，等前三项收口后再做，避免把列表接线和分页查询重构混在一起。

## 本分支交付标准

- 写入本审查报告和任务归档记录。
- 不修改 runtime 代码。
- 不创建重复入口。
- 不把后续 Branch 1/2/3 混进本分支。
