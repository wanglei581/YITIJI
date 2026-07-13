# 材料包（Material Pack）设计文档 — 首版

> 日期：2026-07-12
> 状态：设计已经用户逐节确认（brainstorming 三个关键分叉均由用户拍板）；**本轮只交付设计，不进入实现**，实现排在上线收口完成之后。
> 修订：2026-07-12 Codex 独立复审后修订——部分退款声明为在范围扩展（非现成能力）、首版移除"遮挡"选项、状态机闭合重画（§5.1）、子任务改为支付后逐个懒创建（§5.2）、bridge 撤销补两处联动校验、pii_scan 执行方式如实描述为受控并发同步任务。
> 上游：打印扫描轨道 C 第二部分（第一部分「AI 文件体检真实化」已于 2026-07-12 合入 main 并部署预生产）。
> 关联：`docs/product/print-scan-commercial-plan.md`（MaterialPackTask 草案）| `docs/product/operation-manual-feature-landing-plan.md`（打印材料包页草图）| `docs/progress/next-tasks.md` 材料包条目 | `docs/compliance/compliance-boundary.md`

---

## 1. 定位与边界

会员登录后，从本人资产（我的简历 / 我的文档 / 求职材料）和公共招聘会资料中勾选多份材料，一次下单、按顺序打印，单份失败可单独重试。

硬边界：

- 仅限本人自用打印。不投递、不流转给企业、不生成任何"推荐给企业"的组合（合规红线不变）。
- 会员专属：来源全部是登录态资产，匿名用户不提供该功能入口。
- 不伪造能力：体检未完成/降级的文件必须按已上线的 pii_scan 四态口径诚实展示；公共招聘会资料标注"公共资料，无需隐私检查"而不是冒充"已检查"。

## 2. 已定死的三个关键分叉（用户拍板）

| 分叉 | 决定 | 落选项及原因 |
|---|---|---|
| 首版范围 | **手动多选 + 组合打印**；AI 建议组合留二期 | 含 AI 建议：多一条 LLM 链路 + 建议 UI，首版价值密度低 |
| 执行模型 | **批次 + 子任务**：新增 `MaterialPackTask` 批次层包住 N 个现有单文件 `PrintTask`；`PrintTask` 与 Agent 零改动 | 合并单 PDF：全包同参数、无单份重试，且需要新建 DOCX→PDF 转换能力（目前不存在）；混合模式：两套链路复杂度最高 |
| 隐私检查融入 | **批量后台体检 + 汇总确认页**：勾选完成后并行对每个用户文件跑现有 pii_scan，一个汇总页按文件分组确认 | 逐份走现有单文件检查页：5 份材料 5 轮确认，违背触控 ≤3 步原则；已有文件免检：构成"体检已完成"的不实暗示 |

> 注：本决定同时解决了两份旧文档的写法冲突——`operation-manual-feature-landing-plan.md` 的"生成材料包（合并产物）"写法废弃，以本文档"批次 + 子任务、不合并"为准。

## 3. 数据模型（新增 2 表，`PrintTask` 零改动）

### MaterialPackTask（批次主任务）

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `endUserId` | 会员，必填（会员专属） |
| `terminalId` | 发起终端 |
| `status` | 见 §5.1 状态机（`partial_failed` 是可恢复态，非终态） |
| `orderId` | 关联 C5 支付 `Order`，**一包一单**；注意 `Order.printTaskId` 保持不动（该唯一约束只服务单文件链路），子任务不占用它，包与订单经本字段关联 |
| `createdAt` / `updatedAt` / `expiresAt` | 草稿态过期自动清理（沿用任务 TTL 惯例） |

### MaterialPackItem（包内条目）

| 字段 | 说明 |
|---|---|
| `packId` | 外键 |
| `fileId` | 指向 `FileObject`（招聘会资料经桥接派生，见下） |
| `sortOrder` | 用户排序，决定打印顺序 |
| `printParams` | JSON：份数 / 彩色 / 双面，逐份独立 |
| `piiScanTaskId` | 复用现有 `DocumentProcessTask`（pii_scan）；公共资料为 null |
| `printTaskId` | 子 `PrintTask`；支付前为 null |
| `itemStatus` | 见 §5.1 状态机；`skipped` 是**包内条目**状态，不是 `PrintTask` 状态（`PrintTask` 走自己的既有终态） |

