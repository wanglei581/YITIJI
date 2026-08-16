# A3 打印/扫描交易履约 差异规格（2026-08-16）

## 0. 验证基线

| 项 | 值 |
|---|---|
| 验证 ref | `origin/main` = `67145a855a6eaaab2b5823182d530f817eee806b` |
| V6 原型 | 五份 HTML 与 `origin/main` 完全一致（`git diff origin/main --stat` 为空） |
| 审计文档 | `docs/reviews/2026-08-12-v6-commercial-product-audit.md` **不在 `origin/main`**，仅存在于 `claude/four-tasks-project-coordination-d39229`（由 `14fb2d50` 引入）。本规格引用其 §3/§4/§7 作为输入口径，但它不是主干事实 |
| 硬件口径 | `CLAUDE.md` §3：奔图 CM2800/CM2820，**A4 幅面，不支持 A3**。本文件名中的 "A3" 是任务编号，不是纸张规格 |

控件分类沿用审计 §3 五类：**导航 / 本地交互 / 服务端命令 / 外部来源动作 / 能力门禁**。

---

## 1. P06 打印工作台

原型：`docs/design/kiosk-ai-os-v3-2026-08/06-print-workbench.html`（3593 行，7 阶段 s1–s7）
生产对应：`apps/kiosk/src/pages/print/` 下 9 个页面（`routes/index.tsx:206-214`）

### 1.1 控件清单

| 阶段 | 控件（原型行号） | 类型 |
|---|---|---|
| 轨道 | `rstep` s1–s7 跳转（584-591） | 导航 |
| s1 | 来源卡 本机 / 手机 / U盘（608/614/620） | 本地交互 |
| s1 | 「去扫描」「去文件加工」跨道（626/638/662/670） | 导航 |
| s1 | 手机出码 → 等待/已收到（765/766） | 服务端命令 |
| s1 | 彩色/双面在 `device-off` 下 `aria-disabled`（632/644） | 能力门禁 |
| s2 | PII 体检结果 + 「去遮盖 / 撤销遮盖 / 我确认保持原样」（851-861、1635-1641） | 服务端命令 |
| s2 | 遮盖框选 `candbox` + 「遮住这一处 / 全部取消 / 换一处」（1099-1115） | 本地交互 |
| s3 | 份数 ±、黑白/彩色、单/双面、翻页边、方向、缩放、页码范围（1658-1740） | 本地交互 |
| s3 | 彩色/双面 `device-off` 禁用（1674/1685） | 能力门禁 |
| s4 | **「获取核价」**（2160，`data-gate="unquoted"`） | 服务端命令 |
| s4 | **「确认金额，去付款」**（2161，`data-gate="quoted"`） | 服务端命令 |
| s4 | 「本单免费，直接出纸」（2162，`data-pay="free"`） | 服务端命令 |
| s4 | 权益卡 6 态（914-919） | 能力门禁 |
| s5 | 收银 7 态：待付/扫用户码/到账中/已到账/码失效/查单/已关单（1230-1236） | 服务端命令 |
| s5 | 「我已付款，帮我查」/「重新出码」/「取消支付返回」/「开始出纸」（2166-2178） | 服务端命令 |
| s6 | 出纸 6 态：排队/校验中/校验失败/出纸中/卡纸/10分钟超时（1322-1327） | 服务端命令（Agent 回传） |
| s6 | 卡纸/缺纸处置：「已修好继续」/「退款」/「还是没好」/「改成续打」（1346-1409） | 服务端命令 |
| s7 | 取件码 + 「再打一份」/「存我的文档」/「扫码带走」（1441/1446/2146） | 服务端命令 |
| s7 | 问题上报 4 类 + 满意度 3 档（1488-1491、2061-2063） | 服务端命令 |

### 1.2 控件 → `origin/main` 端点与状态机

