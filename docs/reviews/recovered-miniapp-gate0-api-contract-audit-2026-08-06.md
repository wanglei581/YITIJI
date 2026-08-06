# 找回小程序 Gate 0 API 与履约契约审查

> 审查日期：2026-08-06  
> 小程序基线：`/Users/wanglei/zhiyida-miniapp`，`feature/test-mode-pricing-2026-08-04@4d17e5b`  
> 后端基线：`origin/main@50896ed1`  
> 状态：事实冻结完成；运行时开发仍为 **NO-GO**，待产品与工程决策冻结  
> 范围：只读核对小程序接口门面、页面调用和主仓控制器/服务/Prisma；未连接生产、未改运行时代码
> 协作复审：本地 Claude Code `2.1.222` 两次只读调用均持续无输出后终止，未形成有效 Verdict，不计作通过

## 一、结论

找回的小程序可以作为正式工程的主要迁移资产，但不能直接发布，也不能按现有接口注释继续补页面。`utils/api.js` 中公开内容、会员登录、简历 AI、职业规划、岗位匹配、模拟面试、本人简历/AI 记录等大部分路由在主仓真实存在；通知、反馈、收藏、浏览记录、权益和文档也已有可复用后端，只是小程序尚未接线。

真正的 P0 阻断集中在“手机下单后到一体机打印”：主仓当前 `POST /print/jobs` 会在同一事务中先创建 `PrintTask` 再创建 `Order`，现有支付是微信 Native 屏上二维码，不是小程序 JSAPI；本人订单接口以 `PrintTask` 为主表，无法显示“手机已支付但尚未到机、因此还没有 PrintTask”的订单；材料包、公开终端、订单取件详情和到机释放路由均不存在。现有小程序却假设创建材料包即可取得 `pickupCode`，并允许绕过支付直接进入取件码页，与目标履约状态机正面冲突。

因此 Gate 0 建议为：

1. **工程路线选原生演进**：先保留原生 JavaScript/WXML/WXSS，选择性迁入主仓 `apps/miniapp/`；当前不批准为 Taro 4 重写 57 页。
2. **首发只做 M0-M2**：M0 真实账户与本人台账，M1 已验证 AI/材料能力，M2 Order-only 手机下单与到机释放；视频与职业生活服务留在后续受控试点。
3. **履约限定选定终端**：用户下单前明确选择一个真实可服务终端；到机只能在该终端释放。没有真实坐标和队列数据时不展示距离、空闲或预计等待。
4. **四 Tab 推荐冻结为“今天 / 材料 / 发现 / 我的”**：首页继续一屏，不再增加入口；原五 Tab 页面只做路由归位，不机械删页。
5. **运行时代码继续 NO-GO**：先冻结产品名、Tab、微信主体/AppID/商户与类目条件，并为 M2 单独批准 schema/API/支付改动范围。

## 二、审查范围与文件预算

本任务对应的真实上线阻塞是：确认找回小程序对主仓 API 的假设是否成立，避免用不存在或语义错误的接口开发手机支付与远程打印。