来源接入：

- 我的简历 / 我的文档 / 求职材料：直接引用本人 `FileObject`（服务端强校验 `endUserId` 归属）。
- 招聘会资料：**不**直接引用 `FairMaterial`，走既有 `FairMaterialPrintBridge` 派生 `FileObject`（复用其派生/TTL/魔数复核语义）。**注意**：bridge 现有撤销清理只保护活跃 `PrintTask`，不认识尚未建打印任务的 `MaterialPackItem`——需新增两处联动校验：① 确认/支付前复核 bridge 有效性；② 每份子任务释放前再复核一次，已撤销则该条目直接 `failed`（原因 `MATERIAL_REVOKED`）诚实提示，不静默出纸。

## 4. Kiosk 流程（新页 3 个 + 多选组件 1 个）

入口：`/print-scan` 服务中心新增「材料包」能力卡片（受 Task 10 `TerminalCapability` 能力开关控制，未配置时按能力模式 fail 行为处理）。

1. **选材页** `/print/pack/select`：按来源分 tab（简历 / 文档 / 求职材料 / 招聘会资料），勾选 + 触控拖动排序；底部实时合计"共 N 份 / 约 M 页"。列表复用各来源现有查询端点，新建通用多选组件（当前代码库无多选组件，首个消费方）。
2. **体检汇总页** `/print/pack/check`：服务端对每个用户文件创建 pii_scan 任务（复用现有扫描逻辑，不新建）。**执行方式如实描述**：现有 pii_scan 在创建任务的 HTTP 请求内同步执行，并非后台队列——因此包级批量检查由服务端**受控并发**驱动（并发上限 2–3、单文件超时上限，超时/失败按既有 `degraded` 四态口径诚实展示），前端轮询汇总。按文件分组展示四态结果与 PII 命中，**逐文件动作 = 「保留并继续」或「移出材料包」**；首版**不提供"遮挡"**——现状 `pii_redact` 只做保留/遮挡决定的评估记录（`resultFileCreated=false`，不产遮挡文件），在多文件包里提供"遮挡"会造成"已遮挡再打印"的假象，违反不伪造能力红线（单文件页因有"打印仍使用原文件"的显式提示才允许保留该选项）。公共招聘会资料显示"公共资料，无需隐私检查"。全部文件到达可确认状态才能继续。
3. **参数与确认页** `/print/pack/confirm`：逐份参数（份数/彩色/双面）+ 底部总页数、预计费用 → 进现有 C5 收银台（一包一个 `Order`）→ 支付成功后创建子 `PrintTask` 并进入打印进度页（每份独立状态卡 + 失败项重试/跳过按钮）。

触控与可访问性：主按钮 ≥56px、可点击区 ≥48px、27 寸竖屏两列布局，向导步骤条清晰标注当前位置。

## 5. 顺序执行与失败处理

### 5.1 状态机（闭合定义）

**包（MaterialPackTask）**：

```text
draft → checking → confirming → awaiting_payment → printing
printing → completed                      （全部条目 completed）
printing → partial_failed                 （任一条目 failed 且无在途条目；可恢复态，非终态）
partial_failed → printing                 （用户对失败条目重试）
partial_failed → completed                （用户放弃剩余：失败条目转 skipped，触发退款流程）
draft/checking/confirming → cancelled     （支付前取消/草稿过期 TTL 清理）
awaiting_payment → cancelled              （订单未支付关闭，沿用 C5 订单关闭语义）
终态 = completed / cancelled
```

**条目（MaterialPackItem）**：

```text
pending_check → checked → queued → printing → completed
printing → failed
failed → queued        （重试：重建/重置子 PrintTask）
failed → skipped       （放弃：计入退款金额）
终态 = completed / skipped
```

包的退款进度不放进包状态机——以 `Order`/`Refund` 现有状态为准，包详情页展示订单退款状态，避免两套状态互相追赶。