| 控件 | 端点 | 状态机字段 |
|---|---|---|
| 手机出码上传 | `POST /upload-sessions` 等 5 个 — `upload-sessions/upload-sessions.controller.ts:39/54/63/74/84` | upload session TTL + controlToken |
| U盘 | 无服务端端点；`PrintUploadPage.tsx:58/142/155` 本地 `usbConfigured` 门禁 | — |
| s2 PII 体检 | `POST /materials/tasks`、`GET /materials/tasks/:id`、`POST .../pii-findings/decisions` — `materials/materials.controller.ts:22/32/41` | `DocumentProcessTask.kind/status`、`PiiFinding.action ∈ {keep, redact}` |
| s2 遮盖产物 | `evaluatePiiRedaction()` — `materials.service.ts:530-570`。**只评估，显式返回「当前版本不生成新文件，打印仍使用原文件」** | `resultJson.mode='pii_redaction_evaluation'` |
| s3 参数 | `PrintJobParamsDto`、`verified-print-parameters.ts`、`page-range.util.ts` | `PrintTask.paramsJson`、`Order.printParamsJson` |
| s4 获取核价 | `POST /orders/quote` — `payment/order-quote.controller.ts:16`（**不落库**，签名 fileUrl + 真实页数 + `PricingService`） | 返回 `PrintPriceQuote{amountCents, billablePages, lines}` |
| s4 单价对照 | `GET /print/price-config` — `payment/payment.controller.ts:58` | `PriceConfig.serviceKey/unitCents/active` |
| s4 确认→建单 | `POST /print/jobs` — `print-jobs.controller.ts:53` → `print-jobs.service.ts:392` 事务建 `Order`，`:421` 0 元单走 `markPaid(free)` | `Order.amountCents/payStatus/itemsJson/billablePages/paymentSource` |
| s4 权益抵扣 | `POST /orders/:id/redeem` — `benefit-redemption/order-redeem.controller.ts:23`；`GET /me/benefits` | `Order.discountCents`、`RedemptionRecord`、`BenefitGrant` |
| s5 收银 | 六端点 — `payment/payment.controller.ts:63/73/83/88/94/112` | `Order.payStatus` 八态；`PaymentAttempt.status` 五态；`(channel, channelTxnNo)` 唯一回调幂等键 |
| s5 开始出纸 | `POST /print/jobs/:orderId/release` — `:39` → `pickup-order.service.ts:77`（`payStatus==='paid'` 才放行，C5-3 门控） | `Order.pickupStatus: claimed→used`、`taskStatus→pending` |
| s6 出纸状态 | `GET /print/jobs/:taskId` — `:72`；Agent 侧 `POST /terminals/:id/tasks/claim`、`PATCH /print-tasks/:taskId/status` | `PrintTask.status/claimedAt/claimExpiry/errorCode`、`PrintTaskStatusLog` |
| s7 取件码 | `pickupCodeVisibleFor()` — `payment/order-status.service.ts` | `Order.pickupCode`（唯一，paid 时生成） |
| s7 问题上报 / 满意度 | `POST /me/feedback` — `member-feedback.controller.ts:24`（**`@UseGuards(EndUserAuthGuard)`**） | `FeedbackTicket` |

### 1.3 缺口

**后端缺**

1. **遮盖产物文件未生成。** `evaluatePiiRedaction` 明确返回「当前版本不生成新文件，打印仍使用原文件」。原型 s2 承诺产出遮挡件，后端无 `resultFileId` 写入路径。需要：`pii_redact` 真实渲染 + `FileObject.sourceFileId` 血缘 + 打印时选原件/遮挡件。
2. **匿名反馈端点缺失。** s7 的问题上报与满意度在一体机上是匿名场景，但 `/me/feedback` 挂 `EndUserAuthGuard`。当前 `PrintDonePage.tsx:59` 拼 `/me/feedback?...` 跳登录，等于把匿名用户挡在门外。
3. **「再打一份 / 续打」无端点。** 全仓 `git grep -niE "reprint|续打"` 在 `services/api/src` 下 0 命中。
4. **卡纸/缺纸没有细分故障码。** `terminals/printer-status.ts` 只有 `HEALTHY_PRINTER_STATUSES = {ok, ready, idle}`，`PatchTaskStatusDto` 只接受 `printing|completed|failed`。原型 s6 的「卡纸」「缺纸」「10 分钟超时」三态无法从 Agent 合同中区分。
5. **用户侧退款入口缺失。** 只有 `POST /admin/orders/:id/refund`（`@Roles('admin')`）。s6 的「退款」在 Kiosk 侧无可调端点。

