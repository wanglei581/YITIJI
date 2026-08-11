# V6 商用品质与真实闭环审查（2026-08-12）

## 1. 结论与真值

- 用户确认的 `http://127.0.0.1:8961/` 是 Kiosk **V6 视觉、页面与动效基线**。仓库目录名和页面标题中的 `V3` 是历史命名，不改变产品口径。
- `docs/design/kiosk-ai-os-v3-2026-08/` 是交互规格，不是可直接上线的生产前端。生产实现仍在 `apps/kiosk/`，必须按真实 API、状态机和硬件结果逐条接线。
- 不新建第二套项目目录，不从零重写已验证能力。按业务闭环渐进迁移；每完成一个闭环，同时完成 V6 页面、真实数据、错误/空/加载态和验收。
- V6 中尚无后端的按钮是**待实现产品能力**，不能因为当前代码没有就直接删除。只有不合规、重复、无业务意义或会破坏真实状态机的动作才改设计或下线。
- Kiosk 新增和修改页面统一使用 V6；不得混入当前 75 屏旧视觉。P05 是手机接力页，按 390×844；Admin/Partner 保持现有桌面 InkPaper 设计语言。
- 智慧校园入口首页可见，但默认 `enabled=false`；所有子路由和深链必须服务端 fail-closed。

当前判定：**V6 可作为施工规格，产品整体仍为 NO-GO**。阻塞原因是交易、文件、身份、会话、打印/扫描、取件、后台治理等闭环尚未全部完成，不是页面数量不足。

## 2. Claude 记录的吸收与纠正

本审查已核对：

- `docs/product/codex-handoff-plan-2026-08.md`
- `docs/reviews/2026-08-11-two-line-reconciliation.md`
- `docs/reviews/2026-08-11-backend-buildout-spec.md`
- `docs/reviews/fake-capability-audit-2026-08.md`
- `docs/design/kiosk-ai-os-v3-2026-08/wiring-map.md`
- `docs/api/console-ai-dev-spec-2026-08.md`
- `docs/product/console-ai-upgrade-plan-2026-08.md`

采用 Claude 的正确原则：按业务闭环推进；按钮代表待开发能力；复用现有订单、权益、资产和会话真值；Admin/Partner 补齐现有页面，不另造空后台。

以下两处必须按源码与安全状态机纠正，不能照抄文档：

1. P39「手机扫码上传」不能直接打开 P05。Kiosk 应先进入 P06 创建上传会话并展示 QR；只有扫码后的手机打开 P05/生产 `/upload/phone`。
2. P41 不能新增匿名 `claim-pickup` 并把 `PrintTask` 写成 `claimed`。`claimed` 是 Terminal Agent 的租约状态；匿名 Kiosk 抢写会让 Agent 永远取不到任务。若需要跨机取件，必须新增独立的 pickup authorization / fulfillment request，最终 `claimed` 仍只允许 Agent 写入。

## 3. 所有控件的生产合同

每个非说明性控件必须在实现清单中归入且只归入一种类型：

| 类型 | 必须结果 |
|---|---|
| 导航 | 到存在且语义正确的 V6 路由，并携带服务端对象 ID 或可信路由上下文 |
| 本地交互 | 改变可见状态，支持键盘/触控/返回/刷新恢复；不得伪装服务端成功 |
| 服务端命令 | 发出真实请求，处理 loading/success/error/idempotency，刷新后结果仍成立 |
| 外部来源动作 | 只使用服务端审核的 canonical URL，域名白名单、离站确认和跳转日志齐全 |
| 能力门禁 | disabled/locked 状态可解释；深链同样拦截，不能只在首页隐藏 |

禁止把 `title/pages/copies/source/purpose` 等 URL 参数当文件、页数、价格、权益或来源证明。真实业务必须使用服务端 `artifactId/fileObjectId/jobId/fairId/orderId/taskId`。

## 4. 45 页产品闭环矩阵

