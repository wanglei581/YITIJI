# 功能 ↔ 接口对接表（V3 设计稿 → 生产后端）

> 2026-08-11 落盘。**用途**：Codex 拿着这张表开工，不用再猜「这个按钮该调哪个接口」「这个功能后端到底有没有」。
>
> **两个输入**
> - 设计稿：本目录 45 页（以 `pages.json` 交付集为准；另有 3 份 retired 首页比稿不计入交付集），页面清单见 `index.html` / `README.md` / `closed-loop-map.md`
> - 端点清单：`api-inventory-snapshot.md`（415 个端点 / 76 个控制器，机械抽取；**有已知误渲染，见 §13**）
>
> **配套文件**：`docs/reviews/2026-08-11-backend-buildout-spec.md`（948 行，Codex 出的六项后端能力实施规格）。
> 两份是配套的：**规格说「怎么建」，本表说「哪一页的哪个按钮在等它」**。
> 凡涉及打印 / 权益 / 计价的 ❌，本表只指路，不另出方案 —— 一律引用规格对应小节。
>
> **计价与权益口径**已拍板，见 `backend-contract-pricing-benefits.md` 与上面那份规格，本文不重复论证。

---

## §0 读之前必须知道的

### 0.1 状态图例

| 标记 | 含义 |
|---|---|
| ✅ **已有可用** | 端点存在、语义对得上、参数够用，Codex 可以直接接 |
| ⚠️ **已有但口径不符** | 端点存在**但不等于能用**：参数不对 / 语义不符 / 只实现了一半 / 权限档位不同。备注列写清**差在哪**与**建议改哪边** |
| ❌ **缺（待开发）** | 后端没有。**这不是设计稿的错误，是这张表存在的理由** —— 备注列尽量写清「要做成什么样」：入参、返回、关键约束 |
| ⏸ **本期不排期** | 有意后置。备注列写清**为什么**（依赖没到位 / 优先级 / 需真机验证），不是「不该存在」 |

**「⚠️ 口径不符」是本表最重要的一档。** 端点存在 ≠ 能用。典型例子：`POST /orders/:id/redeem` 存在，
但它是**整单免单 + 扣 1**、不区分券的品类、不看单量上限，直接接「每月 N 次免单」会资损。

### 0.2 全局前置事实（这 10 条不写清楚，下面的表会被误读）

1. **全局前缀 `/api/v1`**（`services/api/src/main.ts:62`）。本表与清单里的路径**都不含它**。
2. **全局只有 `ThrottlerGuard`，没有全局鉴权守卫，也没有 `@Public` 装饰器**（`app.module.ts:143`）。
   判断一个端点匿不匿名，**只看它自己有没有 `@UseGuards`** —— 没有守卫就是完全匿名。
3. 三种鉴权：`EndUserAuthGuard`（会员 JWT + Redis 会话，**30 分钟**）/ `JwtAuthGuard + RolesGuard`（后台）/
   `resolveOptionalEndUser`（匿名可过，带 token 则绑定 `endUserId`）。另有终端令牌（`x-terminal-id` + Bearer）。
4. **匿名产物靠一次性 access token**，响应里只回一次，库里只存 sha256：
   `x-resume-access-token`（AI 简历族）、`x-interview-access-token`、`x-material-task-token`（或 `?accessToken=`）、
   `x-contract-review-access-token`、`X-Upload-Session-Control`、`X-Scan-Session-Control`、`x-payment-session-token`。
   **丢了就找不回来** —— 服务端没有任何「列出本次会话产物」的接口（`kiosk-session` 是空壳，见 §9）。
5. **返回信封不统一**：`/me/*`、`materials`、`companies`、`contract-reviews` 走 `ApiResponse.ok({...})`；
   `/print/jobs`、`/orders/quote`、`/assistant/chat`、`/jobs`、`/job-fairs` 直接返回裸对象。
6. **错误信封不统一**：print-jobs / scan / files / sign 抛 `{error:{code,message}}`；
   **payment 域抛裸字符串**（`throw new BadRequestException('PRICE_CONFIG_UNAVAILABLE')`，`pricing.service.ts:44,60,63,69,72`）。
   06 的「错误码 → 屏幕状态」表是按 `{error:{code}}` 写的，前端两种都要认。
7. **分页两套**：`page/pageSize`（jobs / job-fairs / offline-agencies / fair 子表）与
   `cursor/pageSize`（companies 与全部 `/me/*`，默认 20 上限 50，`common/utils/member-page.ts:13-14`）。
8. **404 语义不统一**：jobs / job-fairs 查不到返回 `200 + data:null`；companies / offline-agencies 抛 404。
9. **能力门禁**：`GET /terminals/:terminalId/capabilities` 返回 10 个键
   （`document_print / phone_upload / cloud_upload / usb_import / material_pack / scan / copy / id_photo / format_convert / signature_stamp`，
   `packages/shared/src/types/printScanCapability.ts:27-38`），状态五档
   （`available / testing / maintenance / unsupported / not_verified`）。
   **只有 `available` 允许普通用户建正式任务**，服务端在任务创建边界强制（`terminal-capabilities.service.ts:148`）。
   有能力键**不等于**有数据模型：`IMPLEMENTED_PRINT_SCAN_TASK_TYPES` 只有 `print / scan / document_process`
   （`printScanCapability.ts:71-76`）—— 复印、证件照、材料包三项**只有开关没有后端**。
10. **`api-inventory-snapshot.md` 有已知误渲染**：凡是一个文件里声明了两个 `@Controller` 的，
    第二个类的前缀被吞掉。已确认 5 处，见 §13。凡是本表与清单不一致的，**以本表的 controller 源码行号为准**。

### 0.3 唯一交易链（引自 buildout-spec §结论）

```text
FileProvenance
    → OrderQuote（价格、参数、场景、资格不可变快照）
        → BenefitReservation
            → Order + RedemptionRecord
                → PrintTask attempt 1..N
                    → Refund 或 RedemptionAdjustment
```

**今天只有中间三段的一部分**：`POST /print/jobs` 一次事务建 `PrintTask + Order`（`print-jobs.service.ts:331-380`），
两头（`FileProvenance` / `OrderQuote` / `BenefitReservation` / attempt 1..N / `RedemptionAdjustment`）**全部没有**。

---

## §1 打印与扫描（06 / 07 / 08 / 39 / 41 / 29）

