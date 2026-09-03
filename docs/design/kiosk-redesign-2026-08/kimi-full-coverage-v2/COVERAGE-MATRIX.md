# COVERAGE-MATRIX · Kiosk 106 路由青序流光唯一归属台账（v5.0）

> 结论：青序流光是唯一最终静态设计底座。表内每条 route 必须与 `apps/kiosk/tests/visual/route-manifest.ts` 一一对应；分组只复用状态定义，不隐藏 route。
>
> 业务真值优先级：当前 route/component/API/Agent > 青序流光最终宿主 > V3/V6 只读历史参考 > 历史聊天或旧总表。
>
> V3/V6 文件不得作为最终宿主或继续施工；没有青序流光宿主的 route 标记为 `K 待建`。静态 HTML 验收只证明原型表现，不证明 React 接线、API 可用、生产数据、支付、Windows Agent 或奔图真机完成。
>
> **2026-08-25 产品密度规则**：台账的 106 条 route 是功能与状态覆盖清单，不是 106 份独立 HTML 的数量目标。相邻任务优先复用一个青序流光产品工作台，以 route 参数、状态和任务分区承接；每张 1080×1920 页面须消除无意义留白，但保留清晰层级和操作呼吸感，禁止重复入口、卡片墙、虚构结果或用静态页假装 AI/语音/支付/设备已接通。

---

## 一、覆盖字段与状态集

### 1.1 字段

- `入口/出口`：真实用户如何进入与离开，不为孤儿 route 虚构入口。
- `认证`：`公开`、`可匿名`、`会员`、`流程上下文`、`手机辅助`、`能力受控`。
- `底座/处理`：`K`=青序流光最终宿主；`K 待建`=当前尚无青序流光宿主；括号内 V3 仅为只读参考；处理词见 `REUSE-MAP.md`。
- `依赖/边界`：只写当前代码或契约支持的来源；没有依据的能力保持受限或冻结。

### 1.2 共享状态集

| 代号 | 必须覆盖的状态 |
|---|---|
| `S-SHELL` | normal、loading、offline、error、retry；公共终端超时/清场按真实本地会话计时 |
| `S-MEMBER` | signed-out、loading、empty、list/detail、action-pending、action-error、success |
| `S-AI` | idle/input、submitting、result、model-unavailable、failed、retry；无假阶段/假百分比 |
| `S-FLOW` | missing-context、ready、processing、failed、retry、success；成功由真实返回驱动 |
| `S-DIR` | loading、empty、list、filter、error、offline、expired/unpublished；来源三要素与合规外跳 |
| `S-PRINT` | ready、quoting、pay-pending、paid、printing、partial-output、failed、client-status-timeout、result-unconfirmed、completed、refund-info |
| `S-SCAN` | setup、panel-instruction、waiting-delivery、completed、failed、expired、cancelled；无一键启动/页级硬件事件 |
| `S-CODE` | idle、verifying、invalid-or-expired、locked、network-error、success、legacy、hid；8 位新码 + 10 位历史码 |
| `S-CONTROL` | capability-loading、disabled、enabled；当前配置请求失败会 fail-closed 折叠为 disabled，不单画可接线的 error/unknown；disabled 时不得挂载业务页 |
| `S-FROZEN` | unavailable/closed；不画可操作成功闭环 |

### 1.3 AI 增强分类与逐路由门禁

每条 route 必须归入一个 AI 类型；“底部有问小青”不等于该 route 已完成 AI 增强。详细六项契约和禁止判定边界见 `design-system/DESIGN-SYSTEM.md` §7.1--7.3。

| 类型 | route 编号 | 当前任务中的 AI 作用 |
|---|---|---|
| `AI-DIRECT`（16） | 006、008--011、017、061、063--066、069、092、103--105 | 生成、诊断、优化、匹配解释、模拟面试、职业规划、参会计划或受控合同风险提示；必须有真实输入、授权、结果依据、失败和非 AI 回退 |
| `AI-CONTEXT`（51） | 007、012--013、019、021--023、025--026、031、034--036、038--040、042--045、050--052、060、062、067--068、070、075--080、082--084、086--091、093--098、102、106 | 在当前任务附近辅助检索、比较、准备、识别、填写、参数建议或下一步解释；不得用大横幅挤占主内容，不得无输入生成个性化结果 |
| `AI-EXPLAIN`（24） | 001、005、016、018、020、024、027--030、032--033、046、054--057、071--074、085、099、101 | 只解释协议、隐私、权益、支付/打印/扫描/来源等已经返回的确定性事实，并给出人工处理建议；不能改变或推测事实状态 |
| `AI-NONE`（15） | 002--004、014--015、037、041、047--049、053、058--059、081、100 | 登录、手机辅助、待机/清场、冻结能力、兼容重定向等不放页内 AI 控件；保持任务直接、安全、无干扰 |

