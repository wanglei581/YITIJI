# 招聘会页面大文件零行为拆分

## 目标

- 拆分 `CampusPage.tsx`、`JobFairDetailPage.tsx`、`FairCompanyDetailPage.tsx`。
- 保持路由、接口、文案、按钮标签、外部跳转记录、二维码、打印入口行为不变。
- 为后续招聘会 / 校园招聘功能开发降低审查成本和误改风险。
- 增加页面尺寸防回退验证，避免后续继续在主页面堆功能。

## 非目标

- 不新增功能。
- 不改 API client。
- 不改路由。
- 不改视觉设计。
- 不改合规文案。
- 不新增报名、签到、候选人、投递结果或企业招聘闭环。

## 允许修改文件

- `apps/kiosk/src/pages/campus/CampusPage.tsx`
- `apps/kiosk/src/pages/campus/components/*`
- `apps/kiosk/src/pages/campus/types.ts`
- `apps/kiosk/src/pages/campus/utils.ts`
- `apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx`
- `apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx`
- `apps/kiosk/src/pages/job-fairs/components/*`
- `apps/kiosk/src/pages/job-fairs/types.ts`
- `apps/kiosk/src/pages/job-fairs/utils.ts`
- `apps/kiosk/scripts/verify-jobfair-page-size.mjs`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/jobfair-pages-size-split/**`

## 验证方式

- `node apps/kiosk/scripts/verify-jobfair-page-size.mjs`
- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`
- Claude + Antigravity 双模型 review。