### 1.1 P06 打印工作台 · 七阶段

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `06` s1「本机上传」 | 匿名上传文件，拿到可打印的 fileId | `POST /files/kiosk-upload` | ✅ | 匿名，20/min。multipart 字段 `file`，body `purpose`（8 值白名单，`dto/kiosk-upload-options.dto.ts:12-22`）。**不接受 `sensitiveLevel`**（服务端按 purpose 推）。返回 `{fileId, sha256, signedUrl(30min), signedUrlExpiresAt, fileExpiresAt}` |
| `06` s1「手机扫码传」 | 出二维码 → 手机上传 → 本机取回 | `POST /upload-sessions` → `GET /upload-sessions/:sessionId` → `POST /upload-sessions/:sessionId/confirm` | ⚠️ | 全链匿名可用（`mode:'temporary'`）。**二维码有效期后端硬编码 600 秒**（`upload-sessions.service.ts:87`），设计稿 `site-config.js` 写的是 `handoffQrSec: 300`。前端必须读服务端 `expiresAt`，别用本地常量。生产必须配 `KIOSK_PUBLIC_BASE_URL` 且是 https |
| `06` s1「U 盘导入」 | 列出 U 盘文件、选一份进流程 | **缺** | ❌ | 能力键 `usb_import` 有，**数据面完全没有**。要做成：Terminal Agent 侧读 U 盘 → 由 Agent 用终端令牌把文件推成 FileObject（可复用 `POST /terminals/:terminalId/scan-sessions/deliver` 的形态），Kiosk 用一次性 control token 轮询取 `fileId + fileUrl`。**绝不能让浏览器直接读本地盘** |
| `06` s1「扫描原件」 | 跳 07 扫描工作台 | 见 §1.2 | ✅ | 纯跳转 |
| `06` s1「复印（先扫后打）」 | 一次操作完成扫+打 | **缺** | ❌ | 能力键 `copy` 有，任务模型没有。**已有两套东西可拼**：07 扫描 → 06 打印。要做成一个 `copy` 任务前，先确认是否只是前端串流程（若是，这属于「同一件事两套实现」，应合并到 07→06 一条路，不新建 copy 模型）。计价单位按已定口径是「张」，不是「计费页」 |
| `06` s1「证件照排版」 | 跳 29 | 见 §1.5 | ⏸ | 29 全流程无后端，设计稿已按「未开放」呈现，口径一致 |
| `06` s2 材料体检（页数 / 清晰度 / 边距 / 幅面） | 上传后自动预检 | `POST /materials/tasks {kind:'inspection'}` + `GET /materials/tasks/:id` | ✅ | 匿名，30/min。匿名要收好返回的一次性 `accessToken`（或用 `x-material-task-token`）。**实质同步**：inspection 直接回 `completed`（`materials.service.ts:271`） |
| `06` s2 隐私预检（身份证号等） | 扫出敏感信息并定位 | `POST /materials/tasks {kind:'pii_scan'}` | ✅ | 检出四类：`phone / email / id_card / address`（`pii-scan.util.ts:168-224`）。**snippet 已脱敏后才入库**。扫描版 PDF 只 OCR 前 `PII_SCAN_MAX_OCR_PAGES`（默认 3）页，截断时 `mode='partial'` 而不是 `'real'` —— 屏上必须照实说「只体检了前 N 页」 |
| `06` s2「遮住这一处 / 全部取消 / 换一处」 | 逐条决定 keep/redact | `POST /materials/tasks/:id/pii-findings/decisions` | ✅ | body `{decisions:[{findingId, action:'keep'\|'redact'}]}`，最多 200 条 |
| `06` s2「遮盖后继续」拿到打了码的新文件 | 遮盖后产出可打印文件 | `POST /materials/tasks {kind:'pii_redact'}` | ⚠️ | **端点在，但 `redactedFileId` 目前恒 `null`**（`materials.service.ts:617-634` 只回 `redactedCount/keptCount/pendingCount`）。也就是说**遮盖完拿不到新文件**，s2 走到 s3 会断。这是上线阻塞级别的半实现 |
| `06` s3 参数：黑白 / 彩色 | 打印色彩 | `PrintJobParamsDto.colorMode` | ⚠️ | 后端取值 `black_white \| color`；设计稿 `data-v="bw"`。**前端负责映射**，别把 `bw` 直接发出去 |
| `06` s3 参数：单面 / 自动双面 / 长边翻 / 短边翻 | 双面模式 | `PrintJobParamsDto.duplex` | ⚠️ | 后端三值 `simplex \| duplex_long_edge \| duplex_short_edge`（`create-print-job.dto.ts:26-62`）。设计稿把「单双面」与「翻页边」拆成两个控件，前端要合成一个值 |
| `06` s3 参数：方向 / 缩放 / 每面页数 | 版面 | `orientation: auto\|portrait\|landscape`、`scale: fit\|actual`、`pagesPerSheet: 1\|2\|4` | ⚠️ | 设计文案「跟随文件（纵向）」→ `auto`；「按原尺寸（100%）」→ `actual`；「缩放到 A4」→ `fit`。**`pagesPerSheet` 不影响价格**（`pricing.service.ts:23`） |
| `06` s3 参数：页码范围 | 只打其中几页 | `PrintJobParamsDto.pageRange` | ✅ | `≤100 字符`，`/^\d+(-\d+)?(,\d+(-\d+)?)*$/`。空 / `'all'` 一律传 `undefined`。范围一页都没命中 → 400 `PRINT_PAGE_RANGE_INVALID`（`order-quote.service.ts:35-41`） |
| `06` s3 参数：份数 | 1–99 | `PrintJobParamsDto.copies` | ✅ | DTO 限 1..99，与设计稿 §4B 边界值一致 |
| `06` s3 现场公示价（`data-site-unit`） | 拉当前单价 | `GET /print/price-config` | ✅ | **匿名可读**（这是关键设计：不该为了看价先登录）。返回 `{billingEnabled:true, items:[{serviceKey, unitCents, unit, description}]}`，只回 `active` 行。零 active 行 → 400 `PRICE_CONFIG_UNAVAILABLE`，**不回退硬编码价** |
| `06` s3 → s4 核价 | 服务端算金额与计费页 | `POST /orders/quote` | ⚠️ | 匿名，10/min。body `{fileUrl, params}` —— **只接内部签名 fileUrl，拒绝任何客户端页数/金额**。返回 `{amountCents, billablePages, billingPageSource, lines[]}`。**没有 `quoteId` / `expiresAt` / `priceVersion` / `discount` / `availableBenefits`**（`payment.types.ts:77-82`），所以本机**不锁价**，建单时会再算一次。设计稿已按此写了「后台刚调价」那一屏 ✅。补齐方案见 buildout-spec「报价快照」+「报价接口」（新端点 `POST /orders/quotes`） |
| `06` s4「权益与本单价格」卡 · 列出可用权益 | 报价时一起返回可用/不可用及原因 | **缺**（`GET /me/benefits` 只是券列表，见 §6） | ❌ | 要做成 buildout-spec「报价接口」响应里的 `benefits.candidates[{grantId, eligible, reasons:[{code, actual, allowed}]}]` + `benefits.selected`。原因码枚举见规格「① 四道闸」第 125–141 行（`BENEFIT_SCENARIO_NOT_ALLOWED / BENEFIT_QUANTITY_LIMIT_EXCEEDED / BENEFIT_COLOR_NOT_ALLOWED / BENEFIT_PERIOD_EXHAUSTED / AUTH_REQUIRED …`）。**前端不做资格判定**，只渲染服务端结论 |
| `06` s4 四道闸：适用场景 | 只在简历 / 求职材料 / 招聘会资料 / 政策申请材料四类上生效 | **缺**（`applicableScopes` 后端 0 命中） | ❌ | 见 buildout-spec「① 四道闸」`BenefitRuleVersion.scenarioKeysJson` + 固定服务端枚举 `resume / job_search_material / job_fair_material / policy_application_material`。判定输入来自「② 服务端场景溯源」的 `FileProvenance.scenarioKey` —— **`from`、URL、客户端 `purpose` 一律不构成授权** |
| `06` s4 四道闸：单次计费总量上限 10 | 上限加在 `页 × 份` 上 | **缺**（`maxBillableUnits` 后端 0 命中） | ❌ | `BenefitRuleVersion.maxBillableQuantity=10`。**必须加在 `billableQuantity = 所选文档页 × 份数`**，只限文档页数拦不住「10 页 × 20 份」 |
| `06` s4 四道闸：只覆盖黑白 | 彩色不免 | **缺**（`colorScope` 后端 0 命中） | ❌ | `BenefitRuleVersion.allowedColorModesJson = ["bw"]` |
| `06` s4 四道闸：每月 N 次 | 月度额度，自然月清零 | `GET /me/benefits`.`quantityRemaining`（只有总量，无周期） | ⚠️ | `BenefitGrant.quantityTotal / quantityRemaining` 已有，但**没有月度周期概念**，不会到月清零。要做成 buildout-spec「③ 月度周期余额」的 `BenefitPeriodBalance`（`periodKey='2026-08'`，`Asia/Shanghai` 自然月，`[startsAt,endsAt)`，不结转，月中首领发整月 N 次）。**不要把历史「剩 7 次」直接解释成本月 7 次**（规格「第二阶段」） |
| `06` s4 权益单选（一单一权益） | 选中一张券 | ✅ 约束天然成立 | ✅ | `RedemptionRecord @@unique([serviceType, serviceRefId])`（`benefit-redemption.service.ts:92,110-120`）。同一订单只能核销一次，**换券也拒**（409 `BENEFIT_OUTPUT_ALREADY_REDEEMED`）。设计稿的单选与「不是本机小气」那句话与后端一致 ✅ |
| `06` s4「确认并去支付」建单 | 建 PrintTask + Order，返回应付金额 | `POST /print/jobs` | ⚠️ | 匿名，10/min，**必须带 `x-terminal-id`**（controller 标 optional，service 强制 `PRINT_TERMINAL_REQUIRED`，`print-jobs.service.ts:259-267`）。body `{fileUrl, fileMd5?, fileName?, params}` —— **单文件，没有 `fileIds` 数组**；**没有任何场景 / 用途字段**，所以四道闸的判定输入无处附着。返回 `{taskId, orderId, orderNo, amountCents, payStatus, priceLines, billablePages, billingPageSource, paymentSessionToken}`。改造方向：buildout-spec「报价接口」把建单收敛成 `POST /print-jobs {quoteId}` |
| `06` s4「本单免费，直接出纸」 | 0 元单跳过收银 | `POST /print/jobs` 返回 `amountCents:0` | ✅ | 后端自动 `markPaid(free)` 并发取件码（`print-jobs.service.ts:384-386`）。前端按 `amountCents===0` 分流即可 |
| `06` s4 用券核销 | 用一次免单券把本单免掉 | `POST /orders/:id/redeem` | ⚠️ | **需会员登录**（类级 `EndUserAuthGuard`，`order-redeem.controller.ts:19`）—— 匿名 Kiosk 调不了。body 只有 `{benefitGrantId}`。`discountCents = order.amountCents` **恒等于整单**（`benefit-redemption.service.ts:152-156`），`quantityRemaining decrement: 1`（`:157-160`）；**只对 benefitType 做可核销白名单**（`coupon/free_quota/package_entitlement`），**不按品类改折扣、不看单量上限、不看色彩、不看场景**。直接接「每月 N 次免单」= 一张券打 200 页平台全赔。**buildout-spec 已把「禁止现有 `/orders/:id/redeem` 按任意 Grant 整单免」列为 P0 立即止血**（规格「迁移与灰度 · 第一阶段」第 1 条） |
| `06` s5「屏上出码，你扫」 | 出动态收款码 | `POST /orders/:id/pay` | ✅ | header `x-payment-session-token`（建单时拿的，默认 30 分钟）。body `{channel?}`；多通道启用且不传 → 400 `PAY_CHANNEL_REQUIRED`（**绝不自动挑真钱通道**）。返回 `{attemptId, channel, status, qrCodeContent, expiresAt, orderPayStatus, orderExpiresAt}`。码 TTL 默认 300 秒、订单关单 900 秒 |
| `06` s5「你出码，本机扫」 | 读用户付款码 | `POST /orders/:id/code-pay` | ✅ | body `{authCode: /^\d{18}$/, channel?}`。**付款码只在本次请求里传给 Provider，绝不落库、审计或日志**（`online-payment.service.ts:269`，审计只带 `orderId/orderNo/channel/amountCents`）—— 与设计红线一致 ✅。Provider 抛错时强制置 `paying` 而非回滚，因为钱可能已扣 |
| `06` s5「到账中 / 已到账」轮询 | 查支付状态 | `GET /orders/:id/pay-status` | ✅ | 返回 `{orderId, orderNo, payStatus, paymentSource, payChannel, amountCents, paidAt, pickupCode, attempt{...}}`。**这是匿名侧唯一能读到取件码的地方**，且受 `pickupCodeVisibleFor` 门控（`order-status.service.ts:41-50`）。副作用：惰性过期与关单 |
| `06` s5「我已付款，帮我查」 | 主动查渠道账本 | `POST /orders/:id/pay/reconcile` | ✅ | 3 秒一次限流 → `RECONCILE_TOO_FREQUENT`；sandbox 无账本 → `RECONCILE_UNSUPPORTED` |
| `06` s5 通道选择 | 列出可用支付通道 | `GET /payment/channels` | ✅ | 匿名，返回 `sandbox \| wechat \| alipay` 子集 |
| `06` s5「重新出码」 | 作废旧码换新码 | `POST /orders/:id/pay` | ⚠️ | 后端**同渠道 pending 会复用同一个码**（`online-payment.service.ts:212-214`），不是「重出并作废旧码」。设计稿 §5.1 写的「重新出码同时关闭旧码；不能两个码都能付」在后端表现为「只存在一个码」，结果一致但过程不同 —— **改前端文案**即可 |
| `06` s5「取消支付，返回 / 先不打，转存我的文档」 | 关单不收钱 | ⚠️ 惰性关单 | ⚠️ | 没有「主动关单」端点；只有超过 `order.expiresAt` 后由 `pay-status` 惰性置 `closed`。前端「取消」只能是本地返回，**不能对用户说「已关单」** |
| `06` s6 出纸进度（排队 / 校验中 / 校验失败 / 出纸中 / 卡纸 / 超时） | 六种任务处境 + 「已完成 N/M 面」 | `GET /print/jobs/:taskId` | ⚠️ | 后端只有五个 status：`pending / claimed / printing / completed / failed`（+ `cancelled / abandoned`）。**`queued / checking / checkfail / jam / timeout` 五个处境后端表达不出来，也没有页面级进度计数**。设计稿 §5.2 明确说这条轴的作用是「堵住伪造状态」—— 在后端补齐前，前端**不得**显示「已完成 3/15 面」。补齐方案见 buildout-spec「⑥ 履约判定与失败补偿」：`PrintTask.dispatchStage`（`pre_spool/spool_submitted/queue_observed/device_confirmed`）+ `outputOutcome`（`no_output/partial/unknown/complete`）+ `Order.fulfillmentStatus` |
| `06` s6「让本机转成可打印 PDF」 | 把打不了的文件转成能打的 | `POST /print/convert/images-to-pdf` | ⚠️ | 该端点**只接图片**（1–20 张），**不能把坏 PDF 转成好 PDF**。s6 校验失败这条出路目前只覆盖「原件是图片」的场景 |
| `06` s7 取件码 | 显示取件凭证 | `GET /orders/:id/pay-status`.`pickupCode` 或 `GET /me/print-orders`.`pickupCode` | ✅ | 码是 10 位、字母表 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`（`order-status.service.ts:14-25`）。**`GET /print/jobs/:taskId` 不含取件码** |
| `06` s7「再打一份」 | 复打 | 重走 `POST /print/jobs` | ✅ | 会产生新订单、重新收费。若要「免费续打」，见 §1.4 的 41 |

### 1.2 P07 扫描工作台

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `07` s1 选类型（纸质简历 / 证件 / 普通文档） | 建扫描会话 | `POST /scan/sessions` | ✅ | 匿名，12/min。body **只有** `{scanType:'resume'\|'id'\|'document'\|'contract', terminalId}`。返回 `{scanTaskId, controlToken, expiresAt, instructions[]}`，TTL 10 分钟硬编码。同终端同时只允许一个 `waiting/matched` 任务 → 409 `SCAN_TERMINAL_BUSY` |
| `07` s1 选输出格式（PDF / JPG / 可检索 PDF） | 输出格式 | **缺** | ❌ | `POST /scan/sessions` 收不了。要做成：DTO 增 `outputFormat: 'pdf'\|'jpeg'\|'pdf_ocr'`，由 Agent 消费；`pdf_ocr` 需要走 OCR 且必须在 `ai-down` 时能被探测为不可选（设计 07 已画了这个降级态） |
| `07` s2 参数（200/300/600dpi、黑白/灰度/彩色、送稿器/玻璃板、单双面） | 扫描参数 | **缺** | ❌ | 同上，`POST /scan/sessions` 一个都收不了。要做成：DTO 增 `{dpi:200\|300\|600, colorMode, source:'adf'\|'flatbed', duplex:'both'\|'one'}`，随 claim 下发给 Agent。**注意扫描侧「双面」与打印侧方向相反**：扫双面 = 页数翻倍 |
| `07` s3 进度 / s4 结果 | 轮询扫描结果 | `GET /scan/sessions/:id` + header `X-Scan-Session-Control` | ✅ | 返回 `{status, scanType, file:{fileId, filename, sizeBytes, mimeType, sha256, fileUrl}, errorCode, errorMessage, expiresAt}`；`fileUrl` 是 30 分钟签名 URL，**可直接喂给 `POST /print/jobs`** |
| `07`（Agent 侧）交付扫描件 | Agent 把扫好的文件送上来 | `POST /terminals/:terminalId/scan-sessions/deliver` | ✅ | 仅 Terminal Agent（`assertAgentAuthorized`），multipart，20MB 上限，内容 sha256 两小时去重防错配 |
| `07` s4「送 AI 简历诊断」 | 扫描件进简历诊断 | `POST /resume/parse` | ✅ | 见 §2 |
| `07` s4「拿去打印」 | 扫描件进打印链 | `POST /print/jobs`（用 `fileUrl`） | ✅ | |
| `07` s4「存进我的文档」 | 长期保存 | ⚠️ 无「转存」端点 | ⚠️ | 文件本身已经是 FileObject，**但未登录时它不属于任何人**，`GET /me/documents` 看不到。前端在未登录态点这个按钮**必须先过身份门**，否则就是伪造保存。可考虑后端补一个 `POST /files/:id/claim`（用 control token 换归属），属于 ❌，见 §11 |
| `07` 计费 | 扫描收不收钱 | 不收 | ✅ | `scan-tasks/` 全模块无任何 price/Order 代码；已定口径也是扫描按「扫描页」另起 key、当前不启用。设计 07「本屏不走纸」与后端一致 ✅ |

### 1.3 P08 文件加工台 / P39 打印域首屏

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `08` t1 图片转 PDF | 多图合成一份 PDF | `POST /print/convert/images-to-pdf` | ✅ | 匿名，3/min，`{sources:[{fileId, fileAccessUrl}]}` 1–20 张，可带 `Idempotency-Key`。返回 `{fileId, printFileUrl, fileMd5, sizeBytes, pages}` |
| `08` t1 版面参数（A4 / 每页 1·2·4 张 / 边距） | 合成版面控制 | **缺** | ❌ | 端点不收这三个参数。要做成：body 增 `layout:{paperSize:'A4', imagesPerPage:1\|2\|4, marginMm:0\|10\|20}`。A3 明确不支持（硬件限制），设计稿已把 A3 画成禁用 ✅ |
| `08` t2 手写签名 → 存成印章图 | 把画板上的签名变成文件 | `POST /files/kiosk-upload {purpose:'signature_image'}` | ✅ | `signature_image` 在白名单里，且被强制 `system_short` 保留（`retention-policy.ts:133-137`） |
| `08` t2 签章预检（这份文件几页） | 探测页数 | `POST /print/sign/inspect` | ✅ | `{terminalId, document:{fileId, fileAccessUrl}}` → `{pages}`。受 `signature_stamp` 能力门禁 |
| `08` t2「授权并合成」 | 把签名叠到 PDF 上 | `POST /print/sign/compose` | ✅ | `{terminalId, document, stamp, placement:{page, position(9 值), size:'small'\|'medium'\|'large'}, authorizationConfirmed:true}`。**`authorizationConfirmed` 必须为 true**（`@Equals(true)`）—— 与设计的「授权并合成」按钮语义一致 ✅。PDF ≤15MB、印章 ≤10MB |
| `08` t2 落款位 AI 建议 | 建议签在哪 | **缺** | ❌ | 没有落款位推荐端点。设计稿把它标成「只给参考」，前端可先用固定 9 宫格；要做真的，需一个 `POST /print/sign/suggest-placement {document}` → `{page, position, confidence, reason}` |
| `08` t3 证件照 | — | **缺** | ⏸ | 见 §1.5 |
| `39` 能力探测（八张能力卡的可用态） | 逐能力开关 | `GET /terminals/:terminalId/capabilities` | ⚠️ | 匿名可读，返回 10 个键。**该端点只认 `Terminal.id`**，而 `/config` 与 `/printer-status` 两者都认 `id` 或 `terminalCode` —— 前端要统一持有 `Terminal.id`。fail-closed 口径与设计 §0.2「读不到不得默认设备正常」一致 ✅ |
| `39` 设备在线 / 打印机状态 | device-off 态判定 | `GET /terminals/:terminalId/printer-status` | ✅ | 匿名。`isOnline` = 最近心跳 < 5 分钟。终端存在但没心跳返回 `isOnline:false` 而不是 404 |
| `39`「异常反馈」六选项 | 提工单 | `POST /me/feedback` | ⚠️ | **需会员登录**。`category` 只有四类 `device \| print \| file_process \| general`，设计的六个选项（没出纸/不清楚/扫描失败/文件没收到/收费退款/其他）要前端归并。`content` 必填 10–500 字。未登录点这个按钮必须先过身份门 |
| `39` AI 三条捷径（不知道用哪个 / 帮我检查文件 / 打印前隐私检查） | 意图分流 | `POST /assistant/chat` + `POST /materials/tasks` | ✅ | 前两条走 chat，第三条直接开 `pii_scan` 任务 |

### 1.4 P41 履约与异常八处境

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `41` pay-fail「重新付一次 / 换个付法」 | 重新出码 | `POST /orders/:id/pay` | ✅ | 换通道传不同 `channel` |
| `41` pay-pending「查询支付状态」 | 主动查单 | `POST /orders/:id/pay/reconcile` | ✅ | 设计稿写「不产生新扣款」，与后端「同一幂等入账路径」一致 ✅ |
| `41` pay-pending「转为待打印订单」 | 挂起等回执 | ⚠️ 惰性 | ⚠️ | 没有主动「转待打印」端点；订单本来就停在 `unpaid/paying`，到点惰性 `closed`。前端只能表述成「先离开，回来查」 |
| `41` refund-doing / refund-done / refund-fail | 退款进度 | `POST /admin/orders/:id/refund`（**仅管理员**） | ⚠️ | 一体机**不能发起退款**。源码原话：「仅 admin auth/role 放行，**绝不新增匿名/会员自助退款入口**」（`admin-order-actions.controller.ts:44`）。而且**只全额退**：金额强制 `order.amountCents - discountCents`，结算断言相等（`refund.service.ts:273,354`），`partial_refunded` 只是类型占位 —— **「按未出面数退款」后端不存在**。用户可见的退款状态可从 `GET /me/print-orders`.`payStatus`（`refunding/refunded`）与 `refundedAmountCents` 读到 ✅ |
| `41` 三处「打印退款凭条 / 回执 / 失败凭条」 | 把单号金额渲染成一张 A4 | **缺** | ❌ | 没有凭条渲染端点。要做成：`POST /orders/:id/receipt {kind:'refund'\|'paid'\|'refund_failed'}` → 与其他 `/print` 端点同形（`{fileId, filename, pageCount, printFileUrl}`），再由 `POST /print/jobs` 出纸。**必须免费**（设计已写「本机不收费」）—— 免费单走 `amountCents:0` 自动 paid 分支即可 |
| `41` supply「我关好了，继续打」 | 卡纸后续打剩余份数 | **缺** | ❌ | 见 buildout-spec「⑥」：同一 Order 下由工作人员授权 attempt 2，`complimentaryRetry=true`，**不重新付款、不重新报价、不再次核销权益**。接口 `POST /admin/orders/:orderId/print-resolution {printTaskId, expectedVersion, resolution:'authorize_reprint', operatorNote}` |
| `41` supply「改到另一台机器」 | 跨机续打 | **缺** | ❌ | 需要「凭取件码在另一台机重排」的能力：`POST /print/pickup/redeem {pickupCode, terminalId}` 校验后在新终端下建 attempt。约束：一次只能一台机认领（CAS）、原单不重复收费、取件码单次有效期内可重试 |
| `41` claim「确认认领」自助取件核销 | 输取件码 → 核销 → 出纸 | **缺**（`POST /print/jobs/claim-pickup` 不存在） | ❌ | ⚠️ **这条已经是线上的假接真**：生产 `apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx:44` 正在调这个不存在的路径。要做成：`POST /print/jobs/claim-pickup {pickupCode, terminalId}` → 校验码有效 + 订单 `paid` + 未退款 + 任务未终态 → CAS 置 `claimed` → 返回 `{taskId, orderId, status}`。**幂等**（同码重复提交返回同一结果）、**限流**（防爆破 10 位码）、**一次性**（认领后码作废） |
| `41` wrongdoc「立即上报 / 原样交回」 | 错件事故登记 | ⚠️ 只能落 `POST /me/feedback` | ⚠️ | 需登录，且没有「机位 + 时间 + 订单号」的结构化字段（只有 `terminalId` / `relatedPrintTaskId` 两个可选串）。要做成结构化上报见 §11 |

### 1.5 P29 证件照工作台

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `29` sA 本机当前状态（未开放） | 能力开关 | `GET /terminals/:id/capabilities`.`id_photo` | ✅ | 能力键有，状态默认 `not_verified` → 页面按未开放渲染。与设计一致 ✅ |
| `29` s2 规格体检 / s3 换底 / s4 A4 排版 / s4b 放进简历 / s5 送打印 | 证件照全流程 | **缺** | ❌ | 后端零实现。要做成三个端点：① `POST /id-photo/inspect {fileId}` → `{faceBox, headRatio, background, issues[]}`；② `POST /id-photo/compose {fileId, spec:'1in'\|'small1in'\|'2in'\|'small2in', background:'white'\|'blue'\|'red'}` → `{fileId, printFileUrl, pageCount}`（A4 排版含裁切线）；③ `POST /id-photo/embed {photoFileId, resumeFileId, position}` → 新简历文件。**约束**：换底是重绘背景、不修改人像五官（设计已写明），产物 `purpose` 必须落敏感级（对齐 `id_scan` 的 `system_short`） |

---

## §2 AI 简历服务（09 / 10 / 12 / 28 / 29 / 31 / 32 / 33）

> **贯穿事实：六个 `.../print` 端点全都只产出文件，不建打印任务、不建订单、不收钱。**
> 一律是「渲染 PDF → 建 FileObject → 回一个内部 HMAC `printFileUrl`」，
> 然后由 Kiosk 再调 `POST /print/jobs` 走收银链。源码里写得很清楚
> （`ai/resume/job-fit.service.ts:222`）。与设计「收钱与出纸的唯一通道是 P06」完全一致 ✅。

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `09` s1 上传简历 | 上传 | `POST /files/kiosk-upload {purpose:'resume_upload'}` | ✅ | |
| `09` s1「我的简历库」 | 取历史简历 | `GET /me/resumes` | ⚠️ | **返回的是 AI 结果记录行（`AiResumeResult` kind ∈ parse/generate），不是简历文件**。真正的文件在 `GET /me/documents`。设计 42「我的简历」画的是文件卡（打印/扫码带走/删除），要接两个端点拼 |
| `09` s2 解析 + 诊断 | 出四维 / ATS / 真实性诊断 | `POST /resume/parse` | ⚠️ | body `{fileId, fileName, fileFormat, source:'upload'\|'scan'\|'manual', selectedDimensions?, targetContext?}` —— **只收 fileId，不收原文**。返回 `{taskId, status, report{sections, suggestions, riskNotes, priorities}, extractionNotice, accessToken?}`。**是同步调用，没有 taskId 轮询**；设计 09 s2 画的是「正在解析」进度阶段，前端只能做本地等待动画，**不能显示假的分步进度** |
| `09` s2 OCR 置信度低 → 标需人工复核 | 低置信不出结论 | `extractionNotice.confidence` | ⚠️ | **口径冲突（重要）**：设计 README §五与 07 都写「OCR 置信度低 → 标注需人工复核，**不送 LLM**」；后端是**照送 LLM + 附一条 warning**（`resume-extraction.service.ts:311`）。硬失败只有 `OCR_NOT_CONFIGURED / OCR_FAILED`。扫描版 PDF 只 OCR 前 `OCR_PDF_MAX_PAGES`（默认 3）页。**必须二选一改**：要么后端加低置信熔断，要么前端把「不送 LLM」这句话删掉 —— 现在屏上写的是错的 |
| `09` s3 诊断结论 | 读回诊断 | `GET /resume/records/:taskId` | ✅ | 匿名要带 `x-resume-access-token`。结果 TTL `AI_RESUME_RESULT_TTL_HOURS` 默认 24 小时 |
| `09` s4 逐条优化 | 出改写建议 | `GET /resume/records/:taskId/optimize` | ⚠️ | **是 GET 但会触发生成**（无缓存时现场调 LLM 并重新抽取原文，`ai.service.ts:330-410`）。返回 `{modules:[{title, before, after}], optimizedResume}`。**没有逐条状态**：设计的「采纳 / 保留原文 / 换一版」三选一后端不接。前端要自己维护采纳集合，未采纳的回填 `before` |
| `09` s4「换一版」 | 同一条重新生成 | **缺** | ❌ | 要做成 `POST /resume/records/:taskId/optimize/:moduleIndex/regenerate` → 只回该条的新 `after`，并带 `attemptNo` 防止无限刷（限流 + 每条最多 N 次） |
| `09` s5 版本树 v1 原件 / v2 采纳 | 简历版本管理，永不覆盖原件 | **缺** | ❌ | 后端 `optimize` 只是同 `taskId` 下的另一行，**没有版本号、没有「不被覆盖」的机制保证**。要做成 `ResumeVersion{resumeId, versionNo, fromTaskId, fileObjectId, adoptedModulesJson, createdAt}` + `GET /me/resumes/:id/versions`。**红线**：只新增版本、永不覆盖原件（CLAUDE.md §四权限矩阵） |
| `09` s5 导出 PDF | 把 v2 导出成文件 | `POST /resume/generate/export` | ⚠️ | 该端点**只接受「访谈式生成」的 resume 结构**（`GeneratedResume`）。从 `parse + optimize` 出来的简历**没有对应的导出端点** —— 09 s5「导出 PDF · 存进我的文档」目前拿不到文件。要么后端让 export 接受 optimize 产物，要么前端把 optimize 结果整形成 `GeneratedResume` 再送 export |
| `09` s5「带去打印」 | 出纸 | `POST /print/jobs` | ✅ | 用 export 回的 `printFileUrl` |
| `09` s5「存进我的简历」 | 落到会员资产 | **缺** | ❌ | 没有「另存为我的简历」端点。AI 记录会自动落 `AiResumeResult`，但那不是简历文件。依赖上面的 `ResumeVersion` 模型 |
| `09` s5「发到我手机」 | 本机 → 手机下行 | **缺** | ❌ | `upload-sessions` **只做手机 → 本机**，没有反向通道。全站 6 处「发到我手机 / 扫码带走」都在等它。要做成 `POST /takeaway-sessions {fileId}` → `{sessionId, qrUrl, controlToken, expiresAt}`，手机扫码后凭一次性票据下载；**票据放 URL fragment 不放 query**（照 `member-data-export-download.service.ts:135` 的做法），TTL ≤10 分钟，单次有效 |
| `09` 版式重排（一页化 / 精简） | 排版调整 | `POST /resume/records/:taskId/layout-adjust` | ✅ | **后端有、09 没用上**，见 §10 |
| `10` 逐题访谈（可跳过 / 上一题 / 举个例子） | 有状态的问答会话 | `POST /resume/generate` | ⚠️ | 后端是**一次性整表提交**（basic/intention/education/experience/projects/skills/certificates/selfIntro），**没有会话态、没有逐题接口**。前端可以在本地把访谈跑完，最后一次性提交 —— 这条路可行，但屏上不能表现得像后端在逐题理解 |
| `10` 语音作答 | 语音转文字 | `POST /resume/voice/transcribe` | ✅ | **后端有、10 没用上**（10 只画了打字）。multipart 字段 `audio`，≤4MiB，**必须 RIFF/WAVE**（16k 单声道），非 WAV 直接 400 `INVALID_AUDIO_FORMAT`。转写结果**不落库、不写日志** |
| `10` s3 导出 / 打印 | 导出成品 | `POST /resume/generate/export` | ✅ | 支持 `pdf / docx / txt / md`；`templateId` 仅 PDF 生效；docx/txt/md 会**另渲一份干净 PDF** 并签它的 `printFileUrl` |
| `12` t1 求职信 | 生成求职信 | `POST /job-materials/generate` | ⚠️ | **需会员登录**（`EndUserAuthGuard`）。**纯确定性模板填充，无 LLM**，body 只有 `{templateId, applicantName, targetRole, targetOrganization?, keyStrengths?, notes?}` —— 设计的四个旋钮（务实/热情/正式、200/300/500 字、写不写抬头、换一版措辞）**一个都不接**。两条路：后端接 LLM，或前端撤掉旋钮 |
| `12` t2 自我介绍 | 生成自我介绍稿 + 小卡片 | **缺** | ❌ | `job-materials` 的五种类型里**没有 self_intro**（有 `resume_template / cover_letter / thank_you / portfolio_cover / materials_checklist`）。`POST /assistant/chat {skill:'self_intro_gen'}` 能出**文本**但出不了文件、打不了。要做成：给 `job-materials` 加 `self_intro` 模板（含「小卡片」版式），入参 `{scene:'fair'\|'interview', tone, lengthWords, mentionSalary:boolean}` |
| `12` t3 材料清单 | 出招聘会/办事材料清单 | `POST /job-materials/generate {templateId:'job-fair-checklist'}` | ⚠️ | 只有**招聘会**清单模板；设计 t3 还有「补贴申领 / 入职报到」两个场景，以及 21 政策页的「办事清单」—— 都没有模板。且**需登录** |
| `12` t4 简历模板 | 列模板 | `GET /job-materials/templates` | ✅ | **匿名可读**（与 `generate` 的登录要求不同） |
| `33` 模板库「带这个版式去简历优化」 | `templateId` 透传并生效 | `GET /job-materials/templates`（列表可用）；09 侧无消费点 | ⚠️ | 09 后端**不消费 `templateId`**（设计稿自己也注了这一点）。真正能吃 `templateId` 的只有 `POST /resume/generate/export`。前端应把版式选择一路带到导出那一步 |
| `28` 自我评估 s1 同意 + s2 作答 + s3 结果 | 25 题问卷 + 陈述式解读 | `POST /resume/self-assessment` | ✅ | 匿名可用。`{answers[], consent:{nonSensitive:true, sensitive}}`，`nonSensitive` 必须 true 否则 `SELF_ASSESSMENT_CONSENT_REQUIRED`。**答案原文不入库**（只存 `answersHash`）。合规拦截时返回 `status:'rejected'` 而不是编内容 ✅ |
| `28` s3「去打印工作台核价」 | 出倾向参考单 | `POST /resume/self-assessment/:taskId/print` | ✅ | `purpose:'self_assessment_report'`（刻意不用 `print_doc`，按敏感件处理）。回 `{fileId, printFileUrl, ...}` → 再走 `POST /print/jobs` |
| `28` 把评估附到简历后面 | 合并 PDF | `POST /resume/self-assessment/:taskId/append` | ⚠️ | 端点有，**但返回里缺 `printFileUrl`**（`appended-self-assessment.service.ts:135-142`），而 `/print/jobs` 只认内部 HMAC URL、不认 COS `signedUrl` —— **这条路的打印会断**。后端补一个字段即可 |
| `28` s4 往期记录 | 只列本人历次评估 | `GET /me/ai-records` | ⚠️ | **没有 kind 过滤参数**（只有 `cursor/pageSize`），要拉全量再前端筛 `kind==='self_assessment'`，而分页是 cursor 的 → 计数不准 |
| `28` 撤回 | 物理删除本次评估 | `DELETE /resume/self-assessment/:taskId` | ✅ | 物理清空 payload、保留审计行。与设计「24 小时可撤回、撤回即删」一致 ✅ |
| `31` 签约风险 s0–s4 | 上传 → 提取 → 确认 → 风险提示 → 报告 | `GET /contract-reviews/consent-scope` → `POST /contract-reviews` → 轮询 `GET /contract-reviews/:id` → `POST /contract-reviews/:id/confirm` → `POST /contract-reviews/:id/report` | ✅ | **全站唯一真异步（BullMQ）的 AI 流程**，11 个状态。`POST` 必须带 `{consentVersion, consentedAt, consentScopeHash, disclaimerVersion}` —— **同意哈希是必填请求字段**，这就是门控。`confirm` 的 `ocrCoverageConfirmed` 与 `personalUseConfirmed` 都是 `@Equals(true)`，与设计「五项知情同意全勾才放行」同源 ✅ |
| `31` 报告删除 / 取消并删除 | 两种删除 | `DELETE /contract-reviews/reports/:fileId`（凭 `x-contract-review-report-abandon-token`）/ `DELETE /contract-reviews/:id` | ✅ | 前者废弃报告文件，后者废弃整个任务并硬清 |
| `31` FAQ 常见签约问题 | 静态问答 | `POST /assistant/chat` 或前端静态 | ⏸ | 无专用端点；设计稿本就是静态问答卡 |
| `11` s1 挑岗位 | 从岗位库选 / 手填 | `GET /jobs`（选）或 body 里的 `manualJob` | ✅ | |
| `11` s2 逐条比对 | 三档参考 + 逐项证据 | `POST /resume/job-fit` | ✅ | `{taskId, jobId? \| manualJob?{title, requirements}}`。输出 `fitLevel: reference_high\|reference_medium\|reference_low` + `matchPoints[{requirement, point, evidence}]` + `gapPoints`。**服务端双重拦截百分比**：违禁词表 + 正则 `/\d{1,3}\s*%/`，命中就重试一次再诚实失败（`llm-job-fit.service.ts:17-20,104-113`）。`evidence` 必须是简历原文的规范化子串，否则该条被丢弃 —— 合规红线在后端已经落死 ✅ |
| `11` 匿名同意 | 未登录也能用，但要单独同意 | `POST /resume/job-fit/consent` / `GET` / `DELETE /resume/job-fit/consent/:taskId` | ✅ | **这三个端点只接匿名**：带 `Bearer` 直接拒（`ANONYMOUS_CONSENT_TOKEN_REQUIRED`）。会员走 `me/ai-consents` 的 `job_ai` scope |
| `11` s3 多岗并排对比（3 个） | 一次比多个岗位 | **缺** | ❌ | 设计稿自己已注明「没有多岗接口」并把该区降级成静态占位 ✅ 口径诚实。要做成 `POST /resume/job-fit/batch {taskId, jobIds:[≤3]}` → 每岗一份 `JobFitPayload` + 一份横向对照（**只能是逐项 有/无，不得出任何排名分数或百分比**） |
| `11` s4「带走报告」 | 出决策报告 PDF | `POST /resume/job-fit/:taskId/print` | ⚠️ | 有，但返回**缺 `signedUrl` / `expiresAt`**（只回 `printFileUrl`），与其余五个 print 端点不一致。够用，但前端要单独处理 |
| `32` 简历域首屏三条分诊 | 纯前端分流，不调接口 | 无需端点 | ✅ | |

---

## §3 岗位与企业（11 / 13 / 14 / 15 / 16 / 34 / 35 / 44）

> **合规前提**：岗位只做第三方 / 官方来源信息入口。后端也是这样建的
> —— 没有任何投递、收简历、筛选、邀约、Offer 端点，`sourceUrl` 是唯一出口。✅

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `13` 岗位列表 | 分页列岗位 | `GET /jobs` | ✅ | 匿名。`{data[], pagination{page,pageSize,total,totalPages}}`，固定按 `syncTime desc` |
| `13` 筛选面板（25 项：类型/方向/地区/行业/薪资/经验/学历/来源…） | 多维筛选 | `GET /jobs` 的 7 个 query | ⚠️ | 后端只有 `keyword / city / industry / category / workType / sourceOrgId / tag`。**薪资、经验、学历、来源渠道、排序全部没有**（`salaryMin/Max` 是返回字段不是筛选字段）。`city` 是**精确等值**不是模糊；`industry` 实际是 `tagsJson` 里 `行业:X` 的字符串匹配。前端先只放能生效的筛选，其余待后端补（见 §11） |
| `13` AI 收敛 / 三档推荐 | 按简历收敛岗位 | `POST /jobs/ai/recommendations` | ⚠️ | **实际是会员限定**：内部用 `parse.endUserId` 去查 `job_ai` 同意，匿名（null）恒抛 403 `USER_AI_CONSENT_REQUIRED`。13 是匿名浏览页 —— 前端要么先过身份门，要么把这块降级成非 AI 排序。另有日限流：会员 20 / 终端 100 / IP 60，超限 429 `JOB_AI_QUOTA_EXCEEDED` |
| `13`「打印岗位清单」 | 把当前筛选结果渲染成 A4 | **缺** | ❌ | 没有岗位清单 PDF 端点。要做成 `POST /jobs/print-list {jobIds:[≤N]}` 或 `{filters}` → `{fileId, printFileUrl, pageCount}`，同其它 print 端点形态。**必须逐条带来源机构 / 同步时间 / 外部 ID**（合规） |
| `14` 岗位详情 | 详情 + 来源三件套 | `GET /jobs/:id` | ✅ | 返回含 `sourceName / syncTime / externalId / sourceUrl / dataSourceNote`。**查不到返回 `200 + data:null`，不是 404** |
| `14`「扫码投递」 | 出来源平台的二维码 | 前端把 `sourceUrl` 编码成二维码 | ⚠️ | **后端不生成二维码，也没有短链**。前端自己画码即可（零外部依赖要求下不能用 CDN 库）。文案继续用白名单：「扫码投递 / 去来源平台投递」 |
| `14`「去来源平台投递」离站确认 | 打点 | `POST /activity/external-jump {targetType:'job', action:'external_apply'}` | ⚠️ | **未登录返回 `200 {recorded:false, reason:'LOGIN_REQUIRED'}` 且一条都不写**（`activity.controller.ts:82`，公共终端隐私刻意如此）。设计 36/38 已写「未登录 0 条」✅。`targetType` 五值：`job / job_fair / policy / company_profile / fair_company`；action 与 target 必须匹配否则 400 |
| `14` 岗位 AI 解读 | 讲清这条岗位 | `POST /jobs/:id/ai/explain` | ⚠️ | **会员限定 + `job_ai` 同意**（`assertMemberAiRequester`）。同上，14 是匿名页 |
| `14`「打印岗位信息」 | 单条岗位渲染成 A4 | **缺** | ❌ | 同 13 的清单端点，可合并成一个 `POST /jobs/print {jobIds}` |
| `15` 企业列表 + 筛选 | 找企业 | `GET /companies` | ⚠️ | **cursor 分页**（与 jobs 的 page 分页不同）。8 个筛选 `keyword/province/city/district/companyType/industry/recruitType/sourceKind`，**非法枚举值直接 400**。**列表项缺 `externalId / syncTime / sourceUrl`**（只有 `sourceName`）—— 合规要求列表卡至少「来源机构 + 同步时间」，**同步时间在列表里拿不到** |
| `15` 企业详情 | 详情 + 指标开关 | `GET /companies/:id` | ✅ | 含完整来源三件套。`metrics` 是稀疏对象，按 Admin 四个开关（`showOpenJobCount/showCity/showEmployeeScale/showBoothNo`）决定有哪些键 —— 前端**按键存在与否渲染**，不要假设字段齐全。未发布 → 404 |
| `15` 企业在招岗位 | 列该企业岗位 | `GET /companies/:id/jobs` | ⚠️ | cursor 分页；**列表项缺 `syncTime`** |
| `15` 筛选面板选项来源 | 地区/行业/类型下拉 | `GET /companies/filters` + `GET /companies/stats` | ✅ | **后端有、设计没用上**，见 §10。`filters` 已标 deprecated 但仍可用 |
| `15` / `16`「收藏」这家企业 / 这家机构 | 收藏 | ❌ 类型不支持 | ❌ | `FAVORITE_TARGET_TYPES` 只有 `job / job_fair / policy`（`member-favorites/dto/add-favorite.dto.ts:5`），非法值 400。要做成：把 `company_profile` 与 `offline_agency` 加入枚举，并补对应的「已审核+已发布」校验分支（`member-favorites.service.ts:22-43`）。注意浏览日志的 target 集合更宽（含 `company_profile / fair_company`），两处枚举需要对齐 |
| `16` 线下机构列表 | 列机构 | `GET /kiosk/offline-agencies` | ⚠️ | query `district / orgType / keyword / service / page / pageSize`。**`service` 筛选是分页后在内存里过滤，并把 `total` 改成当前页长度**（`offline-agencies.service.ts:111-120`）—— 一用这个筛选，分页和计数就都是错的。这是后端 bug。另外列表项**没有 `sourceName` / `sourceUrl`** |
| `16` 机构详情 | 详情 + 岗位 | `GET /kiosk/offline-agencies/:id` | ⚠️ | 未发布 404。外部 ID 用的是 `orgCode`（= `externalId \|\| sourceOrgId \|\| id`），**字段名与 jobs/companies 不一致**。`jobs[]` 全量内联不分页 |
| `16` 线下岗位详情 | 详情 | `GET /kiosk/offline-jobs/:id`（`44` 页） | ⚠️ | 返回**裸 Prisma 行 + 嵌套 agency**，不是规整 DTO。外部入口字段叫 `externalUrl` |
| `16`「到店问题清单」AI 生成 | 生成到店要问什么 | **缺** | ❌ | 要做成 `POST /kiosk/offline-agencies/:id/visit-questions {resumeTaskId?}` → `{questions[], checklist[]}` + 一个 print 端点。**红线**：只能是「到店要问什么」，不得表述成代办、代排队、资格认定 |
| `16` / `44`「打印机构与路线 / 岗位与路线 / 到店问题清单」 | 三种清单渲染 | **缺** | ❌ | 同 §11 的「清单类 PDF 渲染」一条统一做 |
| `34` 岗位域首屏四个类型入口 | 带 `jobType` 深链 | `GET /jobs?category=` | ⚠️ | 设计传 `jobType=all\|fulltime\|intern\|parttime`，后端参数名是 `category`（且 `category` 优先于 `workType`）。前端映射即可 |
| `35` 线上平台扫码 | 四个平台静态二维码 | 无需端点（前端静态） | ⏸ | 设计稿本身就是静态平台码，无需后端。若要做成后台可配，需一个 `GET /kiosk/online-platforms` |
| `13`/`34`/`36`/`38`「浏览记录 / 外部跳转记录」入口 | 明细归位到业务页 | `GET /me/browse-logs` / `GET /me/external-jump-logs` | ✅ | 见 §7 |

---

## §4 招聘会与校园（17 / 18 / 19 / 36 / 45 / 46）

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `36` 第一屏「城市 + 日期 + 方向」筛选 | 按城市/日期/方向筛场次 | `GET /job-fairs` | ⚠️ | **后端只有 `status / page / pageSize / terminalId` 四个参数** —— 城市、日期范围、方向、主题**一个都没有**。（`fair.types.ts:114-120` 里有一个声明了 `theme/city/startAfter` 的 `FairListQuery`，但**没有任何路由用它**。）36 的第一屏目前接不上 |
| `36` / `17` s1 场次列表 | 列场次 | `GET /job-fairs` | ⚠️ | **`status` 是分页之后在内存里过滤的**（`jobs-kiosk.service.ts:176-181`）→ `pagination.total` 是未过滤的总数、每页条数会短。后端 bug，前端不能拿 `total` 当真 |
| `17` s1 场次详情 | 一次拿场次+企业+分区 | `GET /job-fairs/:id/detail` | ✅ | **后端有、设计没用上**：一次返回 `{fair, companies[], zones[]}`，17 现在要发三次请求。见 §10 |
| `17` s2 参会企业 | 列企业 | `GET /job-fairs/:id/companies` + `/:companyId` | ✅ | `page/pageSize`，按 `jobsCount desc`。**没有关键词/行业/展区筛选** |
| `17` s3 / `45` 场馆导览图 | 展位图 | `GET /job-fairs/:id/map` | ⚠️ | 返回 `{mapImageUrl, zones[], booths[]}`，**`booths` 恒为空数组**（后端没有展位模型）。屏上不能画出展位方块 |
| `17` s3 / `45` 展区列表 | 分区 chip | `GET /job-fairs/:id/zones` | ✅ | 扁平 zone 列表 |
| `17` s3 场馆导览（更细） | 展厅 / 展位号 / 服务设施 | `GET /job-fairs/:id/venue-guide` | ✅ | **后端有、设计没用上**：`{venueName, halls[{hallCode, hallName, industryCategory, boothRange, companies[{companyName, boothNo, jobTitles[]}]}], facilities[{type:'entrance'\|'serviceDesk'\|'printPoint'\|'consulting', name, locationLabel}]}`。**这才是能画出真实展位与「打印点在哪」的数据面**，比 `/map` 丰富得多。未配置时返回 null。见 §10 |
| `17` s4 AI 作战单 / 准备单 | 按简历排逛展顺序 | `POST /job-fairs/:fairId/visit-plan/:taskId` | ⚠️ | **`:taskId` 必须是一个已有的简历 parse taskId** —— 没上传过简历就出不了准备单。设计 17 s4 没有画这个前置。前端要么先引导做简历，要么这块要后端支持「无简历的通用准备单」 |
| `17` s4「带去打印：作战单 + 简历」 | 出准备单 PDF | `POST /job-fairs/:fairId/visit-plan/:taskId/print` | ✅ | 文件 only，再走 `POST /print/jobs`。**注意设计按钮上写的是「作战单 1 份 + 简历 6 份 共 13 页」—— 这是两个文件，而 `/print/jobs` 一次只收一个文件**，必须拆成两单或先合成一份 PDF |
| `17`「入场签到」 | 签到 | `fair.checkinUrl` + `POST /activity/external-jump {action:'external_checkin_open'}` | ⚠️ | 全库无任何签到写入端点（已逐字搜过 `checkin/check-in/签到`）。**平台内签到本就不做**（合规：只做第三方入口）。可做的只有：把 `checkinUrl` 画成二维码让用户手机扫 + 打一条外部跳转日志（**需登录才记**）。屏上不得出现「已签到」 |
| `17`「去来源平台预约 / 扫码预约」 | 外部预约入口 | `fair.sourceUrl` / `checkinUrl` | ✅ | 文案继续用白名单 |
| `17` s4 / `45` stats 现场数据 | 规模与签到进度 | `GET /job-fairs/:id/stats` | ⚠️ | **`checkedInCompanies / browseCount / scanCount / printCount / checkinCount` 恒 `null`，`zoneBreakdown` 恒 `[]`**（`jobs-kiosk.service.ts:314-321`）。真实的只有 `totalCompanies / totalPositions / totalHeadcount / industryDistribution / expectedAttendance / seekerIntent`，且带 `dataSourceLabel:'主办方录入数据 · 非实时'`。**前端必须按 null 走「主办方未提供」，不能显示 0** |
| `45` 活动资料列表 | 主办方会刊/名录 | `GET /job-fairs/:id/materials` | ✅ | 项含 `allowPrint / pageCount / previewUrl(签名短期)` |
| `45`「打印已选资料」 | 拿到可打印文件 | `POST /job-fairs/:id/materials/:materialId/print-url` | ✅ | **匿名**，5/min/IP。返回 `{fileId, filename, pageCount, printFileUrl}`。门禁：material 已发布 + `allowPrint` + 所属 fair 已审核已发布 |
| `45`「打印展位企业岗位清单」 | 企业档案/岗位表渲染 | `POST /job-fairs/:id/companies/:companyId/print-url?variant=profile\|positions` | ✅ | 匿名，5/min。现渲 PDF，1 小时 TTL。`variant=positions` 且无岗位 → 404 `FAIR_COMPANY_NO_POSITIONS` |
| `45`「打印图与顺序」 | 展位图 + 逛展顺序 | **缺** | ❌ | 没有把导览图 + 用户排的顺序渲染成 A4 的端点。要做成 `POST /job-fairs/:id/route/print {companyIds[]}` → `{fileId, printFileUrl, pageCount}`；顺序由客户端给、**内容由服务端按 venue-guide 渲染**（不能让客户端塞任意文本） |
| `18` 校园招聘专区 | 校招场次 | 复用 `GET /job-fairs` | ⚠️ | `FairTheme` 里有 `campus / campus_corp`，**但 `theme` 不是可筛参数**。可用的替代：`GET /jobs?category=campus`，或靠 `terminalId` 让 `school_employment_center` 机构的场次排前（`jobs-kiosk.service.ts:85-97`） |
| `18` s3「生成计划表 / 活动清单」 | 两周活动计划表 | **缺** | ❌ | 没有校招计划表端点。最接近的是 `visit-plan`（但那是单场招聘会的准备单）。要做成 `POST /campus/plan {fairIds[], resumeTaskId?}` → `{timeline[], checklist[]}` + print 端点 |
| `19` 智慧校园锁定态 | 未接入时如实说 | `GET /terminals/:terminalId/smart-campus` | ✅ | 未开通**恒返回 200 `{enabled:false, modules:{welcome:false,bigdata:false,luggage:false,panorama:false}, items:[]}`**，不是 404。与设计的锁定态一致 ✅。**注意**：未知终端、终端禁用、无配置、配置关闭四种情况返回体完全相同，前端区分不了 |
| `46` 校园服务（迎新 / 校园卡 / 大数据） | 三块内容 | `GET /terminals/:terminalId/config`.`smartCampus.items` | ⚠️ | 内容靠 toolbox item 下发（`{key,title,description,icon,to,launchMode,externalUrl,qrImageUrl}`），**没有「迎新四步 / 办卡材料」这种结构化内容模型**。设计稿把窗口位置写成「本机未配置，以现场服务台为准」是对的 ✅ |
| `46`「打印报到清单 / 办卡清单」 | 清单渲染 | **缺** | ❌ | 归入 §11 的「清单类 PDF 渲染」统一做 |

---

## §5 政策服务（21 / 38）

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `38` 四个分类入口（就业/社保/档案/补贴） | 按分类筛政策 | `GET /policies?category=` | ⚠️ | query 只有 `kind / audience / category` 三个，**且公开 GET 不校验取值** —— 打错一个字静默返回空列表（`policies.service.ts:100-102`）。合法值：`kind ∈ policy_guide\|notice`、`audience ∈ graduate\|flexible\|migrant\|hardship\|startup\|general`、`category ∈ policy\|announcement\|notice\|recruitment`。**注意后端的 `category` 四值与设计的四个分类（就业/社保/档案/补贴）不是同一套分类轴** —— 设计的分类在后端没有对应字段 |
| `21` 政策列表 / 翻页 | 分页 | `GET /policies` | ⚠️ | **完全没有分页**，硬 `take: 200`（`policies.service.ts:96-106`）。也**没有关键词搜索**。21 页脚「看全部 N 条」只能在这 200 条里做 |
| `21` s2 政策原文 | 详情 | `GET /policies` 的列表项自带 `content`（≤10000 字） | ⚠️ | **没有 `GET /policies/:id`**。43 与 38 的深链 `?policyId=p1` 只能拉全量再前端找 —— 一旦超过 200 条就找不到了。要做成 `GET /policies/:id`，见 §11 |
| `21` 政策来源三件套 | 来源机构/同步时间/外部 ID | `GET /policies` 的 `sourceOrgId`/`sourceName`/`syncTime` | ⚠️ | `PolicyPostDto` 有 `sourceOrgId / sourceName / syncTime`，**缺 `externalId` 和 `sourceUrl`**（外部入口字段叫 `externalUrl`）。合规要求详情页展示外部 ID —— 政策详情这一项目前给不出 |
| `21` s1→s2「看我卡在哪」条件对照 | 按用户情况核对政策条件、列缺口 | **缺** | ❌ | 后端零实现。要做成 `POST /policies/:id/eligibility-check {city, identity, insuredStatus, unemploymentRegistered, insuredMonths, graduationYear, ...}` → `{items:[{condition, status:'met'\|'unmet'\|'unknown', basis}], gaps[], nextSteps[]}`。**硬约束**：允许「不确定」，结论标「待确认」；**绝不能表述成资格认定或代办**（本公司无人力资源服务许可证）；不与人社系统打通 |
| `21` s3「生成办事清单」 | 按事项列材料清单 | **缺** | ❌ | `job-materials` 只有招聘会清单模板。要做成 `POST /policies/:id/checklist` → `{items[{name, required, note, source}]}` + 一个 print 端点 |
| `21` s3「去打印 · 清单 1 份 + 原文 2 份」 | 把政策原文渲染成 PDF | **缺** | ❌ | 政策 `content` 是纯文本字段，**没有把它渲成 A4 的端点** —— 没有文件就调不了 `/print/jobs`。要做成 `POST /policies/print {policyIds[], includeChecklist:boolean}` → `{fileId, printFileUrl, pageCount}` |
| `21` 官方热线 / 官网二维码 | 站点级官方渠道配置 | **缺** | ❌ | 见 §11 的「站点配置下发面」（`hotline` / `officialSiteUrl` 按城市下发） |
| `38` 政策收藏 | 收藏政策 | `POST /me/favorites {targetType:'policy'}` | ✅ | 需登录；目标必须已审核已发布否则 404 |
| `38` AI 政策问答 | 问答 | `POST /assistant/chat` | ✅ | 匿名可用 |

---

## §6 权益与活动（24）

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `24` s1「现在能用什么」券列表 | 列本人权益 | `GET /me/benefits` | ⚠️ | **需登录**，cursor 分页。每项 `{id, benefitType, title, description, quantityTotal, quantityRemaining, status, sourceType, validFrom, validUntil, createdAt}`。**没有 `applicableScopes / maxBillableUnits / colorScope`**（24 屏上要显示的适用范围与上限全部无来源）。补齐见 buildout-spec「① 四道闸」 |
| `24` 券状态「可用 / 已用完 / 已过期」 | 实时有效状态 | `GET /me/benefits`.`status`（库里存的那个值） | ⚠️ | **`status` 原样返回数据库值，读时不算过期**（`member-benefits.service.ts:65`，`list()` 里没有任何 `validUntil vs now` 比较）。于是会出现「列表显示可用、核销时被判过期」的断层 —— 设计 24 与 06 已经把这句话写在屏上 ✅ 口径诚实。**但前端仍必须自己比 `validUntil` 才能显示诚实的「已过期」**。补齐见 buildout-spec「③ 月度周期余额」的 `effectiveStatus` 同步计算（第 285–295 行） |
| `24` 券余量「余 1 / 3 次」 | 剩余次数 | `quantityRemaining / quantityTotal` | ⚠️ | 有，但**没有月度周期**，不会到月清零，也没有「本月已用 / 下月 1 日恢复」的数据。补齐见 buildout-spec `BenefitPeriodBalance` + `GET /me/benefits` 新增 `balance{periodKey,total,remaining,reserved,available,nextResetAt}`；**前端展示 `available`，不要自己算 `remaining - reserved`** |
| `24` 活动列表（后台配了 N 项） | 列可领活动 | `GET /activities` | ⚠️ | **匿名可读**（`OptionalEndUserAuthGuard`）。query 只有 `source?`。**没有分页**，硬 `take: 100` |
| `24` 活动详情 | 详情 | `GET /activities/:id` | ✅ | 只回已发布且在有效期内的，否则 404。**`claimable / claimed / soldOut / ended` 四个布尔是服务端读时算好的**（与 `/me/benefits` 相反）—— 前端直接渲染即可，见 §10 |
| `24`「领取」 | 领券 | `POST /activities/:id/claim` | ⚠️ | **需登录**，无 body。幂等靠 DB 唯一索引 `@@unique([activityId, endUserId])` → 409 `BENEFIT_ACTIVITY_ALREADY_CLAIMED`。**`claimLimitPerUser` 虽然在响应里，但创建时恒写 1 且 claim 时根本不读** —— 实际每人每活动只能领一次。不要做「限领 3 次」的 UI |
| `24` s3「已有与用掉的」流水 | 核销流水 | `GET /me/benefits/redemptions` | ✅ | `{id, kind, benefitRef, serviceType, serviceRefId, orderId, amountCents, quantity, createdAt}`。设计的「第 2 次免单 · 省 1.20 元」正好对应 `amountCents` ✅ |
| `24`「政策资格参考」独立分栏 | info-only 不可核销 | `benefitType='subsidy_eligibility_hint'` | ✅ | 后端类型存在，且核销白名单**明确排除**它（`REDEEMABLE_BENEFIT_TYPES`，`benefit-redemption.types.ts:11`）→ 拿它核销直接 `BENEFIT_NOT_REDEEMABLE`。与设计「不是券、不能核销、也没有金额」完全一致 ✅ |
| `24`「本机还没拉到 / 一项都没配」两种空态 | 区分失败与空 | HTTP 失败 vs 空数组 | ✅ | 前端按响应区分即可 |
| `24` 本机不认识的新 benefitType（降级显示） | 未知类型不猜用法 | 前端兜底 | ✅ | 后端不会拒绝未知类型的展示；设计的降级卡是对的 ✅ |
| `24` s2「这一项怎么用」的适用范围说明 | 服务端下发适用范围 | **缺** | ❌ | 同四道闸三字段。**在补齐前，屏上不得列出看起来像产品规则的固定清单** —— 设计稿已经写了「适用范围由后台配置下发」✅ |
| `24` → `06`「去打印」 | 带券去打印 | 见 §1.1 | ⚠️ | 注意 06 的用券要登录（redeem 是会员端点） |

---

## §7 我的 / 账户 / 记录（03 / 05 / 23 / 42 / 43）

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `03` s2 手机号 + 验证码登录 | 短信登录 | `POST /member/auth/sms-code` → `POST /member/auth/login` | ⚠️ | **`login` 必须带 `termsVersion` 与 `privacyVersion`**，服务端会比对当前生效版本，不一致 400 `LEGAL_VERSION_STALE`（`member-auth.service.ts:190-207`）→ **前端必须先取 `GET /kiosk/legal/:type` 拿版本号**。限流分层：IP 5/min、同号 60 秒冷却、单号 10/天、IP 20/时、设备 20/时；验证码 5 分钟、最多 5 次 |
| `03` s1 扫码登录 | 二维码登录 | `POST /member/auth/qr/create` → 手机 `GET /:ticketId/status` + `POST /:ticketId/confirm` → 本机 `POST /:ticketId/claim` | ⚠️ | **`create` 与 `claim` 需要终端令牌**（`x-terminal-id` + 终端 Bearer，`member-qr-login.service.ts:214-220`）—— Kiosk 前端必须能拿到终端凭据，这在设计稿里没有体现。**TTL 180 秒**（设计只写了「换一个码」没写时长）。`claimToken` 只回给本机、**不进二维码**；确认不延长 TTL；claim 单次有效 |
| `03` 游客「先不登录」 | 跳过身份门继续用 | 无需端点（匿名本就是默认态） | ✅ | 纯前端 |
| `05` 手机接力（手机 → 本机） | 传文件 | `POST /upload-sessions` 三步 | ⚠️ | QR TTL 10 分钟硬编码（设计写 5 分钟），见 §1.1 |
| `05`「在手机上完成登录」 | 手机端确认登录 | `POST /member/auth/qr/:ticketId/confirm` | ✅ | 号码不出现在大屏上，与设计意图一致 ✅ |
| `05`「存到手机 / 发到我手机」（本机 → 手机） | 下行取件 | **缺** | ❌ | 见 §2 里 `09 s5` 那条的规格。**这一条影响 09/10/12/16/20/21/22/28/42/43 共 10+ 处出口** |
| `23` 我的 · 七个「数量 + 路牌」 | 七个计数 | `GET /me/resumes` / `/me/documents` / `/me/print-orders` / `/me/favorites` / `/me/ai-records` / `/me/benefits` / `/me/notifications` | ⚠️ | 前六个的 `total` 可用 ✅。**第七个不行**：`/me/notifications` 的 `total` 是当前页长度、`nextCursor` 恒 `null`（`member-notifications.service.ts:76,80`）—— **不能当收件箱计数**。可用的真计数只有 `unreadCount`。设计 23 写的是「7 条通知 · 2 条未读」，其中「7 条」拿不到 |
| `23`「退出登录」 | 登出 | `POST /member/auth/logout` | ✅ | 删 Redis 会话，JWT 立即失效 |
| `23` 账号设置 · 文件保存期限 | 改保留策略 | `PATCH /files/:id/retention` | ⚠️ | 只能**逐文件**改（`months_3 / months_6 / long_term`，后两者要 `consentVersion`）。设计画的是一个账号级总设置 —— **后端没有账号级默认**。两条路：前端改成「在文档列表里逐份设置」，或后端补 `PATCH /me/preferences {defaultRetentionPolicy}` |
| `23` 隐私与删除 | 删简历/文档 | `DELETE /files/:id` / `DELETE /me/resumes/:id` / `DELETE /me/ai-records/:id` | ✅ | 都写审计。注意 `DELETE /me/ai-records/:id` 删 `parse` 行会**级联删同 taskId 的全部 AI 结果 + JobAiSession**（`member-assets.service.ts:205-215`）—— 确认弹窗必须说清 |
| `23`「结束并清空」 | 清本次会话 | **缺** | ❌ | 见 §9 会话那一节 |
| `42` 我的简历（v1/v2/v3 版本卡） | 版本列表 | `GET /me/resumes` + `GET /me/documents` | ⚠️ | 见 §2「版本树」。目前只能列「AI 记录行」与「文件行」两个不同集合，拼不出设计的版本树 |
| `42` 我的文档 | 文档列表 | `GET /me/documents` | ✅ | 项含 `purpose / sensitiveLevel / assetCategory / retentionPolicy / allowedRetentionPolicies / expiresAt / downloadUrlPath / previewUrlPath`。**只给路径不给 URL** —— 要再调 `GET /files/:id/download-url`（需登录）换签名 URL |
| `42` 文档三类计数（一般 / 敏感 / 已到期） | 分类计数 | `GET /me/documents`（无分类参数） | ⚠️ | 无分类查询参数，只能全量拉再前端分。cursor 分页下计数不准 |
| `42` 打印订单列表 | 订单 | `GET /me/print-orders` | ✅ | 项含 `status(PrintTask 状态) / amountCents / payStatus / paymentSource / billablePages / billingPageSource / pickupCode(门控) / refundedAmountCents / discountCents / fileName / copies / colorMode / paperSize`。**不含 fileUrl、不含错误码** |
| `42` 订单四个筛选 chip（已完成/进行中/已取消/失败） | 按状态筛 | `GET /me/print-orders`（无 status 参数） | ⚠️ | 无 `status` query，只能全量拉再前端过滤，cursor 分页下计数不准。要做成 `GET /me/print-orders?status=` |
| `42`「看进度」 | 单任务状态 | `GET /print/jobs/:taskId` | ✅ | |
| `42`「再打一份 / 重新下单」 | 复打 | `POST /print/jobs` | ⚠️ | **需要原文件仍在**（文件有 TTL）。若文件已清理，前端必须如实说「文件已过期，请重新上传」，不能直接跳核价 |
| `43` AI 服务记录 | 历次 AI 调用 | `GET /me/ai-records` | ⚠️ | 七种 kind：`parse / optimize / generate / job_fit / career_plan / fair_visit_plan / self_assessment`。**没有 kind 过滤参数**，43 的五个 chip（简历类/岗位类/面试类/规划与参会/处理中）要全量拉再前端分。**面试记录不在这里** —— 走 `GET /me/mock-interviews` |
| `43` 我的收藏 | 收藏 | `GET /me/favorites?type=` | ✅ | `type ∈ job\|job_fair\|policy`。设计 43 的 chip 里有「企业 0」—— 企业收藏后端不支持（见 §3） |
| `43` 浏览与跳转足迹 | 足迹 | `GET /me/browse-logs` / `GET /me/external-jump-logs` | ✅ | 支持 `targetType` 过滤 ✅；单条可删。项含 `targetTitle / sourceName / sourceUrl / externalId`，**这些都是服务端从已发布目标反查的，客户端伪造不了** ✅。保留 `ACTIVITY_LOG_TTL_DAYS` 默认 30 天 |
| `43` 足迹「投递结果 0」 | 不记投递结果 | 后端不存在 | ✅ | 合规一致 ✅ —— 后端只有 `browse` 与 `external_jump` 两种日志，没有投递结果模型 |
| `43` 通知与反馈 | 通知 | `GET /me/notifications?unreadOnly=` + `PATCH .../read` + `PATCH /read-all` + `DELETE` | ⚠️ | 功能可用，但**分页是假的**（见上）。四个 chip（全部/未读/打印/文件/设备告警）里只有「未读」有服务端支持 |
| `43` 反馈工单 | 提单 / 追加 / 关闭 | `GET /me/feedback` / `POST /me/feedback` / `GET /:id` / `POST /:id/replies` / `PATCH /:id/close` | ✅ | 四类 category，见 §1.3 |
| `43`「用 AI 起草这段反馈」 | 起草 | `POST /assistant/chat` | ✅ | |

---

## §8 助手与顾问（20 / 22 / 25 / 26 / 27 / 37）

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `25` 小青文字对话 | 对话 | `POST /assistant/chat` | ⚠️ | **完全匿名**、**非流式**（普通 `@Post` 返 JSON，无 SSE）→ 前端只能做阻塞式等待，不能做逐字流。body `{message(≤2000), sessionId?, skill?, context?}` —— **没有 `history` 字段**，多轮全靠客户端回传同一个 `sessionId`。返回 `{sessionId, reply, intent?, actions:[{label, route}]}`，**不裹 `ApiResponse`**。无端点级限流（只有全局 60/min/IP），也无配额 |
| `25` 语音咨询（按住说话） | 实时语音 | `POST /trtc/session` / `POST /trtc/session/stop` | ⚠️ | 需 `X-Terminal-Id`（**只做存在性检查，不验签**）。5/min/IP。返回 `{sdkAppId, userId, userSig, roomId, taskId}`。**未配置腾讯云密钥时抛 500，而不是干净的「未开通」信号** → 前端要么做能力探测，要么把这里的 500 当作「语音不可用」处理 |
| `25`「钉到托盘」 | 收藏对话要点 | **缺** | ❌ | 纯前端会话内即可，但若要跨页保留需要 `POST /me/pins`。优先级低 |
| `25` / `26`「打印钉住的要点 / 已完成的部分」 | 把对话要点渲染成 A4 | **缺** | ❌ | 没有「把 assistant 输出渲染成 PDF」的端点。要做成 `POST /assistant/sessions/:sessionId/print {messageIds[]}` → `{fileId, printFileUrl, pageCount}`。**必须带 AIGC 标识**（设计 §3 硬约束：AI 生成的打印件每页恰好一次可见标识 + 文件元数据标识）|
| `26` A 问答型 / B 填槽型 / C 比对型 | 三种作业面 | `POST /assistant/chat {skill}` | ⚠️ | 11 个 skill：`offer_compare / salary_negotiation / hr_qa / self_intro_gen / material_checklist / jd_analysis / interview_questions / career_explore / cover_letter_gen / resume_jd_match / company_research`。**B 填槽型的「答第 3 问」后端没有槽位状态机** —— 前端要自己维护已填/未填，把上下文塞进 `context` |
| `26`「按这个方案办」 | 深链跳转 | `actions:[{label, route}]` | ✅ | 后端会返回可跳路由 ✅ |
| `27` 百宝箱条目 | 后台上架的扩展条目 | `GET /terminals/:terminalId/config`.`toolbox` | ✅ | `{enabled, items:[{key,title,description,icon,to,disabled,sortOrder,placements,launchMode:'internal_route'\|'external_url'\|'qr_code'\|'mini_program_qr',externalUrl,qrImageUrl,qrTargetUrl}]}`。设计 27 的「未配置就是未配置、不摆假条目」与 `enabled:false + items:[]` 一致 ✅ |
| `27` 打开外部条目的四段埋点 | 运营事件 | `POST /terminals/:terminalId/toolbox-events` | ✅ | 匿名，60/min。`{itemKey, action:'show_qr'\|'open_external_notice'\|'open_external_confirmed'\|'cancel_external', placement?}`。**标题与域名由服务端反查**，客户端伪造不了 ✅ |
| `20` 面试设置 → 开始 | 建会话 | `POST /mock-interviews` + `POST /:id/start` | ✅ | `{interviewerType:'hr'\|'manager'\|'tech'\|'campus'\|'final', industry, position, experience, difficulty:'easy'\|'standard'\|'pressure', durationMin:3\|5\|8, resumeFileId?, interactionMode:'text'\|'voice'}` —— 与设计 s1 的五组选择**几乎一一对应** ✅。匿名 TTL 2 小时、会员 7 天 |
| `20` 语音能力探测 | 能不能语音 | `GET /mock-interviews/capabilities/voice` | ✅ | 返回 `{asrEnabled, ttsEnabled}`。无鉴权、无同意要求，**进页面就能探测** ✅ |
| `20` 逐题作答 / 跳过 / 上一题 | 答题 | `POST /mock-interviews/:id/answer` | ✅ | |
| `20` 按住说话 | 语音答题 | `POST /mock-interviews/:id/transcribe` | ✅ | multipart `audio`，12/min |
| `20` 朗读题目 | TTS | `POST /mock-interviews/:id/turns/:idx/audio` | ✅ | **后端有、20 没用上**，见 §10 |
| `20` s3 点评 / s4 复盘单 | 报告 | `POST /:id/end` → `GET /:id/report` → `POST /:id/report/print` | ✅ | 报告 `overall.level ∈ needs_work\|pass\|good\|excellent`，prompt 里明写「不是通过率」✅ 合规。print 出文件 → 再走 `/print/jobs` |
| `20` / `37` 历史报告 | 只列本人 | `GET /me/mock-interviews` | ⚠️ | **快照把它误写成 `GET /mock-interviews`**，见 §13。会员限定 |
| `22` s1 现状 → s2 方向与缺口 | 职业规划 | `POST /resume/career-plan/:taskId` | ⚠️ | **`:taskId` 必须是已有的简历 parse taskId** —— 22 s1「你现在会什么」若没有简历就跑不起来。会自动叠加同 task 的 job-fit、最近一次面试报告、最近一次自我评估作为上下文 ✅ |
| `22` s3「带走行动清单」 | 出规划单 | `POST /resume/career-plan/:taskId/print` | ✅ | 出文件（源码注释说「进打印订单」是**过时注释**，代码并不建订单） |
| `22` ai-down 降级「只看岗位计数表」 | 数岗位要求条数 | **缺** | ❌ | 没有「本机读过的岗位正文里某类要求出现多少条」的统计端点。要做成 `GET /jobs/requirement-counts?category=&city=` → `{items:[{requirement, count, sampleJobIds[]}], scannedJobCount, syncedAt}`。**必须是原文计数，不是模型判断**（这正是该降级态的价值：E1/E2 不依赖 AI） |
| `37` 面试域首屏三条分诊 | 纯前端分流，不调接口 | 无需端点 | ✅ | |
| `37`「行业薪资参考」 | 同方向岗位薪资区间 | `GET /jobs` 的 `salaryMin/Max` 字段 | ⚠️ | 字段返回了但**不能按薪资筛选、也没有聚合端点**。设计写的是「来源方原文转录，不预测你个人能拿多少」✅ 合规，但要做出「区间分布」得前端自己聚合本页数据 |
| `37`「面试技巧 · 建设中」 | 技巧内容 | **缺** | ⏸ | 设计已标「建设中」并禁用 ✅。要做需要一个内容模型（可复用 toolbox item 或新建 `GET /kiosk/interview-tips`） |

---

## §9 设备与会话（01 / 02 / 04 / 40）

| 页面·动作 | 需要的能力 | 对应端点 | 状态 | 备注 |
|---|---|---|---|---|
| `01` 八磁贴的可用态 | 能力 + 后台开关 | `GET /terminals/:id/capabilities` + `GET /terminals/:id/config` | ✅ | 百宝箱与智慧校园两个磁贴按 `config.toolbox.enabled` / `config.smartCampus.enabled` 决定显不显示（设计口径「后台开关未开启不显示」）✅ |
| `01` 设备离线态 | device-off 判定 | `GET /terminals/:id/printer-status`.`isOnline` | ✅ | 心跳 5 分钟窗口 |
| `01` 意图台「说处境 → 排出办理顺序」 | 把处境翻译成任务链 | `POST /assistant/chat` | ⚠️ | 能拿到 `intent`（封闭集）与 `actions:[{label,route}]`，**但没有办理单（Errand）模型** —— `errandId / goalText / steps[] / assets[] / status` 后端全无。屏上的「本次办理单 #E-7742」目前是编的。两条路：前端把它降级成本地会话号并注明「本机编号」，或后端补 Errand 模型（见 §11） |
| `02` 待机轮播内容 | 广告 / 精选内容 | `GET /terminals/:terminalId/screensaver` | ⚠️ | **注意别接错**：快照里的 `GET /kiosk/screensaver-content` 是**空壳桩**，恒返回 `{data:[]}`（`screensaver/screensaver.controller.ts:3-8`，Service 是空类）。真的在 `content/content.controller.ts` 的 `GET /terminals/:terminalId/screensaver` |
| `02` 离线缓存 | 断网可播 | 前端 | ✅ | 设计要求零外部依赖 ✅ |
| `04` s1 帮助 | 帮助内容 | `GET /kiosk/help` | ⚠️ | **空壳桩**：恒返回 `{data:[]}`，**不接任何参数**（`help/help.controller.ts:3-8`）。接了就是永远空白页。要么后端补内容模型，要么前端用本地内容并注明 |
| `04` s2 法务文本 | 隐私政策 / 服务条款 / AI 声明 | `GET /kiosk/legal/:type` | ⚠️ | 四个合法值：`privacy_policy / terms_of_service / ai_disclaimer / contract_review_disclaimer`。**非法 type 不报错，静默回 `terms_of_service`**（`legal.controller.ts:11-13`）—— 前端拿到的可能是错的文档而不是错误。返回含 `version`，**登录流程要用这个版本号**（见 §7 的 03） |
| `04` s2「扫码存全文」 | 把法务全文带走 | **缺** | ❌ | 同「本机 → 手机下行通道」 |
| `04` s3 会话超时 / `40` 六个会话处境 | 服务端会话钟 | `POST /kiosk/session/heartbeat` / `POST /kiosk/session/extend` | ❌ | **两个都是空壳**：整个 controller 14 行，恒返回 `{ok:true}`，`KioskSessionService` 是空类且没被注入（`kiosk-session/kiosk-session.controller.ts:1-14`）。**服务端零会话状态、零超时**。40 的六个处境（无操作预警 / 超时锁屏 / 会话接管 / 结束并清空 / 断电恢复 / 遗留物）后端一个都不支撑。要做成：`POST /kiosk/sessions` 建会话 → `POST /kiosk/sessions/:id/heartbeat` → `POST /kiosk/sessions/:id/extend` → `POST /kiosk/sessions/:id/end {reason}`；服务端持有 `hintSec/graceSec` 并在超时时**吊销该会话签发的所有一次性 token**（这才是公共终端隐私清场的真正落点，光靠前端计时不成立） |
| `04` s5「接着上次做」会话恢复 | 恢复未完成办理单 | `GET /me/pending-tasks` | ⚠️ | **W0 已核实端点存在**：受 `EndUserAuthGuard` 保护，只回本人的可续办打印支付/进度任务，且不返回 fileUrl。它不是通用 Errand/AI/upload-session 恢复接口；设计稿要表达后者时仍需另行建设，不能把现有打印恢复误报成完整办理单。 |
| `40` handover 会话接管（换人） | 通知另一台机结束会话 | **缺** | ❌ | 依赖上面的会话模型：`POST /kiosk/sessions/:id/takeover {newTerminalId}` → 旧会话立即 end + 清 token |
| `40` recover 断电恢复 | 恢复到第 3 步 | **缺** | ❌ | 同上，需要服务端记住「进行到哪一步」。可与 `OrderQuote`（buildout-spec）合并考虑：报价快照本身就是「进行到哪一步」的可信载体 |
| `40` leftover 遗留物「呼叫服务台」 | 现场求助 | **缺** | ❌ | 要做成 `POST /kiosk/service-calls {terminalId, reason, relatedOrderId?}` → 落告警中心（`GET /admin/alerts` 已有读侧）。当前只能落 `POST /me/feedback`（需登录，不合适） |
| `01`/`04` 站点信息（机号 / 场馆 / 服务台 / 客服电话 / 城市） | 站点配置下发 | **缺** | ❌ | `GET /terminals/:id/config` 只回 `smartCampus` + `toolbox` + `configVersion` + `refreshIntervalMs` + `serverTime`（`terminals-admin.service.ts:622-641`），**没有任何站点文案字段**。设计 §4C 列的 `serviceDeskLocation / serviceHours / supportPhone / venueName / terminalNo / cityCode / officialSiteUrl / hotline` 一个都没有。要做成 `config` 增一个 `site:{...}` 段；**缺配置时返回空串而不是示例值**，前端照兜底文案渲染（设计稿的 `FALLBACK` 已经写好了） |

---

## §10 后端有、设计稿没用上

> 这些是现成能力，Codex 不用重造。按「接上去价值最高」排序。

| # | 端点 / 能力 | 该给哪一页用 | 为什么值得接 |
|---|---|---|---|
| 1 | `GET /job-fairs/:id/venue-guide` | `17` s3、`45` map | 比 `/map` 丰富得多：展厅、展位号、每家企业的岗位标题、以及 `facilities` 里的 `printPoint / serviceDesk / entrance / consulting`。**`/map` 的 `booths` 恒空，画不出展位；venue-guide 才画得出** |
| 2 | `GET /job-fairs/:id/detail` | `17` s1→s2 | 一次返回 `{fair, companies[], zones[]}`，省掉三次请求 |
| 3 | `POST /resume/records/:taskId/layout-adjust` | `09` s5 | 一页化 / 精简重排。会重新抽取原文做防伪基线，比前端排版可信 |
| 4 | `POST /resume/voice/transcribe` | `10` 访谈式生成 | 20 面试舱已经在用同一套 ASR，10 完全可以支持语音答题（一体机站立场景打字很痛苦） |
| 5 | `POST /resume/generate/export` 的 `docx / txt / md` + `templateId` | `10` s3、`33` 模板库 | 设计只画了 PDF；`templateId` 是 33「带这个版式走」唯一真能生效的地方 |
| 6 | `POST /mock-interviews/:id/turns/:idx/audio`（TTS） | `20` s2 | 朗读题目，配合 `capabilities/voice.ttsEnabled` |
| 7 | `GET /companies/filters` + `GET /companies/stats` | `15` 筛选面板与顶部指标 | 筛选选项与四个计数由后端下发，避免前端写死枚举 |
| 8 | `GET /me/job-ai-sessions` + `DELETE /me/job-ai-sessions/:id` | `43` AI 服务记录 · 岗位类 | 岗位 AI 记录的独立明细与逐条删除 |
| 9 | `PATCH /files/:id/retention` + 返回里的 `allowedRetentionPolicies` | `42` 文档卡、`23` 账号设置 | 「保存期限」可以做成真的可改，而不是只读文案 |
| 10 | `GET /me/data-requests` + `POST /me/data-requests` + `POST /me/data-requests/:id/download-authorizations` + `GET /member/data-exports/:id/content` | `23` 隐私与删除 | **个人数据导出整条链后端已具备**（含 step-up 二次验证、一次性票据放 URL fragment）。23 只画了删除，没画导出 |
| 11 | `POST /member/auth/step-up/sms-code` + `/verify` | `23` 敏感动作 | 四个动作已定义：`export_data_request / export_data_download / close_account / phone_rebind`。改绑手机、导出数据必须过这一关 |
| 12 | `POST /member/phone/rebind` | `23` 账号设置 · 登录方式 | 改绑后**全部旧会话被吊销**，前端要清 token |
| 13 | `GET /me/ai-consents/status` + `POST /me/ai-consents` + `POST /me/ai-consents/:scope/revoke` | `23` 隐私、`11`/`14` 会员侧同意 | 两个 scope：`job_ai`、`contract_review`。**撤回 `contract_review` 会连带取消在途合同任务** |
| 14 | `GET /files/:id/preview-url` | `42` 文档预览 | 与 download 分开的预览签名 URL |
| 15 | `POST /materials/tasks {kind:'normalize_a4'}` | `08` 文件加工台 | 现成的「统一成 A4」能力，08 只用了转 PDF 和签章 |
| 16 | `GET /activities/:id` 的 `claimable / claimed / soldOut / ended` | `24` | 四个布尔是服务端读时算好的，前端直接渲染，不用自己判 |
| 17 | `POST /materials/tasks {kind:'inspection'}` | `39` 的「帮我检查这份文件能不能打」 | 39 的三条 AI 捷径里第二条可以直接接 |
| 18 | `GET /admin/alerts`、`GET /admin/print-scan/tasks`、`GET /admin/device-fleet/overview` | — | 运维侧读面已具备，一体机不用，但 40/41 的「已上报运维」文案有真实落点 |

---

## §11 待 Codex 开发清单（所有 ❌ 汇总）

> **设计稿画了而后端没有的，不是设计稿的错误，是这份表存在的理由。**
> 每条尽量写清「要做成什么样」。凡涉及打印 / 权益 / 计价的，**一律引用
> `docs/reviews/2026-08-11-backend-buildout-spec.md` 的对应小节，不另出方案**。

### A. 上线阻塞（不做会资损、会伪造能力、或线上已在假接真）

| # | 缺什么 | 等它的页面 | 要做成什么样 |
|---|---|---|---|
| A1 | **四道闸结构化规则** | `06` s4、`24` s1/s2 | buildout-spec **「① 四道闸结构化规则」**：新建 `BenefitRuleVersion`（`scenarioKeysJson / maxBillableQuantity=10 / allowedColorModesJson=["bw"] / periodType=monthly + periodQuota`），`BenefitActivity` 与 `BenefitGrant` 各加 `ruleVersionId`。判定必须**逐张券返回原因码**而不是一个布尔；全有或全无，任一闸失败整单原价、不扣次数、不补差 |
| A2 | **服务端场景溯源** | `06` s4（四道闸①的判定输入）、全站 20+ 处「带去打印」 | buildout-spec **「② 服务端场景溯源」**：新建 `FileProvenance`（与 FileObject 一对一、写后不可改），字段 `scenarioKey / provenanceType / sourceRefType / sourceRefId / contentHash`。四种推导：招聘会资料 bridge → `verified_material`；AI 生成 → `system_generated`；本机扫描 → `scan_declared`；用户上传 → `user_declared`。**客户端不得提交 `scenarioKey / provenanceType / sourceRefId / 是否符合免费条件`**；`purpose`、`from`、URL 参数保留兼容但不进资格判断 |
| A3 | **报价锁价（`quoteId` / `expiresAt` / `priceVersionId`）** | `06` s3→s4「后台刚调价」那一屏 | buildout-spec **「价格版本」+「报价快照」+「报价接口」**：新建 `PriceVersion` 与 `OrderQuote`，移除 `PriceConfig.serviceKey @unique`；报价改成 `POST /orders/quotes`（带 `Idempotency-Key`），建单改成 `POST /print-jobs {quoteId}`。**在这之前，屏上不能承诺「你看到的就是你要付的」**（设计稿已按此写好那一屏 ✅） |
| A4 | **权益预占** | `06` s4→s5 之间 | buildout-spec **「权益预占」**：`BenefitReservation`（`quoteId @unique`、`held/committed/released`、`version` CAS）。预占只加 `quantityReserved`，提交时才 `quantityRemaining -= 1` 并建 `RedemptionRecord`。**两台终端争最后一次额度，最多一台成功** |
| A5 | **月度周期余额 + 有效状态** | `24` s1、`06` s4 | buildout-spec **「③ 月度周期余额」**：`BenefitPeriodBalance`（`@@unique([benefitGrantId, periodKey])`，`Asia/Shanghai` 自然月，`[startsAt, endsAt)`，不结转，月中首领发整月 N 次）。`GET /me/benefits` 增 `balance{total, remaining, reserved, available, nextResetAt}` 与 `effectiveStatus`（**读时同步计算，不靠午夜 cron**） |
| A6 | **止血：现有 `/orders/:id/redeem` 不得再按任意 Grant 整单免** | `06` s4 | buildout-spec **「迁移与灰度 · 第一阶段」第 1 条**：对打印订单默认拒绝，最终只接受**已提交的 Reservation**。历史 Grant 无法证明规则的返回 `BENEFIT_RULE_MISSING`，暂不可核销 |
| A7 | **履约判定与失败补偿** | `06` s6 六处境、`41` 全八屏 | buildout-spec **「⑥ 履约判定与失败补偿」**：`PrintTask` 增 `orderId / attemptNo / retryOfTaskId / complimentaryRetry / dispatchStage / outputOutcome / outputOutcomeSource / outcomeEvidenceJson`；新建 `PrintExceptionCase` 与 `RedemptionAdjustment`；`Order` 增 `fulfillmentStatus`。工作人员接口 `POST /admin/orders/:orderId/print-resolution`。**W0 已核实** Agent 对队列未出现/超时/非 Windows 已 fail-closed 为 `PRINT_JOB_UNCONFIRMED`；本项要补的是可审计履约语义、补偿与 Windows 真机证据，不重复修复旧误报完成结论。 |
| A8 | **自助取件核销端点** | `41` claim「确认认领」 | `POST /print/jobs/claim-pickup {pickupCode, terminalId}` → 校验码有效 + 订单 `paid` + 未退款 + 任务未终态 → CAS 置 `claimed` → `{taskId, orderId, status}`。**幂等**（同码重提返回同一结果）、**强限流**（10 位码要防爆破）、**单次有效**（认领后作废）。⚠️ 生产 `apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx:44` **已经在调这个不存在的路径** |
| A9 | **PII 遮盖产物** | `06` s2「遮住这一处再继续」 | `POST /materials/tasks {kind:'pii_redact'}` 目前 `redactedFileId` 恒 `null`（`materials.service.ts:617-634`）。要真的产出一份打了码的新 FileObject 并回 `redactedFileId + printFileUrl`，否则 s2→s3 断链 |
| A10 | **服务端会话钟** | `04` s3、`40` 六处境 | `POST /kiosk/sessions` / `:id/heartbeat` / `:id/extend` / `:id/end`。服务端持 `hintSec/graceSec`，**超时时吊销该会话签发的全部一次性 token**（`x-resume-access-token`、`X-Upload-Session-Control`、`X-Scan-Session-Control`、`x-payment-session-token`）。公共终端的隐私清场只靠前端计时不成立 |
| A11 | **通用办理单恢复** | `04` s5 会话恢复 | ⚠️ `GET /me/pending-tasks` **已存在且已接打印恢复**；当前只返回本人的可续办打印任务。若 V3 需要跨 AI/上传/其他办理单的统一恢复，应在 Errand 模型成立后扩展，不能重复建设同名端点。 |
| A12 | **站点配置下发面** | `01` / `02` / `04` / `21` / `39` / `41` 全站 | `GET /terminals/:id/config` 增 `site:{terminalNo, venueName, cityCode, serviceDeskLocation, serviceHours, supportPhone, peerTerminal, hotline, officialSiteUrl}`。**缺配置返回空串，不返回示例值** —— 前端已有兜底文案（`scripts/site-config.js` 的 `FALLBACK`） |

### B. 可后做（不阻塞出纸与收钱，但页面要靠它才完整）

| # | 缺什么 | 等它的页面 | 要做成什么样 |
|---|---|---|---|
| B1 | **本机 → 手机下行取件通道** | `05` / `09` / `10` / `12` / `16` / `20` / `21` / `22` / `28` / `42` / `43` / `04`（10+ 处「发到我手机 / 扫码带走」） | `POST /takeaway-sessions {fileId}` → `{sessionId, qrUrl, controlToken, expiresAt}`；手机扫码后凭一次性票据下载。**票据放 URL fragment 不放 query**（照 `member-data-export-download.service.ts:135`），TTL ≤10 分钟，单次有效，下载后立即失效 |
| B2 | **清单类 PDF 渲染（8 处共用）** | `13` 岗位清单、`14` 岗位信息、`15` 企业与岗位信息、`16`/`44` 机构与路线 / 到店问题清单、`21` 政策要点与办事清单、`45` 展位图与顺序、`46` 报到 / 办卡清单 | **建议做成一个统一端点**而不是八个：`POST /print-renders {kind, refIds[], options}` → `{fileId, filename, pageCount, printFileUrl}`。`kind` 枚举与设计稿的 `kind=` 参数对齐（`job-list / policy-checklist / fair-plan / material / assessment-sheet / interview-sheet / resume-report / jobfit-report / contract-report / id-photo-sheet / template`）。**内容一律服务端渲染**，客户端只给 ID 与选项，不能塞任意文本；**第三方条目必须逐条带来源机构 / 同步时间 / 外部 ID**；**AI 生成内容每页恰好一次 AIGC 标识** |
| B3 | **扫描参数** | `07` s1/s2 | `POST /scan/sessions` DTO 增 `{outputFormat:'pdf'\|'jpeg'\|'pdf_ocr', dpi:200\|300\|600, colorMode:'bw'\|'gray'\|'color', source:'adf'\|'flatbed', duplex:'both'\|'one'}`，随 claim 下发给 Agent。`pdf_ocr` 在 OCR 不可用时必须能被探测为不可选 |
| B4 | **岗位筛选补齐** | `13` 25 项筛选 | `GET /jobs` 增 `salaryMin / salaryMax / experience / education / sourceKind / sort`；`city` 支持省市区三级；`industry` 从 `tagsJson` 字符串匹配改成正式字段 |
| B5 | **招聘会筛选** | `36` 第一屏、`17` s1、`18` | `GET /job-fairs` 增 `city / theme / startAfter / startBefore / keyword`；**并修掉 `status` 分页后内存过滤的 bug**（`jobs-kiosk.service.ts:176-181`） |
| B6 | **`GET /policies/:id` + 分页 + 关键词** | `21` / `38` / `43` 深链 | 现在硬 `take:200` 且无详情端点，`?policyId=` 深链超过 200 条就找不到 |
| B7 | **政策条件对照 + 办事清单** | `21` s2 / s3 | `POST /policies/:id/eligibility-check` → 逐条 `met/unmet/unknown` + 依据；`POST /policies/:id/checklist` → 材料清单。**允许「不确定」，结论标「待确认」；绝不表述成资格认定或代办**（本公司无人力资源服务许可证） |
| B8 | **简历版本模型** | `09` s5、`42` 我的简历 | `ResumeVersion{resumeId, versionNo, fromTaskId, fileObjectId, adoptedModulesJson}` + `GET /me/resumes/:id/versions`。**只新增版本、永不覆盖原件** |
| B9 | **`optimize` 产物的导出** | `09` s5「导出 PDF」 | 让 `POST /resume/generate/export` 接受 optimize 产物，或新增 `POST /resume/records/:taskId/export` |
| B10 | **逐条「换一版」** | `09` s4 | `POST /resume/records/:taskId/optimize/:moduleIndex/regenerate` → 只回该条新 `after`，带 `attemptNo` 与每条上限 |
| B11 | **多岗对比** | `11` s3 | `POST /resume/job-fit/batch {taskId, jobIds:[≤3]}`。**横向对照只能是逐项「有/无」，不得出排名分数或百分比** |
| B12 | **自我介绍模板** | `12` t2 | 给 `job-materials` 加 `self_intro` 类型（含「小卡片」版式），入参 `{scene:'fair'\|'interview', tone, lengthWords, mentionSalary}` |
| B13 | **`job-materials` 接 LLM 或撤旋钮** | `12` t1 | 现在是确定性模板，设计的四个旋钮全落空。两条路二选一，别留着按不动的旋钮 |
| B14 | **`/me/*` 列表的过滤参数** | `42` 订单 4 chip、`43` AI 记录 5 chip、`42` 文档 3 chip | `GET /me/print-orders?status=`、`GET /me/ai-records?kind=`、`GET /me/documents?sensitiveLevel=&expired=`。现在只能全量拉再前端筛，而分页是 cursor 的 → 计数一定不准 |
| B15 | **通知的真分页与真计数** | `23` 数量卡、`43` notice | `nextCursor` 恒 null、`total` 是当前页长度（`member-notifications.service.ts:76,80`）。需要合并流的复合 keyset 游标 |
| B16 | **收藏支持企业与线下机构** | `15` / `16` / `43` | `FAVORITE_TARGET_TYPES` 增 `company_profile`、`offline_agency`，并补对应的「已审核+已发布」校验分支。注意与浏览日志的 `ACTIVITY_TARGET_TYPES` 对齐 |
| B17 | **招聘会真实统计** | `17` / `45` stats | `checkedInCompanies / browseCount / scanCount / printCount / checkinCount` 恒 null。在补齐前**前端必须按 null 显示「主办方未提供」，不能显示 0** |
| B18 | **证件照全流程** | `29` 七阶段、`08` t3、`46` | `POST /id-photo/inspect` / `/compose` / `/embed`，见 §1.5。**换底是重绘背景、不修改人像**；产物按敏感件保留 |
| B19 | **U 盘文件面** | `06` s1 | 由 Agent 推成 FileObject，Kiosk 凭 control token 取。**绝不让浏览器直接读本地盘** |
| B20 | **凭条 / 回执渲染** | `41` 三处 | `POST /orders/:id/receipt {kind}` → 同其它 print 端点形态。**必须免费**（走 0 元单自动 paid 分支） |
| B21 | **跨机续打** | `41` supply | `POST /print/pickup/redeem {pickupCode, terminalId}` → 新终端下建 attempt。一次只能一台机认领（CAS），原单不重复收费 |
| B22 | **现场服务呼叫** | `40` leftover、`41` refund-fail / wrongdoc | `POST /kiosk/service-calls {terminalId, reason, relatedOrderId?}` → 落告警中心（读侧 `GET /admin/alerts` 已有）。当前只能落需登录的 `POST /me/feedback`，不合适 |
| B23 | **办理单（Errand）模型** | `01` 意图台、`04` s5、`40` recover | `{errandId, intent(封闭集 7), goalText, steps[], assets[], context, advice, status}`。在它落地前，屏上的「#E-7742」应降级成本地会话号并注明。可与 A3 的 `OrderQuote` 合并考虑 —— 报价快照本身就是「进行到哪一步」的可信载体 |
| B24 | **校招计划表** | `18` s3 | `POST /campus/plan {fairIds[], resumeTaskId?}` → `{timeline[], checklist[]}` + print |
| B25 | **岗位要求原文计数** | `22` ai-down 降级 | `GET /jobs/requirement-counts` → `{items:[{requirement, count, sampleJobIds[]}], scannedJobCount, syncedAt}`。**必须是原文计数不是模型判断** —— 这正是该降级态的价值 |
| B26 | **到店问题清单生成** | `16` detail | `POST /kiosk/offline-agencies/:id/visit-questions` → `{questions[], checklist[]}`。**只能是「到店要问什么」，不得表述成代办 / 代排队 / 资格认定** |
| B27 | **助手输出打印** | `25` / `26` | `POST /assistant/sessions/:sessionId/print {messageIds[]}`。**必须带 AIGC 标识**（每页恰好一次 + 文件元数据） |
| B28 | **落款位建议** | `08` t2 | `POST /print/sign/suggest-placement` → `{page, position, confidence, reason}` |
| B29 | **08 合成版面参数** | `08` t1 | `POST /print/convert/images-to-pdf` body 增 `layout:{paperSize:'A4', imagesPerPage:1\|2\|4, marginMm}` |
| B30 | **`/append` 补 `printFileUrl`** | `28` 附到简历 | 一个字段的事：`appended-self-assessment.service.ts:135-142` 缺 `printFileUrl`，而 `/print/jobs` 只认内部 HMAC URL → 这条打印链是断的 |
| B31 | **匿名文件认领** | `07` s4 / `08` / `09` 的「存进我的文档」 | `POST /files/:id/claim`（用 control token 换归属）。在它之前，未登录点「存进我的文档」**必须先过身份门**，否则是伪造保存 |
| B32 | **帮助内容模型** | `04` s1 | `GET /kiosk/help` 是空壳桩。要么补内容模型，要么前端用本地内容并注明 |
| B33 | **面试技巧内容** | `37` | 设计已标「建设中」并禁用 ✅。要做需要一个内容模型 |
| B34 | **`GET /kiosk/legal/:type` 非法值应报错** | `04` s2 | 现在静默回落到 `terms_of_service`（`legal.controller.ts:11-13`）—— 前端拿到错文档却不知道 |

### C. 本期不排期（写清为什么）

| # | 项 | 为什么本期不排 |
|---|---|---|
| C1 | **打印会员 / 订阅** | buildout-spec **「④ 打印会员/订阅」**判为 **P2 建议不做**：「每月 N 次」由 `BenefitGrant + BenefitPeriodBalance` 已经解决，**不需要 Membership**。现在做会额外引入购买、续费、退款、已用权益退费、订阅争议，却不解决本轮的资损与履约问题。入口继续隐藏，最小模型规格已备（`MembershipPlan/Subscription/Term`），需要时再启 |
| C2 | **AI 计价与收费** | buildout-spec **「⑤ AI 计价与用量账本」**判为 **P1 先 shadow**：先建 `AiUsageLedger + AiUsageAttempt` 做**影子计量**，`BillingReadiness` 门禁到 `enforced` 之前**不得播种任何生产 `ai_*` PriceConfig**。没有账本、退款与对账闭环就定价，会把现有免费能力直接变成新的资损入口。**在此之前 AI 继续免费**，页面不得出现 AI 次数扣费 |
| C3 | **独立资金账本（政府出资）** | buildout-spec **「政府出资的额外边界」**判为**条件性 P0**：只有真的有政府资金结算才做（`FundingProgram/Reservation/Settlement/Adjustment`）。**没有该账本就不得把免单称为政府补贴** —— 24 页已经据此删掉了「本机按页向人社结算」那句话 ✅，替换文案待产品所有者拿到合同证据后再定 |
| C4 | **终端差异价** | buildout-spec「价格版本」：P0 只允许 `scopeType=global`。现在没有采购方 / 出资方 / 商业归属模型，**不应仅凭 `Terminal.orgId` 假装支持终端差异价** |
| C5 | **复印 / 扫描收费闭环** | 已定口径：复印按「张」、扫描按「扫描页」，**将来另起 serviceKey**，不复用 `print_bw_page`。当前既无任务模型也无价目，且不是本轮上线阻塞 |
| C6 | **部分抵扣 / 抵扣叠加** | 后端 `@@unique([serviceType, serviceRefId])` + `REDEEM_REQUIRES_FULL_COVERAGE` 双重挡着。要做需先补五条（见 `backend-contract-pricing-benefits.md` §六），且与「一单一权益」冲突需一并决定。**在五条齐备前，屏上不得出现「已抵扣 X 元、还需付 Y 元」** |
| C7 | **平台内签到写入** | 合规：招聘会只做第三方 / 官方来源信息入口。只做 `checkinUrl` 二维码 + 外部跳转打点 |
| C8 | **未登录也记浏览 / 跳转** | 后端为公共终端隐私**刻意不记**（`activity.service.ts:21-22`）。设计 36/38 的「未登录 0 条」是对的，保持 |
| C9 | **一体机自助退款** | 后端明写「绝不新增匿名 / 会员自助退款入口」。走服务台 + `POST /admin/orders/:id/refund`。**且只全额退，无「按未出面数退」** —— 41 的相关文案要按此收口 |
| C10 | **线上平台入口后台化** | `35` 现为静态四码，够用。要做成后台可配需 `GET /kiosk/online-platforms` + Admin 管理面，优先级低于上面全部 |

---

## §12 口径不符清单（所有 ⚠️）

> 端点存在 ≠ 能用。下面每条写清**差在哪**与**建议改哪边**。

| # | 项 | 设计怎么写 | 后端实际 | 建议改哪边 |
|---|---|---|---|---|
| 1 | **免单券语义** | 四道闸全满足 → 整单免 + 扣 1 | `discountCents = order.amountCents`，**不分品类、无上限、不看色彩、不看场景**（`benefit-redemption.service.ts:152-160`） | **改后端**（A1–A6）。在补齐前**立即止血**：`/orders/:id/redeem` 对打印订单默认拒绝 |
| 2 | **核销需要登录** | `06` s4 只在「未认领身份」处境提登录，其余处境看起来匿名可用 | `POST /orders/:id/redeem` 是类级 `EndUserAuthGuard`，匿名 401 | **改前端**：任何要用券的分支都先过身份门；`NEEDS_IDENTITY` 原因码要覆盖全部匿名场景 |
| 3 | **报价不锁价** | 设计已诚实标注「本机不锁价、确认下单时服务端重算」✅ | 确实不锁：`quotePrint` 无 quoteId/expiresAt，`effectiveFrom` 不被读（`pricing.service.ts:24`），`serviceKey @unique` 存不下两份价 | 口径一致 ✅。**改后端**补 A3 后可以把这段话换成「已锁价至 XX:XX」 |
| 4 | **手机接力二维码有效期** | `site-config.js` `handoffQrSec: 300`（5 分钟） | `SESSION_TTL_SECONDS = 600` 硬编码（`upload-sessions.service.ts:87`） | **改前端**：读服务端返回的 `expiresAt`，不要用本地常量 |
| 5 | **会话钟** | 3 分钟提示 / 4 分钟清空，且写着「唯一真源」 | 服务端**零会话状态**（`kiosk-session` 空壳） | 前端自管**并明确写「本机计时」**；服务端化列 A10 |
| 6 | **OCR 低置信** | README §五 / `07`：「标注需人工复核，**不送 LLM**」 | **照送 + 附 warning**（`resume-extraction.service.ts:311`） | **必须二选一**：后端加低置信熔断，或前端删掉「不送 LLM」这句 —— 现在屏上写的是错的 |
| 7 | **打印任务六处境** | `data-job`：queued / checking / checkfail / printing / jam / timeout，右栏三行必须跟着走 | 只有 `pending/claimed/printing/completed/failed`，**没有页级进度** | **改后端**（A7）。在此之前前端**不得**显示「已完成 3/15 面」 |
| 8 | **重新出码** | 「重新出码同时关闭旧码，不能两个码都能付」 | 同渠道 pending **复用同一个码**（只存在一个码） | **改前端文案**（结果一致、过程不同） |
| 9 | **取消支付 / 关单** | s5 有「取消支付，返回」 | 无主动关单端点，只有超时惰性 `closed` | **改前端**：只能表述成「先离开」，不能说「已关单」 |
| 10 | **扫描参数** | `07` 一整屏 dpi / 色彩 / 送稿器 / 双面 / 输出格式 | `POST /scan/sessions` 只收 `scanType + terminalId` | **改后端**（B3）。在此之前这些控件不能显示成「已生效」 |
| 11 | **复印** | `06` s1 有「复印」卡 | 无 copy 任务模型（`IMPLEMENTED_PRINT_SCAN_TASK_TYPES` 不含） | **前端先走 07→06 两步**；若确定只是串流程，就不要新建 copy 模型（属于「同一件事两套实现」）|
| 12 | **「存进我的文档」** | `07`/`08`/`09`/`12`/`21` 多处 | 无转存端点；文件已是 FileObject 但**未登录不属于任何人**，`/me/documents` 看不到 | **改前端**：未登录必须先过身份门。后端可补 B31 |
| 13 | **「发到我手机」** | 10+ 处 | 只有手机→本机，**没有下行通道** | **改后端**（B1）。在此之前该按钮不能显示成已送达 |
| 14 | **简历版本树** | `09` s5：v1 原件 / v2 采纳 / 「原件不被覆盖」 | `optimize` 只是同 taskId 的另一行，**无版本号、无覆盖保护机制** | **改后端**（B8）；或**改前端**改成「原件 / 优化建议」两栏，别叫版本 |
| 15 | **逐条采纳 / 换一版** | `09` s4 三选一 | optimize 一次性返回 `modules[]`，无逐条状态、无重生成 | **改前端**（本地维护采纳集合）+ **改后端**（B10） |
| 16 | **逐题访谈** | `10` 逐题、可跳过、可回上一题、举例子 | `POST /resume/generate` 是**一次性整表提交** | **改前端**：本地跑完访谈再一次提交；屏上不能表现得像后端在逐题理解 |
| 17 | **求职信四个旋钮** | 语气 / 字数 / 抬头 / 换一版措辞 | `job-materials` 是确定性模板，**无 LLM**，一个都不接 | **二选一**（B13），别留按不动的旋钮 |
| 18 | **求职材料需登录** | `12` 看起来匿名可用 | `POST /job-materials/generate` 是 `EndUserAuthGuard`（而 `GET /templates` 匿名） | **改前端**：生成前过身份门 |
| 19 | **岗位 AI（收敛 / 解读 / 匹配）需登录** | `13`/`14` 是匿名浏览页 | `POST /jobs/ai/recommendations` 与 `/ai/explain` `/ai/match` 实际**会员限定 + `job_ai` 同意**；另有日限流 20/100/60 | **改前端**：先过身份门与同意，或把这块降级成非 AI 排序 |
| 20 | **岗位筛选 25 项** | `13` 筛选面板 | 后端 7 个；无薪资/经验/学历/排序；`city` 精确等值；`industry` 是 tag 串匹配 | **改前端**先只放能生效的 + **改后端**（B4） |
| 21 | **招聘会筛选（城市/日期/方向）** | `36` 第一屏 | `GET /job-fairs` 只有 4 个参数 | **改后端**（B5） |
| 22 | **`GET /job-fairs?status=` 破坏分页** | — | 分页后内存过滤，`total` 是未过滤总数、页条数会短 | **改后端**（bug）。前端不能拿 `total` 当真 |
| 23 | **`GET /kiosk/offline-agencies?service=` 破坏分页与 total** | — | 分页后内存过滤且把 `total` 改成当前页长度 | **改后端**（bug） |
| 24 | **招聘会现场数据** | `45` stats 显示签到进度 / 浏览数 | 五个计数**恒 null**，`zoneBreakdown` 恒 `[]` | **改前端**：按 null 走「主办方未提供」，**不能显示 0**；后端 B17 |
| 25 | **展位图** | `17` s3 / `45` 画展位方块 | `/map` 的 `booths` **恒空** | **改前端**改接 `/venue-guide`（§10 第 1 条），那里才有展厅与展位号 |
| 26 | **政策深链 `?policyId=`** | `21`/`38`/`43` 都在传 | 无 `GET /policies/:id`，列表硬 `take:200` | **改后端**（B6） |
| 27 | **政策分类轴** | `38` 四类：就业 / 社保 / 档案 / 补贴 | 后端 `category ∈ policy\|announcement\|notice\|recruitment` —— **不是同一套轴** | **改后端**（加 `topic` 字段）或**改前端**（用 `audience` 近似并说明） |
| 28 | **政策来源三件套** | 合规要求详情页展示外部 ID | `PolicyPostDto` **缺 `externalId` 与 `sourceUrl`** | **改后端**（补字段） |
| 29 | **企业列表来源字段** | 合规要求列表卡至少来源机构 + 同步时间 | `GET /companies` 列表项**只有 `sourceName`**，缺 `syncTime`/`externalId`/`sourceUrl`；`/companies/:id/jobs` 缺 `syncTime` | **改后端**（补字段） |
| 30 | **线下机构来源字段** | 同上 | 列表缺 `sourceName`/`sourceUrl`；详情用 `orgCode` 代 `externalId`，**字段名与其它域不一致** | **改后端**（统一命名） |
| 31 | **收藏企业 / 机构** | `15`/`16` 有收藏按钮，`43` 有「企业 0」chip | `FAVORITE_TARGET_TYPES` 只有 job / job_fair / policy，非法值 400 | **改后端**（B16）。在此之前这两个按钮**不能显示成已收藏** |
| 32 | **权益「可用」不等于能用** | `24`/`06` 已明写这一点 ✅ | `status` 原样返回，读时不算过期；但 redeem 时**会**按 `validUntil` 判 `BENEFIT_EXPIRED` | 口径一致 ✅，但**前端仍要自己比 `validUntil`** 才能显示诚实的「已过期」；后端 A5 |
| 33 | **活动限领次数** | `claimLimitPerUser` 在响应里 | 创建时恒写 1 且 claim 时**根本不读**，实际靠唯一索引每人一次 | **改前端**：不要做「限领 3 次」的 UI |
| 34 | **异常反馈六选项** | `39` 六个 | `POST /me/feedback` 只有四类 category，**且需登录** | **改前端**：归并到四类 + 未登录先过身份门 |
| 35 | **通知计数** | `23` 写「7 条通知 · 2 条未读」 | `total` 是当前页长度、`nextCursor` 恒 null | **改前端**：只显示 `unreadCount`；后端 B15 |
| 36 | **文件保留期限设置** | `23` 画的是账号级总设置 | 只有逐文件 `PATCH /files/:id/retention` | **改前端**（挪到文档列表逐份设）或**改后端**（补账号级默认） |
| 37 | **`/me/*` 的 chip 计数** | `42` 订单 4 chip、`43` AI 5 chip、`42` 文档 3 chip | 无过滤参数 + cursor 分页 → **计数必然不准** | **改后端**（B14）。在此之前 chip 上不要显示数字 |
| 38 | **扫码登录需要终端令牌** | `03` 只画了「换一个码」 | `qr/create` 与 `qr/claim` 需 `x-terminal-id` + 终端 Bearer；TTL 180 秒 | **改前端**：Kiosk 必须持有终端凭据；屏上补「码 3 分钟有效」 |
| 39 | **短信登录必须带法务版本号** | `03` 只画了手机号 + 验证码 | `login` 必须带 `termsVersion`/`privacyVersion`，不一致 400 `LEGAL_VERSION_STALE` | **改前端**：登录前先取 `GET /kiosk/legal/:type` |
| 40 | **四个 `kiosk/*` 空壳桩** | `04` 帮助、`02` 待机、`24` 活动、`43` 通知 | `GET /kiosk/help` / `/kiosk/screensaver-content` / `/kiosk/activities` / `/kiosk/notifications` **全是空壳**（Service 是空类，恒返回空） | **改前端接真端点**：待机 → `GET /terminals/:id/screensaver`；活动 → `GET /activities`；通知 → `GET /me/notifications`；帮助无替代，见 B32 |
| 41 | **`x-terminal-id` 必填但标成可选** | — | `POST /print/jobs` controller 标 optional，service 强制 `PRINT_TERMINAL_REQUIRED` | **改后端**（DTO/注释）+ **前端务必带** |
| 42 | **capabilities 只认 `Terminal.id`** | — | `/config` 与 `/printer-status` 认 id 或 terminalCode，`/capabilities` **只认 id** | **改后端**（统一）；前端先统一持有 `Terminal.id` |
| 43 | **错误信封两套** | `06` 的错误码→屏幕表按 `{error:{code}}` 写 | payment 域抛裸字符串（`PRICE_CONFIG_UNAVAILABLE` 就是 message） | **改前端**两种都解析，或**改后端**统一 |
| 44 | **`PRINT_REQUIRE_PAID_BEFORE_CLAIM` 默认关** | 收银→出纸是强门控 | 环境变量默认 false（`terminal-utils.ts:155`），关时**未付款也可 claim 出纸** | **部署口径**：上线必须置 `true`，并纳入发布前置核对 |
| 45 | **`/append` 缺 `printFileUrl`** | `28` 附到简历后可打印 | 返回里没有该字段，而 `/print/jobs` 只认内部 HMAC URL | **改后端**（B30，一个字段） |
| 46 | **`job-fit/print` 缺 `signedUrl`/`expiresAt`** | 与其它 print 端点同形 | 只回 `printFileUrl` | **改后端**（对齐）或**改前端**单独处理 |
| 47 | **办理单编号** | `01`/`06`/`21`/`25` 屏上都有 `#E-7742` 这类编号 | 后端**无 Errand 模型** | **改前端**：降级成本地会话号并注明「本机编号」；后端 B23 |
| 48 | **`visit-plan` / `career-plan` 需要简历前置** | `17` s4 / `22` s1 没画这个前置 | 两者的 `:taskId` **必须是已有的 parse taskId** | **改前端**：先引导做简历，或后端支持无简历的通用版 |
| 49 | **一次打印一个文件** | `17` s4 按钮写「作战单 1 份 + 简历 6 份 共 13 页」 | `POST /print/jobs` **单文件** | **改前端**：拆成两单，或先合成一份 PDF（可用 `print/convert`，但那只接图片） |
| 50 | **TRTC 未配置抛 500** | `25` 语音应有干净的「未开通」态 | 缺密钥时抛 500，不是 feature flag | **改后端**（加能力探测端点）或**改前端**（把 500 当作语音不可用） |
| 51 | **智慧校园四种情况同一响应** | `19` 想区分「未接入 / 已停用」 | 未知终端、终端禁用、无配置、配置关闭**返回体完全相同** | **改后端**（加 `reason`）或**改前端**（统一表述成「未接入」） |
| 52 | **`GET /kiosk/legal/:type` 非法值静默回落** | — | 回 `terms_of_service` 而不是 400 | **改后端**（B34） |

---

## §13 `api-inventory-snapshot.md` 的重新生成方式与已知误渲染

### 13.1 它回答什么、不回答什么

快照由脚本从 `services/api/src/**/*.controller.ts` 的 `@Controller` + `@Get/@Post/@Put/@Patch/@Delete`
装饰器**机械抽取**，不是手写的。因此：

- ✅ 它**能**回答：「这个路径存不存在」「它在哪个控制器文件里」。
- ❌ 它**不能**回答：**有没有实现完**、**参数对不对**、**要不要登录**、**语义是否符合当前产品口径**、
  **返回体是什么**、**是不是空壳桩**。

> 快照里 `GET /kiosk/help`、`GET /kiosk/notifications`、`GET /kiosk/activities`、
> `GET /kiosk/screensaver-content` 四条**都存在**，但四个 Service 都是空类，恒返回空。
> 这就是「存在 ≠ 能用」的活例子 —— 所有这类裁定只在**本文件的逐条表**里。

### 13.2 重新生成

原生成脚本未在仓库中找到（`docs/design/kiosk-ai-os-v3-2026-08/tools/` 与 `scripts/` 下都没有）。
下面这段是**等价重建**，已实测产出 **415 个端点 / 76 个控制器**，与现有快照数量一致，
并且**修掉了 §13.3 的误渲染**（正确处理一个文件里多个 `@Controller` 的情况）：

```bash
# 在生产仓根目录执行
cd /Users/wanglei/AI求职打印服务终端
python3 - <<'PY' > /tmp/api-inventory.md
import os, re
ROOT = 'services/api/src'
CTRL = re.compile(r"@Controller\(\s*(?:'([^']*)'|\"([^\"]*)\")?\s*\)")
METH = re.compile(r"@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)'|\"([^\"]*)\")?\s*\)")
rows, files = [], 0
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in ('generated', '__tests__', 'node_modules')]
    for fn in sorted(filenames):
        if not fn.endswith('.controller.ts'):
            continue
        p = os.path.join(dirpath, fn)
        src = open(p, encoding='utf-8').read()
        src = re.sub(r'//[^\n]*', '', src)              # 去行注释
        src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)  # 去块注释
        files += 1
        marks = [('C', m.start(), (m.group(1) or m.group(2) or '')) for m in CTRL.finditer(src)]
        marks += [('M', m.start(), (m.group(1), m.group(2) or m.group(3) or '')) for m in METH.finditer(src)]
        marks.sort(key=lambda x: x[1])
        prefix = ''
        for kind, _pos, val in marks:
            if kind == 'C':
                prefix = val.strip('/')                  # ← 关键：按出现顺序切换前缀
            else:
                verb, sub = val
                path = '/'.join(x for x in (prefix, sub.strip('/')) if x)
                rows.append((verb.upper(), '/' + path, os.path.relpath(p, ROOT)))