**前端缺**

6. **权益抵扣全链未接。** `origin/main` 上 Kiosk 对 `benefitGrantId` 引用为 **0 处** —— 这被代码自己记录在 `apps/kiosk/src/pages/activities/BenefitActivityDetailPage.tsx:207-208`：「打印报价不查权益、确认页不能选券、收银页不调 `/orders/:id/redeem`」。原型 s4 六态权益卡整块无实现。
7. **s3 参数覆盖不全。** 翻页边、方向、缩放三组需比对 `PrintJobParamsDto` 白名单后决定是删设计还是补参数（见 §8-1）。

**仅缺接线**

8. s4 两段式门禁（`data-gate="unquoted"/"quoted"`）在 `PrintConfirmPage.tsx:150` 已调 `quotePrintOrder`，需按原型补 gate 状态。
9. s5 七态 ↔ `payStatus` 八态 + `PaymentAttempt.status` 五态的映射表需固化；`PrintCashierPage.tsx` 已具备全部调用点。

---

## 2. P07 扫描工作台

原型：`07-scan-workbench.html`（1186 行，4 阶段）｜生产：`apps/kiosk/src/pages/scan/` 四页（`routes/index.tsx:229-232`）

### 2.1 控件与端点

| 控件（行号） | 类型 | 端点 / 状态机 |
|---|---|---|
| 扫描类型 简历/证件/文档（182-194） | 本地交互 | `POST /scan/sessions` — `scan-tasks.controller.ts:36`；DTO **仅 `scanType ∈ {resume,id,document,contract}` + `terminalId`** |
| 输出格式 PDF/JPG/**OCR 可搜索 PDF**（206-218） | 本地交互 | **无合同** |
| OCR 在 `ai-down` 下禁用（224） | 能力门禁 | — |
| 「我已放好，开始扫」（769） | 服务端命令 | `GET /scan/sessions/:id` — `:48`，`status: waiting→matched→completed / expired / cancelled / failed` |
| `device-off` → 「改用手机拍照上传」→ P05（770） | 能力门禁 + 导航 | — |
| DPI 200/300/600、色彩、进纸、单双面（490-515） | 本地交互 | **无合同** |
| 「取消本次扫描」（765） | 服务端命令 | `DELETE /scan/sessions/:id` — `:61` |
| 「重扫某一页」（766） | 服务端命令 | **无端点** |
| 「送 AI 简历诊断」（629/773） | 服务端命令 | `ScanResultPage.tsx:87` `navigate('/resume/parse', {fileId})` |
| 「拿去打印」→ P06 s3（632/774） | 导航 | `ScanResultPage.tsx:68` |
| 「存进我的文档」→ P42（638/775） | 服务端命令 | `:79`；未登录走 `:82 loginPathForCurrentLocation()` |

Agent 投递：`POST /terminals/:terminalId/scan-sessions/deliver` — `:72` → `scan-tasks.service.ts:461`。
并发约束：partial unique index `ScanTask_terminalId_active_unique`（migration `20260713160000`），同终端同时只允许一条 `waiting|matched`。
超时回收：`scan-tasks/scan-task-reaper.task.ts`。

### 2.2 缺口

**后端缺**

1. **扫描参数合同为空。** `CreateScanTaskDto` 只有 `scanType` 和 `terminalId`。原型的 DPI、色彩、进纸、单双面、输出格式**五组参数全部无处可传**。需同时扩 `ScanTask` 模型列 + Agent 下发合同 + 终端能力探测。
2. **「重扫某一页」无端点。** 现有状态机是整任务级，没有页级重扫或追加页。
3. **OCR 可搜索 PDF 无产物路径。** `materials/pii-scan.util.ts` 中的 `OcrService` 用于 PII 文本抽取，不产出可搜索 PDF。

**前端缺**

4. `ScanSettingsPage.tsx` **诚实地没有实现这些控件** —— 只传 `{scanType, terminalId}`（`:103`）。这是正确现状，不是 bug；补参数必须后端先行，否则会变成假控件。

---

## 3. P08 文件加工

原型：`08-file-tools.html`（929 行，3 tab）｜生产：`ConvertImagesPage.tsx`、`SignStampPage.tsx`（`routes/index.tsx:200-201`）

### 3.1 控件与端点

| 控件（行号） | 类型 | 端点 / 合同 |
|---|---|---|
| t1/t2/t3 切换，t3 `aria-disabled`（161-163） | 本地交互 + 能力门禁 | — |
| 纸张 A4 / **「A3 不支持」禁用**（477） | 能力门禁 | 与 `CLAUDE.md` §3 一致，**正确，保留可聚焦禁用态** |
| 每页张数 1/2/4（481）、边距 无/窄/宽（485） | 本地交互 | **无合同** |
| 「合成 N 页 PDF」（635） | 服务端命令 | `POST /print/convert/images-to-pdf` — `print-conversion.controller.ts:22`；`ConvertImagesDto` **仅 `sources[]{fileId, fileAccessUrl}`，1–20 张** |
| 「用已保存的印章」（555） | 服务端命令 | **无印章资产实体** |
| 「预览合成结果」（536） | 服务端命令 | `POST /print/sign/inspect` — `print-sign.controller.ts:22` |
| **「授权并合成」**（637） | 服务端命令 | `POST /print/sign/compose` — `:34`；`SignComposeDto{..., authorizationConfirmed: @Equals(true)}` |
| 位置/尺寸枚举 | — | `print-sign/print-sign.types.ts`、`print-sign-geometry.ts` 已存在 |

### 3.2 缺口

**后端缺**

1. **t1 三组排版参数无合同。** `ConvertImagesDto` 只有 `sources[]`。纸张、每页张数（N-up）、边距全部无字段。A4/A3 那一组按 `CLAUDE.md` §3 是**正确的**，应保留禁用态不要删。
2. **「用已保存的印章」无印章资产存储。** `SignComposeDto.stamp` 要求调用方现给 `{fileId, fileAccessUrl}`。需新增印章资产（或明确降级为每次现写），并同时决定隐私保留期。

**前端缺**

3. t1 的 N-up / 边距控件未实现 —— 同 P07，先后端后前端，否则是假控件。

**仅缺接线**

4. t2 的 `authorizationConfirmed` 后端已强制 `@Equals(true)`，只需把确认弹层接上。
5. t3 是禁用占位 tab，保留可聚焦禁用态即可。

---

## 4. P39 打印 Hub

原型：`39-print-hub.html`（1246 行）｜生产：`PrintScanHomePage.tsx`（`routes/index.tsx:198`）

### 4.1 控件与端点

| 控件（行号） | 类型 | 端点 |
|---|---|---|
| 意图分流 路线/体检/隐私（447-455） | 本地交互 | **前端未实现**（纯本地，不需后端） |
| 「说不清就问小青」→ P25（490） | 导航 | — |
| **「重新检测」**（563） | 服务端命令 | `GET /terminals/:id/capabilities` — `terminals.controller.ts:158`；客户端 `printScanCapabilities.ts:41` |
| 探测态控制全部卡片（585-778、902-915） | 能力门禁 | `TerminalCapability.capabilityKey/status/configured/note` |
| 七张能力卡 → P06/**P05**/P07/P06/P29/P08/P08?t2 | 导航 | 见 §4.2 冲突 |
| 我的文档 / 我的订单（864/871） | 导航 | `GET /me/print-orders` |
| **反馈弹层** 6 类 + 提交（990-1019） | 服务端命令 | `POST /me/feedback`（`EndUserAuthGuard`） |
| 探测 unknown 时主 CTA 降级、手机上传 `disabled`（903/915） | 能力门禁 | — |

