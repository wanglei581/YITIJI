# 参展企业外部投递跳转记录

## 目标

- 新增 `fair_company` activity target。
- `fair_company` 只允许 `external_apply` 动作。
- 服务端只允许记录归属已审核、已发布招聘会的 `FairCompany`。
- `FairCompanyDetailPage` 的扫码投递和来源平台投递入口记录本人外部跳转。
- 参展企业投递二维码改为真实 `SourceUrlQr(company.sourceUrl)`。
- 我的浏览与跳转记录能识别 `fair_company` 类型，并可回到参展企业详情页。

## 非目标

- 不记录投递结果。
- 不接收、存储或转发求职者简历给企业。
- 不新增报名、签到、候选人管理、面试邀约或 Offer 流程。
- 不改招聘会 / 参展企业审核发布流。
- 不把 `FairCompany` 伪装为 `company_profile` 或 `job_fair`。

## 允许修改文件

- `services/api/src/activity/activity.types.ts`
- `services/api/src/activity/activity.service.ts`
- `services/api/scripts/verify-activity-logs.ts`
- `apps/kiosk/src/services/api/activity.ts`
- `apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx`
- `apps/kiosk/src/pages/profile/me/MyActivityPage.tsx`
- `packages/shared/src/types/memberAssets.ts`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/fair-company-external-activity/**`

## 设计决策

- 一体机不直接 `window.open` 来源平台；参照 `JobDetailPage`，入口按钮打开真实二维码，让用户用手机扫码前往来源平台。
- 对 `fair_company`，`ExternalJumpLog.externalId` 保存父级 `JobFair.id`，用于 `/me/activity` 回跳 `/job-fairs/:id/companies/:companyId`。`FairCompany` 自身没有独立外部编号。
- 没有有效 `company.sourceUrl` 时不记录跳转；二维码组件仍可显示“来源平台未提供有效链接”的兜底提示。

## 验证方式

- `pnpm --filter @ai-job-print/api verify:activity-logs`
- `pnpm --filter @ai-job-print/api verify:jobfair-review`
- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