rows.sort(key=lambda r: (r[1], r[0]))
print(f"共 **{len(rows)}** 个端点，{files} 个控制器。\n")
print("| 方法 | 路径 | 控制器 |\n| --- | --- | --- |")
for v, p, f in rows:
    print(f"| {v} | `{p}` | `{f}` |")
PY
```

去掉注释这一步是必要的：不去掉，控制器头部注释里的示例路径会被当成真路由抽出来。
输出路径**不含全局前缀 `/api/v1`**（`services/api/src/main.ts:62`）。

### 13.3 现有快照的已知误渲染（5 处，共 12 条路径）

原脚本用**文件里第一个 `@Controller` 的前缀**套整个文件，凡是一个文件声明了两个控制器类的，
第二个类的路由全被挂到第一个前缀下。已逐一核对源码确认：

| 快照写的（错） | 实际（对） | 源码 |
|---|---|---|
| `GET /jobs`（job-ai 那条） | `GET /me/job-ai-sessions` | `job-ai/job-ai.controller.ts:147,152` |
| `DELETE /jobs/:id` | `DELETE /me/job-ai-sessions/:id` | `job-ai/job-ai.controller.ts:147,161` |
| `GET /admin/ai-config`（重复的那条） | `GET /admin/ai-configs` | `ai/llm/ai-config.controller.ts:79,88` |
| `GET /admin/ai-config/:featureKey` | `GET /admin/ai-configs/:featureKey` | 同上 `:98` |
| `PUT /admin/ai-config/:featureKey` | `PUT /admin/ai-configs/:featureKey` | 同上 `:106` |
| `POST /admin/ai-config/:featureKey/test` | `POST /admin/ai-configs/:featureKey/test` | 同上 `:121` |
| `GET /job-materials/summary` | `GET /admin/job-materials/summary` | `job-materials/job-materials.controller.ts:56,62` |
| `GET /mock-interviews` | `GET /me/mock-interviews` | `mock-interview/mock-interview.controller.ts:242,247` |
| `DELETE /mock-interviews/:id` | `DELETE /me/mock-interviews/:id` | 同上 `:257` |
| `GET /me/ai-consents` | `GET /me/data-requests` | `member-privacy/member-privacy.controller.ts:86,94` |
| `POST /me/ai-consents`（重复的那条） | `POST /me/data-requests` | 同上 `:102` |
| `POST /me/ai-consents/:id/download-authorizations` | `POST /me/data-requests/:id/download-authorizations` | 同上 `:120` |

> **注意 `DELETE /jobs/:id` 这一条**：快照让人以为一体机能删岗位。
> **全库没有任何 `DELETE /jobs/:id` 路由** —— 它删的是会员自己的 AI 会话记录。
> 凡本表与快照不一致的，**以本表引用的 controller 源码行号为准**。

端点总数不受影响：误渲染只改路径字符串，不改条数，两边都是 415 / 76。

---

## §14 我没能核实的

诚实列出，不猜：

1. **Terminal Agent 侧的出纸判定细节。** **已由 W0 在 `main@6ad3be9f` 复核**：
   `apps/terminal-agent/src/agent/task-runner.ts:445-448,582-586,662-668,679-704` 对队列未出现、超时和非 Windows 统一
   fail-closed 为 `PRINT_JOB_UNCONFIRMED`，`:286-299` 对崩溃恢复同样 fail-closed。保留 Windows 真机回归，不再以旧
   “conservative completed”描述开展修复。

2. **`materials` 的 `pii_redact` 是否在别处真的产出了文件。**
   我确认了 `materials.service.ts:617-634` 只回计数、`redactedFileId` 恒 null（这一点来自子代理读取的行号），
   但**没有全量搜过是否存在另一条产出遮盖文件的路径**（比如由 Agent 侧完成）。A9 请以实测为准。

3. **各 `/print` 端点产出的 PDF 是否已经带 AIGC 标识。**
   设计 §3 要求「AI 生成内容含打印件必须带可见标识与文件元数据标识，每页恰好一次」。
   我**没有核实**六个 print 端点渲染出来的 PDF 里有没有这个标识。这是上线前必须实测的一项。

4. **`GET /print/price-config` 生产库里实际播种了哪些 serviceKey、单价是多少。**
   我只确认了代码路径（只回 `active` 行、零行 fail-closed）与开发种子（bw 20 分 / color 50 分，
   种子拒绝在 production 运行）。**正式单价以生产 `PriceConfig` 为准**，设计稿的 0.20 / 1.50 是原型样例。

5. **`GET /kiosk/help` 之外，是否还有别的空壳桩。**
   我核实了 `activities / help / notifications / screensaver / kiosk-session` 五个模块的 Service 为空类，
   **没有逐一检查全部 76 个控制器背后的 Service 是否有实现**。表里标 ✅ 的都有子代理读过服务层，
   但覆盖率不是 100%。

6. **`POST /assistant/chat` 的 11 个 skill 各自的真实输出质量与是否都接了 LLM。**
   我确认了 skill 枚举与响应结构，**没有逐个验证**每个 skill 背后是否都有对应 prompt 实现。
   26 页三态（A/B/C）对 skill 的依赖需要实测。

7. **44 个设计页里，我按 ActionBar（`data-at`）+ 页内主按钮 + 跨页 `href` 三类机械抽取了动作，
   共 1938 条。** 纯装饰性元素、`[data-review]` 评审脚手架已排除。但**页内被 JS 动态生成的按钮
   （尤其 `06` 的权益卡与 `24` 的 GRANTS 渲染脚本）我是读源码注释推断的，没有在浏览器里跑过**。
   若某个动作在表里缺席，以页面实测为准。

8. **`dead-buttons-2026-08-11.md` 里那 99 个「按下去什么都不发生」的按钮**，
   我没有逐条与本表对齐。其中大部分是原型内的态切换控件（不需要后端），
   但少数（如 `41` 的 8 个 `.pick`、`40` 的 6 个）确实对应本表的 ❌ 条目。

---

## 附：快速索引

| 想找 | 去 |
|---|---|
| 打印 / 扫描 / 加工 / 履约的每个按钮 | §1 |
| AI 简历 / 材料 / 面试 / 合同的每个按钮 | §2 |
| 岗位 / 企业 / 线下机构 | §3 |
| 招聘会 / 校园 | §4 |
| 政策 | §5 |
| 权益活动 | §6 |
| 我的 / 登录 / 记录 | §7 |
| 顾问 / 百宝箱 / 面试训练 | §8 |
| 待机 / 系统态 / 会话安全 | §9 |
| **现成能力，别重造** | §10 |
| **要建什么（施工清单）** | §11 |
| **端点在但不能直接用** | §12 |
| 快照怎么重生成、哪几条是错的 | §13 |
| 我没核实的 | §14 |
