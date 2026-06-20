# 我的页商用闭环收口计划审查报告

> 日期：2026-06-21  
> 分支：`codex/profile-commercial-closure-plan`  
> 范围：只做计划、审查和进度同步，不修改 runtime 代码。

## 结论

任务目标需要更新：当前不应继续表述为「做出我的页商用闭环」，而应表述为「我的页商用闭环收口计划、拆分准入和首批执行任务定义」。

原因是当前仓库已经具备大量真实能力：权益、通知、反馈、活动、打印订单、文档、收藏、浏览/外部跳转记录和 AI 记录后端。继续以“大闭环”名义开发，容易重复造页面、扩大后端边界或触碰合规红线。

## 双模型审查结果

Claude 和 Antigravity 均支持目标修正，并确认以下事实：

- `ProfilePage.tsx` 超过 500 行阈值，继续新增功能前必须先拆分或至少评估拆分。
- 「AI服务记录」入口指向 `/assistant`，与真实记录语义不一致。
- `GET /api/v1/me/ai-records` 和 `getMyAiRecords` 已存在，但 Kiosk 没有 `/me/ai-records` 页面。
- `relatedPrintTaskId` 已在反馈后端和 client 类型中存在，后端会校验打印订单归属，但前端订单页和反馈页尚未接线。

主要差异：

- Antigravity 建议先做 `/me/ai-records` 和打印反馈两个功能分支。
- Claude 建议先做 `ProfilePage` 结构拆分，再做两个功能分支。

采纳 Claude 的顺序。理由是 `.ccg/spec/guides/index.md` 已明确 500 行以上新增功能前必须评估拆分，而 `ProfilePage.tsx` 已经 595 行；先拆分能降低后续两个分支的 diff 风险。

## 采纳方案

1. `codex/profile-page-split`：纯结构拆分，零行为变更。
2. `codex/profile-me-ai-records-page`：补齐 `/me/ai-records` 页面，修正入口。
3. `codex/profile-print-feedback-link`：接通打印订单到意见反馈的关联参数。

## 不做事项

- 不新建仓库，不迁移物理项目目录。
- 不修改后端模型/API，不引入支付、套餐购买、招聘会凭证或招聘闭环。
- 不恢复 `AccountAssetsPanel` 或「账号资产/资产中心」聚合页。
- 不展示 AI 记录 payload、简历原文或文件内容。
- 不把已完成的权益、通知、反馈、收藏、文档、订单、浏览/跳转记录重做一遍。

## 验证矩阵

| 分支 | 后端验证 | 前端验证 | 浏览器验收 |
| --- | --- | --- | --- |
| `codex/profile-page-split` | 无后端逻辑变更 | `pnpm --filter @ai-job-print/kiosk typecheck` / `pnpm --filter @ai-job-print/kiosk lint` / `pnpm --filter @ai-job-print/kiosk build` | `/profile` 游客态和登录态入口行为不变 |
| `codex/profile-me-ai-records-page` | `pnpm --filter @ai-job-print/api verify:member-assets-c2d` | 同上 | `/profile` 到 `/me/ai-records`，列表、空态、删除、登录引导正常 |
| `codex/profile-print-feedback-link` | `pnpm --filter @ai-job-print/api verify:member-print-orders` / `pnpm --filter @ai-job-print/api verify:feedback-notifications` | 同上 | `/me/print-orders` 到 `/me/feedback` 预填并提交；伪造订单 ID 优雅失败 |

## 风险

- `MyFeedbackPage.tsx` 已接近 500 行，Branch 3 需要控制 diff；若新增逻辑明显膨胀，应拆出反馈表单子组件。
- `relatedPrintTaskId` 来自 URL，前端只能做显示和提交，安全边界必须以后端归属校验为准。
- AI 服务记录页只能展示元数据，不能扩大到简历内容、诊断 payload 或跨会话助手内容。
