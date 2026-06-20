# 打印订单关联反馈闭环审查

> 日期：2026-06-21
> 分支：`codex/profile-print-feedback-link`

## 目标

完成「我的页商用闭环」Branch 3：从 `/me/print-orders` 的本人打印订单跳转到 `/me/feedback?category=print&relatedPrintTaskId=...`，提交意见反馈时携带 `relatedPrintTaskId`，由后端既有归属校验保证不会关联他人订单。

## 范围

已修改：

- `apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx`
- `apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx`
- `services/api/scripts/verify-member-print-orders.ts`

未修改：

- 后端反馈接口契约、数据库 schema、权限模型。
- 打印订单生产行为、文件内容展示、支付/金额字段。

## 结论

- 打印订单列表中仅对 `completed` / `failed` 订单展示「反馈」入口。
- 反馈页读取 `category` 与 `relatedPrintTaskId` 查询参数；关联打印订单时分类固定为「打印服务」，提交 payload 中带 `relatedPrintTaskId`。
- 前端对 `FEEDBACK_PRINT_TASK_INVALID` 做专门提示。
- 订单卡片改为响应式 grid，避免小屏下长文件名挤压状态与反馈按钮。
- `verify-member-print-orders` 已对齐当前分页 envelope，并补充 `pageSize=2` 游标翻页正路径。

## 验证

- `pnpm --filter @ai-job-print/kiosk typecheck`：通过。
- `pnpm --filter @ai-job-print/kiosk lint`：通过；仅保留既有 `KioskBusyContext.tsx` fast-refresh 警告。
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`：通过；仅保留既有大 chunk 提示。
- `pnpm --filter @ai-job-print/api typecheck`：通过。
- `pnpm --filter @ai-job-print/api verify:feedback-notifications`：通过。
- `pnpm --filter @ai-job-print/api verify:member-print-orders`：通过；使用临时迁移 SQLite 库和必要环境变量。
- `curl -I http://127.0.0.1:5173/me/print-orders`：200。
- `curl -I 'http://127.0.0.1:5173/me/feedback?category=print&relatedPrintTaskId=test-print-task'`：200。

## 双模型审查

首轮：

- Antigravity：无 Critical；Warning 为 `verify-member-print-orders` 缺少分页正路径。
- Claude：无 Critical；Request changes，要求关联订单时锁定分类、修正订单卡片小屏布局。

修复：

- 反馈提交时若存在 `relatedPrintTaskId`，强制 `category: 'print'`。
- 关联订单状态下禁用分类选择器，并显示固定分类提示。
- 订单卡片改为小屏双列 / 大屏三列 grid。
- 验证脚本增加 `pageSize=2` 的第一页、第二页、`nextCursor`、`total` 断言。

复审：

- Antigravity：APPROVE，无 Critical / Warning。
- Claude：APPROVE，无 Critical / Warning。Info 级建议：后端可后续做 defense-in-depth，在 `relatedPrintTaskId` 存在时服务端也强制 `category='print'`。

## 后续记录

- `MyFeedbackPage.tsx` 当前超过 500 行，列入 P3 拆分候选；本分支不继续扩大为结构重构。
- 服务端强制关联反馈分类为 `print` 属 hardening follow-up，不阻塞当前 UI 闭环。