允许修改：本报告、`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。  
禁止修改：`/Users/wanglei/zhiyida-miniapp` 运行时代码、`project.config.json`、`apps/`、`services/`、`packages/`、Prisma schema/migration、支付配置、数据库、密钥、生产环境和硬件链路。  
新增内容：仅 1 份审查文档，不新增入口、页面、模型、服务或依赖。  
验证：Git diff、文档链接、接口路由静态核对；不运行构建/E2E，因为本轮没有运行时代码变更。

## 三、接口对账矩阵

### 3.1 可以直接复用的现有后端

| 小程序能力 | 小程序门面 | `origin/main` 事实 | 结论 |
|---|---|---|---|
| 岗位列表/详情 | `GET /jobs`、`GET /jobs/:id` | `JobsController` 已有公开路由 | 复用；继续保留来源平台动作 |
| 招聘会列表/详情 | `GET /job-fairs`、`GET /job-fairs/:id` | `JobsController` 已有公开路由 | 复用；预约只去来源平台 |
| 企业列表/详情 | `GET /companies`、`GET /companies/:id` | `CompaniesController` 已有公开路由 | 复用；企业展示不扩成企业招聘端 |
| 政策列表 | `GET /policies` | `PoliciesController` 已有公开列表 | 复用；真实空数据必须显示空态 |
| 法务版本 | `GET /kiosk/legal/:type` | `LegalController` 已有公开路由 | 复用；正式版本未激活时不得把草稿哨兵当上线法务完成 |
| 短信与微信登录 | `/member/auth/sms-code`、`/login`、`/wx-login`、`/logout`、`/member/me` | `MemberAuthController` 已有；微信 DTO 强制 `code/phoneCode/termsVersion/privacyVersion` | 复用；仍需正式 AppID、类目、隐私与真机验证 |
| 文件上传 | `POST /files/kiosk-upload` | `FilesController` 已有，支持可选会员归属 | 复用；继续执行 purpose、MIME、TTL 和短签名 URL 门禁 |
| 简历解析/诊断/优化 | `/resume/parse`、`/resume/records/:taskId`、`/optimize` | `AiController` 已有 | 复用；小程序需修正本地模块导入和匿名令牌读取 |
| 职业规划 | `POST/GET /resume/career-plan/:taskId`、`POST .../print` | `CareerPlanController` 已有 | 复用；PDF 是本人文件，不等于已下单或已打印 |
| 岗位匹配 | `/resume/job-fit`、结果与打印路由 | `JobFitController` 已有 | 复用分析能力；会员与匿名授权必须分流 |
| 模拟面试 | 创建、开始、回答、结束、报告、打印 | `MockInterviewController` 已有 | 路由复用；现有页面 DTO 与模块导入不兼容，见 4.1 |
| 小青助手 | `POST /assistant/chat` | `AiController` 已有 | 复用；动作只映射白名单路由，不允许模型直接支付、打印或外跳 |
| 本人简历/AI 记录 | `GET /me/resumes`、`GET /me/ai-records` | `MemberAssetsController` 已有 | 复用；列表游标分页和本人隔离保持不变 |

### 3.2 后端已存在，但小程序需要新增适配

| 能力 | 主仓真实接口 | 小程序现状 | 处理 |
|---|---|---|---|
| 我的文档 | `GET /me/documents`，文件下载/预览/删除走 `FilesController` | 页面含 5 条写死样例，并误写 TODO `/me/files` | 删除假数据，按本人文档契约适配短时 URL 与删除 |
| 通知 | `GET /me/notifications`、`PATCH read-all`、`PATCH :kind/:id/read`、`DELETE` | 页面强制空数组，注释还写成错误的 `PUT` | 接真实分页、未读数、分类和已读/删除动作 |
| 反馈 | `GET/POST /me/feedback`、详情、回复、关闭 | Help 页只提示“即将上线” | 复用真实工单；从订单异常带 `relatedPrintTaskId` 进入 |
| 收藏 | `GET/POST/DELETE /me/favorites` | 只用本机 Storage，且 UI 包含后端不支持的 `company` 类型 | 登录后以服务端为准；首期只支持 `job/job_fair/policy`，企业收藏另审契约 |
| 浏览/外跳记录 | `GET/DELETE /me/browse-logs`、`external-jump-logs`，写入走 activity API | 当前只在本机 Storage 记录 | 接本人日志；仍不得记录投递/预约结果 |
| 权益 | `GET /me/benefits`、`GET /me/benefits/redemptions` | 会员页写死套餐并提示待接入 | 首期只读真实权益，不先建会员购买闭环 |
| AI 同意与隐私 | `/me/ai-consents/*`、`/me/data-requests/*`、二次验证与导出下载 | 隐私页均为占位 | 接真实授权、撤回、导出与注销申请；不得在本地假完成 |
| 自我探索 v1 | `/resume/self-assessment` submit/get/print/append/delete | 找回工程无页面和门面 | M1 后只做小程序适配，复用 25 题五维服务端，不做 MBTI/临床量表 |

### 3.3 现有接口语义不兼容，不能直接复用

| 能力 | 当前事实 | 不兼容原因 | 目标处理 |
|---|---|---|---|
| 我的打印订单 | `GET /me/print-orders` 存在，但从 `PrintTask` 查询并返回 `id=printTaskId` | Order-only 待到机阶段没有 PrintTask，列表会漏单；小程序又把 task id 当 order id | 新增真正按 `Order.endUserId` 查询的移动端订单列表/详情；明确 `orderId` 与 `printTaskId` |
| 订单取件详情 | 小程序调用 `GET /me/print-orders/:orderId/pickup` | 主仓无此路由；当前取件码只可能从任务列表或带 payment session token 的支付状态响应读取 | 新增本人订单详情/到机凭证接口，返回 additive 履约状态与有效期 |
| 打印建单 | 当前 `POST /print/jobs` 同事务创建 `PrintTask + Order` | 手机付款前即创建 Agent 可见任务，不满足公网不直驱打印机和 Order-only 目标 | 新增远程材料包报价/建单入口，只创建 Order；不复用 Kiosk 建任务入口 |
| 微信支付 | 当前 WeChat Provider 使用 `/v3/pay/transactions/native`，`/orders/:id/pay` 返回屏上二维码 | 小程序 `wx.requestPayment` 需要 JSAPI `prepay_id` 与前端签名参数；现有支付会话也绑定了 `printTaskId` | 新增小程序 JSAPI provider/端点与 openid 绑定，复用回调验签、查单、退款和金额校验底座 |
| 到机释放 | Kiosk 页面引用 `POST /print/jobs/claim-pickup` | `origin/main` 无 controller/service/route；仅有失效前端调用 | 设计“选定终端 + 到机凭证”事务：校验 paid/TTL/文件/能力/终端后首次创建 PrintTask |
| 材料包 | 只有无归属、无条目关系的基础 `PrintMaterialPack` 表 | 无 `/me/bundles` controller/service；无法表达本人条目快照、锁定、版本、TTL 与订单关系 | 新增本人材料包模型/API；不要在旧基础表上硬套业务语义 |
| 终端选择 | 只有单终端配置、心跳、能力与 Admin 列表 | 无 `GET /terminals/public`；现有数据也没有经审定的公开坐标/距离/队列 | 新增最小公开适配器，只返回已启用服务点的安全字段和诚实在线态 |
| 政策详情 | 小程序调用 `GET /policies/:id` | 主仓只提供政策列表，没有公开详情路由 | 首期可从列表项进入详情或新增只读详情路由；二选一后冻结契约 |

### 3.4 找回小程序没有使用、但主仓可复用的相邻能力

- `GET /me/mock-interviews` 与删除：可用于本人面试记录。
- `GET /me/documents` 与 AI 记录删除：可用于统一材料页。
- `GET /me/benefits/redemptions`：可用于权益使用明细。
- `GET /me/notifications` 与反馈工单：可组成“我的”服务台账。
- 自我探索 v1 的 submit/get/print/append/delete：可作为后续私人报告能力。
- 百宝箱 manifest 与治理底座：可作为职业生活服务入口，但首批只选最多 3 项，不延长首页。

## 四、旧前端错误假设与发布阻断

### 4.1 确定的运行时错误

1. `utils/api.js` 使用 `module.exports = api`，但 `resume-optimize` 和 3 个模拟面试页面使用 `const { api } = require(...)`；`api` 实际为 `undefined`。
2. 同一批页面把 `utils/storage.js` 错误解构为 `{ storage }`，优化页还把 `utils/normalize.js` 错误解构为 `{ normalize }`；均会在运行时失败。
3. 优化页即使修正 import，仍把整个 `RESUME_TASK` 对象当作 `accessToken` 传入，而不是读取 `.accessToken`。
4. 模拟面试创建页传 `industry: ''`，而服务端要求非空；传入的 `campus/junior/mid/senior` 也不属于服务端允许的 `fresh/lt1/y1_3/y3_5/gt5/switch`，因此会被全局 DTO 校验拒绝。
5. 岗位匹配页无条件走匿名 consent API；但该 API 明确排除会员 parse。会员任务应走 `/me/ai-consents` 的 `job_ai` 同意，而不是匿名 parse token 授权。

### 4.2 确定的错误业务语义

1. `createBundle()` 注释承诺立即返回 `pickupCode`，但主仓没有该接口，且目标状态机禁止未支付先发到机码。
2. `print-pay.js` 只要 query 带 `pickupCode` 就绕过支付；普通流程则允许用户“预览取件码”。两条路径都必须删除，失败时只能停在真实错误/待接入态。
3. `print-pickup.js` 在缺少后端有效期时自行估算 24 小时，并显示终端关联入口；有效期与终端绑定必须来自服务端，不得由页面推断。
4. `orders.js` 把 `MemberPrintOrderItem.id` 同时当 `printTaskId` 和 `orderId`，会把任务标识传给并不存在的订单取件路由。
5. 政策详情页保留真实感很强的默认补贴金额、对象和官方 URL；虽然加载失败有 error state，仍应在真实详情接入时移除该运行时样例，避免状态闪现或后续逻辑误用。
6. 文档、会员、证件照、链接分析、打印排版等页面仍含样例、固定价格或“即将上线”操作；不能因为页面存在就计入商用功能完成度。

### 4.3 工程与配置风险

- 找回工程 `config.js` 直接指向 `https://zyidai.cn` 且 `USE_MOCK=false`；迁入前必须按环境注入并加生产域名守卫，不能让开发构建默认打生产。
- 法务版本请求失败会回落 `draft-pending-legal-review`。该哨兵只能表达未完成，正式发布必须 fail-closed，不能凭回落值允许真实同意与登录。
- 原生工程没有 TypeScript/typecheck 保护，上述 CommonJS 解构错误未被构建期发现；若继续原生演进，必须增加至少 ESLint、模块导出契约测试、路由/API 静态门禁和微信构建验证。
- 小程序当前仍在独立仓，且用户已有 `project.config.json` 未提交改动；归位时只选择性迁移，不覆盖该文件，也不复制成第二个正式源码。

## 五、M2 正确履约契约

```text
本人材料/材料包
  -> 服务端锁定条目与文件 TTL
  -> 服务端报价
  -> 创建 Order（printTaskId=null, fulfillment=pending_payment）
  -> 微信 JSAPI 支付成功（fulfillment=ready_for_release）
  -> 用户到选定终端出示/扫描随机到机凭证
  -> 单事务校验 paid + 未退款 + 未过期 + 文件有效 + 终端匹配 + capability 可用
  -> 首次创建 PrintTask 并绑定 Order（fulfillment=released）
  -> Agent 只领取该终端 PrintTask
  -> 打印状态回流 Order/通知/订单详情
```

建议新增的最小服务端契约，名称可在实现 Gate 冻结：

| 类别 | 最小能力 |
|---|---|
| 材料包 | 本人 CRUD、条目快照、锁定/解锁、TTL、服务端页数与报价 |
| 远程订单 | 创建 Order-only、本人列表、详情、取消、支付状态、履约状态 |
| JSAPI 支付 | 以登录会员微信 openid 创建 `prepay_id`，返回 `wx.requestPayment` 参数；复用真实回调、查单与退款底座 |
| 到机凭证 | 服务端生成随机不可猜凭证、哈希/受控存储、24 小时候选 TTL、次数与爆破限制 |
| 释放事务 | 选定终端核验、幂等、CAS、首次创建 PrintTask、响应丢失后返回同一任务 |
| 终端目录 | 只读公开安全字段、enabled/lifecycle/heartbeat/capability 诚实过滤，不返回设备凭证或内部网络信息 |
| 售后 | 从真实 order/printTask 发起反馈；未释放到期或取消按真实渠道原路退款/返还权益 |

`Order` 至少需要 additive 履约字段或等价独立事件模型：`fulfillmentStatus`、`releaseExpiresAt`、`releasedAt`、`releasedTerminalId`、`pickupCodeUsedAt`。是否直接扩 `Order` 还是新建凭证/事件表，必须在 M2 schema Gate 中结合并发、审计和 SQLite/PostgreSQL 双迁移决定，本报告不提前写 schema。

## 六、推荐开发顺序

### Gate 0.1：先冻结五项决策

1. 产品名：建议沿用已有品牌“职易达”，副标题“AI 求职与职业生活服务”。
2. 四 Tab：建议确认“今天 / 材料 / 发现 / 我的”，首页保持一屏。
3. 工程：建议原生微信小程序渐进式演进，暂不迁 Taro 4。
4. 首发：建议 M0-M2；自我探索排 M1 后，视频排 M2 稳定后，职业生活服务排 M4。
5. 履约：建议只允许用户下单时选定的终端释放，不做任意终端通兑。

同时由业务方确认微信主体、正式 AppID、商户号绑定、服务类目、隐私保护指引、JSAPI 支付目录/域名和订阅消息模板是否具备。任何一项未知都记录为外部上线阻塞，不在代码中假定已完成。

### Gate 0.2：唯一工程归位

- 从干净 `main` 建独立分支/worktree，将找回工程选择性迁入唯一 `apps/miniapp/`。
- 先修 CommonJS 导入、DTO、政策详情、生产域名默认值和假数据门禁，再接新页面。
- 建立原生工程 lint、JS 语法、WXML 标签、路由注册、API 契约、合规文案和微信 build 门禁。
- 归位完成后，独立仓只保留历史，不再并行产生正式功能。

### M0：真实 Shell 与本人台账

- 登录、法务、公开内容、材料/文档、通知、反馈、收藏、浏览、权益和隐私接真。
- 不新增首页入口；现有页面按四 Tab 归位。
- 删除运行时样例、假价格、假成功、假终端和“预览取件码”。

### M1：AI 与材料闭环

- 修复简历优化、模拟面试和岗位匹配会员授权分流。
- AI 结果进入本人简历/文档/报告；小青只执行白名单导航与建议。
- 复用自我探索 v1 服务端，只做原生页面、隐私说明、内存答案和退出清场。

### M2：手机下单与到机打印

- 单独批准材料包、Order-only、JSAPI、到机释放、终端公开适配器和售后状态机。
- 完成 1 分钱 live 支付/退款、并发只释放一次、错终端/过期/退款/文件失效拒绝、响应丢失幂等，以及 Windows + 奔图真实出纸证据。
- 打印机仍只读 `printerName` 配置，未知彩色 mode 不得假设，不能把浏览器门禁替代真机。

### M3-M4：商业扩展

- 视频先做外部受控 HTTPS 链接 + 可撤销随机二维码，不托管视频、不记录扫码者身份或招聘结果。
- 职业生活服务首批最多 3 项，进入“发现/百宝箱”，不延长首页；优先合同风险提示、社保/公积金官方指引、公共服务机构。
- MBTI、临床心理量表、人格总分、岗位适配、企业查看、泛生活 O2O 和招聘闭环继续 NO-GO。

## 七、发布负向门禁

1. 手机支付前或到机释放前出现 Agent 可 claim 的 PrintTask，测试失败。
2. 创建材料包直接返回或页面自行生成到机码，测试失败。
3. `Order.printTaskId=null` 的已支付订单不出现在本人订单列表，测试失败。
4. 错终端、过期、退款中/已退款、文件过期、能力不可用仍可释放，测试失败。
5. 同一凭证并发释放产生两个 PrintTask，测试失败。
6. JSAPI 金额来自前端、openid 不属于当前会员、回调未验签或金额不一致仍入账，测试失败。
7. 小程序使用 Native 二维码结果冒充 `wx.requestPayment` 参数，测试失败。
8. 终端目录展示无真实数据支撑的距离、队列或等待分钟数，测试失败。
9. 模块解构、DTO 枚举和匿名/会员同意分流没有契约测试，发布门禁失败。
10. 文档、通知、会员、政策或订单页面仍渲染运行时样例/假成功，发布门禁失败。
11. 开发/体验版默认请求生产 API，发布配置门禁失败。
12. 岗位/招聘会出现平台内投递、预约、企业收简历或候选人入口，合规门禁失败。

## 八、Gate 0 Verdict

| 项目 | Verdict |
|---|---|
| 找回源码作为迁移资产 | **GO** |
| 直接发布找回源码 | **NO-GO** |
| 继续用原生小程序渐进演进 | **GO（推荐，待用户冻结）** |
| 当前改用 Taro 4 重写 57 页 | **NO-GO** |
| 复用公开内容、登录、AI、本人资产底座 | **CONDITIONAL GO** |
| 复用当前 Kiosk 建单接口做手机远程打印 | **NO-GO** |
| M2 新增 Order-only + JSAPI + 到机释放 | **CONDITIONAL GO，须独立 schema/API/支付 Gate** |
| 自我探索 v1 小程序适配 | **CONDITIONAL GO，排在 M1 后** |
| 外部视频链接二维码 | **CONDITIONAL GO，排在 M2 稳定后** |
| 平台托管视频、MBTI/临床测评、泛生活平台 | **NO-GO** |

最终结论：先把找回工程归位并修正真实接口契约，再做 M0/M1；手机支付与到机打印必须作为独立 M2 状态机开发，不能在旧材料包和 `PrintTask-first` 路径上打补丁。首页继续保持一屏，后续能力进入材料、发现和我的，不再向首页堆入口。