探测 fail-closed 已正确：`printScanCapabilities.ts` 显式区分 `ok / skipped / error`，注释写明「避免把失败当成未配置可放行」；失败回落空 map「不放大可用性」。

### 4.2 缺口

**后端缺**

1. **匿名反馈端点缺失**（与 §1.3-2 同一项，此处是主要触发点）。P39 反馈弹层是一体机公共位反馈，6 类里「缺纸」「质量」「费用」都是匿名用户最可能提的。

**⚠️ 待产品裁决的实质冲突**

2. **P39 → P05 的跳转口径。** 原型第 618 行「手机上传」能力卡直接 `href="05-phone-relay.html"`，底部 902 行同样直连 P05。审计 §2 第 1 条与 §5 判定这是**错的**：应先进 P06 创建上传会话并展示 QR，扫码后手机才打开 `/upload/phone`。审计 §5 声称已改为 `06-print-workbench.html?stage=s1&source=qr`，但 **`origin/main` 上 `39-print-hub.html` 第 618/902 行仍是 `05-phone-relay.html`**。审计文档本身又不在 `origin/main` 上。**施工前必须由产品裁一次，不能两边各按各的接。**

**仅缺接线**

3. 能力探测→卡片禁用已有真实基础，只需把七张卡的 `data-cap` 键与 `PrintScanCapabilityKey` 枚举对齐。

