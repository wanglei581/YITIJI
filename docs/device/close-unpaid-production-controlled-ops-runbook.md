# close-unpaid — 生产受控操作授权 Runbook

> 最后更新：2026-07-25  
> 代码：`POST /api/v1/admin/print-scan/tasks/print/:taskId/close-unpaid`（[PR #223](https://github.com/wanglei581/YITIJI/pull/223)，`e2b3858d`）  
> 预生产：已随 `DEPLOY_SOURCE=70ed8f6d` 部署；路由在线（无 token → `401`）。  
> **本文不授权任何生产写操作。** 未收到下方书面授权模板前，禁止只读预检以外的关闭动作，也禁止「演练关闭」。

## 1. 目标与边界

| 目标 | 非目标 |
|------|--------|
| 在书面授权下，对**单笔**符合资格的未支付、未领取打印任务做受控关闭 | 批量关闭、脚本循环关闭、为验收而造单再关 |
| 留下可复核的 AuditLog / 状态日志（脱敏摘录） | 改 DB 直写、绕过 Admin UI/API、改价目 / 支付配置 |
| 失败即停，不重试覆盖竞态 | 把 close-unpaid 当成退款入口（有 `PaymentAttempt` 必须走对账/退款） |

**硬禁止**

- 未授权对生产任务调用 close-unpaid（含「先试一单看看」）
- 关闭存在任何 `PaymentAttempt`（含 `failed`）的订单
- 关闭已被 Agent claim / 非 `pending` 的任务
- 输出用户手机号明文、支付凭证、完整 cookie / token、未脱敏订单详情到聊天或仓库

## 2. 资格条件（服务端 SSOT）

必须**全部**满足，Admin 详情才会 `closeUnpaidEligible=true`：

1. `PrintTask.status === pending`
2. `claimedAt` / `claimExpiry` 均为空
3. 关联订单存在，且 `payStatus === unpaid`、`taskStatus === pending`
4. 该订单 `paymentAttempts` 数量为 0（含历史 failed）
5. 提交时 `expectedUpdatedAt` 与当前 `updatedAt` 一致（CAS）

成功事务效果（同一 Prisma transaction）：

- 任务 → `cancelled`，`errorCode=ADMIN_UNPAID_PRINT_TASK_CLOSED`
- 订单 → `payStatus=closed` / `taskStatus=cancelled`
- `PrintTaskStatusLog`：`pending → cancelled`
- `AuditLog.action=print_task.admin_unpaid_closed`（含 reason、版本戳、状态迁移；记 IP / UA / requestId）

同入口完整终态可幂等回放；其它路径产生的 `cancelled` 会 `ADMIN_UNPAID_CLOSE_CONFLICT`。

阻断原因（Admin 文案键）：`no_associated_order` / `task_not_pending` / `task_claimed` / `order_not_unpaid` / `order_task_not_pending` / `payment_attempt_exists`。

## 3. 授权阶段（必须分两步）

### Phase A — 只读预检（默认下一步）

**需要授权口令**：`CLOSE_UNPAID_PHASE_A_READONLY`

允许：

- 确认目标环境（预生产 / 生产）的 `DEPLOY_SOURCE`、API health、Admin 可登录
- 在 Admin「打印扫描」列表按状态筛选，打开候选任务详情
- 记录（脱敏）：`taskId` 前后缀、`closeUnpaidEligible`、阻断原因键、`payStatus`/`taskStatus`、是否有 attempt（是/否）、`updatedAt` ISO
- 只读 SQL / Admin API GET（若使用），不调用 close-unpaid

禁止：任何 POST close-unpaid；不新建测试打印单「只为关闭」。

**退出标准**：书面清单写明「有 N 条合格候选」或「当前无合格候选」；若 N=0，**不得**进入 Phase B。

### Phase B — 单笔受控关闭

**需要授权口令**：`CLOSE_UNPAID_PHASE_B_SINGLE`  
授权内容必须点名 **一个** `taskId`（完整 ID）+ 操作环境 + 操作人（本人 Admin 账号）。

允许：

1. 重新打开该任务详情，确认仍 `closeUnpaidEligible=true`
2. 复制当前 `updatedAt` 作为 `expectedUpdatedAt`
3. 在 Admin UI 填写真实处置原因（10–500 字）并二次确认后提交  
   按钮文案：「取消未支付待打印任务」
4. 成功后刷新详情：任务 `cancelled`、订单 `closed/cancelled`；记录 AuditLog `action` 与 `taskId`（可记 audit 行 id，不抄 reason 全文到公共频道若含隐私）

禁止：

- 同一授权关闭第二笔（要关第二笔须新授权）
- CAS 冲突后盲目连点；应刷新详情，冲突则停止并回报
- Agent 正在 claim / 用户正在支付时强行重试

**退出标准**：该 `taskId` 终态与审计齐备；或明确失败码（`ADMIN_UNPAID_CLOSE_*`）并停止。

## 4. 执行清单（操作人勾选）

### 4.1 Phase A

- [ ] 已收到用户书面 `CLOSE_UNPAID_PHASE_A_READONLY`
- [ ] 环境确认：`DEPLOY_SOURCE` / health `ok`+`postgres` / Admin 登录成功
- [ ] 候选表（脱敏）已写入进度或当次授权回复，含 eligible 数量
- [ ] **未**调用 close-unpaid

### 4.2 Phase B

- [ ] 已收到用户书面 `CLOSE_UNPAID_PHASE_B_SINGLE`，且 taskId 与环境匹配
- [ ] 提交前二次确认 eligible + 最新 `updatedAt`
- [ ] 一次提交；成功或失败均停止
- [ ] 脱敏复核：task/order 状态 + `print_task.admin_unpaid_closed` 审计存在
- [ ] 结果写回 `docs/progress/current-progress.md`（不写密钥/手机号/完整 reason 若敏感）

## 5. 书面授权模板（请用户原样回复）

**Phase A（推荐先发）**

```text
授权 CLOSE_UNPAID_PHASE_A_READONLY
环境：<预生产|生产>
窗口：<开始>–<结束> Asia/Shanghai
范围：只读预检合格 close-unpaid 候选；禁止 POST close-unpaid；禁止造单。
```

**Phase B（预检有合格候选后再发）**

```text
授权 CLOSE_UNPAID_PHASE_B_SINGLE
环境：<预生产|生产>
taskId：<完整任务 ID>
操作人：<Admin 登录身份说明，勿贴密码>
窗口：<开始>–<结束> Asia/Shanghai
范围：仅上述一笔；失败即停；禁止批量/脚本。
```

## 6. 与其它能力的关系

| 能力 | 关系 |
|------|------|
| FREE_MODE / 0 元出纸 | 已支付或 free 履约的任务**不**走本入口 |
| G5 订单退款 | 有 `PaymentAttempt` 或已支付场景；**不要**用 close-unpaid 代替 |
| F1 Genesis / 切流 | 无关；关闭任务不改变 provenance NO-GO |
| 生产部署 | 预生产已含能力；另机生产若未部署，须先单独部署授权，再谈 Phase A/B |

## 7. 当前状态（2026-07-25）

- 代码与预生产部署：已完成  
- Phase A / Phase B 书面授权：**未收到**  
- 生产受控关闭验收：**未做**，不得宣称线上关闭能力已验收