四类互斥且合计 `16 + 51 + 24 + 15 = 106` 条。编号 034 的 `AI-CONTEXT` 是未来 React 迁移目标：只有真实政策 skill 和当前政策原文上下文传递接通后，才可提供原文解释；当前静态工作台按页内 `AI-NONE` 处理，只保留通用顾问出口，且 `?tab=eligibility` 的资格核对始终保持确定性零 LLM。编号 036 的欢迎空态不因 AI 总量目标强塞页内 AI。编号 051 的 AI 只可建议用户复核疑似隐私内容，材料裁决仍由用户确认；编号 076、085 的 AI 只帮助理解和准备，来源与到场结果仍由系统/来源平台确认。编号 103--105 仅在真实 capability 开启后进入 `AI-DIRECT`；默认关闭时按 `S-CONTROL`，不得展示可使用的 AI 合同审查闭环。

**逐 route 验收字段**：进入页面施工前，在该 route 的原型注释或批次事实表补齐 `ai-mode`、`ai-input`、`ai-consent`、`ai-output`、`ai-failure`、`ai-fallback`、`ai-persistence`。缺任一项，或 AI 失败会阻断原本可完成的非 AI 主任务，该 route 不得标记静态 GO。

---

## 二、106 路由唯一归属台账

| # | route | 大功能 / 小功能 | 完整流程与入口/出口 | 底座 / disposition | 认证 | 状态 / 真实依赖 / 边界 |
|---:|---|---|---|---|---|---|
| 001 | `/` | 首页 / 服务分流与继续办理 | 屏保/返回首页进入；出口到五个 Hub、打印扫描、AI、我的及真实 ContinuePanel | K `01-home` / `keep-repair` (V3 ref `01-home-v6`) | 可匿名 | `S-SHELL`；登录时读会员与可恢复任务；五个 Hub 不得遗漏 |
| 002 | `/login` | 身份 / 登录 | 受保护操作进入；成功回 returnTo，失败留本页 | K `03-login-gate` / `repair-add-state` (V3 ref `03-identity-gate`) | 公开 | 短信/二维码 ticket 真实状态；验证码错误、过期、网络失败 |
| 003 | `/member/qr-login` | 手机辅助 / 扫码登录 | 手机扫描终端二维码进入；成功后回终端等待轮询确认 | K `51-phone-relay?screen=qr-login` / `phone-helper-shared-host` (V3 ref `05-phone-relay`) | 手机辅助 | S11 静态 GO；390x844；ticket 检查、发码/限流、旧码、确认未知/成功；手机页不宣称终端已登录 |
| 004 | `/upload/phone` | 手机辅助 / 文件接力 | 手机扫描上传码进入；上传后回终端确认是否用于本次任务 | K `51-phone-relay?screen=phone-upload` / `phone-helper-shared-host` (V3 ref `05-phone-relay`) | 手机辅助 | S11 静态 GO；390x844；服务端 `expiresAt`、格式/大小/过期/失败/结果未知/留存边界；不计 Kiosk 竖屏页面数 |
| 005 | `/legal/:doc` | 系统 / 协议 | 登录/设置页进入；出口返回来源页 | K `08-legal` / `repair` | 公开 | `S-SHELL`；只渲染真实协议，失败可重试 |
| 006 | `/resume/job-fit` | AI 简历 / 岗位匹配 | 简历/岗位上下文进入；授权后看匹配，出口行动建议 | K `46-resume-decision-workspace?screen=job-fit` / `shared-host-new` (V3 ref `11-jobfit-compare`) | 流程上下文 | `S-AI`；missing/rejected/loading/consent/pick/analyzing/三档结果/AI 不可用/失败；禁伪百分比 |
| 007 | `/resume/job-fit/actions` | AI 简历 / 匹配行动 | 匹配结果进入；出口打印/返回结果 | K `46-resume-decision-workspace?screen=actions` / `shared-host-new` (V3 ref `11-jobfit-compare`) | 流程上下文 | 真实 taskId 与 print；missing/loading/ready/print-pending/print-failed；无任务显示 missing-context |
| 008 | `/resume/career-plan` | AI 简历 / 职业规划 | 简历/评估入口进入；出口打印或返回 | K `46-resume-decision-workspace?screen=career-plan` / `shared-host-new` (V3 ref `22-career-plan`) | 流程上下文 | `S-AI`；missing/loading/generating/ready/AI 不可用/失败/打印失败；匿名不写“已保存” |
| 009 | `/interview/setup` | AI 面试 / 训练设置 | 面试 Hub 进入；创建会话后到 session | K `29-interview-training` / `repair` (V3 ref `20-interview-pod`) | 可匿名 | `S-AI`；语音 capability 不可用时降级文字 |
| 010 | `/interview/session` | AI 面试 / 多轮作答 | setup/恢复进入；结束到 report | K `29` / `add-state` (V3 ref `20`) | 流程上下文 | 会话恢复、逐题提交、语音失败、网络中断；无假面试官在线 |
| 011 | `/interview/report` | AI 面试 / 单次报告 | session 完成进入；出口打印/历史 | K `29-interview-training?state=report-loading|report-ready|report-unavailable|report-print-pending|report-print-failed` / `shared-host-add-state` | 流程上下文 | 会话/凭证加载、完整报告信息结构、过期/无权、真实文件生成与失败回退；不评分排名、不固定成功 |
| 012 | `/interview/tips` | AI 面试 / 技巧 | 面试 Hub 进入；出口 setup/Hub | K `29-interview-training?state=tips` / `shared-host` | 公开 | 同页承载准备清单、STAR、高频问答展开与自我介绍结构；公开内容不伪装个性化 AI |
| 013 | `/interview/reports` | AI 面试 / 历史报告 | 面试 Hub/我的进入；查看或删除 | K `29-interview-training?state=reports-guest|reports-loading|reports-empty-member|reports-ready|reports-delete-failed|reports-error` / `shared-host-add-state` | 可匿名 | 游客短期边界；会员本人列表/空态/加载/错误、仅有报告可查看、两次确认删除及失败保留列表 |
| 014 | `/screensaver` | 系统 / 待机 | 空闲进入，触摸回首页 | K `00-standby` / `keep` (V3 ref `02-standby`) | 公开 | 真实宣传物料或诚实回退；不打断进行中任务 |
| 015 | `/session-timeout` | 系统 / 会话超时 | 本地空闲计时触发；延时返回或清场回首页 | K `04-session-guard` / `repair` (V3 ref `40-session-safety`) | 会话 | 本地先清敏感数据；不虚构离人传感器或服务端倒计时 |
| 016 | `/error-offline` | 系统 / 离线 | 健康检查失败进入；恢复回来源页 | K `09-system-state` / `repair` (V3 ref `04-system-states`) | 公开 | 只列已验证的离线能力；不得宣称 U 盘打印/扫描到 U 盘已真机通过 |
| 017 | `/assistant` | AI 顾问 / 通用问答 | 首页/政策 Hub 进入；意图跳转到真实 route | K `05-ai-cockpit` / `repair-add-state` (V3 ref `25-advisor`) | 可匿名 | `S-AI`；当前只读 `?intent=`，不得把 `state.topic` 画成已生效；政策入口文案为“打开 AI 顾问” |
| 018 | `/profile` | 我的 / 概览 | 底栏进入；出口各 `/me/*` 或登录 | K `30-my-profile` / `repair` (V3 ref `23-me`) | 可匿名 | signed-out/会员概览/待办；真实 PendingTaskBanner |
| 019 | `/me/resumes` | 我的 / 简历 | profile 进入；查看/删除/去优化 | K `39-member-records?view=resumes` / `shared-host` (V3 ref `42-my-assets`) | 会员 | `S-MEMBER`；本人数据与删除结果 |
| 020 | `/me/print-orders` | 我的 / 打印订单 | profile/ContinuePanel 进入；取消/恢复进度 | K `38-member-assets` / `shared-host-add-state` (V3 ref `43-my-records`) | 会员 | `S-MEMBER`；订单真实状态，失败原因使用安全文案 |
| 021 | `/me/documents` | 我的 / 文档 | profile/材料完成进入；预览/再打印/删除 | K `38-member-assets` / `shared-host-add-state` (V3 ref `42-my-assets`) | 会员 | `S-MEMBER`；页内真实预览，格式不可预览时诚实降级 |
| 022 | `/me/favorites` | 我的 / 收藏 | profile/岗位详情进入；出口岗位详情 | K `39-member-records?view=favorites` / `shared-host` (V3 ref `42-my-assets`) | 会员 | `S-MEMBER`；真实收藏，空态不造数据 |
| 023 | `/me/ai-records` | 我的 / AI 记录 | profile 进入；查看/删除对应会话 | K `39-member-records?view=ai-records` / `shared-host` (V3 ref `43-my-records`) | 会员 | 已含岗位 AI 会话；面试报告由 `/interview/reports` 分开承载 |
| 024 | `/me/benefits` | 我的 / 权益台账 | profile/活动领取进入；出口可用服务 | K `31-benefits` / `repair-add-state` (V3 ref `24-benefits`) | 会员 | Benefit 领取/台账真实；无打印折扣或 AI 抵扣承诺 |
| 025 | `/me/activity` | 我的 / 行为记录 | profile 进入；出口详情/来源页 | K `39-member-records?view=activity` / `shared-host` (V3 ref `43-my-records`) | 会员 | 浏览/外跳记录，不记录投递或预约结果 |
| 026 | `/me/activity/:id` | 我的 / 行为详情 | activity 列表进入；返回列表 | K `39-member-records?view=activity-detail` / `shared-host` (V3 ref `43-my-records`) | 会员 | loading/not-found/detail/error；不展示平台无法证明的外部结果 |
| 027 | `/me/notifications` | 我的 / 会员通知 | profile 进入；读/标记 | K `35-notifications` / `shared-host` (V3 ref `43-my-records`) | 会员 | `S-MEMBER`；持久化会员通知；不存在已实现的顶栏临时通知双轨 |
| 028 | `/me/feedback` | 我的 / 意见反馈 | profile/help 进入；提交后留结果页 | K `40-member-feedback` / `shared-host` (V3 ref `43-my-records`) | 会员 | `S-MEMBER`；真实提交、失败重试 |
| 029 | `/me/settings` | 我的 / 设置与退出 | profile 进入；协议/退出/切换账号 | K `30` / `repair-add-state` (V3 ref `23b-account-privacy`) | 可匿名 | 只画已实现设置；退出必须真登出与清场 |
| 030 | `/me/privacy-requests` | 我的 / 隐私请求 | settings 进入；提交/查询/撤回授权 | K `41-member-privacy` / `shared-host` (V3 ref `23b-account-privacy`) | 会员 | `S-MEMBER`；真实 data request/consent 状态 |
| 031 | `/help` | 系统 / 帮助 | 首页/错误页进入；出口对应真实功能或反馈 | K `06-help` / `repair` | 公开 | 只描述当前已上线或明确受限能力 |
| 032 | `/activities` | 权益 / 活动列表 | 首页/权益进入；出口活动详情 | K `31` / `add-state` (V3 ref `24`) | 可匿名 | loading/empty/list/error；领取需登录 |
| 033 | `/activities/:id` | 权益 / 活动详情与领取 | activities 进入；成功到 `/me/benefits` | K `31` / `add-state` (V3 ref `24`) | 可匿名 | 已结束/领完/未登录/claim-pending/success/error |
| 034 | `/renshi` | 政策 / 列表、办事、条件核对 | 政策 Hub 进入；tabs 内浏览/核对/外跳官方来源 | K `48-policy-workspace` / `shared-host-new` (V3 ref `21-policy`) | 公开 | S9 静态 GO；`S-DIR`；资格核对只认两个确定性端点、零 LLM；政策专属 skill/原文上下文未接通前，页内按 `AI-NONE`，只可外出到通用顾问 |
| 035 | `/campus` | 校园 / 校招服务 | 招聘会/服务入口进入；出口企业、展区、欢迎页 | K `49-campus-workspace?screen=campus` / `shared-host-new` (V3 ref `18-campus`) | 公开 | S9 静态 GO；真实招聘会/企业/展区/统计链；loading/empty/error；AI 参会准备须使用本次确认的简历上下文并可降级 |
| 036 | `/campus/welcome` | 校园 / 招聘迎新空态 | campus 进入；出口返回 campus | K `49-campus-workspace?screen=welcome` / `shared-host-new` (V3 ref `18-campus`) | 公开 | S9 静态 GO；只承载当前 React 的独立迎新空态并返回校园招聘，不误复用智慧校园通用报到，也不强塞页内 AI |
| 037 | `/campus/freshman-insights` | 校园 / 新生洞察 | 深链兼容；出口 campus | 无需新页 / `frozen` | 公开 | `S-FROZEN`；开关强制关闭，不画业务成功态 |
| 038 | `/toolbox` | 扩展 / 百宝箱 | 首页/服务页进入；站内、二维码或外链启动 | K `50-capability-zone-workspace?screen=toolbox` / `shared-host-new` | 能力受控 | S10 静态 GO；5 态；真实配置项才展示；当前 `AI-NONE`，不替第三方推荐或背书 |
| 039 | `/smart-campus` | 扩展 / 智慧校园首页 | 首页/校园进入；出口 welcome/service | K `50-capability-zone-workspace?screen=campus` / `shared-host-new` | 能力受控 | S10 静态 GO；7 态；enabled 才挂载真实首页；当前 `AI-NONE`，不编造学校安排 |
| 040 | `/smart-campus/welcome` | 扩展 / 智慧校园欢迎 | smart-campus 进入；出口 service | K `50-capability-zone-workspace?screen=campus-welcome` / `shared-host-new` | 能力受控 | S10 静态 GO；2 态；唯一真实 AI 交接到 `/resume/source?intent=diagnose`，本页零输入、零结果 |
| 041 | `/smart-campus/freshman-insights` | 扩展 / 新生洞察 | 深链；出口 smart-campus | 无需新页 / `frozen` | 能力受控 | `S-FROZEN`；当前 module 关闭 |
| 042 | `/smart-campus/service/:key` | 扩展 / 校园具体服务 | smart-campus 进入；返回首页 | K `50-capability-zone-workspace?screen=campus-service` / `shared-host-new` | 能力受控 | S10 静态 GO；7 态；not-found 与 module-blocked 分离；当前 `AI-NONE`，不生成材料、地点或时间 |
| 043 | `/print-scan` | 打印扫描 / 服务 Hub | 首页进入；出口打印、扫描、图片转 PDF、签名盖章 | K `10-print-hub` / `keep-repair` (V3 ref `39-print-hub`) | 可匿名 | capability loading/error/通道锁定；设备状态真实轮询 |
| 044 | `/print-scan/feature/:key` | 打印扫描 / 功能说明 | Hub 进入；出口对应流程或返回 | K `10` / `shared-host-add-state` (V3 ref `29-id-photo`) | 可匿名 | key not-found；证件照 info-only/未开放；不画假闭环 |
| 045 | `/print-scan/convert` | 文件工具 / 图片转 PDF | Hub/上传进入；完成到 material-check/我的文档 | K `19-img2pdf` / `repair-add-state` (V3 ref `08-file-tools`) | 可匿名 | `S-FLOW`；真实合成、失败、隐私门控 |
| 046 | `/print-scan/sign` | 文件工具 / 签名盖章 | Hub/上传进入；未登录先引导登录，完成到预览/打印 | K `20-sign-stamp` / `repair-add-state` (V3 ref `08-file-tools`) | 可匿名 | `S-FLOW`；实名合成操作需会员；图片合成，不称 CA 电子签名/电子印章 |
| 047 | `/print/scan-convert` | 兼容 / 图片转 PDF | 旧入口进入；重定向 045 | 045 / `redirect` | 同目标 | 不新增 HTML |
| 048 | `/print/scan-sign` | 兼容 / 签名盖章 | 旧入口进入；重定向 046 | 046 / `redirect` | 同目标 | 不新增 HTML |
| 049 | `/print/scan-feature` | 兼容 / 证件照说明 | 旧入口进入；重定向 044 `id-photo` | 044 / `redirect` | 同目标 | 不新增 HTML；目标保持未开放 |
| 050 | `/print/upload` | 打印 / 文件来源 | Hub 进入；文件落库后到 material-check/preview | K `12-file-source` / `repair-add-state` (V3 ref `06-print-workbench`) | 可匿名 | 本机/手机/U 盘真实通道；格式、大小、过期、设备不可用 |
| 051 | `/print/material-check` | 打印 / 材料隐私检查 | upload 进入；全部裁决后到 preview | K `13-print-desk` / `repair-add-state` (V3 ref `06`) | 流程上下文 | PII 检测/裁决真实；遮挡产物未落地时明确仍用原件 |
| 052 | `/print/preview` | 打印 / 预览与参数 | material-check 进入；出口 confirm | K `13` / `repair-add-state` (V3 ref `06`) | 流程上下文 | 真实 preview URL；仅开放已验证参数，其他锁定 |
| 053 | `/print/params` | 兼容 / 打印参数 | 旧深链进入；重定向 052 | 052 / `redirect` | 同目标 | 页面已下线，不新增 HTML |
| 054 | `/print/confirm` | 打印 / 报价确认 | preview 进入；出口 cashier 或免费任务 | K `14-print-confirm` / `repair-add-state` (V3 ref `06`) | 流程上下文 | 服务端报价唯一真值；权益核销未通不承诺抵扣 |
| 055 | `/print/cashier` | 打印 / 支付 | confirm/续办进入；paid 后到 progress | K `32-cashier` / `repair-add-state` (V3 ref `41-fulfillment-states`) | 流程上下文 | `S-PRINT` 支付子集；成功只认 pay-status/reconcile |
| 056 | `/print/progress` | 打印 / 进度与异常 | cashier/续办进入；完成到 done | K `15-print-fulfill` / `keep-add-state` (V3 ref `41`) | 流程上下文 | `S-PRINT`；Agent 轮询；无假逐页递增 |
| 057 | `/print/done` | 打印 / 完成取件 | progress 真完成进入；出口继续打印、我的打印订单、帮助/反馈或首页 | K `15` / `repair-add-state` (V3 ref `41`) | 流程上下文 | 仅真实 completed；到机码只作为接口返回的凭证展示，本页不导航回认领页 |
| 058 | `/resume` | 兼容 / 简历入口 | 旧入口；重定向 060 | 060 / `redirect` | 同目标 | 不新增 HTML |
| 059 | `/resume/upload` | 兼容 / 简历上传 | 旧入口；重定向 060 | 060 / `redirect` | 同目标 | 不新增 HTML |
| 060 | `/resume/source` | AI 简历 / 来源选择 | Resume Hub 进入；上传后到 parse/generate | K `21-resume-triage` / `keep-add-state` (V3 ref `09-resume-workbench`) | 可匿名 | 本机/手机/U 盘/扫描真实边界；`S-FLOW` |
| 061 | `/resume/generate` | AI 简历 / 从零生成 | Resume Hub/source 进入；完成到 preview | K `24-resume-generate` / `repair-add-state` (V3 ref `10-resume-interview`) | 可匿名 | `S-AI`；填槽保留、语音降级、模型不可用 |
| 062 | `/resume/generate/preview` | AI 简历 / 生成预览 | generate 完成进入；出口导出/打印/保存 | K `24` / `repair-add-state` (V3 ref `10`) | 流程上下文 | 真实 PDF/export；链接过期重生成 |
| 063 | `/resume/parse` | AI 简历 / 解析等待 | source 上传完成进入；完成到 report | K `21` / `keep-add-state` (V3 ref `09`) | 流程上下文 | POST 最终结果；只显示整体等待，无假解析阶段 |
| 064 | `/resume/report` | AI 简历 / 诊断报告 | parse 完成进入；出口 optimize/打印 | K `22-resume-report` / `repair-add-state` (V3 ref `09`) | 流程上下文 | 真实 record；报告打印端点缺失时按钮受限 |
| 065 | `/resume/optimize` | AI 简历 / 优化建议 | report/我的简历进入；出口 compare | K `23-resume-optimize` / `repair-add-state` (V3 ref `09b-resume-optimize`) | 流程上下文 | `S-AI`；真实建议、空、失败 |
| 066 | `/resume/optimize/compare` | AI 简历 / 逐条裁决 | optimize 进入；出口 preview/保存 | K `23` / `keep-repair` (V3 ref `09b`) | 流程上下文 | 采纳/保留/自写；新事实未填不得采纳 |
| 067 | `/resume/export` | AI 简历 / 导出 | 当前孤儿深链；返回 preview | K `24` / `restricted-add-state` | 流程上下文 | 仅诚实 unavailable/missing-context；未接入口前不画完整闭环 |
| 068 | `/resume/templates` | AI 简历 / 模板库 | Resume Hub/generate 进入；选择后回生成流程 | K `46-resume-decision-workspace?screen=templates` / `shared-host-new` (V3 ref `33-resume-templates`) | 可匿名 | loading/error/empty/list/select；选择仅为版式参考，不伪称已应用或已生成 |
| 069 | `/resume/materials` | 求职材料 / 材料工坊 | Resume Hub 进入；生成后到我的文档/打印 | K `25-material-workshop` / `repair-add-state` (V3 ref `12-material-factory`) | 会员 | 模板、生成、失败、登录引导；真实 PDF |
| 070 | `/resume-service` | AI 简历 / 服务 Hub | 首页主卡进入；出口 source/generate/templates/materials/fit/plan | K `16-service-hubs?hub=resume` / `shared-host` (V3 ref `32-resume-hub`) | 可匿名 | S1/S2 静态 GO；共享宿主，不新增第二 HTML |
| 071 | `/scan/start` | 扫描 / 创建会话与面板指引 | Print Hub/source 进入；出口 settings/progress | K `18-scan-workbench` / `repair-add-state` (V3 ref `07-scan-workbench`) | 可匿名 | `S-SCAN`；无浏览器/Agent 一键启动扫描 |
| 072 | `/scan/settings` | 扫描 / 参数说明 | start 进入；出口 progress | K `18` / `repair-add-state` (V3 ref `07`) | 流程上下文 | 只展示服务端/面板支持参数；无未验证硬件控制 |
| 073 | `/scan/progress` | 扫描 / 等待文件回传 | settings/start 进入；完成到 result | K `18` / `repair-add-state` (V3 ref `07`) | 流程上下文 | `S-SCAN`；面板→SMB→Agent→服务端，无页级进度 |
| 074 | `/scan/result` | 扫描 / 结果文件 | progress 真完成进入；出口保存/打印/简历 | K `18` / `repair-add-state` (V3 ref `07`) | 流程上下文 | 真实文件、过期、预览失败、取消；OCR/CV 未实现则锁定 |
| 075 | `/jobs` | 岗位信息 / 列表 | Jobs Hub 进入；出口 detail/平台目录 | K `26-browse-list` / `repair-add-state` (V3 ref `13-jobs-desk`) | 公开 | `S-DIR`；仅审核发布且来源完整 |
| 076 | `/jobs/:id` | 岗位信息 / 详情与 AI 解读 | jobs/favorites 进入；出口来源平台 | K `27-browse-detail` / `repair-add-state` (V3 ref `14-job-detail`) | 公开 | 过期 fail-closed；按钮只用合规外跳文案；AI 独立失败 |
| 077 | `/jobs/:id/offline` | 岗位信息 / 线下岗位详情 | 机构/岗位入口进入；出口机构咨询 | K `42-offline-agency-directory?screen=job` / `shared-host` | 公开 | S6 静态 GO；来源不足不外跳；不做平台投递 |
| 078 | `/offline-agencies` | 岗位信息 / 线下机构目录 | Jobs Hub 进入；出口机构详情 | K `42-offline-agency-directory?screen=list` / `shared-host` | 公开 | S6 静态 GO；`S-DIR`；资质、门店、来源证据 fail-closed |
| 079 | `/offline-agencies/:id` | 岗位信息 / 机构详情 | 目录进入；出口岗位/自行咨询 | K `42-offline-agency-directory?screen=agency` / `shared-host` | 公开 | S6 静态 GO；detail/not-found/error；无资质不显示核验徽章 |
| 080 | `/jobs-service` | 岗位信息 / 服务 Hub | 首页主卡进入；出口 jobs/companies/agencies/platforms | K `16-service-hubs?hub=jobs` / `shared-host` (V3 ref `34-jobs-hub`) | 公开 | S1/S2 静态 GO；共享宿主，不新增第二 HTML |
| 081 | `/notifications` | 我的 / 通知兼容入口 | 历史/外部入口进入；渲染 MyNotificationsPage | K `35-notifications?compat=1` / `shared-host` (V3 ref `43-my-records`) | 会员 | 与 027 同页面状态；不是 Navigate，也不新建第二 HTML |
| 082 | `/companies` | 岗位信息 / 企业目录 | Jobs Hub/招聘会进入；出口详情 | K `43-company-directory?screen=list` / `shared-host` | 公开 | S6 静态 GO；`S-DIR`；真实统计与审核媒体 |
| 083 | `/companies/:id` | 岗位信息 / 企业详情 | companies/招聘会企业进入；出口在招岗位 | K `43-company-directory?screen=company` / `shared-host` | 公开 | S6 静态 GO；detail/not-found/error；媒体缺失不留假图位 |
| 084 | `/job-fairs` | 招聘会 / 列表 | Fairs Hub/校园进入；出口详情 | K `28-jobfair-enhanced` / `repair-add-state` (V3 ref `17-fair-desk`) | 公开 | `S-DIR`；来源完整、已结束状态 |
| 085 | `/job-fairs/checkin` | 招聘会 / 到场指引 | 详情/现场进入；出口来源预约/返回 | K `28` / `repair-add-state` (V3 ref `17b-fair-checkin`) | 可匿名 | 无签到回执，永不显示“已签到”；码过期/未登记/系统不通 |
| 086 | `/job-fairs/:id` | 招聘会 / 详情 | 列表进入；出口企业、地图、材料、计划 | K `28` / `repair-add-state` (V3 ref `17-fair-desk`) | 公开 | 合规预约外跳；结束/下架/空/失败 |
| 087 | `/job-fairs/:id/companies` | 招聘会 / 参展企业 | fair detail 进入；出口公司详情 | K `28` / `repair-add-state` (V3 ref `45-fair-onsite`) | 公开 | loading/empty/list/error；真实名单 |
| 088 | `/fairs-service` | 招聘会 / 服务 Hub | 首页主卡进入；出口 fairs/campus/现场服务 | K `16-service-hubs?hub=fairs` / `shared-host` (V3 ref `36-fairs-hub`) | 公开 | S1/S2 静态 GO；共享宿主，不新增第二 HTML |
| 089 | `/job-fairs/:id/companies/:companyId` | 招聘会 / 参展企业详情 | 087 进入；出口企业/岗位来源 | K `44-fair-company-detail` / `shared-host` | 公开 | S6 静态 GO；not-found/error；不在平台收简历 |
| 090 | `/job-fairs/:id/map` | 招聘会 / 展位地图 | fair detail 进入；出口企业/返回 | K `28` / `add-state` (V3 ref `45`) | 公开 | 有真实图才展示；无图诚实空态；上下文重定向需单独验收 |
| 091 | `/job-fairs/:id/materials` | 招聘会 / 活动物料 | fair detail 进入；出口预览/打印 | K `28` / `add-state` (V3 ref `45`) | 流程上下文 | 真实签名 URL、过期刷新、打印失败 |
| 092 | `/job-fairs/:id/visit-plan` | 招聘会 / AI 参会准备 | fair detail 进入；出口打印/返回 | K `28` / `add-state` (V3 ref `45`) | 可匿名 | `S-AI`；真实生成/打印；无假个性化完成 |
| 093 | `/job-fairs/:id/stats` | 招聘会 / 现场统计 | fair detail 进入；返回详情 | K `28` / `add-state` (V3 ref `45`) | 公开 | 真实统计；无数据为空，不固定数量 |
| 094 | `/resume/self-assessment/intro` | AI 简历 / 自我探索介绍 | Resume Hub 进入；出口 questions/history | K `34-self-assessment` / `repair` (V3 ref `28-self-assessment`) | 可匿名 | 说明、同意/开始；禁人格定型和百分比 |
| 095 | `/resume/self-assessment/questions` | AI 简历 / 测评答题 | intro/恢复进入；出口 result | K `34` / `repair-add-state` (V3 ref `28`) | 流程上下文 | 进度为真实题数；中断保护、缺答案、提交失败 |
| 096 | `/resume/self-assessment/result` | AI 简历 / 测评结果 | questions 完成进入；出口 fit/plan/print | K `34` / `repair-add-state` (V3 ref `28`) | 流程上下文 | 真实描述与建议；无排名/百分比类型标签 |
| 097 | `/resume/self-assessment/history` | AI 简历 / 测评历史 | intro/profile 进入；出口 result | K `34` / `restricted-add-state` (V3 ref `28`) | 会员 | 当前硬编码空；只画诚实空/未接，不造历史记录 |
| 098 | `/interview-service` | AI 面试 / 服务 Hub | 首页主卡进入；出口 setup/tips/reports | K `16-service-hubs?hub=interview` / `shared-host` (V3 ref `37-interview-hub`) | 可匿名 | S1/S2 静态 GO；共享宿主，不新增第二 HTML |
| 099 | `/print/pickup-claim` | 打印 / 到机码认领 | 首页/取件入口进入；成功释放任务到进度/完成 | K `11-arrival-code` / `repair` (V3 ref `47-arrival-code`) | 公开 | `S-CODE`；**8 位数字新码 + 10 位历史码**；不存在/错终端统一模糊错误，真实过期/不可用可用安全文案区分；限流/锁定服务端驱动 |
| 100 | `/ai/plan` | AI / 方案页 | 当前无真实调用入口；手工深链返回首页 | 无需新增 / `frozen-remove-candidate` | 流程上下文 | `S-FROZEN`；无 AI 调用，只能诚实空态 |
| 101 | `/session-resume` | 会话 / 待办续办 | 首页 ContinuePanel / 我的待办进入；列 pending tasks，出口 cashier/progress | K `07-session-resume` / `shared-host-review` (V3 ref `40-session-safety`) | 会员 | `GET /me/pending-tasks`；loading/error/empty/list；首页与“我的”复用同一续办工作台，不新增第二页面 |
| 102 | `/jobs/online-platforms` | 岗位信息 / 官方平台目录 | Jobs Hub 进入；出口来源平台 | K `45-online-platform-directory` / `shared-host-restricted` | 公开 | S6 静态 GO；不能宣称 Admin 审核/API 已接，需真实来源校验 |
| 103 | `/contract-review` | 求职材料 / 合同审查入口 | feature flag 开启后从工具/材料进入；出口 processing | K `47-contract-review-workspace?screen=home` / `controlled-shared-host` (V3 ref `31-contract-review`) | 能力受控 | S8 静态 GO；`S-CONTROL`；默认 off，关闭时不挂载业务流程；真实 consent/capability 返回后才可提交 |
| 104 | `/contract-review/processing` | 求职材料 / 合同处理 | 103 提交进入；成功到 result | K `47-contract-review-workspace?screen=processing` / `controlled-shared-host-add-state` (V3 ref `31-contract-review`) | 能力受控+流程上下文 | S8 静态 GO；真实任务状态、低置信确认、失败、重试、取消与过期；禁固定计时成功 |
| 105 | `/contract-review/result` | 求职材料 / 合同结果 | 104 完成进入；出口打印/返回 | K `47-contract-review-workspace?screen=result` / `controlled-shared-host-add-state` (V3 ref `31-contract-review`) | 能力受控+流程上下文 | S8 静态 GO；真实结果/证据/不可用、打印生成与删除返回；不构成法律意见，不承诺服务端即时删除 |
| 106 | `/policy-service` | 政策 / 服务 Hub | 首页主卡进入；出口 renshi tabs/通用 AI 顾问 | K `16-service-hubs?hub=policy` / `shared-host` (V3 ref `38-policy-hub`) | 公开 | S1/S2 静态 GO；AI 文案中性，不承诺个性化补贴资格 |