---

## 5. P41 履约状态

原型：`41-fulfillment-states.html`（1313 行，8 态）｜生产：**`routes/index.tsx` 无 P41 路由**，八态分散在 `PrintProgressPage` / `PrintDonePage` / `PrintPickupClaimPage` / `MyPrintOrdersPage`

### 5.1 状态与端点

| 状态 | 主/次动作 | 端点 / 状态机 |
|---|---|---|
| 1 支付失败 | 主动作 / 「放弃并保留待打印」 | `GET /orders/:id/pay-status`、`POST /orders/:id/pay/reconcile`；`payStatus ∈ {unpaid, paying, failed, closed}` |
| 2 支付待确认 | 主动作 / 「转为待打印订单」 | `PaymentAttempt.status='expired'` → `PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED`（`online-payment.service.ts:211/310`） |
| 3 退款处理中 | 主动作 / 「回打印台重打」 | `POST /admin/orders/:id/refund`（**`@Roles('admin')`**）；`refund.service.ts:242/519/582` |
| 4 退款完成 | 主动作 / 「回首页」 | `payStatus ∈ {refunding, partial_refunded, refunded}`、`Order.refundedAmountCents`、`Refund.refundNo` 幂等键 |
| 5 退款失败 | 主动作 / **「打印失败凭条」** | **无凭条产物端点** |
| 6 耗材/缺纸 | 「我关好了，继续打」/「改到另一台机器」 | `GET /terminals/:id/printer-status`；healthy 集合仅 `{ok, ready, idle}` |
| 7 安全取件认领 | **4 位码输入 + 「确认认领」** / 「叫服务台」 | `POST /print/jobs/claim-pickup` — `print-jobs.controller.ts:32` → `pickup-order.service.ts:21`；错误码 `PICKUP_CODE_INVALID / _EXPIRED / _TERMINAL_MISMATCH / _UNAVAILABLE / ORDER_PAYMENT_UNAVAILABLE` |
| 7 释放出纸 | — | `POST /print/jobs/:orderId/release` → `pickup-order.service.ts:77`（`pickupStatus==='claimed' && payStatus==='paid'` 双条件 + CAS，冲突抛 `ORDER_RELEASE_CONFLICT`） |
| 8 错件事故 | 「立即上报」/「原样交回」 | **无端点** |

> 原型自身在 170/179 行留了注释，要求这些 `pick` 用真 `<button>` + 显式 `aria-disabled="true"`。生产实现必须把它们变成真动作或保留可解释禁用态。

### 5.2 缺口

**后端缺**

