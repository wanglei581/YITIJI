# 小程序云打印 M2 第一片立项方案（预提交任务 + 到机码 + 到机核销 + 机端支付）

> 状态：**方案候选，未开发 / 未部署**。用户 2026-08-07 确认范围：小程序端“预提交打印任务 → 生成到机码”，到机后用取件码核销，**支付仍走机器现有屏上二维码（Native/被扫）**，小程序端本期不做远程支付。
> 相关决策：`docs/product/miniprogram-gate0-decision-confirmation-2026-08-07.md`（M2 原延后，本次按用户指示提前第一片）；Gate 0 事实审查（`/me/print-orders/:orderId/pickup` 与 `/print/jobs/claim-pickup` 不存在、订单以 PrintTask 为主表、无小程序 JSAPI）；小程序唯一工程底座已合入 `apps/miniapp`（PR #541）。

## 1. 目标与范围

### 1.1 本片（第一片）范围

- 小程序（`apps/miniapp` 原生四 Tab“首页 / AI百宝箱 / 求职 / 我的”）内新增“云打印”下单：从本人“我的文档/求职材料”选择文件（`print_doc`/`resume_upload`/`cover_letter`）→ 选择份数/单双面（A4、单面优先，彩色/双面未知 mode 不假设）→ 服务端按页数/份数固化报价快照 → 创建 **Order-only 待到机订单**并生成**到机码** → 小程序展示到机码、有效期与服务点信息。
- Kiosk 端新增“到机取件/核销”：输入到机码 → 校验（哈希比对、有效期、终端匹配、未使用、防爆破/限流）→ 展示订单与价格 → 走**既有机端支付**（屏上二维码/被扫付款码）→ 支付成功后在同一事务创建 `PrintTask` → Agent 按既有链路领取并打印 → 完成/取件。
- 服务端：Order 增加 additive 待到机履约字段/记录；`claim-pickup` 核销端点（CAS、限流、防爆破、过期/错终端/重复使用门禁）；文件 TTL 与订单生命周期联动。

### 1.2 本片明确不做

- 小程序远程支付（JSAPI/`wx.requestPayment`、商户绑定、回调/退款）——第二片。
- 材料包编辑器/条目快照（本人模型、CRUD/锁定、服务端页数与报价快照的“材料包”完整形态）——本片从“我的文档”选文件即可，材料包形态后续片补齐。
- 附近服务点/距离（不显示假距离；只读展示 Admin 管理的 `terminalCode + locationLabel + enabled + 心跳`）。
- 订阅消息、自提通知、多机队灰度——后续片。

## 2. 状态机（第一片）

```
小程序提交 → ORDER_PENDING_RELEASE（待到机，未支付，到机码有效）
             │
             ├─ 有效期到期 → ORDER_EXPIRED（文件按 TTL 回收，审计）
             │
             └─ 到机核销（claim-pickup 成功，CAS 置核销中）→ 机端支付
                    ├─ 支付超时/取消 → 回到 ORDER_PENDING_RELEASE（到机码未使用，可重试）
                    ├─ 支付成功 → 同事务创建 PrintTask（仅一次）→ Agent 打印
                    │         → COMPLETED → 到机码标记已使用/作废
                    └─ 文件/能力失效 → 阻断 PrintTask 并按既有退款/补偿路径处理
```

- 待到机默认有效 **24 小时**（可配）；到机核销后支付窗口复用既有 **15 分钟**待支付规则。
- 核销幂等：`claim-pickup` 成功但响应丢失时，同一到机码再次核销返回同一订单/任务（不重复创建）。
- 并发：同一到机码并发核销只放行一次（CAS），释放只创建一次 `PrintTask`。

## 3. 数据模型（全部 additive）

- `Order` 新增字段（或等价 additive 记录）：`pickupCodeHash`（仅存哈希，不存明文）、`pickupCodeCreatedAt`、`pickupCodeExpiresAt`、`releaseTerminalId`、`pickupClaimedAt`、`pickupStatus`（`pending|claimed|used|expired|cancelled`）、`quoteSnapshotJson`（服务端固化的页数/份数/价格/参数）。
- 新增 additive 表（如 `OrderPickup`）记录到机码生命周期与核销审计（核销终端、核销时间、结果），**不含文件内容**。
- 状态一致性：`PrintTask` 仍只在“支付成功后、到机事务内”创建；`Order` 与 `PrintTask` 通过 `orderId` 关联（既有关系复用）。
- 文件：订单待到机期间保留；`ORDER_EXPIRED`/取消后按既有文件 TTL/清理规则回收，`FileObject` 生命周期审计不变。