| 页面 | 当前主要缺口 | 商用闭环 |
|---|---|---|
| P01 首页 | 静态设备/价格/活动；AI 自动打字会污染输入；卡片嵌套交互 | 站点配置、能力投影、AI 路由白名单；智慧校园可见锁定 |
| P02 待机 | 内容、时间、设备 ETA 为样例 | 终端屏保配置、离线缓存元数据、全屏唤醒 |
| P03 身份门 | QR/SMS 均为本地演示；手机号页硬编码 | 短时单次 QR、SMS 限流、legal version、returnTo 白名单、清场 |
| P04 系统状态 | 恢复、结束清空、帮助、法务仅本地 | session create/heartbeat/extend/end、token 撤销、pending task 恢复 |
| P05 手机接力 | 上传、拍照、登录、带走未接真实会话 | 手机→终端 upload-session；终端→手机 takeaway-session；390×844 独立验收 |
| P06 打印工作台 | 核价、权益、支付、履约、退款是原型态 | provenance→quote→reservation→order→payment→PrintTask attempt→device outcome→refund |
| P07 扫描工作台 | 格式/DPI/ADF/单双面超出现有 Agent 合同 | 扩 ScanTask/Agent 参数、迟到任务 fencing、真实文件产物 |
| P08 文件加工 | 转换/签章部分参数未落后端 | inspect/compose、授权确认、产物版本、保存/打印/带走 |
| P09 简历工作台 | 版本、导出、保存、带走不持久 | 不可变版本、真实 export artifact、claim/save、OCR/AI 低置信规则 |
| P10 访谈生成 | 问答可本地，但最终生成与导出未闭环 | 一次生成提交、语音能力探测、版本/导出/保存 |
| P11 岗位匹配 | 多岗、报告、对象 ID 不完整 | consent、真实 jobId/resumeVersion、最多三岗、无排名/录用承诺 |
| P12 材料工厂 | tone/length/再生成/清单为样例 | 登录前置、真实生成、artifact、打印/保存 |
| P13 岗位台 | 卡片缺 jobId；筛选/收藏/异常上报不完整 | 真分页与 facets、收藏、canonical source、external-jump |
| P14 岗位详情 | 外链由页面样例提供 | 服务端 jobId→审核 sourceUrl，离站确认和跳转日志 |
| P15 企业导览 | metrics/来源/收藏部分静态 | companyId、真实指标键、来源和同步时间、收藏类型 |
| P16 线下机构 | service 筛选破坏分页；材料产物缺失 | 修查询、资质中性表述、到店清单/打印/带走 |
| P17 招聘会作战台 | fairId、分页、路线、打印 bundle、帮助缺失 | 招聘会/场馆真值、外部签到/预约、bundle artifact |
| P18 校园招聘 | 活动与计划为静态 | 真实校园活动、筛选、计划 artifact、打印/带走 |
| P19 智慧校园 | 关闭后仍可深链进后续阶段 | terminal capability fail-closed；默认锁定；配置化内容 |
| P20 模拟面试 | 面试 FSM 与报告未接；隐私文案与上传转写冲突 | interviewId/turn、ASR/TTS 能力、真实保留策略、报告 artifact |
| P21 政策服务 | 政策、资格、清单、热线/来源为样例 | 政策 API、未知结果、官方来源核验、打印/带走 |
| P22 职业规划 | 缺 resumeTaskId 前置与真实结果 | 简历任务校验、规划任务、岗位统计真值、artifact |
| P23 我的 | 退出、删除、清空只改本地 UI | `/me/*` 真值、幂等删除、退出与账号/匿名会话清理 |
| P24 权益 | 页面硬编码 Grant；抵扣合同不安全 | 服务端资格/余额/有效期/预占/核销/退款恢复；订阅 feature gate |
| P25 AI 顾问 | 输入无提交；钉住/打印/保存缺失 | session/chat、发送、降级、pin 持久化、输出 artifact |
| P26 顾问工作页 | 三模式与“答第3问”无真实动作 | skill/session、输入槽、继续回答、真实产物 |
| P27 百宝箱 | 配置与外链治理未接；部分路由跳过前置 | terminal config、allowlist、离站确认、正确 hub/s1 |
| P28 自我评估 | consent、历史、打印/带走仅本地 | consent version、assessmentId、结果/历史、artifact |
| P29 证件照 | 整条能力未开放 | 保持锁定；完成图片质量、隐私、排版、简历替换和真机打印后开放 |
| P30 | P11 的升格别名，不是缺页 | 不新增第二文件、第二入口或第二模型 |
| P31 合同审阅 | 页面未接已有异步链；默认门禁可绕过 | Gate 0、consent、upload/scan、poll、confirm、report、print/save/delete |
| P32 简历 Hub | intent/need 只在 URL，门禁不消费 | typed route context、身份/简历/AI/合同前置检查 |
| P33 模板库 | AI 目标生成、套用与打印是硬编码 | 模板 API、assistant、templateId→真实 resume/artifact |
| P34 岗位 Hub | 分流需要真实能力与对象上下文 | typed routes、来源治理、空/错/加载态 |
| P35 线上平台 | QR 是不可扫示意码，平台数据硬编码 | 受治理的 online-platform API、真实 QR、域名 fail-closed |
| P36 招聘会 Hub | 筛选只拼 URL；“免费”无报价证明 | 真实筛选合同、禁用态、现场核价 |
| P37 面试 Hub | 缺目标时移除 href | 保留可聚焦 disabled 与原因；补会话前置 |
| P38 政策 Hub | 资格字段不全；“官方”缺核验 | 完整输入合同、unknown 结果、来源验证徽标 |
| P39 打印 Hub | 手机上传曾错跳 P05；能力探测失败会误置 ok | 进入 P06 QR；capability unknown/unavailable fail-closed |
| P40 会话安全 | 全部主动作本地演示；站点位置虚构 | 复用现有隐私上下文，补服务端会话、接管、清场、任务恢复 |
| P41 履约状态 | 支付/退款/补偿/续打/领取均为原型 | attempt/outcome、补偿与退款真值；独立 pickup authorization |
| P42 资产中心 | 删除确认只关弹层 | 复用 `/me/*`，服务端删除成功后再更新 UI |
| P43 活动中心 | 反馈、已读、删除只改 DOM | 通知持久化、反馈 ticket id、重载一致 |
| P44 离线岗位 | 重试、收藏、网络、保存带走未接 | 复用 OfflineJobDetail、收藏决策、takeaway |
| P45 招聘会现场 | 人数、次数、免费文案为硬编码 | fairId、venue-guide、真实材料、实时核价、takeaway |
| P46 校园服务 | 无能力守卫；“校方官方”无证据 | smart-campus fail-closed、可审计来源、真实清单/打印/带走 |