1. ~~**用户侧退款申请端点缺失。**~~ **⛔ 本条与一条已封板的产品决定冲突，暂停据此派单（2026-08-16 订正）。**

   技术描述本身没错 —— `RefundService.refund()` 确实完整（幂等键、CAS、provider、收敛、重试），确实只缺受限的用户侧触发面。**错的是把它列为「缺口」**：仓库里有五处已声明「不做自助退款」，其中一处是**用户此刻正在读的上线文案**：

   | 位置 | 内容 |
   |---|---|
   | `apps/kiosk/.../PrintCashierPage.tsx:494` | 「本机不提供自助退款」**（用户可见）** |
   | `services/api/.../admin-order-actions.controller.ts:44` | 「绝不新增匿名/会员自助退款入口」 |
   | `docs/.../wiring-map.md` C9 | 同上口径 |
   | `docs/.../console-plan-for-kiosk-proto-2026-07.md` | 同上口径 |
   | C5-4 进度记录 | 同上口径 |

   本规格成稿时没有核对这五处，于是把一条**产品有意不做的事**写成了「后端缺口」。据此派出的实现（PR #632）已完成并绿灯，但**挂起未合**，等待产品边界裁决。

   **在裁决之前，后续会话不得再把本条当作待办派单。** 裁决为「做」则合入 #632 并**必须同步修 `PrintCashierPage.tsx:494` 那句假承诺**；裁决为「不做」则关闭 #632 并删除本条。

   附一条会影响裁决的事实：生产单价为 0（免费试运营）时订单创建即结清，#632 对 0 元单显式 409，**因此该端点在当前生产配置下会拒绝每一笔订单** —— 合入与否今天都不改变用户可见行为。
2. **状态 6「改到另一台机器」无跨终端改派。** `pickup-order.service.ts:82` 硬拒 `PICKUP_TERMINAL_MISMATCH`。改派需新的受控端点 + 审计，不能靠前端换 header。
3. **状态 6 缺纸/耗材无细分**（同 §1.3-4）。要让「我关好了，继续打」有意义，Agent 合同必须能上报可恢复故障并支持 resume。
4. **状态 8 错件事故无上报模型。** `FeedbackTicket` 可承载，但需匿名入口 + 事故分类 + 不落 PII 的取证字段。
5. **状态 5「打印失败凭条」无 artifact 生成端点。**

**前端缺**

6. **P41 整页无路由。** 需决策：新建状态页，还是把 8 态分派进现有四页。**倾向后者** —— 审计 §7 反对「把 45 个静态页搬进 React」。
7. 状态 7 的「或扫码调出你的取件码」QR 分支在 `PrintPickupClaimPage.tsx` 无实现（当前只有手输）。

**仅缺接线**

8. 状态 7 主链路**已完整**：`PrintPickupClaimPage.tsx:100/165` 已调 `claim-pickup` 并按 `result.released` 分流。只需按 V6 视觉重排 + 补错误码文案表。
9. 状态 1/2 的 reconcile 兜底已在 `PrintCashierPage.tsx:281/334` 实现，注释明确「绝不在前端伪造已支付」。

---

## 6. 已具备、无需重做的能力清单

以下均以 `git show origin/main:<path>` 逐条读过。**后续会话不得把这些写成「缺失」或重新建设。**

### 6.1 定价与金额
| 能力 | 位置 |
|---|---|
| 真实报价服务，读 `PriceConfig`，不落库、不信任前端金额/页数 | `payment/order-quote.service.ts`、`pricing.service.ts` |
| 页数真实识别 + 页码范围求交（签名 fileUrl 验签） | `print-jobs/print-page-count.service.ts`、`page-range.util.ts` |
| `Order.amountCents` 整数分，`itemsJson` 存计费明细快照，改价不影响历史单 | schema Order |
| 公开价目只读 / Admin 读写 + 对账 | `GET /print/price-config`；`GET/PUT /admin/billing/price-config[/:serviceKey]`、`GET /admin/billing/reconciliation` |

### 6.2 支付与退款
| 能力 | 位置 |
|---|---|
| `payStatus` 八态 | schema Order |
| `paymentSource` 只允许 `offline/free/manual_confirmed`；`payChannel` 只能由回调成功路径写 | schema 注释 + `order-status.service.ts` |
| `markPaid` 事务 + CAS + 唯一 `pickupCode` + 审计 | `payment/order-status.service.ts:56-110` |
| `PaymentAttempt` 五态 + `(channel, channelTxnNo)` 唯一回调幂等键 | schema |
| 出码/扫码付/查单/reconcile/回调/沙箱 六端点 | `payment/payment.controller.ts:63-114` |
| 码过期与代付收敛定时任务 | `qr-payment-expiry.task.ts`、`code-payment-convergence.task.ts` |
| `Refund` 幂等键 + pending 收敛 + 失败重试 + 回滚 | `payment/refund.service.ts` + `refund-convergence.task.ts` |
| provider 抽象（sandbox / wechat / alipay） | `payment/payment-provider.factory.ts` + `providers/` |

