# 参展企业外部投递跳转记录审查

## 变更范围

- `ActivityTargetType` 新增 `fair_company`，并在后端 `JUMP_ACTION_BY_TARGET` 中限定为 `external_apply`。
- `ActivityService.loadPublishedTarget` 新增 `fair_company` 分支，只允许记录归属 `approved + published` 招聘会的参展企业。
- `verify-activity-logs` 增加参展企业正向、未发布父招聘会拒绝、动作错配拒绝、禁词扫描覆盖。
- `FairCompanyDetailPage` 将占位二维码替换为 `SourceUrlQr(company.sourceUrl)`，扫码投递和来源入口按钮统一打开二维码并记录本人外部跳转。
- `MyActivityPage` 支持 `fair_company` 类型展示与回跳 `/job-fairs/:fairId/companies/:companyId`。

## TDD 证据

- RED：扩展 `verify-activity-logs` 后先运行失败，失败点为 `fair_company` 还不是合法 targetType，返回 Bad Request。
- GREEN：补齐类型、服务端快照和前端接线后，`verify:activity-logs` 通过。

## 双模型分析

- Claude：指出 `window.open` 与一体机二维码模式冲突，建议两个投递入口都打开二维码；同时要求 QR 展示 URL 与记录 URL 一致。
- Antigravity：指出 `MyActivityPage` 的 `TYPE_LABEL` 和回跳路由必须适配 `fair_company`，否则类型或导航会出问题。
- 已处理：本分支采用二维码模式，不直接跳出浏览器；新增 `MyActivityPage` 支持；无效来源 URL 不记录跳转。

## 验证结果

- `pnpm --filter @ai-job-print/api verify:activity-logs`：通过。
- `pnpm --filter @ai-job-print/api verify:jobfair-review`：通过。
- `pnpm --filter @ai-job-print/api typecheck`：通过。
- `pnpm --filter @ai-job-print/kiosk typecheck`：通过。
- `pnpm --filter @ai-job-print/kiosk lint`：通过，保留既有 `KioskBusyContext.tsx` Fast Refresh warning。
- 最终 Claude + Antigravity 双模型 review：无 Critical、无 Warning。Claude 提出的 verify 脚本注释编号重复已修正；Antigravity 关于 `recordExternalJump` catch 的建议不适用，因为该封装返回 `void` 且内部已吞失败。

## 边界

- 不记录投递结果。
- 不接收、存储或转发简历给企业。
- 不新增报名、签到、候选人管理、面试邀约或 Offer 流程。
- 不把参展企业记录混入 `company_profile` 或 `job_fair`。