## 5. 视觉与体验硬门禁

Kiosk 页面按 1080×1920 逐页验收；P05 单独按 390×844。每个页面至少验证 normal/loading/empty/error/long-text/overlay/keyboard 或软键盘相关状态。

- 二维码中心与所属主操作面板中心横向偏差不超过 2px；扫码距离和实际解码另做真机测试。
- 无横向滚动；唯一纵向滚动区；底部主动作不被裁切或遮挡。
- 触控目标不小于 48×48 CSS px，手机主动作不小于 52px。
- 弹层有 `role=dialog`、`aria-modal`、初始焦点、焦点圈定、Escape 和关闭后焦点返回。
- 动态状态使用 `aria-live/aria-busy`；tabs/筛选语义正确。
- `prefers-reduced-motion` 下关闭长动画、扫光和自动打字；动画不得阻塞点击。
- 静态设备号、价格、队列、活动数量、机构名、场馆位置、成功率和“官方/免费/已上报”不得进入生产。

2026-08-12 第一批已验证修正：

- P39 手机扫码上传改为 P06 `stage=s1&source=qr`，P06 只接受 `local/qr/usb` 三个入口值，不能用 URL 伪造 `phone-got/usb-in`。
- P03/P06 二维码在所属主操作区横向偏差均为 `0px`，页面 `scrollWidth=1080`。
- P05 修正继承 1080×1920 `.stage` 的问题；390×844 下 `.stage/.screen/viewport` 均精确匹配且无滚动溢出。

## 6. 5303 双后台升级审查

`http://localhost:5303/` 对应 `docs/design/console-ai-os-2026-08/`，是 Claude 交给 Codex 的 Admin/Partner 改造规格。它可以指导现有页面的内容结构、Tab 和后台操作密度，但仍是 **mock 原型**，不能把本地切换、静态数字或无处理器按钮当成已完成能力。生产 Admin/Partner 继续使用桌面 InkPaper 语言，不套 Kiosk V6。