### 6.3 出纸门控与状态机分离
| 能力 | 位置 |
|---|---|
| **C5-3：只有 `payStatus==='paid'` 才能 release 出纸** | `pickup-order.service.ts:85` |
| `Order.pickupStatus` 与 `PrintTask.claimed` **两套状态机已正确分离**（`claimed` 仅 Agent 租约） | `pickup-order.service.ts` + `terminals.controller.ts:105/130` |
| release 双条件 CAS，冲突抛 `ORDER_RELEASE_CONFLICT` | `:111-114` |
| 终端就绪三级拒绝 / 文件可用性 + PII 前置门禁 | `:133-145` / `:149-164` |
| `PrintTaskStatusLog` 状态迁移审计 | schema |

### 6.4 隐私体检
| 能力 | 位置 |
|---|---|
| **PII 扫描是真的**：OCR + 正则抽取，无跳过路径（`contentCategory=photo` 口子已移除） | `materials.service.ts:154-198`、`pii-scan.util.ts` |
| 截断扫描诚实降级为 `mode:'partial'`，不冒充 `real` | `:186-193` |
| 建单前强制存在 completed `pii_scan` 且无 pending 裁决，绕过写审计 | `print-jobs.service.ts:473-512`、`member-print-order-create.service.ts:212`、`pickup-order.service.ts:160` |
| 匿名任务访问令牌 | `materials.service.ts:assertCanAccessTask` |

### 6.5 文件与上传
手机接力上传会话全链（create/status/upload/confirm/cancel）；签名 URL + 内容嗅探 + 校验 + 留存策略 + 清理任务；`PrintTask.fileId` 血缘。

### 6.6 终端与能力门禁
终端能力下发 + **客户端 fail-closed**（区分 ok/skipped/error，失败不放大可用性）；终端注册/绑定码/凭证轮换/紧急吊销；Agent claim + 状态回传 + 心跳。

### 6.7 已接线的 Kiosk 页面
`PrintConfirmPage`（quote/create/分流）、`PrintCashierPage`（六个支付调用全在）、`PrintProgressPage`（轮询 + errorCode 映射 + 10 分钟硬超时）、`PrintDonePage`（取件码可见性完全由后端决定）、`PrintPickupClaimPage`、`ScanSettingsPage`、`ConvertImagesPage`、`MyPrintOrdersPage`。

### 6.8 会员云打印线
`member-print-orders/` 全套 + `member-benefits/` + `benefit-redemption/` 后端**均已存在**，缺的只是 Kiosk 侧接线（§1.3-6）。

---

## 7. 实施顺序建议

文件预算 = 预计改动文件数（不含测试；测试另按 1:1 估）。

| 步 | 内容 | 依赖 | 文件预算 |
|---|---|---|---|
| **S0** | **裁决 P39→P05 跳转口径冲突**（§4.2-2）。产品裁决 + 改 `39-print-hub.html` 两处 `href`。必须先做，否则两条线按矛盾口径开工 | — | **1** |
| **S1** | **匿名反馈端点**。不需 `EndUserAuthGuard` 的受限提交面（限流 + 分类白名单 + 不收 PII + 可选关联 `printTaskId`），复用 `FeedbackTicket` | — | **4–5** |
| **S2** | **权益抵扣接线（纯前端）**。后端已就绪，接 P06 s4 权益卡六态 | 可并行 | **4–6** |
| **S3** | **用户侧退款申请端点**。复用 `RefundService.refund()`，加原因码白名单 + 状态组合校验 + 限流 + 审计 | 独立 | **3–4** |
| **S4** | **P41 八态落位（前端）**。分派进现有四页，**不新建 P41 页面**。补取件码 QR 分支、错误码文案表 | S1、S3 | **7–9** |
| **S5** | **打印故障细分合同**。扩 `PatchTaskStatusDto` 允许可恢复故障码 + `PrintTask` 恢复语义 + Agent 侧合同。**必须同步改 Windows Agent，跨仓协调** | 独立 | **6–8** + Agent 仓另计 |
| **S6** | **续打/再打端点** | S5 | **4–5** |
| **S7** | **扫描参数合同**。扩 `ScanTask` 模型 + DTO + Agent 下发 + 能力探测键 + 前端控件。**含 migration** | S5（同批发版） | **8–10** |
| **S8** | **转换排版参数**。扩 `ConvertImagesDto` + 合成实现 + 前端。A4/A3 保持禁用态 | 独立 | **4–5** |
| **S9** | **遮盖产物生成**。`pii_redact` 真实渲染 + `resultFileId` + 血缘 + 选原件/遮挡件。风险最高，放最后 | S7/S8 后，独立评审 | **7–9** |
| **S10** | 印章资产持久化，或产品决定降级为每次现写并删该按钮 | 可延后 | **5–6** 或 **1** |
| **S11** | 跨终端改派 + 错件事故上报分类 | S1、S3 | **4–6** |

