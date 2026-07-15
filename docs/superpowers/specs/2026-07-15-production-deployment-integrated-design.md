# 生产整合候选与已关闭订单遗留打印任务处置设计

## 背景

`95758fcc` 是管理员凭据安全修复的已通过 CI 主线提交，但生产当前运行 `6d4c5ae7`。直接替换会移除生产独有的中文文件名修复、支付宝付款码与过期二维码安全收敛。生产还有一条订单已关单、打印任务仍 pending 的遗留状态；现有“未付款关闭”和“冻结历史任务”入口都故意拒绝它。

## 方案选择

采用“整合候选 + 一次性维护命令”。不选择直接 SQL，因为 SQL 无法复用 CAS、审计和状态日志；不选择常规 Admin HTTP 按钮，因为此状态是异常收敛而不是日常业务能力。

## 集成范围

候选从 `95758fcc` 创建，按时间顺序整合生产独有补丁：

1. `c859b8e2`：中文上传文件名修复。
2. `9f0f46f5`：支付宝付款码。
3. `6d4c5ae7`：过期收款二维码安全收敛。

若出现冲突，采用“保留主线已合入的认证、终端和 LightFlow 变更，同时保留三项支付/上传修复”的最小人工合并；不得用整文件覆盖处理冲突。

## 新维护命令

新增 `maintenance:dispose-closed-pending-print-tasks`，只能在显式设置确认变量、任务 ID、管理员操作员 ID 与原因后运行。服务逐条校验：

- PrintTask 必须为 `pending`、匿名、`claimedAt` 与 `claimExpiry` 均为空；
- 必须有对应 Order，且为 `payStatus=closed`、`taskStatus=pending`；
- 不允许存在 `created`、`pending` 或 `success` 的 PaymentAttempt；允许没有尝试，或仅有 `expired`、`failed` 尝试；
- 操作员必须是已启用的管理员；
- 批次最多 10 条，原因 10–500 字符，任务 ID 去重。

通过所有条件后，在同一 Prisma transaction 内 CAS 更新 PrintTask 至 `cancelled`、Order.taskStatus 至 `cancelled`，写入状态日志和 `print_task.closed_pending_disposed` 审计。Order 的 `payStatus=closed` 保持不变。任何行 CAS 或审计写入失败都回滚整个事务。

命令不会暴露 HTTP 路由；标准输出只含任务 ID、数量与幂等结果，不输出订单内容、数据库 URL、token 或密码。

## 验收与发布

新增 verify 覆盖成功、幂等、支付中/成功阻断、已领取阻断、已支付/订单状态不一致阻断、审计失败整体回滚。运行 API typecheck/build、相关 payment 与 print-scan verify、GitHub CI，并对 diff 做 Antigravity 与 Claude 双模型审查。

生产动作顺序固定为：校验候选提交与产物哈希 → `pg_dump -F c` 备份并 `pg_restore -l` 验证 → 再读任务资格 → 通过两个现有 `close-unpaid` 操作和一个新维护命令处理三条任务 → 原子切换候选并重启 API → 本地/公网 health、静态 Admin 账号设置、生产修复存在性与任务审计复核。任何门禁失败时停止，不执行后续步骤；切换失败按保留的上一发布目录回滚。