### 6.1 范围与页面数裁决

- 「新增 0 页」只对原先拟新增的 AI 面试运营页和 Partner 工单页成立：前者并入 `/ai-services`，后者并入 `/account`。
- `/online-platforms` 是本轮**唯一确需新增的 Admin 顶级路由和侧栏项**。当前原型同时写「新增 0 页」和「唯一新增页」，`mapping.html` 又漏记该页，必须先统一口径。
- 当前代码保留 `/permissions` 实体路由，仅计划从侧栏摘除。按照删除证据规则，在它被正式重定向或退役前，加入 `/online-platforms` 后物理页面总数应按 **48** 计算；若产品坚持 47，则必须先完成 `/permissions` 的迁移、旧 URL 兼容、引用与测试清理，不能靠统计口径把页面抹掉。
- 现有 `mapping.html` 仍以早期 30 个前台点位为基线，漏掉 V6 P33–P46，并把不存在且不安全的 `pickup-claim` 当成已存在接口。它必须补齐 V6 页号、真实 React 路由、消费字段和 `existing/extend/new/deferred` 状态后，才可作为施工清单。
- 5303 静态盘点共 378 个 `<button>`：统一脚本只处理 40 个 Tab 和 4 个 switch，约 328 个普通业务按钮没有生产动作；77 个链接中还有 16 个 `#` 和 3 个 `javascript:void(0)`。它们全部进入 action manifest，逐个标记为 navigate/local/query/command/external/gate，并绑定 owner、API、权限、状态和验收。
- 原型常驻「机构助手」目前使用硬编码答案，却出现「帮你查了」「逐条查库」等措辞；在真实只读查询、权限裁剪与工单 API 完成前，不得进入生产或声称查过数据。

### 6.2 不能照原型直接接线的关键点

| 域 | 现状/风险 | 开发前置 |
|---|---|---|
| 在线平台目录 | 只有只读目录能力，Kiosk P35 仍是静态平台数组；原型写的写接口路径也不成立 | 复用现有目录实体，但 Partner 修改已发布记录会让线上版本失效，因此申请/改稿须有 revision/change-request 或等价发布快照；补 Admin 审核/发布/排序/下架、证据门禁、canonical URL/SSRF 防护、CAS/reason/强审计；Partner 不能发布或排序；P35 只读 ready 投影 |
| AI 配置 | 当前配置可写任意 Base URL，服务端会携带模型密钥访问；扩大「影子测试/一键切换」会放大 SSRF 与密钥外发风险 | DTO 白名单、固定供应商或受控 egress、二次确认、reason、版本/CAS、`writeRequired`、灰度和回滚 |
| AI 运营 | `AiServiceLog` 是 best-effort 观测数据，不能作为账单；事故、降级、质量、Prompt 发布没有完整持久状态机 | `AiUsageLedger` 使用整数最小计费单位或双库验证 Decimal；能力/Prompt 关系完整；预算预占；事故和合规记录；高危写事务化 |
| 权益/补贴 | 当前一张 Grant 可抵整单，尚无服务范围、面值、上限和退款恢复 | W0 先补核销规则、预占/核销/冲正和价目快照；完成前禁止把 Kiosk 用券 CTA 接真 |
| 内容审核 | 原型把未发布内容描述为已曝光，并提供无端点的批量通过/发布 | 先裁决 reviewing claim、批次部分失败、幂等和 CAS；AI 只排序/解释，不能自动审核发布 |
| Partner 统计 | API 与前端 adapter 已存在但 timezone 和响应解包不一致；漏斗缺不可变 `sourceOrgId` 归因 | 先修现有基础 stats 合同；再加写时归因快照、N≥5 聚合、无个人明细；曝光/跳转不得写成投递/预约 |
| Partner 权限 | 当前主要只有 `role=partner + orgId`，五类机构菜单与能力没有服务端统一投影 | 先做 org-type capability 真值与 API/路由守卫，再做动态侧栏；必须覆盖跨机构和深链负向测试。对象不存在与他租户对象应采用统一不泄露策略，现有 404 可保留，不为迎合文档强改成可枚举 403 |
| Partner 账号/工单 | `/account` 是空壳；高风险账号端点由 Admin 守卫；没有 Ticket 模型 | 子账号角色/配额/操作日志可独立设计；手机换绑/删除保留 step-up 或支持流程；先有 Ticket 状态机再启用支持 Tab |
| Partner 数据源/招聘会 | 基础 CRUD 已有，但凭证轮换、测试、手动同步、归档、映射建议及招聘会子资源仍缺 Partner 契约 | 全部按本机构归属校验；凭证永不回显；命令幂等、审计、失败可重试；大页面先拆分再扩展 |