---

## 三、机械核验规则

### 3.1 必须满足

1. `route-manifest.ts` 共 106 条，本表必须也是 106 行。
2. 每条 manifest route 在表内恰好出现一次；不得漏、不得重复。
3. 兼容重定向仍占一行，但 disposition 必须是 `redirect` 且不新建业务 HTML。
4. `/member/qr-login`、`/upload/phone` 占 route 台账，但标记为手机辅助，不计 1080×1920 Kiosk 页面施工。
5. 多 route 可共享同一 HTML/state host；页面数、route 数、state 数分别统计，禁止混算。

### 3.2 当前分类摘要

- `redirect`：047、048、049、053、058、059，共 6 条。
- `phone-helper`：003、004，共 2 条。
- `controlled`：038、039、040、042、103、104、105，共 7 条。
- `frozen/remove-candidate`：037、041、100，共 3 条。
- 青序流光宿主已归属：97 条；`K 待建`：0 条。另有 6 条 `redirect` 与 3 条 `frozen/remove-candidate` 无需新增宿主，三类合计覆盖 106 条 route。
- `shared-host/review/restricted` 不等于删除 route；须保留真实边界和诚实状态。

---

## 四、硬件与合规总边界

1. 打印成功只认 API/Terminal Agent 回流；无真实页级回流时不得展示逐页递增。
2. 扫描只认“奔图面板手动扫描 → SMB → Agent `scanWatchFolder` → 服务端”；无 React/TWAIN/WIA 一键启动，无盖板、无纸、卡纸、ADF 页级事件；该链路尚未完成目标 Windows + 奔图真机全链路验收。
3. 打印机型号通过 `printerName` 配置，禁止硬编码；不得假设 A3、彩色 mode、双面或特殊纸张已开放。
4. 嵌入式扫码器是 USB HID 输入，无在线遥测；到机码当前为 8 位数字新码 + 10 位字母数字历史码。
5. 麦克风仅浏览器探测可用时启用，失败降级文字；摄像头软件未接通，不画视频面试、人脸识别或离场检测。
6. 岗位和招聘会只做第三方/官方来源入口；按钮使用“去来源平台投递/扫码投递/去来源平台预约/扫码预约”。
7. 不开发平台内投递、收简历、企业筛选、面试邀约、Offer、候选人推荐或企业自助发布收件闭环。
8. AI、支付、硬件、文件、政策和外部来源不可用时必须展示诚实失败/受限状态，不用演示数据填满页面。
