# 微信退款异常处理 SOP

> 2026-07-13。对应 `next-tasks.md`「C5-6 后续回归门禁 / SOP」待办：锁定退款通知 rawBody / 验签 /
> 解密 / 幂等 / 对账异常口径 + 补对账与异常退款 SOP。代码侧回归门禁见
> `pnpm --filter @ai-job-print/api verify:wechat-refund-regression`；对账口径实现见
> `services/api/src/payment/reconciliation.service.ts`；生产 live 支付/退款样本见
> `docs/operations/print-rollout-deployment-matrix.md` 与 `docs/progress/current-progress.md`
> 2026-07-08 条目。

本文档只讲**运营/客服/技术支持在退款出现异常时该做什么**，不重复退款状态机的实现细节
（状态机与三分法见 `services/api/src/payment/refund.service.ts` 顶部注释）。

---

## 第一步：永远从对账页开始

```
GET /admin/billing/reconciliation
```

Admin「计费与对账」页（`/billing`）只读展示同一份数据。任何退款异常排查都先看这里的
`discrepancies` 列表，不要直接改数据库。每条差异都带 `orderId` / `orderNo`，凭这两个字段
去查 `Order` / `Refund` / `AuditLog`。

---

## 异常类型 1：`STUCK_REFUNDING`（退款通知缺失 / 迟迟未收敛）

**含义**：订单停留在 `refunding`（或 `partial_refunded`）超过 30 分钟
（`STUCK_REFUNDING_MS`，见 `reconciliation.service.ts`）。通常原因：
- 微信侧退款仍在处理中（`PROCESSING`），尚未回调；
- 退款结果通知因网络/证书问题未送达；
- `REFUND_AUTO_CONVERGE_ENABLED` 未开启，没有自动查证收敛兜底。

**处理步骤**：
1. 确认 `REFUND_AUTO_CONVERGE_ENABLED=true` 是否已在生产开启（`RefundConvergenceTask` 每 10
   分钟扫描一次，走与人工重复退款完全相同的幂等查证路径，绝不二次出款）。若已开启但仍卡住，
   等待下一轮扫描或查看 API 日志确认任务是否在跑。
2. 若未开启自动收敛，或需要立即处理，可手动触发同一收敛逻辑（`convergeStalePendingRefunds`），
   或直接等待微信商户平台/客服查证。**禁止直接改 `Order.payStatus` / `Refund.status`**——
   一切状态迁移必须走 `RefundService` 的收敛路径，保留幂等键与审计。
3. 收敛后回到 `/admin/billing/reconciliation` 确认该 `orderId` 已从 `STUCK_REFUNDING` 消失，
   且不再出现在其他 `discrepancies` 分类里（金额/状态一致）。
4. 超过 24 小时仍无法通过查证收敛的，属于渠道侧异常，升级到微信商户支持并保留
   `refundNo` / 时间线记录（见「人工处理记录」一节）。

**不算异常的情况**：`refunding` 未满 30 分钟属于正常等待窗口，不需要介入。

---

## 异常类型 2：渠道明确失败（`CLOSED` / `ABNORMAL`）

**含义**：微信侧明确告知这笔退款不会再退（`refund_status=CLOSED/ABNORMAL`）。系统会**自动
回滚**：`Refund.status=failed`，`Order.payStatus` 回到 `paid`，写 `refund.channel_error` 审计。

**处理步骤**：
1. 这是**自愈行为**，不需要人工改数据。订单回到 `paid` 后可以用同一 `refundNo` 重新发起退款
   （系统按同一幂等键处理，渠道视角仍是同一笔退款，不会被算成两笔）。
2. 若重试后再次 `CLOSED/ABNORMAL`，检查退款原因是否触发了微信侧限制（如超过原支付渠道退款
   时限），必要时改用线下退款流程（`offline` / `manual_confirmed`，不经渠道，仅记账）。
3. 对账页不会把这类订单标记为 `STUCK_REFUNDING`——回滚是明确结果，不是「不知道结果」的滞留
   态，因此对账口径上视为已解决，不需要按异常类型 1 处理。

---

## 异常类型 3：重复通知

**含义**：微信侧对同一笔退款重复推送通知（网络重试、服务重启后补发等）是正常现象。

**处理步骤**：
1. 系统按 `refundNo` + 幂等状态机处理，重复的 `SUCCESS` 通知不会二次出款、不会重复写审计、
   不会让 `REFUND_AMOUNT_MISMATCH` 出现在对账里。**不需要人工干预**。
2. 若怀疑重复通知造成了账目问题，用 `AuditLog`（`action=refund.created`，
   `targetId=orderId`）核对该订单只有一条 `refund.created` 记录；`viaRefundNotify=true`
   表示这笔是由退款通知完成的（区别于查证收敛 `payment.reconciled` 或 Admin 直接标记）。

---

## 异常类型 4：金额/归属不符

**含义**：通知里的金额与本地 `Refund.amountCents` 不一致，或 `out_refund_no` 在本系统找不到
对应记录。系统会拒绝该通知（`REFUND_NOTIFY_AMOUNT_MISMATCH` / `REFUND_NOTIFY_UNKNOWN_REFUND`），
**不会误改任何订单**，并写 `refund.notify_amount_mismatch` 审计（金额不符时）。

**处理步骤**：
1. 这类通知会被拒绝但订单状态保持不变，不会造成账目污染，可以先观察。
2. 若同一订单反复收到金额不符的通知，说明渠道侧或本地记录之一有问题，需要人工核对
   `Refund.amountCents` 与商户平台后台的退款金额是否一致，禁止绕过校验强行标记完成。

---

## 人工处理记录：怎么留痕

- **禁止**直接执行 SQL 改 `Order` / `Refund` 表。所有状态迁移必须经过 `RefundService` 的既有
  路径（收敛 / Admin 退款端点 / 渠道通知处理），这样才会自动落 `AuditLog`。
- 需要留痕的场景（如「已电话联系微信客服确认」「已改用线下退款」）应记录在工单系统或运营
  日志里，引用具体的 `orderId` / `orderNo` / `refundNo`，并注明触发的系统动作
  （例如「已重新发起退款，refundNo 不变」）。
- 排查/处理时**不得**把微信交易号、退款单号等完整流水号写入本仓库文档或代码注释——只在
  内部工单/私有证据目录记录，仓库里最多保留脱敏摘要（订单号 + 结果），对齐
  `docs/progress/current-progress.md` 现有做法。

---

## 回归门禁

`pnpm --filter @ai-job-print/api verify:wechat-refund-regression` 锁定本 SOP 依赖的系统行为，
已接入双 CI job（`build-and-verify` + `postgres-readiness`）：
- rawBody 替换攻击必须被拒绝（签名绑定原始字节，不是可预测的派生字段）；
- `STUCK_REFUNDING` 的 30 分钟边界精确生效（29 分钟不报、31 分钟必报）；
- 退款通知到达后 `STUCK_REFUNDING` 立即解除；
- 渠道明确失败（`CLOSED`）自愈后即便远期对账也不再被判定为滞留；
- 重复通知不会在对账里产生金额误报；
- 每条自动完成路径都留有可按 `orderId` 查询的审计记录（`refund.created` / `refund.channel_error`）。

若上述行为回归，说明本 SOP 的前提假设已被代码变更破坏，需要先修代码或更新本文档，再继续
按 SOP 处理线上异常。