### 6.3 双后台实施顺序

1. **C0 事实冻结**：修正 47/48、路由、现有端点和错误包络；生成 5303 全控件 action manifest，删除 `javascript:void(0)` 生产策略。
2. **C1 快速真实闭环**：先修 Partner `/stats` 已有契约并填真实基础统计；不等待 AI 内核，也不伪造漏斗。
3. **C2 内容治理闭环**：Online Platform Admin 治理 → Partner 申请 → Kiosk P35 发布投影；同步完成来源 URL 安全与审计。
4. **C3 AI 配置底座**：先堵 Base URL/凭证/审计风险，再做 capability registry、Prompt 版本、shadow test、灰度和回滚；逐能力迁移，禁止一次性重写所有 LLM service。
5. **C4 AI 运营**：账本、预算、质量样本、事故/降级、合规拦截和面试运营；所有高危写必须 reason + step-up/RBAC + CAS + 强审计。
6. **C5 Partner 能力投影**：五类机构服务端守卫先行，再补终端、数据源、招聘会、资料/资质等页面；前端隐藏只是体验层。
7. **C6 账号与支持**：子账号、角色、配额、组织审计和 Ticket 状态机完成后再开放 `/account` 三个 Tab。

每一批都必须同时通过 SQLite 与 PostgreSQL、跨租户负向用例、API contract、Admin/Partner typecheck/lint/build、真实浏览器状态与键盘/焦点验收。高风险写还须验证重复提交、并发 CAS、审计失败回滚和版本冲突。

## 7. 实施顺序与上线定义

不采用“先把所有后端做完、最后统一换皮”，也不采用“先把 45 个静态页搬进 React”。采用垂直业务切片：每一片同时完成 V6 UI、真实数据、API、状态机、错误态、自动化与真机验收。

1. **公共底座**：typed route context、capability guard、站点配置、action manifest、统一 loading/error/empty、帮助、无障碍与 1080×1920 门禁。
2. **身份/会话/文件**：P03/P04/P05/P40，完成 QR/SMS、session lifecycle、upload/takeaway、文件 provenance；W1-D4 durable staging cap 未关闭前不得宣称手机上传商用 GO。
3. **打印/扫描交易履约**：P06/P07/P08/P39/P41，完成核价锁价、权益预占、订单支付、Agent attempt/outcome、退款补偿、真机扫描/出纸。
4. **简历与 AI 资产**：P09–P12、P20、P22、P25/P26、P28、P32/P33；所有输出先落真实 artifact，再开放打印/保存/带走。
5. **招聘/招聘会/政策入口**：P13–P18、P21、P34–P38、P44/P45；只做第三方/官方来源入口，不建平台内投递、签到、邀约或候选人闭环。
6. **我的与权益**：P23/P24/P42/P43，统一数据、删除、记录、通知、反馈、资金与退款真值。
7. **受控能力**：P19/P29/P31/P46 默认关闭，分别通过配置、隐私、法务、图像和硬件门禁后开放。
8. **Admin/Partner**：按 Claude 标记在现有桌面页面中补 AI 运营、内容治理、统计、数据源、工单、账号与 capability projection；不套 Kiosk V6，不新增平行后台壳。

“完成”必须同时满足：无死按钮或本地假成功；双库 CI 通过；浏览器全链通过；真实 Windows Terminal Agent 与 Pantum 真机完成扫描、付款、出纸、异常、退款、清场和跨机规则验收；生产配置、密钥、法务和来源治理通过。任何一项缺失都不得称为可推广商用产品。
