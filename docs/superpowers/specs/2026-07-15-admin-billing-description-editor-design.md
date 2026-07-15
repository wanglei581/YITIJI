# Admin 价目说明独立编辑设计

> 日期：2026-07-15
> 状态：已获用户口头批准，待文档复核
> 范围：仅补 Admin 本地代码与验证；不部署、不修改生产数据

## 背景与目标

生产 `print_bw_page` 与 `print_color_page` 已为 active 0 元，但说明仍保留旧的预生产 100 / 300 分文案。后端 `AdminUpdatePriceConfigDto`、`AdminBillingService.updatePriceConfig` 和 Admin API client 已支持可选 `description`，当前缺口仅在 Admin `/billing` 页面没有说明编辑控件。

本设计在现有价目表每一行增加独立说明编辑能力，使管理员可以只提交 `description`，避免说明更新意外携带或覆盖 `unitCents`、`active`。

## 方案选择

采用“每行内联说明输入 + 独立保存说明按钮”。

- 推荐理由：与当前逐行改价结构一致，但提交路径完全分离，最容易证明不会误改价格。
- 不采用统一编辑弹窗：金额、状态、说明进入同一表单会增加误提交风险和状态耦合。
- 不采用临时脚本或直接 API / 数据库操作：绕过 Admin 合法操作面，不符合生产治理边界。

## 交互设计

1. 价目表新增“说明”列，每行显示当前说明文本输入框。
2. 说明输入使用独立 `descriptionEditing` 状态，不复用现有 `editing` 单价状态。
3. 只有说明实际变化时显示或启用「保存说明」按钮；空字符串按显式空说明处理，不隐式回退旧值。
4. 点击「保存说明」后弹出确认，明确展示价目项以及旧说明、新说明，并提示“只更新说明，不修改单价与启停状态，操作记入审计”。
5. 确认后调用既有 `adminBillingService.updatePriceConfig(serviceKey, { description })`；请求体不得包含 `unitCents` 或 `active`。
6. 成功后清理该行说明编辑状态并重新加载列表；失败时保留输入，展示现有页级错误，不影响另一行或单价编辑状态。
7. 单价保存与启停按钮行为保持不变，说明编辑期间不改变价格控件的值。

## 数据流与安全边界

```text
管理员编辑说明
  -> 独立本地 descriptionEditing[serviceKey]
  -> 二次确认 old/new
  -> PUT /admin/billing/price-config/:serviceKey
     body: { description }
  -> 既有后端校验 MaxLength(200)
  -> 既有 price.updated 审计 old/new 快照
  -> 重新 GET 列表
```

- 不新增后端端点、DTO、数据模型或数据库迁移。
- 不读取或处理支付凭据、密码、token、cookie 或密钥。
- 不允许把说明保存包装成“保存全部”，防止未来字段联动。
- 后端仍负责 200 字符上限和无实际变化拒绝；前端仅提供即时反馈，不替代后端门禁。

## 文件范围

允许修改：

- `apps/admin/src/routes/billing/index.tsx`
- `apps/admin/scripts/verify-admin-billing-ui.mjs`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

如实现需要新增纯 UI 子组件，只能放在 `apps/admin/src/routes/billing/`，不得修改 API、Prisma、支付运行时或其他页面。

## TDD 与验收

先修改 `verify-admin-billing-ui.mjs` 形成失败门禁，至少证明：

1. 页面存在独立说明编辑状态和「保存说明」操作。
2. 说明保存调用精确为 `{ description }`，不与 `{ unitCents }` 或 `{ active }` 合并。
3. 确认文案明确“只更新说明、不修改单价与启停状态、记入审计”。
4. 说明保存成功后清理该行编辑状态并刷新列表；失败时保留输入。
5. 原有改价二次确认、停用非免费语义、路由和导航守卫继续通过。

实现后执行：

- `pnpm --filter @ai-job-print/admin verify:billing-ui`
- `pnpm --filter @ai-job-print/admin typecheck`
- `pnpm --filter @ai-job-print/admin lint`
- `git diff --check`
- Antigravity + Claude 双模型安全终审

浏览器只做本地或已部署版本的只读 / 受控交互验证；本任务不部署，因此不得在生产 Admin 提交说明更新。

## 完成与后续边界

本任务完成只表示 Admin 代码候选和本地验证就绪，不表示已 push、PR、CI、部署或生产文案已修改。部署必须另行确认；部署后生产写操作仍须重新做价格、渠道、health、终端与 active task 门禁，并确保两次请求分别只更新对应 `description`。
