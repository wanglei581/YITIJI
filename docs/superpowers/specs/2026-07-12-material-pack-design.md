# 材料包（Material Pack）设计文档 — 首版

> 日期：2026-07-12
> 状态：设计已经用户逐节确认（brainstorming 三个关键分叉均由用户拍板）；**本轮只交付设计，不进入实现**，实现排在上线收口完成之后。
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
| `status` | `draft → checking → confirming → awaiting_payment → printing → completed / partial_failed / cancelled` |
| `orderId` | 关联 C5 支付 `Order`，**一包一单** |
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
| `itemStatus` | `pending_check → checked → queued → printing → completed / failed / skipped` |

来源接入：

- 我的简历 / 我的文档 / 求职材料：直接引用本人 `FileObject`（服务端强校验 `endUserId` 归属）。
- 招聘会资料：**不**直接引用 `FairMaterial`，走既有 `FairMaterialPrintBridge` 派生 `FileObject`（复用其撤销 / TTL / 魔数复核语义；资料下架时包内条目同步失效并诚实提示）。

## 4. Kiosk 流程（新页 3 个 + 多选组件 1 个）

入口：`/print-scan` 服务中心新增「材料包」能力卡片（受 Task 10 `TerminalCapability` 能力开关控制，未配置时按能力模式 fail 行为处理）。

1. **选材页** `/print/pack/select`：按来源分 tab（简历 / 文档 / 求职材料 / 招聘会资料），勾选 + 触控拖动排序；底部实时合计"共 N 份 / 约 M 页"。列表复用各来源现有查询端点，新建通用多选组件（当前代码库无多选组件，首个消费方）。
2. **体检汇总页** `/print/pack/check`：进入即并行对每个用户文件创建 pii_scan 任务（复用现有后端，不新建扫描逻辑）；按文件分组展示四态结果与 PII 命中，逐文件确认保留/遮挡（语义与单文件页一致）；`degraded` / `unsupported_format` 沿用 fail-closed 警告口径（不冒充"检查完成"）；公共招聘会资料显示"公共资料，无需隐私检查"。全部文件到达可确认状态才能继续。
3. **参数与确认页** `/print/pack/confirm`：逐份参数（份数/彩色/双面）+ 底部总页数、预计费用 → 进现有 C5 收银台（一包一个 `Order`）→ 支付成功后创建子 `PrintTask` 并进入打印进度页（每份独立状态卡 + 失败项重试/跳过按钮）。

触控与可访问性：主按钮 ≥56px、可点击区 ≥48px、27 寸竖屏两列布局，向导步骤条清晰标注当前位置。

## 5. 顺序执行与失败处理

- **逐个释放**：第 N 份子任务到达终态（completed/failed/skipped）后，服务端才把第 N+1 份置为 `pending`。Agent 现有 claim 循环零改动即天然顺序执行，不需要 Agent 理解"批次"概念。
- 单份 `failed`：包状态转 `partial_failed`；用户可对该份**单独重试**（重新置 pending，不重新支付）或**跳过**（skipped，金额走退款）。
- 计费与退款：费用 = Σ(子任务页数 × 单价 × 份数)，支付走 C5 现有收银与账单链路；失败/跳过份的金额走 C5 既有退款链路（含自动收敛任务），不伪造出纸成功、不吞用户钱。
- 断网/中断：沿用 PrintTask 现有语义（断网任务不伪造成功，恢复后重新 claim）；包层只做状态聚合，不引入新的一致性机制。

## 6. 后端模块与接口

新模块 `services/api/src/material-packs/`（预计 4–5 文件，单文件 ≤300 行）：

- `material-packs.service.ts`：建包/加删条目/排序/触发批量体检/确认/创建订单/子任务逐个释放/重试/跳过。
- `material-packs.controller.ts`：`POST /me/material-packs`、`PATCH .../items`、`POST .../check`、`POST .../confirm`、`POST .../items/:id/retry|skip`、`GET .../:id`（轮询状态聚合）。全部挂会员鉴权 + 本人归属校验。
- DTO + 本地类型（沿用 services/api 本地类型 + SSOT 注释惯例）。
- `scripts/verify-material-packs.ts`：建包→体检→确认→顺序释放→单份失败重试→退款钩子→归属越权 403 全链断言，接入双 CI job。

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
- 收藏岗位 JD 摘要打印进包。
- 同参数文件合并出纸连续性优化。
- 统一任务中心整合。