### 5.2 子任务创建与顺序执行

- **支付后逐个懒创建**：支付成功只创建第 1 份子 `PrintTask`；第 N 份到达 `PrintTask` 终态时，服务端再创建第 N+1 份。不预创建、不引入"不可领取"新状态，Agent 现有 claim 循环零改动。
- **推进钩子**：挂在 `PrintJobsService` 现有的任务终态更新点，调用 `MaterialPacksService.onSubTaskTerminal(printTaskId)`（模块间用 Nest 事件或 `forwardRef` 解决 print-jobs ↔ material-packs 的依赖方向，实现计划里定）。钩子必须幂等（同一终态重复触发只推进一次）。
- 断网/中断：沿用 `PrintTask` 现有语义（断网不伪造成功，恢复后重新 claim）；包层只做状态聚合。

### 5.3 计费与退款（复用边界如实声明）

- 费用 = Σ(子任务页数 × 单价 × 份数)，支付走 C5 现有收银（一包一个 `Order`）。
- **部分退款是本功能的在范围扩展，不是现成能力**：现有 `RefundService` 只支持全额退款（代码注释明写"`partial_refunded` 与部分退款动作仅预留，不接"）。实现材料包必须先扩展 RefundService 支持按金额部分退款（schema 的 `partial_refunded` 状态已预留），包内 failed→skipped 条目按其应付金额累计退款。此扩展属支付域改动，实现计划中列为独立前置任务并单独 verify。
- 全部条目失败且用户放弃 → 走现有全额退款。不伪造出纸成功、不吞用户钱。

## 6. 后端模块与接口

新模块 `services/api/src/material-packs/`（预计 4–5 文件，单文件 ≤300 行）：

- `material-packs.service.ts`：建包/加删条目/排序/触发批量体检/确认/创建订单/子任务逐个释放/重试/跳过。
- `material-packs.controller.ts`：`POST /me/material-packs`、`PATCH .../items`、`POST .../check`、`POST .../confirm`、`POST .../items/:id/retry|skip`、`GET .../:id`（轮询状态聚合）。全部挂会员鉴权 + 本人归属校验。
- DTO + 本地类型（沿用 services/api 本地类型 + SSOT 注释惯例）。
- `scripts/verify-material-packs.ts`：建包→体检→确认→顺序释放→单份失败重试→部分退款→bridge 撤销联动→归属越权 403 全链断言，接入双 CI job。
- 前置任务（支付域）：RefundService 部分退款扩展 + 对应 verify（见 §5.3）。

审计：建包、支付、重试、跳过、退款各写现有 AuditLog 口径；日志只记元数据不记文件内容。

## 7. Admin（首版最小化）

- 现有打印任务列表：子任务带 `packId` 可筛。
- 新增批次详情抽屉：包状态、子任务列表、失败原因、退款入口（复用 C5 Admin 退款）。
- 统一任务中心大改版**不在本期**（`next-tasks.md` 既有条目继续挂账）。

## 8. 测试与验收口径

- 后端：`verify-material-packs.ts`（见上）+ 既有 `verify:materials-processing` / `verify:cos:files` 回归不破。
- Kiosk：typecheck / lint / 生产 build 门禁 + 540×960 竖屏浏览器走查（选材多选排序、体检四态汇总、参数合计、支付、进度、失败重试）。
- 真机：顺序出纸、单份失败重试、断网恢复列入 Windows 真机验收清单 §五 追加项（实现期补）。
- 上线门禁：实现完成前不得在服务中心放出"材料包"卡片为可用态（能力开关保持未配置/禁用）。

## 9. 二期展望（明确不做在首版）

- AI 建议组合（按目标岗位/招聘会建议一套材料，用户逐项确认）。
- 真实遮挡文件生成：`pii_redact` 产出派生遮挡文件（`resultFileCreated=true`）后，包流程才恢复"遮挡"选项。
- 收藏岗位 JD 摘要打印进包。
- 同参数文件合并出纸连续性优化。
- 统一任务中心整合。