**建议批次**：S0+S1+S2 第一批（低风险、快速见效、直接消灭假按钮）；S3+S4 第二批（履约状态闭环）；S5+S6+S7 第三批（Agent 合同批次，跨仓，一次发版）；S8+S9+S10+S11 第四批。

---

## 8. 本规格未验证的部分

**不要当作结论使用**，需另行核实。

1. **`PrintJobParamsDto` 完整字段表未逐字段读。** 因此 P06 s3 的翻页边、方向、缩放三组是否已有后端字段**未验证**（§1.3-7 标为「需比对」而非「缺失」）。`verified-print-parameters.ts` 白名单内容同样未验证。
2. **线上 `price-config` 返回 0 元、描述「免费试运营」** —— 由任务方提供，本规格作者无法访问生产验证。仅验证了 `price-config.seed.ts` 的开发默认价来自 `PRINT_UNIT_PRICE_CENTS` 且 production 时 seed 被硬拒。
3. **`PriceConfig.effectiveFrom` 是假能力字段** —— 来自 `price-config.seed.ts` 自陈注释；已确认 `pricing.service.ts:39/67` 按 `active` 查询，但未穷尽全仓 `effectiveFrom` 读取点。
4. **P41 八态只读了 `pay-fail` / `claim` / `wrongdoc` 三段正文**，其余五段只读到按钮标签与标题行号，正文里可能还有未见控件或数据依赖。
5. **P06 的 3593 行中脚本区（2208–3593）只读了函数名清单**，未逐行读 `benCalc` / `benRender` / `calc` / `bindDots`。原型权益抵扣计算口径可能与后端 `RedemptionRecord` 语义有出入，未核对。
6. **Windows Terminal Agent 仓库完全未读。** S5/S6/S7 涉及 Agent 合同变更，仅从云端 DTO 反推。Agent 实际能力（能否区分卡纸/缺纸、能否 resume、TWAIN/WIA 参数支持度）**未验证**，S5/S7 文件预算可能显著偏低。
7. **`packages/shared` 未读**（任务禁令）。`PrintScanCapabilityKey`、`PrintScanCapabilityStatus`、`makePrintParams` 定义未验证，S2/S7 涉及的 shared 改动未计入预算。
8. **测试文件全部未读。** 「已具备」清单基于源码而非测试证据。
9. **P08 t3 tab 具体是什么能力**未确认。
10. **`admin-print-scan` 的 action 白名单未读**，P41 后台侧处置与前台八态的对应关系未验证。
11. **`Order.taskStatus`** 在 `pickup-order.service.ts` 中出现 `'expired'` 和 `'awaiting_payment'`，但 schema 注释只列 `pending|claimed|printing|completed|failed|cancelled`。**注释与实现不一致，未追查哪个是真值**，P41 状态映射前需先澄清。

---

## 9. 合规确认

- 全程只读，未修改任何 `.ts/.tsx/.css/.prisma/.mjs`，未触碰 `packages/`、`apps/miniapp`、`docs/progress/`
- 未出现「一键投递/立即投递/平台投递」等禁用文案；本域为打印扫描履约，不涉及岗位/招聘会入口
- 「已具备」清单每条均标注 `origin/main` 上的文件路径与行号；未读过的一律进 §8