## 4. 接口契约（新增/扩展）

### 4.1 小程序侧（会员本人）
- `POST /me/print-orders`（创建云打印订单）：入参文件 ID、份数、单双面、服务点（可选，默认运营服务点）；服务端校验文件归属/格式/大小、生成报价快照、创建 Order + 到机码；**到机码明文只返回一次**，服务端仅存哈希。
- `GET /me/print-orders/:orderId`（查看待到机订单与到机码剩余有效期；核销后不再返回码）。
- `GET /me/print-orders`（列表，含待到机/已完成，供“我的”回看）。
- `POST /me/print-orders/:orderId/cancel`（待到机未核销时取消；过期同理）。

### 4.2 Kiosk 侧
- `POST /print/orders/claim-pickup`：入参到机码（不落日志/审计明文）；校验哈希、有效期、终端匹配（当前 `terminalCode`）、状态未使用；限流与防爆破（按终端/IP/码计数）；成功返回订单摘要与报价（不含文件内容路径），并标记 `pickupClaimed`。
- 机端支付复用既有 `createPayAttempt`/`code-pay` 路径；支付成功回调后由服务端在**同一事务**内：置订单履约状态 → 创建 `PrintTask`（`orderId` 关联）→ 到机码置 `used` → 返回打印任务。
- 若主干仍无 `claim-pickup`，本片新增；已有则以本方案收口。

### 4.3 Admin
- 订单管理查看待到机订单、到机码状态（不展示明文）、手动失效/取消与审计。

## 5. 页面（小程序 / Kiosk）

- 小程序（`apps/miniapp`）：四 Tab 内入口（优先挂在“我的/材料”与 AI百宝箱既有入口，**不新增首页 Tab 或重复入口**）；下单页（选文件→参数→确认报价→展示到机码与有效期/服务点指引）。
- Kiosk：首页“打印”链路内新增“到机取件”入口（或打印页既有入口扩展）；输入到机码 → 核销 → 支付 → 进度 → 完成。**入口稳定规则**：只接线已有入口，不新增同义卡片。

## 6. 验证门禁

- 服务端专项 verify：`claim-pickup` 的 CAS、限流、防爆破、过期、错终端、重复使用、响应丢失幂等、并发只释放一次；订单状态机（待支付超时/取消/过期）；文件 TTL 与取消回收；报价快照不可变。
- 既有门禁回归：`verify:print-rollout-config`、`verify:production-runtime-gates`、打印真实性、隐私、W2 浏览器套件、API typecheck/lint/build、共享契约门禁。
- 小程序侧：`apps/miniapp` 微信开发者工具真实编译、四 Tab/路由/合规/返回链路专项审计；不使用微信云开发。
- Windows 真机：小程序提交 → 到机码 → Kiosk 核销 → 机端支付 → 真实出纸 → 完成取件；覆盖不提前出纸、并发只释放一次、失败不重复扣款/自动重打、断网/重启恢复；保留订单/任务/Agent 日志/脱敏截图证据。

## 7. 分期

- **第一片（本方案）**：Order-only 待到机 + 到机码 + `claim-pickup` + 机端支付 + 小程序下单页 + 文档收口。支付依赖 = 现有 Native/被扫。
- **第二片**：小程序 JSAPI 支付（`prepay_id`/签名/`wx.requestPayment`、AppID 商户绑定、回调/查单/退款、1 分钱 live 冒烟）；需先确认微信主体/类目/商户资质。
- **第三片**：订阅消息与到机提醒、服务点列表与心跳展示、材料包完整形态、多机队灰度。

## 8. 范围与工程边界

- schema 仅 additive（新增字段/表，不改既有列语义）；不新增首页 Tab、不新增重复入口；依赖最小化（不引入新的微信云/支付 SDK 之外的依赖）。
- 小程序代码落在 `apps/miniapp`（唯一工程底座，PR #541 已合入）；找回源码目录不再作为事实源。
- 不连接生产、不部署、不执行 seed；文件/订单只操作本地或预生产隔离环境直至授权发布。
- 涉及支付的文件/密钥/回调验证按既有 `merchant-onboarding-checklist.md` 与 `payment-production-env-checklist.md` 边界执行。

## 9. 未决项（须用户确认后再开工）

- 待到机 24 小时与机端支付 15 分钟窗口是否采用默认值（可配）。
- 到机码位数/字符集（建议 6 位数字，哈希存储 + 防爆破）。
- 小程序端是否展示服务点只读信息（单机运营下默认当前机器即可）。
- 免费单是否允许云打印（建议允许，便于真机联调与首店试点）。
