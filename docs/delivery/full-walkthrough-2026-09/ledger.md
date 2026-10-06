# 四端全功能模拟走查 · 验收底账（2026-09-29 起）

> 产品负责人 9/29：用模拟数据按正常使用方式把所有功能走一遍，找出断点、走不通、数据显示有问题的地方，
> 汇总、评审、设计、修复。开发完不算完成，要站在用户角度实际操作一遍。
>
> 「做完」标准：从真实入口一路操作到拿到结果（纸、文件、报告、二维码、记录）；数据正确（存了还在、两端同一份、
> 两后台数字对得上）；出错、空态、断网、AI 挂了都有下一步；证据用真后端走一遍。
>
> **10/6 起本文是验收底账，不是交接文档。** 产品负责人 10/6 批准全面检查报告第 14 条：总表从走查分支
> `claude/full-walkthrough-20260929` 的 `docs/reviews/full-walkthrough-2026-09-29.md` 移到这里；之后每次发布前复走
> （第六次 10/9、第七次 10/16、第八次 10/30、第九次 11/13、正式发布 11/20）与前端照稿补齐后的复走，都更新本文。
>
> 状态列以「10/6 核对：」开头的，是 10/6 按线上 `e2e530a29`、候选 `07e0ad943` 与各 PR 状态重新核过的
>（已合 PR 用合并提交做祖先判定，「仍在」对候选代码核到 文件:行）；其余行保留登记当时的状态。
> 「五、闭环矩阵」是 10/4 晚按已有证据整理的四端覆盖表，走通 / 走不通 / 没走都附证据位置。
>
> **证据层级：本地全栈 + 模拟外部服务。** 不代表生产验收、真实 AI、真实支付、真实短信或真实出纸。
> 上一轮（一体机与两后台）见 [kiosk-full-walkthrough-2026-09-27.md](../../reviews/kiosk-full-walkthrough-2026-09-27.md)，
> 本文沿用它的编号与格式，并逐条复核那一轮的问题。场景清单见 [附录](scenarios.md)。

## 一、环境（9/29 起好）

| 项 | 取值 | 与生产的差别 |
|---|---|---|
| 代码 | 候选 `claude/codex-task-history-progress-0de1dc`：9/29 下午 `586bf279c` 起环境，17:14 起并到 `3841b823a` 重建 | 修复合入后换新候选复走 |
| 数据库 | 本机独立 PostgreSQL 16（端口 4332，库 `walk_dev_0929`），`db:pg:deploy` 按生产迁移建表 | 同类库；空库起步 |
| Redis | 本机独立实例（端口 4379，不与其他窗口共用编号库） | — |
| API | `NODE_ENV=development`，端口 4300；开关按第一次发布表（见下） | 开发模式；生产启动门禁不跑 |
| 一体机 / 管理员 / 机构 | 三端都用 `vite build` 正式构建产物，由本地静态托管加 `/api` 反代（模仿生产 nginx，`scripts/walkthrough/static-proxy.mjs`），端口 4310 / 4320 / 4330 | 非 https；一体机网桥地址改成 4350 |
| 初始管理员 | 用生产同款 `bootstrap:first-admin`（只建一个管理员、临时密码、首登强制改密）建 `walkadmin`；**不跑 `db:seed`**，库里没有任何种子机构、终端、岗位 | — |
| 大模型 | 本地 OpenAI 兼容假服务（端口 4340），按功能返回合规格式内容，可切超时 / 500 / 格式错 / 内容被拦 | 不是真实模型；候选上后台拒绝回环地址（`assertPublicLlmBaseUrl`），#1077 合入前按总指挥口径直接写演示库配置 |
| OCR | 本地假百度 OCR（端口 4341，`BAIDU_OCR_BASE_URL`），可切低置信 / 空 / 报错 / 超时 | — |
| 短信 | `SMS_PROVIDER=log`，验证码从 API 日志取 | 生产是腾讯云 |
| 支付 | `PAYMENT_PROVIDER=sandbox`；价目 0 元时服务端直接建免费单，不走支付 | 生产 disabled |
| 终端 Agent | 模拟 Agent（`scripts/walkthrough/sim-agent.mjs`）：绑定码开通、心跳、领任务、校验、回写打印中 / 完成 / 缺纸 / 卡纸 / 未确认；本机网桥（身份、启动票、扫码登录、U 盘目录、扫描收件目录、打印唤醒） | 不调打印机；**缺纸只在模拟 Agent 和会写状态的驱动上成立**，真奔图驱动不报缺纸（见 R 类说明） |
| 数字人 / 语音 | 一体机按文字助手构建（`VITE_ALLOW_TEXT_ONLY_ASSISTANT=true`），ASR 关 | 待真实凭证 |
| Word 转换 | 本机未装 LibreOffice，`CONVERSION_ENGINE=disabled` | 生产是 soffice |

### 第一次发布开关（本地按此设置）

| 项 | 取值 |
|---|---|
| 招聘内容托管 | 关（托管 a） |
| 价目 | 黑白、彩色两行 0 元「免费试运营」；`resume_export` 0 元启用 |
| 法务文档 | 用户服务协议、隐私政策、AI 服务说明三份激活；经营者信息不激活；`LEGAL_DOCS_REQUIRE_PUBLISHED=true` |
| AI 四开关 | 登录档位 off、使用声明不强制、暂停关、维护关（存 Redis `system:ai-access:*`，30 秒缓存） |
| AI 功能位 | 15 个都开 |
| 签名、彩色、双面 | 不登记（未登记即拒） |
| 隐私检查 / 打印机须在线 | `PRINT_REQUIRE_PII_SCAN=true`、`PRINT_REQUIRE_PRINTER_ONLINE=true`、`PRINT_SCAN_CAPABILITY_MODE=managed` |
| 终端开通 | `TERMINAL_LEGACY_REGISTER_ENABLED=false`、`TERMINAL_PLANNED_PROVISIONING_ENABLED=true`（只能后台预建 + 绑定码） |
| 服务提供者隐式标识 | `AIGC_CONTENT_PRODUCER` 写演示值，不写真实信用代码 |

## 二、分工与方法

| 层 | 谁 | 做什么 |
|---|---|---|
| 场景 | agy | 六类人群的正常路径 + 走错 / 返回 / 超时 / 换人 / 断网 / AI 挂 / 没纸，及跨端对账点（附录） |
| 实操 | Claude（子代理跑 Playwright，逐屏人工看） | 管理员与机构按正常操作建数据；一体机全部路由按场景走；每步截图、记操作流水 |
| 小程序 | 小程序窗口 | 在开发者工具里走全部页面，并与一体机对账 |
| 两后台 | 两后台窗口 3.8 走查清单 | 后台页面问题用它的结果，不另走一遍 |
| 读代码 | Codex（只读，xhigh） | 9/27 问题逐条复核；18 条旅程从按钮读到库再读回显示 |
| 反方评审 | agy | 总表 v1 的漏链、级别、同根因合并 |

## 三、操作流水与对账

9/29 已完成：管理员首登改密、两家机构（含可信与域名）、终端 WALK-001 预建 + 绑定码开通（模拟 Agent 兑换，心跳正常）、三份法务文档激活、屏保素材与方案、机构 A 两条官方渠道与三条政策（两条发布、一条待审）、机构 B 一条政策，全部经界面点击完成（Playwright，截图 108 张、流水 124 行在本机 `~/.cache/walk0929/evidence/setup/`）。价目两行按运维 SQL 补（W-02）。AI 槽位后台保存被 `AI_BASE_URL_PRIVATE` 拒（预期），按总指挥口径用种子写配置指向假模型。
一体机三路（打印扫描 / AI / 我的与文案巡检）15:12 整机中断、无产出；17:12 环境重启（`~/.cache/walk0929/start-all.sh`）后重派，Codex 两路同时重派。

小程序：职易达小程序窗口待总指挥确认名称后发送地址与账号（「小程序目录确认」窗口是另一个美业小程序项目，与本次走查无关）。

## 四、问题总表

编号沿用 9/27：C = Claude，F = Codex，A/B = 9/27 Grok，P = 机构后台，W = 本轮新增（W 后接序号）。
状态：仍在 / 已修 / 回归 / 新增 / 已派 / 修复中 / 已复走通过。

### 4.1 9/27 问题逐条复核

来源：Codex A 只读逐条读代码（基准 `3c1b38e39`，含 `3841b823a`），走查窗口用 9/29 实走结果交叉核对；「实走」一列是本轮在正式构建上亲眼看到的。计数：已修 27、部分修 3、仍在 22、回归 0、代码无法判定 10（其中 C-12、C-13、A-06、F19 在 9/27 表里本就没有定义）。

| 编号 | 现状 | 实走 | 证据 / 说明 |
|---|---|---|---|
| C-01 | 已修 | 通（K1、K2 预览逐页显示中文） | `PdfPreviewFrame.tsx` 改为 canvas 逐页渲染（`2023246ae`） |
| C-02 / A-03 | 已修 | 通（打印台不再复水上一位；K4 退出残留只剩边界键） | 换票前清敏感状态（`6825c664a`）；清场前窗口的新问题见 W-42/W-75 |
| C-03 | 部分修 | 部分（协议已上移；验证码框不聚焦、键盘遮住「获取验证码」） | 并入 W-54 |
| C-04 / C-05 / C-09 / F17 | 仍在 | 仍在 | 「能力配置」「当前题库（v1）」「空就是空」、英文眉题等；并入 W-53（「服务端」「会话」用户可见已清零） |
| C-06 / B-10 / A-09 | 仍在 | 仍在 | 政策页「管理员审核后展示」、隐私页「撤回岗位 AI 授权」（W-48） |
| C-07 | 仍在 | — | `SessionResumePage.tsx:95,100-103` 两个「去打印扫描」 |
| C-08 / A-07 | 仍在 | 本轮未触发（价目已配） | 缺价目不单独说原因（`PrintConfirmPage.tsx:193-197`） |
| C-10 | 仍在 | 仍在（K3 路由巡检大量 16px 按钮字） | — |
| C-11 / C-14 | 已修 | 通（备案号为文字、终端不弹系统文件框） | `c50393dc4` |
| C-15 | 已修 | 通（中文 PDF 预览与检查正常） | CMap 预置（`779f36c76`） |
| F01 / F14 / F16 / F20 | 已修 | 大体通；返回修改后再打印的变体见 W-47 | 统一打印交接上下文（`30175b419`） |
| F02 | 已修 | — | 参数按本机能力降级 |
| F03 | 部分修 | 通（本机签名未开通，接口 403） | 服务端仍只按用途收任意图片；签名能力第一次发布关闭 |
| F04 / F06 / F18 | 已修 | — | TRTC 终端身份守卫；样例开关只在开发构建 |
| F07 | 已修 | 半通（记录能打开，但诊断/优化打开后「还没有诊断报告」→ W-47，#1107 修） | `3e36bdcb8` |
| F08 | 仍在 | — | 小青摘要只显示标题与时间，不显示摘要正文 |
| F09 / F10 / F21 / B-14 / B-11 / B-07 | 已修 | 通 | — |
| F11 | 仍在 | 仍在（K1：登录后 U 盘导入进材料检查 403 空页 → W-76） | 导入不带会员令牌 |
| F12 | 仍在 | — | 试点后再议（W-10） |
| F13 | 已修 | 通（文档 62、跳转 56 可加载更多） | 小程序半边仍缺（W-32） |
| F15 | 已修 | 通（K2 优化等待约 90 秒未被清场） | `78defa2dd` |
| A-04 | 仍在 | 仍在（= W-17） | 服务端 `pii-scan-gate.ts:74-79` 仍要求扫描完成，#1068 的本人确认未接到一体机 |
| A-05 | 仍在 | 未复现空等（K1 扫描投递正常） | 页面仍写「接收目录已由管理员配好」、未探测本机程序 |
| A-08 | 仍在 | — | 空白页判定 0.3 缩放 + 99% 白像素 |
| A-10 | 仍在 | 仍在（W-07） | 管理员侧栏招聘类入口 |
| A-11 | 仍在 | — | 文件页 `window.confirm` |
| B-03 | 仍在 | 仍在 | 「自己写」不进导出稿 |
| B-06 | 部分修 | — | AI 挂掉有通用题目单，但先建会话再出题 |
| B-09 | 已修 | 通（登录页写中文页名） | 使用时限页仍显示原始路径 → W-65 |
| B-12 | 已修（#1149） | 通过（9565ee6bc 复核：「我的 → 结束使用」与「账号设置 → 结束使用并退出登录」都落首页、未登录） | `MySettingsPage.tsx:134-138` |
| P-01 / P-02 / P-03 | 已修 | 通（K3 下架后机构端冻结） | — |
| P-04 | 仍在 | 仍在（机构 13 项指标待补） | 并入 W-69 |
| B-04 / B-05 / B-08 / B-13 / B-15 / F05 | 代码无法判定 | 本轮用假大模型走到结果（B-04/B-05 已通）；B-08 扫码登录两端同步实测已通过（9/29 22:02）；B-15 Word 转换本地未装 | — |

### 4.2 本轮新增

| 编号 | 级别 | 端 | 问题 | 证据与根因 | 归属窗口 / 实现方 | 状态 |
|---|---|---|---|---|---|---|
| W-01 | **P0**（法定投诉渠道，agy 评审上调；#1100 已修） | 一体机 | 一体机没有可点的「AI 内容投诉」入口：词表有 `ai_content_complaint`，但打印完成页、打印扫描首页两个反馈子集都不含；「我的反馈」类别只有 4 类（`apps/kiosk/src/pages/profile/me/feedback/types.ts:4-9`，`services/api/memberFeedback.ts:11` 类型也没有）。小程序已有 | 代码核对 | 走查窗口 / Claude 子代理 | 已合入候选（#1100，走查全栈已走通：入口→反馈已选中→提交→我的反馈→管理员后台类别正确） |
| W-02 | P1 | 管理员后台 | 新生产库上后台建不出黑白/彩色打印价目：计费页只渲染已有行，服务端只自动补 `resume_export`（`admin-billing.service.ts:40`），不存在的行返回 `PRICE_CONFIG_NOT_FOUND`（:121）→ 报价失败。本地按 `docs/operations/price-config-production.md` 的 SQL 补齐 | UI 实操截图 setup/ 第 3 项 | 后端窗口（接口）+ 两后台窗口（新建入口） / 待定 | 10/6 核对：已修·在线上（#1098） |
| W-03 | P1（优先） | 机构后台 | 管理员新建的机构账号永远验证不了手机号：每次登录弹「手机号本人验证」，获取验证码 409 `ACCOUNT_PASSWORD_PROOF_NOT_READY`，只能「稍后验证」（`password-proof-state.ts:16`、`auth.service.ts:648-656`）；也不强制首登改密 | UI 实操截图 61–62、89–90 | 后端窗口（接口）+ 两后台窗口（登记手机号按钮） / 待定 | 10/6 核对：已修·在线上（#1128、#1133、#1140）；「不强制首登改密」那半句未核实 |
| W-04 | P2 | 管理员后台 | 从没连过的终端显示「最近心跳 刚刚」：心跳空时回落 `lastSeenAt`（`@updatedAt`，任何编辑都刷新）（`terminals/index.tsx:767`） | 截图 22、25 | 两后台窗口（前端）+ 后端窗口 / 待定 | 10/6 核对：已修·在线上（#1113 服务端 lastHeartbeatAt、#1141） |
| W-05 | P2 | 管理员后台 + 小程序 | 绑定码兑换时 Agent 上报的名称覆盖管理员设的终端名（小程序选终端页因此显示「测试·模拟终端」而不是管理员设的「测试·崂山零工之家 1 号机」）（`terminal-credential-security.service.ts:248`） | 截图 60 | 后端窗口 / 待定 | 10/6 核对：已修·在线上（#1113，14f3ab46c） |
| W-06 | P1 | 两后台 | 工程词与原始 ID 给运营看：工作台「最近操作」`policy.publish`、`terminal.bind_code.exchange`、账号 ID；「contentTrustStatus=active」；设备总览「F1/F2 CLOSED_MODE」；「fail-closed 口径」；机构端每页「不直接对应前端页面」；「info-only」；星号原样显示（`partners/index.tsx:725`）；AI 调用 0 次显示成功率 0% | 截图 58、107 等 | 两后台窗口 / 待定 | 10/6 核对：已修·在线上（#1141、#1181；机构类型补两类 #1113） |
| W-07 | P2 | 两后台 | 托管 a 下管理员导航仍有岗位/招聘会/企业/Excel 导入/数据接入；机构类型默认模块含岗位招聘会；法务类型名「AI 免责声明」与「AI 服务免责声明」两叫法；设备能力页仍叫「签名盖章」；保存成功无提示（机构档案、屏保终端配置） | UI 实操 | 两后台窗口 / 待定 | 10/6 核对：已修·在线上（#1141、#1181；机构类型补两类 #1113） |
| W-08 | P2 | 一体机 | 读不到能力配置时的开发者口吻（`printHubContent.ts:205-206` 常量经核实全仓无引用，用户看不到）；首页分组副文案「正在读取本机能力配置」「能力配置读取失败」是工程词；「签名盖章」已由 e5ae77a4f 全部改为「签名」 | 代码核对 | 走查窗口 / Claude 子代理（并入 R4 PR） | 已合入候选（#1102） |
| W-09 | 待拍板 | 一体机 | 小青「按办事入口开顾问作业」：2.0 定稿里没有这个入口（05 稿 :979 把顾问工作台标「还没开放」，52 稿无上游链接）；只有驾驶舱「入口方向」标签未实现（P2） | 设计稿核对 | 产品负责人（总指挥 9/29 转达） | 试点后再议：稿件冻结不新增入口，照旧走「小青对话 → 要点总结」 |
| W-10 | 待拍板 | 一体机 | F12 政策材料清单打印：2.0 冻结稿 48 没有此按钮；`PolicyPost` 没有结构化材料字段，只能印原文；要做需改冻结稿 + 新端点（参照 `fair-company-print.service.ts`）+ 打印交接新来源 | 设计稿与代码核对 | 产品负责人（总指挥 9/29 转达） | 试点后再议：列入第二版；之前由机构把材料清单写在政策正文，一体机「上传自备材料打印」不变 |
| W-11 | 已知限制 | 真机 | 缺纸只在模拟 Agent 与会写状态的驱动上成立：奔图驱动 `DetectedErrorState` 恒 0，真机缺纸最终是 `PRINT_JOB_UNCONFIRMED`，一体机显示「打印结果未确认」；`wmi.ts:127-128` 把 4 映射成 error | Windows 窗口 | Windows 窗口 | 已派 |
| W-12 | P1 | 服务端 | 扫描指引用词与面板不一致（`scan-tasks.service.ts:177-193`「按『开始』」「扫描到网络 / SMB」，面板实际「扫描」按钮、「扫描到 SMB」）；面板复印设置会留给下一位（已知限制）；面板可出 TIFF/OFD 而 Agent 只认 pdf/jpg/png（待验） | 总指挥转奔图手册 | 后端窗口 | 10/6 核对：已修·在线上（#1113，14f3ab46c）；「按『开始』」是有意保留；TIFF/OFD 待验那半句未核实 |
| W-13 | P2 | 小程序 | 法务页顶栏标题过长时压到微信胶囊下面（「用户服务协议（走查测试版）」可复现）。另：经营者信息显示「暂未发布」，符合第一次发布只激活三份的配置，不算问题 | 小程序窗口实走 | 小程序窗口 | 10/6 核对：已修·在线上（#1093） |
| W-14 | **P0** | 一体机 | 简历来源页手机扫码上传并确认后，「开始 AI 诊断」「更换文件」永久禁用，页头一直「接收中」：`UploadSessionQrPanel` 卸载时没调 `onBusyChange(false)`，`ResumeSourcePage` 的 phoneBusy 恒真；连带堵住职业规划 | 后端窗口子代理 F 走查，截图 `~/.cache/claude-lanes/bh-0929/evidence/` F4c-demo-03* | 走查窗口 / Claude 子代理 | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-15 | P1 | 一体机 | 扫码登录：先勾协议再切「扫码」永远停在「正在获取二维码」；先切再勾正常（dev 构建复现，正式构建待验） | 后端窗口子代理 F 走查，截图 `~/.cache/claude-lanes/bh-0929/evidence/` F6a-02/03 | 主执行窗口（登录页，本窗口子代理改完短信退路后派）/ 待定 | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-16 | P1 | 一体机 | 一体机从不发 `x-age-14-plus`、没有 AI 使用声明入口：后台一开「使用声明强制」，一体机全部 AI 生成失败。第一次发布此开关关，但开之前必须先补一体机声明 | 后端窗口子代理 F 走查，截图 `~/.cache/claude-lanes/bh-0929/evidence/` F8-kiosk-01/02 | 主执行窗口（合规改造一体机 C6，排在登录页之后）/ Grok | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-17 | P1 | 一体机 | OCR 不可用时扫描件在材料检查页让「人工确认」却没有继续按钮（= 9/27 A-04 一体机半边；服务端本人确认 #1068 已备） | 后端窗口子代理 F 走查，截图 `~/.cache/claude-lanes/bh-0929/evidence/` F4f-scan-04 | 主执行窗口 / Grok（G1 打印链，grok/kiosk-print-chain-walk-0929） | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-18 | P2 | 一体机 | `AI_ENDPOINT_NOT_ALLOWED` 时小青写「这一轮没连上，可以重试」、面试写「AI 服务本身是通的，可以直接再点一次」，与事实相反（人话码表 #1095 已补，页面分支待接） | 后端窗口子代理 F 走查，截图 `~/.cache/claude-lanes/bh-0929/evidence/` F3-kiosk-01/02 | 后端窗口（#1095，谁新增错误码谁补人话）/ 待定 | 10/6 核对：已修·在线上（3c24afb72，`AI_ENDPOINT_NOT_ALLOWED` 进 `aiOutage.ts`） |
| W-19 | P1 | 一体机 | 短信额度满后主按钮仍是「重新获取验证码」：单台满应主推扫码登录，总量满应主推「不登录，继续使用」；另一体机发码不带终端头，单台上限实际不生效 | 后端窗口子代理 F 走查，截图 `~/.cache/claude-lanes/bh-0929/evidence/` F2e/F2f | 主执行窗口（登录页，本窗口子代理改完短信退路后派）/ 待定 | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-20 | P0 | 一体机 | 小青回显用户问题时手机号、邮箱打码，**身份证号原样显示在公共屏** | 后端窗口子代理 F 走查，截图 `~/.cache/claude-lanes/bh-0929/evidence/` F5c-03 | 走查窗口 / Claude 子代理 | **已修，K10 复走通过**（#1137 已合；rc 栈 4deeaefec，含 dd8b09c92；`~/.cache/walk0929/evidence/k10/`） |
| W-21 | P2 | 一体机 | 零元单确认页主按钮可见文字「确认并建单」，读屏名却是「确认并去付款……」（`PrintConfirmPage` primaryAccessible） | 后端窗口子代理 F 走查，截图 `~/.cache/claude-lanes/bh-0929/evidence/` | 主执行窗口 / Grok（G1 打印链，grok/kiosk-print-chain-walk-0929） | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-22 | P2 | 一体机 | 诊断报告标题写「简历被读成七块」，正文写「共 5 块」 | 后端窗口子代理 F 走查，截图 `~/.cache/claude-lanes/bh-0929/evidence/` F4c-demo-05 | 走查窗口 / Claude 子代理 | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-23 | P2 | 一体机 | 打印完成页对模拟面试报告也提示「证件页水印」 | 后端窗口子代理 F 走查，截图 `~/.cache/claude-lanes/bh-0929/evidence/` F7b-05 | 主执行窗口 / Grok（G1 打印链，grok/kiosk-print-chain-walk-0929） | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-24 | P2 | 一体机 | dev 构建下 inspection、normalize_a4、pii_scan 各 POST 两次（正式构建待验，与「进手机扫码上传建两个会话」同类） | 后端窗口子代理 F 走查，截图 `~/.cache/claude-lanes/bh-0929/evidence/` | K1 路在正式构建上核实 | 10/6 核对：未核实。很可能和 W-118 一样是开发版构建的假象，但总表没有对这条下结论｜证据：总表 4.16 / W-118 的 10/4 结论 |
| W-25 | P2 | 演示包 | 演示包网桥没有 `/local/qr-login/*`，扫码登录在演示环境走不通；`AI_PROVIDER=mock` 写死且清掉 AI_ 前缀变量，验不了真实诊断与白名单；起 API 的命令行含 `src/main.ts`，会被 `pkill -f` 误杀（走查栈的模拟 Agent 已实现 qr-login 两条，可回移） | 后端窗口子代理 F 走查，截图 `~/.cache/claude-lanes/bh-0929/evidence/` | 演示包归属窗口（合规与运维） | 10/6 核对：未核实：演示包不在仓库里｜证据：`git grep "qr-login"` 在 scripts 下只命中 `ci-gate-exemptions.json` |
| W-26 | P1 | 小程序 | 「我的文档」列表有文件时下方同时出现「暂无文件」空态卡（无下一页时必现）：`documents.wxml:121` 的「加载更多」提示插在 loading/error/list 链与 `wx:else`（:125）之间，wx:else 配错了对象 | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` 11-docs-after-upload | 小程序窗口 / 小程序窗口 | 已修复并复走通过（PR #1093；r2-03） |
| W-27 | P2（agy 评审下调） | 小程序 | 选终端页、确认到机打印页的文件名与终端名显示成 URL 编码（%E6%B5%8B…）：查询串参数没 `decodeURIComponent`（上一页 print-upload 解了码） | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` 13-print-store、14-print-pay | 小程序窗口 / 小程序窗口 | 10/6 核对：已修·在线上（#1093） |
| W-28 | P2（agy 评审下调） | 小程序 | 确认到机打印页说明写「到机确认前不会创建 Agent 可领取的 PrintTask」，工程用语 | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` 14-print-pay | 小程序窗口 / 小程序窗口 | 10/6 核对：已修·在线上（#1093） |
| W-29 | P3 | 小程序 | 同一步骤一会儿叫「门店」（页标题「选择门店」、步骤条「选门店」）一会儿叫「终端」（确认页「选终端」） | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` 13、14 | 小程序窗口 / 小程序窗口 | 10/6 核对：已修·在线上（#1093） |
| W-30 | P3 | 小程序 | Word 文件提示同一句话说两遍（本地文案 + 服务端 reason 拼接，`documents.js:61`） | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` | 小程序窗口 / 小程序窗口 | 10/6 核对：已修·在线上（#1093） |
| W-31 | P2 | 服务端 + 小程序 | 「我的文档」接口不返回页数：`member-assets.service.ts:121-134` 的 select 没有 pageCount，且 `FileObject` 表本身没有页数列；小程序读 `item.pageCount`（`documents-helpers.js:55/:122`）恒为 0，显示「页数未知」，重新打印时页数也带 0（服务端报价会重算，金额不受影响） | 总指挥转 Codex 两端核查（`~/.cache/claude-lanes/xend-0929/codex-xend.md`，候选 d75be0345）；走查窗口已对代码核实，页面待小程序窗口复现 | 后端窗口（字段来源需定：检查结果里的页数）/ 待定 | 10/6 核对：已修·在线上（#1120 文件表加页数列） |
| W-32 | P1 | 小程序 | 小程序简历页只取第一页 50 条、丢掉 nextCursor（`resumes.js:81`）；Codex 称权益页、反馈页同样（= 9/27 F13 的小程序半边） | 总指挥转 Codex 两端核查（`~/.cache/claude-lanes/xend-0929/codex-xend.md`，候选 d75be0345）；简历页已对代码核实 | 小程序窗口 / 小程序窗口 | 10/6 核对：已修·在线上（5fe9e1a2c 小程序简历、反馈接上游标翻页） |
| W-33 | P1 | 小程序 | AI 记录分多条数据流，小程序疑漏读小青摘要、岗位 AI、后续模拟面试（`ai-records.js:151-166`、`api.js:1249`） | 总指挥转 Codex 两端核查（`~/.cache/claude-lanes/xend-0929/codex-xend.md`，候选 d75be0345） | 小程序窗口 / 小程序窗口 | 10/6 核对：已修·在线上（b1cd03443 小程序 AI 记录显示问答要点） |
| W-34 | P1（agy 复核定 P0 候选） | 两端 | 打印订单两端来源不统一：一体机「我的打印订单」只读打印任务，手机下单未到机核销的单一体机看不到 | 总指挥转 Codex 两端核查（`~/.cache/claude-lanes/xend-0929/codex-xend.md`，候选 d75be0345）；小程序窗口 9/29 已报 | 主执行窗口（#1086 订单时间线） | 10/6 核对：仍在·未修（一体机前端半边）。总表写「修复中」，但没有开着的 PR｜证据：main 和候选的 `apps/kiosk/src/services/api/memberPrintOrders.ts:71` 都只调 `/me/print-orders`；`git grep "print-orders/timeline" -- apps/kiosk/src` 两边都是 0 处；服务端 `memb… |
| W-35 | 说明 | 一体机 | 一体机匿名反馈不挂账号，答复只能走会员路径——设计如此，写进帮助说明即可，不算缺陷 | 总指挥转 Codex 两端核查（`~/.cache/claude-lanes/xend-0929/codex-xend.md`，候选 d75be0345） | — | 不算缺陷 |
| W-36 | **P0** | 小程序 | 登录会员在小程序用简历类 AI（上传解析 / 诊断 / 生成 / 语音说简历 / 优化 / 导出）一律「解析失败，请稍后重试」：服务端自 #794（9/06）起要求会员先有 `resume_ai` 授权（`ai.controller.ts:187/283/339/383/434/549` `requireActiveConsent`，403 `USER_AI_CONSENT_REQUIRED`），一体机有授权弹窗（`resumeAiConsent.ts`），小程序从没接；游客不受影响 | 小程序窗口实走（截图 31-resume-result）；走查 API 日志已核实 5:43:49 PM `requestId=57dfc1bb…` `POST /api/v1/resume/parse` 403 `USER_AI_CONSENT_REQUIRED` | 小程序窗口 / 小程序窗口（走查结束、TEST_BASE_URL 改回后修，修完同环境复走） | 已修复并复走通过（PR #1093 head 0d07dbbc8；501 同意授权后解析到诊断完成，隐私页可撤回；r2-01、r2-02） |
| W-37 | P2 | 小程序 | 小青遇模型超时要转 45 秒才出「小青暂时无法回复」，中间没有「还在等」的提示 | 小程序窗口实走（21b-assistant-fault-after） | 小程序窗口 / 小程序窗口 | 10/6 核对：仍在·未修｜证据：main 和候选的 `apps/miniapp/pages/assistant/assistant.js:131` 只放一个 `'…'` 占位，没有中途提示 |
| W-38 | P2 | 小程序 | 模拟面试设置页目标岗位、难度、时长、题型几块贴着屏幕左边缘，没有左右边距 | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` 40-interview-qa | 小程序窗口 / 小程序窗口 | PR #1106 已修（按产品负责人拍板：边距） |
| W-39 | P1（agy 评审上调；已在修） | 服务端 + 两端 | 模拟面试结果总评标签「基本合格」、面试官标签「HR 初筛」，在练习工具里读起来像招聘结论；建议改训练口径（如「表达清楚」「还需准备」、「HR 面练习」） | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` 41-interview-result | 主执行窗口 / Grok（一体机+服务端）；小程序窗口（小程序半边） | 10/6 核对：已修·在线上（#1106 小程序、#1109 一体机与服务端） |
| W-40 | P3 | 小程序 | AI 服务记录页脚「仅已接真实结果页的记录可直接回看」是工程用语 | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` 42-ai-records-after-interview | 小程序窗口 / 小程序窗口 | 10/6 核对：已修·在线上（#1093） |
| W-41 | P3 | 小程序 | 页面栈满 10 层时「开始模拟面试」跳转失败无提示，每点一次服务端多建一场面试（本次多出 3 场孤儿会话）：`interview-entry.js:68` navigateTo 没有 fail 分支 | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` | 小程序窗口 / 小程序窗口 | 10/6 核对：已修·在线上（#1093） |
| W-42 | **P0**（清场组，agy 评审上调） | 一体机 | 清场前的窗口里下一位能看到上一位：登录用户中途走开，下一位点「首页」见「138****0201，下午好」并能进上一位「我的文档」（文件名、大小、可查看/打印）；同屏写「不会显示上一位使用者的资料」自相矛盾；首页写「离开 3 分钟自动退出」实测约 56 秒清场。闲置窗口本身是设计，问题在文案承诺与实际不符、窗口内未做任何遮挡 | K1 `~/.cache/walk0929/evidence/k1/` 051、053、054 | 主执行窗口 / Grok（G2 清场，grok/kiosk-privacy-clear-walk-0929） | **已修，发布前复核通过**（候选 9565ee6bc，#1149；rc 栈 9/30 12:07 后证据 `~/.cache/walk0929/evidence/k13/clear/`） |
| W-43 | **P0**（清场组，agy 评审上调） | 一体机 | 打印完成页 58 秒自动清空并写「本次打印文件预览和记录已清除」，但没退出登录，「我的」仍可看上一位简历、文档、订单，要等 3 分钟全局闲置（假装已清场） | K2 `evidence/k2/` 057、058 | 主执行窗口 / Grok（G2 清场，grok/kiosk-privacy-clear-walk-0929） | **已修，发布前复核通过**（候选 9565ee6bc，#1149；rc 栈 9/30 12:07 后证据 `~/.cache/walk0929/evidence/k13/clear/`） |
| W-44 | P1 | 一体机 | 报价页工程口吻铺满：「零元单也要先建单」×4、「不存在不建单直接出纸的路径」×2、「优惠券功能尚未接通…」、「本机不估价」、已回报价仍写「等报价返回后按原价显示」；全页没有「免费试运营」（C-04/C-05 仍在） | K1 `~/.cache/walk0929/evidence/k1/` 015、016；K3 `evidence/k3/` 027 | 主执行窗口 / Grok（G1 打印链，grok/kiosk-print-chain-walk-0929） | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-45 | P1 | 一体机 | 到机码出纸后 10 分钟内重输：服务端 200 taskStatus=completed（`pickup-order.service.ts:311-327` 有意重放），一体机不看 printTaskStatus，仍说「已进入队列，请留在出纸口旁」让人空等 | K1 `~/.cache/walk0929/evidence/k1/` 032 | 主执行窗口 / Grok（G1 打印链，grok/kiosk-print-chain-walk-0929） | 10/6 核对：已修·在线上（#1159） |
| W-46 | P1 | 一体机 | 完成页「订单号」显示内部 ID 而不是 ORD- 号，与进度页、到机码页、后台对不上；任务号、反馈编号原文直接露出；进度页「再印一份 · 核价并支付 · 不免费」试运营期不实 | K1 `~/.cache/walk0929/evidence/k1/` 017、018、029、042；K3 `evidence/k3/` 028、030、078 | 主执行窗口 / Grok（G1 打印链，grok/kiosk-print-chain-walk-0929） | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-47 | P1 | 一体机 | 优化页 6 条建议时内容压住底部操作条、页面滚不动（`styles/qingxu/shell.css:97` `.qx-body` 无滚动）；「AI 服务记录」打开诊断/优化显示「还没有诊断报告」（`TASK_ID_RE` 不认 64 位任务号，F07 半修）；「应用到编辑区」没写入所选改写也不提示（`resumeDecisions.ts:87`）；报价页「返回修改」后回优化页不能直接再打印（F01/F16 变体） | K2 `evidence/k2/` 022、030、031、038、041、046–050、059–062 | 走查窗口 / Grok（与 W-14、W-22 同一 PR） | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-48 | P1 | 一体机 | 一体机隐私请求不能发起导出或注销，只能撤回「岗位 AI」授权（托管 a 前旧说法，且因未授权而置灰）；管理员「数据权利工单」0 条可处理 | K3 `evidence/k3/` 042、072 | 走查窗口 / Claude 子代理（合规口径） | 10/6 核对：仍在·未修（一体机仍然只能撤回；按 10/3 口径「本人申请 + 管理员执行」，一体机本来就不设提交入口）｜证据：候选 `MyPrivacyRequestsPage.tsx:102`「一体机只开放撤回 AI 使用授权」，导出、注销两张卡 `data-off="true"`（:190、:198） |
| W-49 | P1 | 一体机 | 「我的收藏」里收藏的政策打不开，写「对应政策页待建设…不提供误导性的替代跳转」，死胡同；首页「查政策」磁贴写「带走：材料清单」但做不到（F12 已定试点后再议，文案要先改） | K3 `evidence/k3/` 001、038 | 主执行窗口 / Grok（G4 政策页，grok/kiosk-policy-walk-0929） | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-50 | 不成立 | 一体机 | 游客态约 30 秒进屏保（读一条政策原文就被打断），登录态约 3 分钟；终端屏保配置是 180 秒，阈值来源待查 | K3 `evidence/k3/` | 走查窗口 / Grok（先查根因） | Grok K3 复核不复现：屏保配置 180 秒，游客首页 151 秒进屏保，政策页 150 秒、登录后 154 秒进使用时限页；「30 秒」是预警窗（`useIdleLogout.ts:75-79`），撤销 |
| W-51 | P1 | 一体机 | 0 元单详单「实付 未记录（…不按应付减优惠来推算）」「页范围 未记录」，列表却写「免费 · 已支付（免费）」；订单列表/详单没有 ORD- 号；完成页 3 份写「取走全部 2 页」、「已付 ¥0.00」与「本次未收款」两种说法；「我的文档」再打时完成页「共 0 面」 | K1 `~/.cache/walk0929/evidence/k1/` 018、043、044；K2 `evidence/k2/` 065、066；K3 `evidence/k3/` 032 | 主执行窗口 / Grok（G1 打印链，grok/kiosk-print-chain-walk-0929） | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-52 | P2 | 服务端 + 一体机 | 机构发布的政策「发布日期」恒「—」：一体机读 `publishedDate`（`services/api/policies.ts:24`、`PolicyPanel.tsx:128`），`GET /policies` 只返回 `publishConfirmedAt`；两后台「展示日期」同样「—」 | K3 `evidence/k3/` 017 | 后端窗口（接口字段）+ 主执行窗口 / Grok（G4 一体机半边） | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-53 | P2 | 一体机 | 文案收口批（C-04/C-05/C-09 仍在）：英文眉题 MY RESUMES / MY FILES & ORDERS / MY FAVORITES / AI SERVICE RECORDS / NOTIFICATIONS / MY FEEDBACK / MY ACTIVITY / TERMS OF SERVICE / SCAN VIA PANEL；「空就是空，本页不会造几条记录让页面好看」等；手机上传页「本页无法核对这句话」；政策首页「能力配置」「本页只做分流」「机械比对」；扫描页「不画什么」「本屏不重复开口子」、已登录仍写「本屏无登录步骤」；「llm · 任务 7773d3…」；上传页「材料检查按住不放」；参数页「参数预填当前已关闭…」、PDF 也提示「Word 转换暂未开放」 | K1 `~/.cache/walk0929/evidence/k1/`、K2 `evidence/k2/`、K3 `evidence/k3/` | 走查窗口 / Claude 子代理（合规文案） | 10/6 核对：仍在·未修（部分）：英文眉题 MY RESUMES / IMAGES TO PDF 等两边都是 0 处；剩下的两边都还在：「空就是空」9 处、「本页无法核对这句话」`PhoneUploadPage.tsx:302`、「本页只做分流」「能力配置 · 以办理时确认」`QxServiceHubPage.tsx:117`、「机械比对」3 处、「本屏不重复开口子」「本屏无登录步骤」`ScanStartPage.tsx:276/288`、「Word 转换暂未开放」7 处、「当前题库（v1）」`SelfAssessmentFlow.tsx:302`、「理由直接来自能力配置，不是我猜的」`QxPrintHubView.tsx:253` |
| W-54 | P2 | 一体机 | 界面细节：登录页输满 11 位键盘自动切验证码并遮住「获取验证码」、未勾选协议框画浅色对勾像已勾、验证码框不自动聚焦（C-03 残留）；结束使用停在未登录「我的」（B-12 登录态仍在）；「我的」打印过仍「这一趟还没有留下记录」、通知未读无数字；从「我的」进帮助无返回；政策分区标题被吸顶栏压住；大片留白（上传页二维码下约 400px、打印扫描首页签名右侧两格、到机码结果卡下两段约 250px、首页顶部约 400px 横幅且「问小青」在 y=444 违反顶部 500px 规则） | K1 `~/.cache/walk0929/evidence/k1/`、K3 `evidence/k3/` | 主执行窗口（登录页，本窗口子代理改完短信退路后派）/ 待定 | 10/6 核对：**未修**（原「K8 已修」判定有误）：「打印过仍写『这一趟还没有留下记录』」至今未改，`ProfileSessionRecords.tsx` 自 9/09 fae9a260a 未动，与 W-70 是同一处 |
| W-55 | P2 | 一体机 | 诊断默认方向「应届 · 校招 · 信息传输、软件和信息技术服务业」，45 岁职工不改就按此诊断（`ResumeSourcePage.tsx:243-244`）；简历来源页无「扫描纸质简历」通道要绕到打印·扫描；导出前核对事实弹窗公共屏明文显示全号；导出文件名 v1/v2 同名分不清 | K2 `evidence/k2/` 003、043、063、077 | 走查窗口 / Grok | 10/6 核对：仍在·未修（部分）：简历来源页仍没有「扫描纸质简历」，候选 `ResumeSourcePage.tsx:61-80` 的 UPLOAD_OPTIONS 只有 usb / cloud / phone；导出文件名 v1/v2 同名**未核实** |
| W-56 | P2 | 两后台 | 机构后台下架通知事由末尾「。。」；管理员政策信息源已下架行仍有「紧急下架」按钮、弹窗「服务端已确认处置」；机构资料「合规限制」直接列 `in_platform_apply` 等英文代码 | K3 `evidence/k3/` 064、068、070、071 | 两后台窗口 / 待定 | 10/6 核对：仍在·未修（部分）｜证据：候选 `apps/admin/src/routes/components/recruitment/EmergencyTakedownDialog.tsx:139`「服务端已确认处置」；英文代码已映射成中文（`ComplianceRestrictions.tsx:4`）；已下架行仍有按钮这一点未核实 |
| W-57 | 待核实 | 一体机 | 管理员后台机构 A 未勾「AI简历服务」「AI模拟面试」，终端首页仍有「改简历」「练面试」——机构模块开关是否应控制一体机入口待核 | K3 `evidence/k3/` 058 vs 001 | 走查窗口 / Grok（先读代码核实） | 10/6 核对：未核实（总表仍写「待核」） |
| W-58 | P1 | 服务端 + 小程序 | 手机下单、一体机核销后，小程序订单列表把这单写成「一体机任务，详情请在一体机『我的打印订单』查看」、网点显示「打印服务终端」、点不开详情：核销后 `/me/print-orders/cloud` 不再返回这单，`/me/print-orders` 的 PrintTask 行无 orderId 与终端名（= W-34 的小程序半边）。小程序先把错指一体机的那句改成中性说法；正解靠 #1086 订单时间线或后端补字段 | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` 52-orders | 主执行窗口（#1086）+ 小程序窗口（先改文案）/ 待定 | 10/6 核对：已修·在线上（#1093、#1086、#1108；未复走） |
| W-59 | P1 | 小程序 | 材料包空态写「材料包在小程序只完成组包与到机码；费用在一体机现场支付，付款并核销后才开始打印」——引导到一体机付款，与试运营免费不符（运营规范 §5.13）；应改「试运营期间免费；到一体机输码后开始打印」 | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` 52-orders | 小程序窗口 / 小程序窗口（合规窗口复核文案） | PR #1093 已改「这里不付款，也还没有开始打印；到终端核验后才打印」，待合规窗口复核 |
| W-60 | P2 | 小程序 | 创建材料包返回箭头跑到标题正下方（`package-create.wxml:4` navbar 用了 col）；打印订单「材料包订单」「单件打印订单」小标题贴左边缘、金额「免费」被挤成竖排两行 | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` 52-orders、74-package-create | 小程序窗口 / 小程序窗口 | 返回箭头 #1093；贴边与「免费」竖排 #1106 |
| W-61 | 产品拍板落地 | 一体机 | R4：复印与身份证复印用打印机面板自带功能，一体机打印扫描说明页加「怎么在面板上复印」（首页复印卡可点 → `/print-scan/feature/copy`）；身份证放置与翻面留占位待 Windows 窗口现场核实 | 奔图手册提取稿第 3 节；截图 `~/.cache/walk0929/evidence/panel-copy/01–03` | 走查窗口 / Claude 子代理 | 已合入候选（#1102） |
| W-62 | P2 | 小程序 | 小程序小青有「保存本次要点」，但保存的要点在小程序哪儿都看不到：`api.js:1252` 的 `getMyAssistantQaRecords` 没有页面调用；一体机 AI 服务记录显示 qaRecords（= W-33 的确认结论） | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` r2-10、r2-11 | 小程序窗口 / Grok | **已修复并复验通过**（小程序「AI 服务记录 → 问答要点」显示 13800000311 在一体机保存的要点，证件号、手机号已打码；截图 `evidence/miniapp/w62-01～03`） |
| W-63 | P3 | 小程序 | 发短信被限流时登录页只闪一下 toast，屏幕留不下原因；SMS_IP_LIMIT、SMS_DAILY_LIMIT、SMS_DEVICE_LIMIT、SMS_DAILY_TOTAL_LIMIT、SMS_TERMINAL_DAILY_LIMIT、SMS_BUDGET_UNAVAILABLE 都显示笼统「发送失败」（不在 user-error 放行表） | 小程序窗口实走，截图 `~/.cache/walk0929/evidence/miniapp/` | 小程序窗口 / 小程序窗口 | 10/6 核对：已修·在线上（e84529025 短信限流原因留在屏上） |
| W-64 | P1 | 一体机 | 「换一个账号登录」后用另一个号登录完成，人落在游客首页、新号没有留在机器上（直接从「我的」登录则正常）：清场用整页重载写入历史边界（`KioskPrivacyGuard.tsx:199-214`），登录成功后 `LoginPage.tsx:68` 用 replace 跳 /profile，新历史不带边界令牌，被当成过期历史再清场（同文件 300-303、505-508） | Grok K3 续跑，`~/.cache/walk0929/evidence/k3/` 101–189 135、136、173、176 | 主执行窗口（登录页 + 隐私守卫）/ 待定 | **已修，发布前复核通过**（候选 9565ee6bc，#1149；rc 栈 9/30 12:07 后证据 `~/.cache/walk0929/evidence/k13/clear/`） |
| W-65 | P2 | 一体机 | 使用时限页「继续后回到」直接显示原始路径 `/profile`、`/policy-service`（`SessionGuardView.tsx:55`，与 B-09 同类）；图片转 PDF、材料扫描英文眉题 `IMAGES TO PDF`、`SCAN VIA PANEL`（`ConvertImagesView.tsx:91`、`ScanWorkbenchChrome.tsx:128`，并入 W-53） | Grok K3 续跑，`~/.cache/walk0929/evidence/k3/` 101–189 138、153、179、180 | 走查窗口 / 并入 W-53 文案批 | 10/6 核对：已修·在线上（`SessionGuardView.tsx` 改用 `sessionGuardSourceName`；英文眉题由 #1179 清掉） |
| W-66 | P2 | 管理员后台 | 订单管理任务状态列显示英文 `pending_release`（`orders/index.tsx:30-38` 状态表缺项）；小程序云打印单文件名「未记录」；用户列「会员 · 会员」「游客 · 游客」（`admin-orders-readonly.service.ts:361` + `orders/index.tsx:74、491`）；工作台「最近操作」露出 `file/` 加原始编号（`dashboard/index.tsx:187-189`，W-06 修复需覆盖） | Grok K3 续跑，`~/.cache/walk0929/evidence/k3/` 101–189 112、156 | 两后台窗口 / 待定 | 10/6 核对：仍在·未修（部分）｜证据：候选 `orders/orderDisplay.ts:7-15` 的 STATUS_MAP 仍没有 pending_release，列表兜底成「未归类」（`orderColumns.tsx:40`）；详情抽屉 `OrderDetailDrawer.tsx:32` 用 `?? detail.taskStatus` 回… |
| W-67 | P2 | 运维文档 | 价目运维 SQL（`docs/operations/price-config-production.md`）用 `NOW()` 写 `updatedAt/effectiveFrom`：PostgreSQL 会话时区是上海时，存进去的是上海本地时间却被当 UTC 读，后台显示超前 8 小时（走查库价目「2026/9/29 23:07:37」而当时是 15:07）。生产若同样手工执行会让价目生效时间错 8 小时 | Grok K3 续跑，`~/.cache/walk0929/evidence/k3/` 101–189 158；运维 SQL 由走查窗口 15:07 按手册执行 | 后端窗口（与 W-02 一并）/ 待定 | 10/6 核对：已修·在线上（#1134） |
| W-68 | P1 | 管理员后台 | 数据大屏「累计打印 N 页」按已支付订单的 `billablePages` 求和、不乘份数，且把已支付未出纸的单也算进去（`console-screen.queries.ts:284-337`，按 paidAt、上海时区）；订单页按 createdAt 列全部订单——两处单位与口径不同。库里实测 18:15：大屏 12 页 = 10 单 billablePages 之和（含 1 单待取件），实际出纸 15 张（游客单 2 页 × 3 份等） | Codex B 旅程核查 `~/.cache/walk0929/codex/B-journeys.md`；走查窗口 psql 核对 Order/PrintTask | 后端窗口 + 两后台窗口 / 待定 | 已复现 |
| W-69 | P1 | 两后台 | 服务人次：KioskSession 已真实写入（000d3bf81 一体机上报），但工作台仍返回 `unavailableMetric(... kioskSessionUnwritten)`（`console-screen.usage.service.ts:285-287`），机构页仍写「一体机会话尚未记录」（`PartnerUsageHostingOff.tsx:25-30`）；机构工作台打印/失败/AI/告警指标标不可用（`console-screen.assemble.ts:229-245`，与 P-04「13 项待补」同根） | Codex B 旅程核查 `~/.cache/walk0929/codex/B-journeys.md`；K3 截图「另有 13 项指标待补机构归属」 | 后端窗口 + 两后台窗口 / 待定 | 代码已核实，待页面复走 |
| W-70 | P2 | 一体机 | 「我的」首页顶部记录列表来自 `location.state` 与本地合成 ID（`ProfilePage.tsx:36-55,196-215`），真实数量另查接口——可能数字有、列表空（与 K1/K3「打印过仍写还没有留下记录」同现象）；打印按钮只丢文件跳预览（:100-106） | Codex B 旅程核查 `~/.cache/walk0929/codex/B-journeys.md` | 走查窗口 / Grok（先复现） | 10/6 核对：仍在·未修｜证据：候选 `ProfilePage.tsx:32` `location.state`；`ProfileSessionRecords.tsx` 最后修改是 9/09 的 fae9a260a，:55「这一趟还没有留下记录」；只统计 resumes / scans / aiRecords |
| W-71 | 线索 | 小程序 | AI 记录页模拟面试只取 50 条不接 nextCursor（`ai-records.js:137-182`）；政策详情无收藏与材料（`policy-detail.wxml:24-93`，首发停放政策页，第一次发布不影响） | Codex B 旅程核查 `~/.cache/walk0929/codex/B-journeys.md` | 小程序窗口 / 小程序窗口 | 10/6 核对：仍在·未修｜证据：候选 `apps/miniapp/pages/ai-records/ai-records.js:228` `getMyMockInterviews({ pageSize: 50 })`，没有游标 |
| W-72 | P1 | 小程序 | 订单详情未核销时状态芯片显示英文 `pending_release`（列表同时是「待到机」）：`order-detail.js:91` `STATUS_MAP[status] \|\| status` 缺这一项，`order-detail.wxml:36` 直接画出 | Grok K4 跨端场景，`~/.cache/walk0929/evidence/k4/`；两单下单后详情字段 | 小程序窗口 / 小程序窗口 | 10/6 核对：已修·在候选未上线｜证据：main `apps/miniapp/pages/order-detail/order-detail.js:25-32` 的 STATUS_MAP 没有 pending_release；候选 :27 有 `pending_release: '待到机'` |
| W-73 | P1 | 一体机 | 另一端删掉文件后在材料检查页点「下一步」：停在检查页，同屏既写「保存隐私选择失败，请重试」又写「检查完成」「没有待处理的隐私片段」，文件名还在（没有出纸，未假装打印，但给的下一步是死循环重试）：`PrintMaterialCheckPage.tsx:491-492` 失败后仍停 review，`MaterialCheckPresentation.tsx:168-171` 无片段时仍写检查完成 | Grok K4 跨端场景，`~/.cache/walk0929/evidence/k4/` 017、018；`POST /api/v1/materials/tasks` 404 | 主执行窗口（打印链）/ Grok（G1 可并入） | 10/6 核对：仍在·未修｜证据：候选 `PrintMaterialCheckPage.tsx:563-564` 出错后照旧 `setStage('review')`；`PrintHandoffGoneError` 只在本地交接丢失时抛出（:296-298），服务端文件被删的情况走不到；#1239 正文没有涉及这一点 |
| W-74 | P2 | 一体机 | 跨端缓存失效：小程序删了文档，一体机「我的文档」不刷新仍显示「可用 3」和那一行，点「查看」才报失败（`MyDocumentsPage.tsx:152-153` catch 不看状态码也不刷新）；小程序取消收藏，一体机收藏行还在、点了进政策库（`MyFavoritesPage.tsx:43-46`，同 W-49）。反向（一体机删 → 小程序预览）服务端 404 `FILE_NOT_FOUND`，小程序显示笼统「预览失败」（码不在 `user-error.js` 白名单） | Grok K4 跨端场景，`~/.cache/walk0929/evidence/k4/` 009、011、012、014 | 走查窗口 / Grok（一体机半边）；小程序窗口（白名单） | 10/6 核对：仍在·未修｜证据：候选 `MyDocumentsPage.tsx:153-154` 的 catch 不看状态码、不刷新，只提示「文档打开失败，可能已到期或被清理」 |
| W-75 | **P0**（并入清场组，agy 评审上调） | 一体机 | 不点「结束使用」直接回首页：下一位在首页、我的页看到上一位脱敏号「138****0463，晚上好」与「进入我的」，约 180 秒闲置后才清（文件名与问题原文不出现；与 W-42 同源，定级按「只露脱敏号」降为 P2）；「这一趟做过什么」只数简历、扫描、AI 记录（`ProfileSessionRecords.tsx:41`、`ProfilePage.tsx:207-210`），上传了文档仍写「还没有留下记录」（坐实 W-70） | Grok K4 跨端场景，`~/.cache/walk0929/evidence/k4/` 065、069 | 主执行窗口（清场 G2 可并入）/ Grok | **已修，发布前复核通过**（候选 9565ee6bc，#1149；rc 栈 9/30 12:07 后证据 `~/.cache/walk0929/evidence/k13/clear/`） |
| W-76 | P1 | 一体机 | 登录后用 U 盘导入打印：点「下一步：材料检查」变成空页「这一页没有文件」，看不到原因；三次都是 `POST /materials/tasks` 403 `MATERIAL_TASK_ACCESS_DENIED`。根因线索：本机程序导入 `print_doc` 时不转发会员令牌（真 Agent `qr-login-server.ts:350-412` 同样只对 `resume_upload` 转发），文件落成匿名，材料检查再以会员身份建任务被拒后清掉交接（`PrintMaterialCheckPage.tsx` 约 288–391）。同一账号改手机上传正常（F11 同链） | Grok K1 续跑，`~/.cache/walk0929/evidence/k1/` 101–246 215–224；requestId 2a8b2fe8… | 主执行窗口（打印链）+ Windows 窗口（Agent 转发令牌）/ Grok | 10/6 核对：仍在·未修（根因代码没动）｜证据：候选 `apps/terminal-agent/src/local-api/qr-login-server.ts:406` 仍只在 `purpose === 'resume_upload'` 时转发 Authorization，`print_doc` 不转发；main 是 :393，同样如此 |
| W-77 | P2 | 一体机 | 卡纸完成页写「已出的纸你先收好」，实际这一单没出纸（缺纸页没这句）；U 盘里 PDF 与 docx 同在，列表只列 PDF、不说明 docx 为何不在；同一笔 ¥0 缺纸页「本次未收款」、卡纸/未确认/成功页「已付 ¥0.00」（并入 W-51） | Grok K1 续跑，`~/.cache/walk0929/evidence/k1/` 101–246 201、204、207、215、242 | 主执行窗口（打印链）/ Grok | 10/6 核对：仍在·未修（部分）｜证据：候选 `PrintDonePage.tsx:572` 仍是「工作人员会取出卡纸…已出的纸你先收好」（main 同样） |
| W-78 | P2 | 管理员后台 | 告警中心正文里的失败时间用 UTC 截到分钟，比右侧卡片早 8 小时（`services/api/src/admin-ops/derived-alerts.ts` 约 245 行） | Grok K1 续跑，`~/.cache/walk0929/evidence/k1/` 101–246 202、205、208 | 后端窗口 / 待定 | 10/6 核对：已修·在线上（#1134） |
| W-79 | **P0** | 服务端 | 小青对话把用户原话**明文**送给大模型：手机号、身份证号、邮箱、姓名都未遮盖（`llm-chat.service.ts:317` 入会话、`324-327` 送出）；简历诊断与小青要点摘要已换占位符，简历对照、职业规划里姓名仍是明文。真实服务上线等于把个人信息发给第三方模型 | Grok K2 收尾，`~/.cache/walk0929/evidence/k2/` 258–275；`fake-llm/requests.jsonl`（假大模型请求日志 #35、#52、#49、#50） | 后端窗口（#1085 送模型前遮盖补齐）/ 待定 | **已修，K8 在候选 90eb5a21c 复走通过**（`~/.cache/walk0929/evidence/k8/`） |
| W-80 | P1 | 一体机 | 小青「保存本次要点」后作业页（/ai/plan）永远停在「正在读取这一趟的产物」：服务端已生成 1 页 PDF，但页面同一秒对 `GET /advisor/sessions/:id` 发了 445 次被 429——`AiPlanPage.tsx:49` 每次渲染重新解析导航里的要点对象，`65-120` 的读取效果把它当依赖、开头又把状态设回读取中，形成请求风暴 | Grok K2 收尾，`~/.cache/walk0929/evidence/k2/` 258–275；`fake-llm/requests.jsonl` 264；api.log 22:03:26 `advisor.pdf_ok kind=qa_pins pages=1` | 走查窗口 / Grok | **已修，K10 复走通过**（#1137 已合；rc 栈 4deeaefec，含 dd8b09c92；`~/.cache/walk0929/evidence/k10/`） |
| W-81 | P1 | 一体机 | 简历来源页手机二维码还在等人扫时，顶栏就是「接收中」，U 盘入口被禁用，要先点「取消」才能换（等待态也打开了 `sourceBusy`，`ResumeSourcePage.tsx:248,512`；与 W-14 同一忙碌锁，#1107 只修了卸载那一半） | Grok K2 收尾，`~/.cache/walk0929/evidence/k2/` 258–275；`fake-llm/requests.jsonl` 113、220、229 | 走查窗口 / Grok | **已修，K10 复走通过**（#1137 已合；rc 栈 4deeaefec，含 dd8b09c92；`~/.cache/walk0929/evidence/k10/`） |
| W-82 | P2 | 一体机 | 小青技能条标题带英文「JD」：「AI 简历 JD 匹配」「AI 岗位 JD 解读」；小青对话记录不进「AI 服务记录」（只有保存要点才有，F08 仍在） | Grok K2 收尾，`~/.cache/walk0929/evidence/k2/` 258–275；`fake-llm/requests.jsonl` 164、263 | 走查窗口 / 并入 W-53 文案批 | 10/6 核对：仍在·未修｜证据：候选 `AdvisorTools.tsx:75/82`、`advisorScenes.ts:123/147`「AI 简历 JD 匹配」「AI 岗位 JD 解读」；后半句（F08）见下面的未核实 |
| W-83 | P1 | 一体机 | 导出前核对事实弹窗在公共屏明文显示完整手机号（从 W-55 拆出，agy 评审上调） | K2 043、119 | 走查窗口 / Grok（与 W-20 同批：公共屏统一打码） | **已修，K10 复走通过**（#1137 已合；rc 栈 4deeaefec，含 dd8b09c92；`~/.cache/walk0929/evidence/k10/`） |
| W-84 | P2 | 服务端 | 跨租户按 ID 读打印任务状态：`GET /print/jobs/:taskId` 无终端或会员身份校验，只按任务号返回状态、完成时间与文件保存/删除元数据（`print-jobs.controller.ts:83-86`、`print-jobs.service.ts:599-645`）。任务号是 64 位随机，但一体机完成页把任务号原文印在公共屏上（W-46），旁人可据此查询；不泄露文件正文。`POST /print/jobs/:taskId/retry` 有终端守卫但服务层未限定任务终端（防御纵深不足） | Codex C 只读审查；走查窗口 22:50 实测无凭证 `curl` 返回 200 与状态字段 | 后端窗口 / 待定 | 10/6 核对：仍在·未修｜证据：候选 `services/api/src/print-jobs/print-jobs.controller.ts:84-88` 只有 `@TerminalScopedThrottle(40)`，没有 Guard |
| W-85 | P1 | Windows Agent | 图片转 PDF 的临时文件 `print_<任务号>_<uuid>.pdf` 在 Agent 中途被强杀或断电后会永久留在公共机：清理函数 `cleanupStaleTempPdfs`（`image-to-pdf.ts:285`）没有任何调用点（注释却写启动时调用），开机清理 `print-task-temp-cleanup.ts` 只认 `task_*`。修法：拿到单实例锁后把 `print_*.pdf` 一起清 | Windows 真机路 9/29 22:52 KSK-001 只读 + 候选 90eb5a21c 代码核实 | Windows 窗口 / 待定 | 10/6 核对：已修·在线上（#1150，`print-task-temp-cleanup.ts` 已清 `print_*.pdf`） |
| W-86 | P1（已运行时证实） | Windows Agent + 服务端 | 缺纸、卡纸后在同一台机「重新提交打印」可能永远打不出来：服务端重试沿用同一任务号只改回 pending（`print-jobs.service.ts:783-793`），Agent 本地任务库见过这个任务号就当已做完（`db.ts:263-266` isTaskDone），只回报一次 failed 不打印（`task-runner.ts:352-355`）；现有门禁只测服务端（`verify-print-jobs.ts:843`、`verify-payment-flow.ts:2185`）。修法方向：重试带序号或新建任务号，Agent 按「任务号+重试序号」判重 | Windows 真机路 9/29 22:52 KSK-001 只读 + 候选 90eb5a21c 代码核实；模拟 Agent 同样按任务号判重，可在本地先复现 | Windows 窗口 / Grok（grok/print-retry-attempt-0929：领任务下发重提次数 attempt、Agent 按任务号+attempt 判重、重报不冲掉 errorCode） | 10/6 核对：已修·在线上（#1152、#1164） |
| W-87 | P2 | 服务端 + 一体机 | 文件接口返回 `Cache-Control: private, max-age=300`（`files.controller.ts:324-340`，Codex 报、待复核），一体机 Edge 用普通配置目录（kiosk 模式、独立 user-data-dir、非 InPrivate），用户预览过的文件可能在 Edge 缓存里留 5 分钟以上；9/28 记录的「InPrivate」为推断、已更正 | Windows 真机路 9/29 22:52 KSK-001 只读 + 候选 90eb5a21c 代码核实（Edge 进程 19 个、带 kiosk 7 个、带 inprivate 0 个） | 后端窗口（敏感文件 no-store）+ Windows 窗口（发布当天比对缓存）/ 待定 | 10/6 核对：仍在·未修｜证据：main 和候选的 `services/api/src/files/files.controller.ts:339` 都是 |
| W-88 | P2 | 一体机 | 缺纸已失败后，进度页仍写「订单已建立，等待终端领取」「排队等待中」，没说已发生的缺纸失败（从 W-86 拆出） | Grok K9 `evidence/k9/018-failure.png` | 主执行窗口（打印链进度页）/ 待定 | **发布前复核通过**（候选 9565ee6bc，rc 栈，9/30 12:09 后证据 `~/.cache/walk0929/evidence/k13/print/`） |
| W-89 | P2 | 一体机 | AI 顾问页「发送」按钮被拉成约 260px 高的一大块（y≈1385–1650），原有版式问题 | 主执行窗口看 #1137 修后截图时发现 | 主执行窗口（留白修复包）/ 待定 | 10/6 核对：未核实（版式问题，代码看不出来） |
| W-90 | P1 | 一体机 | 下架穿透：用户停在政策详情时平台紧急下架，一体机不刷新仍能扫出来源二维码、没有失效提示；停在公告时下架后点「上传自备材料打印」直接进空白上传页、不说已下架；官方渠道下架后页面二维码仍在（与 W-49、W-74「跨端失效」同组） | Grok K7 第二轮，`~/.cache/walk0929/evidence/k7/` 105、106、108、109、113、114 | 主执行窗口（政策页 G4）/ Grok | 待派 |
| W-91 | P1 | 一体机 + 管理员后台 | 打印中强杀 Agent、60 秒后恢复：一体机仍写「订单已建立，正在出纸」「打印进行中」，告警中心没有这单、也没有 WALK-001 刚离线的告警（服务端要 10 分钟后才把 printing 收成 PRINT_JOB_UNCONFIRMED，页面自述「连续 10 分钟仍无结果才会提示」）；只出纸 1 份，**无重复出纸** | Grok K7 第二轮，`~/.cache/walk0929/evidence/k7/` 141、151、152；任务 ptask_kiosk_8b42a5006cfbdeb0 | 后端窗口（告警与收口时限）+ 主执行窗口（进度页）/ 待定 | **发布前复核通过**（候选 9565ee6bc，rc 栈，9/30 12:09 后证据 `~/.cache/walk0929/evidence/k13/print/`） |
| W-92 | P1 | 一体机 + 合规 | 年龄声明两端不一致：一体机登录勾选、当场打开的隐私政策前 4000 字、第一次 AI 整理都没有「年满 14 周岁」；小程序登录、隐私政策、AI 入口都写了（`launch.wxml`、`privacy.wxml`、`ai-access.js`）。第一次发布「AI 使用声明强制」关，但年龄条款口径两端应一致 | Grok K7 第二轮，`~/.cache/walk0929/evidence/k7/` 002、003、005、j6-miniapp-age.txt（基线 3841b823a 栈；#1119 自我探索同意已进 dd8b09c92，待复走） | 合规窗口复核 + 主执行窗口（C6 声明）/ 待定 | 10/6 核对：仍在·未修（部分：一体机登录页仍没有「年满 14 周岁」）｜证据：main 和候选的 `apps/kiosk/src/ai/aiDeclarationCopy.ts:6/33` 已有；`git grep "14 周岁" -- apps/kiosk/src/pages/auth` 两边都是 0 处 |
| W-93 | P1 | 一体机 | 加密 PDF 进材料检查：预览空白、页数「待识别」、下一步灰，文案说「内容扫描暂不可用，请人工确认」又说「不能继续」，没说这是加密文件、也没给「请去掉密码再传」这样的下一步（死胡同） | Grok K7 第二轮，`~/.cache/walk0929/evidence/k7/` 054、058 | 主执行窗口（打印链材料检查）/ Grok | **发布前复核通过**（候选 9565ee6bc，rc 栈，9/30 12:09 后证据 `~/.cache/walk0929/evidence/k13/print/`） |
| W-94 | P2 | 一体机 + 手机上传 | 微信乱码文件名二次乱码：手机页 `ç®€åŽ†.pdf`，报价页变成 `Ã§Â®â‚¬Ã¥Å½â€ .pdf`（页数、金额正确）；手机上传 HEIC、WPS、ET、DOC 选中后页面不变「已收到」、只重复「支持 PDF / JPG / PNG」，不点名这一份为什么不行（U 盘则明说）；结果未确认页把 `errorCode = PRINT_JOB_UNCONFIRMED` 与任务号原文给用户（并入 W-46/W-53） | Grok K7 第二轮，`~/.cache/walk0929/evidence/k7/` 059、064、079–081、120 | 主执行窗口（打印链）/ Grok | 格式说明**通过**（9565ee6bc 复核）；**遗留**：微信乱码文件名二次乱码——`file-validation.ts:268` 还原 UTF-8 要求结果含汉字才采用，非阻塞，转后端 |
| W-95 | P1 | 服务端 | 分段排好的**文字层 PDF 简历**被读成 1 块：`resume-extraction.service.ts:187` 用 `extractPdfText(..., { mergePages: true })`，unpdf 合并页时把所有空白收成一个空格，「个人信息 / 工作经历」等分段标题不再各自成行；诊断只剩 1 块、优化页「没有需要逐条对照的建议」。应届生最常见的 Word 导出 PDF 正是这类（图片型 PDF 经 OCR 反而读成 6 块） | Grok K8（rc 栈 90eb5a21c）控制台「简历被读成 1 块」；同一 PDF 用 unpdf mergePages 抽出为一整行 | 后端窗口 / 待定 | 10/6 核对：已修·在线上（#1158） |
| W-96 | **P1（确认，真问题）** | 服务端（小程序无缺陷） | 手机下单、家人持码到一体机代取被拒「打印隐私检查尚未完成」，单停在 `pending_release`：该单源文件上没有任何 `pii_scan` 记录（同日另一张隔夜单有已完成扫描、正常出纸）。到机核销要求已完成隐私检查，但取件人在一体机上没法补做——若小程序或服务端允许在没完成隐私检查时就建单，就是一条「手机上下了单、到机永远取不了」的死胡同；也可能是回放脚本漏了隐私检查这一步，需先核「未完成隐私检查能否建手机到机单」 | Grok D4b（`ORD-20260928-DA5479EA61`，周博下单、周桂芳代取） | 后端窗口 / Grok | 10/6 核对：已修·在线上（#1165） |
| W-97 | P2 | 服务端 | 简历结构化对凌乱原稿太挑：公司与在职时间写在「工作经历」标题之前会被归进基础信息，逐条对照只从工作经历块里带「公司 + 时间」的行生成，于是一条建议都没有；姓名行不以「姓名：」开头时结构化姓名为空（显示「原文未识别到姓名」）。现实中招聘网站导出、手机转发的简历常是这样 | Grok K12 `~/.cache/walk0929/evidence/k12/016-c-report.txt`、`017-c-optimize.txt`（数据集 v2 欧阳春梅「女儿发来的简历.pdf」） | 后端窗口 / Grok（用「女儿发来的简历.pdf」同款排版做夹具） | 10/6 核对：仍在·未修（部分）｜证据：候选 `services/api/src/ai/resume/resume-structure.ts:82-84` 仍只认 2–4 个连续汉字；该路径没有 NFKC。逐条建议「待真模型复核」 |
| W-98 | P2 | 小程序 | 「我的」页的「打印单」计数只数取件后的打印任务，没算还没到机的手机单：王堃订单页有 1 张手机单「已过期」，「我的」打印单却是 0 | 小程序窗口第四轮（数据集 v2，615 王堃） | 小程序窗口 / 小程序窗口（分支 claude/miniapp-me-order-count，两段相加、满 50 显示「N+」，已做反向变异） | 已修复并复验（PR #1168；615 王堃订单页 1 = 「我的」1 = 服务端 1） |
| W-99 | P2（待核） | 服务端 | 终端心跳路由按每 IP 60 次/分钟限流（`terminals.controller.ts:151` `@Throttle({ default: { ttl: 60_000, limit: 60 } })`）；走查栈 4 台模拟终端共用 127.0.0.1 时 4300 日志出现心跳与领任务 429 `RATE_LIMITED`。领任务已改按终端计（:163-174），心跳仍按 IP。真实网点多台一体机共用一个出口时是否会被误判离线，需后端按真实频率估算（走查环境额外还有别的进程共用该 IP，不能直接当生产结论） | 走查栈 `api.log` 9/30 11:32 `route=/api/v1/terminals/:terminalId/heartbeat status=429 code=RATE_LIMITED` | 后端窗口 / 待定 | 10/6 核对：仍在·未修（代码没改；会不会出问题待后端估算）｜证据：候选 `terminals.controller.ts:75` 心跳路由没有按终端计数的装饰器（领任务 :174 已改成 `TerminalScopedThrottle`） |
| W-100 | P1 | 服务端 + 小程序 | 会员订单里打印失败只显示「打印失败」，没有原因、没有下一步，终端名兜底成「打印服务终端」：`/me/print-orders` 失败行不带 errorCode 与终端名（PrintTask 里记了 PAPER_EMPTY / PRINT_JOB_UNCONFIRMED / PRINTER_ERROR）；已过期只写「已过期」，不说没打印、不说可重新下单。修法：服务端只下发码（不下发现场原文），小程序按码配用户说法与「可在我的文档重新打印」；过期单加一句 | 小程序窗口第四轮（602 欧阳春梅 21 单、604 韩冰 21 单、603 孙伟 20 单，失败 1–3 单） | 后端窗口（下发码）+ 小程序窗口（说法与下一步）/ 待定 | 10/6 核对：已修·在线上（#1171、#1176） |
| W-101 | P1（「今日概览」口径）/ P2（其余） | 两后台 | 发布前复核（候选 9565ee6bc）两后台剩余工程词：「今日概览」实为滚动近 24 小时（`ai-log.service.ts:373`，104 vs 上海今日 40，**优先**）；原始 ID（AI 用量按终端/机构、文件管理用户列、审计操作人、Task ID）；告警标题拼英文错误码（`derived-alerts.ts:283`）；配置键名、异常类名、模型串、源码文件名（`llm-config.service.ts` runtimeNote）、价目键名、审计动作名、机构「合规限制」英文代码等。总指挥 9/30 裁定：**不阻塞第二次小步更新**，进两后台 UI 优化下一批；「。。」已由 #1166 修 | Claude 子代理（consoles 路）截图 `~/.cache/walk0929/evidence/k13/consoles/`，对账 `~/.cache/walk0929/k13/consoles/recon.sql` | 两后台窗口 / 待定 | 10/6 核对：优先项已修·在线上（#1172、#1175）；其余批次在线上（#1181/#1185/#1194/#1204/#1215）与候选（#1226/#1234） |
| W-102 | P2 | 一体机 | 打印链小问题（9565ee6bc 复核）：超 100 面被拦后报价页仍写「正在计算本次费用 / 正在获取报价 / 报价回来之前不能建单」；50 页×2 份报价页「计费页数 50 页」与「¥0.00/页 × 100 页」并列矛盾；缺纸时参数页打印机栏「打印机缺纸」vs 徽标「打印机异常」；加密 PDF 页同句重复 4 次且写「暂未识别 PDF 页数」；W-91 那单强杀后服务端过了领取时限仍停在 printing（清理未轮到或未收尾，待盯） | Claude 子代理 print 路 `~/.cache/walk0929/evidence/k13/print/` 014、017、030、031、002 | 主执行窗口（打印链）/ 待定 | 10/6 核对：未核实 |
| W-103 | P2 | 一体机 | AI 诊断报告导出后打印，报价页文件行「共 2 页」而计费「4 页」，完成页让用户核对「全部 2 页」，实际出纸 4 页（导出回传的 pageCount 与真实页数不一致；旧版同样存在）。另：有打印进行时「我的」底部「结束使用」换成「看出纸进度」、空账号刚登录时「我的」无「结束使用」（可走账号设置或首页「结束上一位的使用」）；「这一趟做过什么」仍写「还没有留下记录」（W-75 同组遗留） | Claude 子代理 clear 路 `~/.cache/walk0929/evidence/k13/clear/` 078、108–111 | 主执行窗口 / 待定 | 10/6 核对：已修·在线上（#1177） |
| W-104 | P2 | 服务端 | 诊断报告 PDF「四、内容结构摘录」把本人姓名、电话、邮箱印成「[劳动者_1]」「[手机号_1]」「[邮箱_1]」：contentBlocks 只许逐字引用脱敏后的原文（`llm-resume.service.ts:384`），导出（`diagnosis-report-pdf.service.ts:203-212`）不还原，真模型同样发生；没泄露，但纸面难看、本人姓名被换 | 发布前复核 353b680d0 打印路 `~/.cache/walk0929/evidence/k14/print/049-printed-p2.png` | 后端（经主执行窗口转）/ 待定 | 10/6 核对：仍在·未修｜证据：候选 `diagnosis-report-pdf.service.ts:204-210` 原样输出 contentBlocks；`llm-resume.service.ts:384` 用 maskedText 校验。两个文件最后修改分别是 9/30 71e793b00、9/29 045797333，都早于登记 |
| W-105 | P2 | 管理员后台 | 订单管理列表与详情看不到页数，详情「页范围」写「未记录」，库里 `Order.billablePages` 有值；运营核不了出纸页数 | 打印路 `evidence/k14/print/052–060` | 两后台窗口 | 并入两后台 UI 优化第 2 批（Codex 在做） |
| W-106 | P2 | 两后台 | 每页条数切换只在用户管理、权限管理生效，其余页下拉选 10 弹回 20 且不发请求（旧缺陷，9565ee6bc 同）；另三页分页条仍旧样式、总数无千分位、「¥ 0.00」多空格、空值「-」与「—」不一 | 后台路 `evidence/k14/consoles/090–101` | 两后台窗口 | 条数切换与千分位修复在 PR #1183（head 5125487c5，公共 useTableState 连续写入累加 + Excel 导入记录 + 新 E2E），合入后 rc 复核；旧分页器、「¥ 0.00」空格、「-」进两后台第 2 批 |
| W-107 | P2 | 一体机 | AI 简历诊断目标方向默认预选「信息传输、软件和信息技术服务业 · 应届 · 校招」（`ResumeSourcePage.tsx:242-244`），中老年不改就按 IT 校招诊断；应不预选 | 简历路；K12 已见 | 主执行窗口 | 10/6 核对：已修·在线上（#1193） |
| W-108 | P2 | 一体机 | 加密 PDF 诊断提示「PDF 解析失败，请确认文件未损坏后重试」，不说要密码；「重新解析」「打印原件」对加密文件都走不通 | 简历路 `evidence/k14/resume/043–044` | 主执行窗口 | 10/6 核对：已修·在线上（#1193） |
| W-109 | P2 | 服务端 | 扫描/图片简历诊断与优化各 OCR 一遍，上真百度费用与配额翻倍 | 简历路 `k14/resume/results.jsonl` | 后端（经主执行窗口转） | 10/6 核对：未核实 |
| W-110 | P2 | 服务端 + 一体机 | 48 页扫描件只 OCR 前 3 页，页面只说「部分图片文字需要本人复核」，不告诉用户只读了 3 页 | 简历路 022–024 | 后端（经主执行窗口转） | 10/6 核对：仍在·未修｜证据：候选 `ResumeReportPage.tsx:62` 仍是笼统的「部分图片文字需要本人复核」；「前 3 页 / 只读了」两边都是 0 处 |
| W-111 | P2 | 一体机 + 服务端 | Word 简历进不了 AI 诊断：服务端 resume_upload 收 docx/doc，但手机上传页按三种用途格式交集预检只放 PDF/JPG/PNG，拒收文案用打印口径「这台机器现在打不了」；先说清哪条规则拦、再判该不该拦 | 简历路 031–036 | 后端 + 主执行窗口 | 10/6 核对：仍在·未修｜证据：候选 `apps/kiosk/src/pages/upload/phoneUploadModel.ts:70-71`「这是 Word 文档，这台机器现在打不了」不分用途 |
| W-112 | P1（待总指挥定级，走查建议不阻塞第三次小步更新） | 服务端 | 到机码核销不受打印闸门约束：Agent 0.4.13 队列闸门合上（queue_cleanup_failed / queue_pause_failed）时，家人在一体机输到机码，claim-pickup 200、码标 used，屏上「已进入打印队列…请留在出纸口旁」、进度页绿色「排队等待中」，闸门恢复后立刻出纸，取件人可能早已离开。677cffefd 里只有报价（`order-quote.service.ts:158`）与建单（`print-jobs.service.ts:415`）调 `assertTerminalPrinterAvailable`，核销从不看打印机，所以离线、缺纸时同样放行（既有问题，非本次回退）。修法：核销先调同一检查，拒绝并说原话、码不作废 | 发布前复核 353b680d0 闸门路 `~/.cache/walk0929/evidence/k14/gate/030–031`（ORD-20260930-896C760E37） | 后端（经主执行窗口转）/ 待定 | 总指挥 9/30 定 P1、不阻塞第三次更新、须在小程序发布与 12/1 试点前修；闸门收尾包 PR #1186（head 80d2a331e，进候选）：核销与放行前查打印机，取件说「到机码没有作废」、会员领取说「订单没有受影响」，码不作废、不计输错；13 条断言 + 三处反向变异已验 |
| W-113 | P2 | 一体机 + 后台 | 一体机确认页**报价**分支只把 PRINTER_UNAVAILABLE、PRINT_JOB_TOO_LARGE 交给 `userMessageOf`（`PrintConfirmPage.tsx:207`），停在参数页时闸门合上，显示「暂时无法获取报价」和「网络中断」等误导原因（建单分支正确显示原话）；告警副标题露出 `queue_pause_failed` 英文码；打印机页不显示「请到现场清空打印队列后重启 Agent」处置指引；代取完成页摘要留空 | 闸门路 033、020 | 主执行窗口 + 两后台窗口 | 并入闸门收尾包 PR #1186（报价原话、告警副标题中文、打印机页处置指引、代取完成页摘要） |
| W-115 | P2 | 服务端 + 一体机 | 到机核销「未放行」回执（released:false，现场需付款的单）返回未脱敏的 sourceFileName，已放行回执用 maskPickupFileName；一体机把它显示在公共大屏上。既有行为，agy 评审闸门收尾包时指出 | agy 评审 `~/.cache/walk0929/agy/gate-closeout-review.md` 第 1 条；`pickup-order.service.ts` settleClaim 返回对象 | 主执行窗口 / 后端 | 10/6 核对：仍在·未修｜证据：候选 `services/api/src/print-jobs/pickup-order.service.ts:259` `fileName: fresh.sourceFileName`；已放行分支 :512 用的是 `maskPickupFileName` |
| W-116 | P1 | 一体机 + 服务端 | 简历优化页「导出 PDF」三例全部 400 VALIDATION_FAILED（`intention.position` 不能为空，`services/api/src/ai/dto/resume-generate.dto.ts:56`），页面只说「提交内容未通过校验，请检查后重试」，而优化页编辑区没有求职意向这一栏，用户没法补；原件写了求职意向的也失败（可能与模拟大模型没抽出意向有关，未用真模型排除）。同页「导出修改清单」与诊断报告页导出正常。另：价目为 0 时导出区价目条仍写「当前免费，不扣权益」（服务端 `resume-export-gate.service.ts:344` 与一体机兜底 `ResumePricingBar.tsx:19-24`、`constants.ts:60`），已交主执行 D 批 | 简历导出钱字眼实测（rc 栈 677cffefd）`~/.cache/walk0929/evidence/k15/export-money/` 012、028、040；价目条 37 张 | 主执行窗口 / 后端 | 10/6 核对：已修·在线上（#1192） |
| W-117 | P2 | 一体机 + 两后台 | 第四次更新复走遗留（均为老问题）：打印入口第三行「签名」卡右侧空白 287px，证件照未按 2.0 定稿挪进签名右边两格；缺纸态与离线态文案一字不差（「一体机离线」，`QxPrintHubView.tsx:311-316`、`printHubContent.ts:180/228/246`）；离线/缺纸提示条写「签名仍可使用」而同屏签名卡「本机暂未开通」；闸门报价被拒后确认页右半约 500px 空白、原话出现两次；到机码被拒页 8 格仍显示刚提交的码；「我的→打印订单」无订单号；非闸门打印失败告警副标题仍带 PAPER_EMPTY 等英文码；「我的文档」4 份时底部空白 291px；一体机建单 printParamsJson 为空 | `~/.cache/walk0929/evidence/k16/gate-print/002、004`，`resume-look/035–041` | 主执行窗口 + 两后台窗口 | 10/6 核对：未核实（「我的文档」底部空白、建单 printParamsJson 为空两项总表写「待下一轮」） |
| W-118 | ~~P0~~ → **开发版假象（成对建任务部分）**；服务端「只看最晚一条」降为 P2 | 一体机 + 服务端 | 有隐私命中的文件在报价页点「确认并打印」约半数被 400 `PRINT_PII_SCAN_REQUIRED` 拒，重点、返回都救不回，只能重传：进材料检查页时同一文件被建两条 pii_scan 任务（间隔 0–23ms，页面挂载两次，`PrintMaterialCheckPage.tsx:405` 挂载副作用无防重），裁决只写进一条，闸门 `pii-scan-gate.ts:27-29` 取 createdAt 最晚的一条。rc 库 10/4 的 11 份文件 11 份成对。逻辑在 7807f7ac8 与 bb49ea064 之间未变，可能线上已有；上传会话同样成对建 | 第五次复走打印路 `~/.cache/walk0929/evidence/k18/print/` 100–112、`b-results.jsonl` | 后端（闸门/幂等）+ 主执行（挂两次、提示） | 10/6 核对：已修·在候选未上线（#1222 服务端、#1239 一体机防重与开发版构建闸）；第六次正式构建复走 |
| W-119 | **P0（挡发布，已拦下第五次更新）** | 服务端 | 简历优化页「导出 PDF」必 400：#1195 补回的经历职务为空（`resume-optimize-coverage.ts:199`，提示词第 9 条也要求留空），导出 DTO 仍 `@IsNotEmpty()`（`resume-generate.dto.ts:91`）。同路坐实：「2024.07 至今」不识别、补回吞进联系方式与页脚、无标题自述句与求职岗位不补回、合并时重复 | 简历路 `~/.cache/walk0929/evidence/k18/resume/` 010、022、034、045、056 | 后端 | 10/6 核对：主问题已修·在线上（#1220 → #1224）；遗留 R-1/R-2 在候选（#1225）；R-6 在候选（#1254，10/4 合入）——三项随第六次用样本 6 复走 |
| W-120 | P1（签约前必须修或改协议口径） | 服务端 + 机构后台 | 机构后台被隐藏的 1–4 能反推：①终端数据页与导出 CSV 同行给「出纸成功 少于 5 / 已结束 5 / 成功率 60.0%」；②机构大屏终端页 24 小时状态带逐单画色块、接口带毫秒起止；③「今日人次」隐藏而近 7/30 天实时给原数，两次读数相减。直接显示 1–4 未发现；「使用情况」0 被写成「少于 5」已知 | 人次路 `~/.cache/walk0929/evidence/k18/smallcount/` 024–032、105、005–010、075–080 | 后端 + 两后台 | 10/6 核对：已修·在候选未上线｜证据：#1226 合并提交 197e794c5 不在 main；正文逐条写了截至昨天、补充隐藏、状态带不画打印段，并附穷举门禁 |
| W-121 | P1 / P2 | 两后台 | 第 2–4 批复走（通过，无挡发布）遗留：审计 58 种动作 31 种显示「其他操作」含紧急下架、新建机构、放行打印单（P1）；审计详情英文键名与内部终端号；AI 服务管理残留 `llm`、`llm:deepseek`、金额小数位不一、日志无条数切换；订单详情「¥ 0.00」带空格；机构对公联系电话在 `/admin/orgs` 接口与详情抽屉明文（待裁定）；机构资料仍列岗位、招聘会模块未标「暂不开放」 | 后台路 `~/.cache/walk0929/evidence/k18/consoles/`，`audit-actions.txt` | 两后台 | 10/6 核对：已修·在候选未上线（主体）；以下三项**未核实**：日志无条数切换、机构对公电话明文（待裁定）、机构资料里岗位招聘会模块没标「暂不开放」｜证据：#1226 正文：293 个动作码全有中文名、去掉 `llm`、金额四位小数 |
| W-122 | P1 / P2 | 小程序 | #1189 不通过：材料包三页免费时仍写「不付款 / 未付款 / 现场付款」、订单详情行标签「金额」，门禁 free-pilot-copy 有盲区；8 页「免费 / 免费试运营」是否算钱字眼待产品负责人定。#1201 断网时英文「request:fail timeout」直接显示共 7 处（5 处为本次带出）。另：订单详情显示 `pending_release` 等英文状态；额度用完句在模拟面试与小青里不贴切 | 小程序路 `~/.cache/walk0929/evidence/k18/miniapp/结论.md` | 小程序窗口 | 10/4 已报总指挥 |
| W-123 | P2 | 一体机 + 服务端 | 第五次复走其它遗留：AI 次数用完时一体机标题写「这一轮没连上，可以重试」、服务端提示「请稍后再试」（应为明天）；无腾讯云凭证时 `POST /trtc/session` 报笼统 500；B 批 9 个状态留白超标（12 等待 257、13 加密 241、15 卡纸失败 694、18 等待回传 282、32 无订单 540 等）、14 主按钮首屏被底栏盖住、报价页隐私摘要与用户裁决不符；托管：机构端 `scope=admin` 资料预览链接关闭后 10 分钟内仍可开、Excel 导入中文文件名乱码、关闭期间本人删不了关联岗位的求职进度；带 jobId 被拒提示「招聘内容托管已关闭」是内部术语 | `~/.cache/walk0929/evidence/k18/quota/`、`print/`、`hosting2/` | 主执行 + 后端 | 10/6 核对：主体已修·在候选未上线。仍在：带 jobId 被拒时的提示仍是「招聘内容托管已关闭」（候选 `services/api/src/recruitment-hosting/recruitment-hosting.ts:47`）。**未核实**：TRTC 无凭证 500（候选 services/api 里没有 TRTC 专用错误码）、本人删不了关联岗位的求职进度｜证据：见 PR 号 |
| W-124 | P1 / P2 | 一体机 | 第五次放行复走（3faa07816 正式构建）新登记：N1 **游客**在预览页点「返回材料检查」或「上一步」整份办理被清、只能重传（重进检查页查检查任务 403「缺少或无效的材料任务访问凭证」，5/5，会员不受影响，P1）；N2 卡纸失败页 0 元单仍写「已付金额都保留着」、约 650px 空白（printProgressModel.ts 缺纸文案同）；N3「我的打印订单」详单 0 元单仍有支付、实付、抵扣字样；N4 报价页隐私摘要与用户保留的命中不符。另两后台：K19-C1 告警副标题英文码与格式、K19-C2 宣传屏没写限额且不校验格式 | `~/.cache/walk0929/evidence/k19/w118/` 022–054，`k19/consoles/` | 主执行（N1–N4）+ 两后台（C1、C2） | 10/6 核对：已修·在候选未上线｜证据：三个合并提交 0be2e87e6、1497b4240、2a3d27bcd 都只在候选 |
| W-125 | P1（挡试点机验收，不挡第六次） | 一体机 + 服务端 + Agent | U 盘导入开关只关住打印扫描首页卡片：后台把 WALK-001 的 `usb_import` 配成未验收（维护中、不支持同样），首页卡片置灰写「本机暂未开通」，但①首页→开始选择材料→手机扫码上传→二维码过期→「改用 U 盘导入」②深链接 `/print/upload?source=document&tab=usb&mode=transfer` ③简历来源页「U盘上传」卡片，三条路照常读盘导入（POST /local/usb/upload 200）。原因：services/api 只有类型定义提到 `usb_import`、无 `assertUserTaskAllowed`，U 盘文件经 Agent 代传到通用 `/files/kiosk-upload` 分不出来源；Agent 不认开关；PrintUploadPage:184、ResumeUsbImportPanel:58 只看构建期网桥令牌 `isUsbImportConfigured()`。未配置=放行、首页卡片三种状态文案均通过。修好后复走：三种关闭态×四条路都进不去、未配置与可用照常导入、读不到能力配置按拒绝 | `~/.cache/walk0929/evidence/k20/usb/`（11-/12-/13-/14-） | 主执行（四处入口）+ 后端（来源标记加拦截）+ Windows（Agent 来源标签与错误码） | 10/6 核对：已修·在候选未上线。服务端按 PR 说明有意不改；Agent 侧的改动要等新版 Agent 装到机器上才生效｜证据：两个 PR 的合并提交 0e66f5416、784f4fb54 是候选祖先、不是 main 祖先；#1237 正文写明「拦在 Agent」 |
| W-126 | P2 | 管理员后台 + 服务端 | 能力行一旦登记就回不到「未配置」：界面只有登记/保存，服务端无删除接口（走查现场经总指挥同意删本地库那一行还原，删前 1 行、删后 0 行） | `k20/usb/REPORT.md` 第 4 步 | 两后台 + 后端 | 10/6 核对：已修·在候选未上线｜证据：002215e89→a1e5f302a 只在候选 |
| W-127 | P2 | 管理员后台 | 能力中心未登记行的「调整为」下拉默认停在「未验收」，直接点「登记」就把该项关掉，易误操作（代码注释称有意为之，需复核默认值或文案） | `k20/usb/REPORT.md` 非阻塞 | 两后台 | 10/6 核对：已修·在候选未上线｜证据：71eb9fad4 只在候选 |
| W-128 | P1（不挡第六次，试点前必须进，目标随第六次） | 服务端 | 模型 402（余额耗尽）时简历解析失败照样扣当天次数：`resume-parse-intent-runner.service.ts:17` 写明 Failures are not refunded（consumeOnce 不回滚；小青用 consume+rollback 不受影响）。每次失败会员、终端、IP 三项计数各 +1，页面写「请稍后重试」，连点约 4 分钟用完会员 20 次；恢复后本人直接 429 `AI_PUBLIC_QUOTA_EXCEEDED`、不调模型；终端 120、IP 240 同被烧掉，充值当天整机可能不可用。状态文件路径与提示词标记路径均复现（欧阳春梅 null→1、终端 41→42）。建议上游 4xx/5xx 失败回滚次数 | `~/.cache/walk0929/evidence/k20/llm402/` r5/r9/r10/s3，`089-s3-diag-402.png` | 后端 | 10/6 核对：修复中（#1241 OPEN，与候选冲突、kiosk-browser-smoke 红） |
| W-129 | P1（不挡第六次，试点前必须进，目标随第六次） | 一体机 | 模拟面试作答遇 402：`InterviewSessionPage.tsx:307-309` 先把回答追加进对话并清空草稿，catch 不恢复，用户要在触屏上整段重打，「最近对话」里却显示得像已记下；随后「结束本场」：首轮一题未落库时 `/end` 400 `INTERVIEW_NO_ANSWERS`，补测已答题时 `/end` 503，页面都写「报告生成失败，请重试」，重试不会成功，也没有不依赖 AI 的出路。建议失败保留草稿、未落库的回答不进对话、报告失败说明 AI 暂不可用并给查看我的回答/打印通用题目单/返回 | `~/.cache/walk0929/evidence/k20/llm402/` `042`/`043`（首轮）、`084`/`085`（补测） | 主执行 | 10/6 核对：一体机半边已修·在候选（#1246）；后端「打印本场题目和回答」修复中（#1249 OPEN，build-and-verify 红） |
| W-130 | P2 | 服务端 + 一体机 | 402 被归成单次请求错误：`llm/llm-failure.ts:75` 把 402 归入 `AI_PROVIDER_REQUEST_ERROR`，一体机 `aiOutage` 只认 `AI_PROVIDER_UNREACHABLE`，于是面试设置页（`InterviewSetupPage.tsx:357`）与简历生成页（`ResumeGeneratePage.tsx:339`）显示「AI 服务本身是通的，再点一次」，余额耗尽时不实；小青 `/assistant/chat` 503 无机读错误码（前端得「服务器内部错误」）。建议 402/401/403 单独成码按「AI 暂时用不了」处理 | `~/.cache/walk0929/evidence/k20/llm402/` `031`/`032`、`046`、`038`/`086` | 后端 + 主执行 | 10/6 核对：修复中（#1241 OPEN，同 W-128） |
| W-131 | P2 | 一体机 + 服务端 | 402 走查其它：面试开场失败的错误提示落在 2047px（屏高 1920），首屏无变化；`AI_PUBLIC_QUOTA_EXCEEDED` 显示成「当前使用的人较多，请稍后再试」，应为「今天的次数用完，明天恢复，可先打印原件」；面试开场失败每点一次留一条 `status=configured` 空会话、旧错误提示回到设置页仍挂着；优化失败页右上角状态胶囊仍写「等待优化建议」。简历诊断/优化失败页、小青、AI 简历生成（可导出未润色原稿）出路齐全；402 调用均记 upstream_error 不计费；恢复后四项阳性对照全部正常 | `~/.cache/walk0929/evidence/k20/llm402/` `031`、`073`、`081`、`091`–`095` | 主执行 + 后端 | 10/6 核对：已修·在候选未上线｜证据：候选 `userErrorMessage.ts:41` 有 `AI_PUBLIC_QUOTA_EXCEEDED_COPY`「今天的 AI 次数用完了，明天恢复…」，main 没有；#1242 写「开场失败的空面试会话满 30 分钟再删」 |
| W-114 | P2 | 一体机 + 小程序 | 677cffefd 差量复核遗留：一体机 0.4.12 竞态下重新提交被 409 PRINT_RETRY_AGENT_VERSION 挡，页面只显示兜底句「重新提交失败，请联系工作人员补打」且在首屏外（`userMessageOf` 未放行该码，并入闸门收尾包）；失败页连点第二下落到进度页「问小青」被带到 /assistant；小程序单件打印闸门合上时核价仍成功、选服务点页不显示暂停，材料包在核价就拦，两路不一致，「换一台终端」与「换一个服务点」用词不一；失败单说明写「可重新打印」却无按钮；0 元单失败页顶部「本次未收款」 | 差量路 `~/.cache/walk0929/evidence/k14/delta/008、013、017–024` | 主执行窗口 + 小程序窗口 | 10/6 核对：未核实（其余五项总表写「待派」） |

### 4.5 两端对账结果（9/29 晚）

| 账号 | 一体机做了什么 | 小程序看到什么 | 结论 |
|---|---|---|---|
| 13800000501 | 小程序下单到机码 88767910 → 一体机游客态核销，17:42:26 出纸 1 页 | 取件页「打印已完成」、订单列表「已完成」 | 一致（通） |
| 13800000201 | 一体机打印 2 单（1 页 × 2 份、1 页 × 1 份，0 元）、我的文档 2 份 | 订单 2 单「已完成·免费」、文档 2 份 | 一致；终端名兜底成「打印服务终端」（W-58） |
| 13800000301 | 诊断 1、优化 1、导出 2、打印 2 单 | AI 记录诊断 1、优化 1 | AI 记录一致；问答要点小程序无页面（W-62，已修） |
| 13800000501 | 小程序作废重发到机码，一体机旧码 404、新码 18:29 出纸 | 取件页「打印已完成」、pickupStatus=used、二维码撤下 | 一致（通） |
| 13800000501 | 小程序扫一体机登录码并确认；扫上传码传 1 份 PDF | 登录 phase=confirmed；上传会话服务端 status=uploaded、文件在 | 各验了小程序一半（码由脚本生成） |
| 602 欧阳春梅 / 604 韩冰 / 603 孙伟（数据集 v2） | 两周订单，含完成、失败、待到机、过期 | 订单页 21 / 21 / 20 = 「我的」打印单 = 服务端行数；604 的 pending_release 显示「待到机」 | 一致（小程序第四轮，9/30）；失败与过期说法见 W-100；会员最多 21 单一页给完，分页未真正触发 |
| 13800000311 | 一体机问小青并保存要点（22:03） | 小程序「问答要点」显示该条，证件号与手机号打码 | 一致（W-62 修复后复验通过） |
| 13800000501 | 22:01 一体机真实打开「扫码登录」；22:02 一体机打开「手机扫码上传」 | 22:01:30 扫码、22:01:38 确认；22:02:43 扫码、22:02:51 发送 PDF | **两端同步实测通过**：一体机 22:02:09 显示 138****0501 已登录；22:02:54 出现「测试·走查简历.pdf 394 B · 手机扫码上传 待确认」（`~/.cache/walk0929/evidence/k5/live-*-result.md`，小程序截图 `evidence/miniapp/live-*`；模拟器无摄像头，扫码结果用替身返回二维码原文，其后全走真实代码） |

### 4.6 两后台对账（Grok K3，18:15 快照）

订单管理 10 条（全部已支付 ¥0.00，第 1/1 页）：已完成 8 = 数据大屏「近 24 小时打印完成 8」；另 2 条小程序云打印待取件（对应 K4、K5 的手机下单）。大屏「累计打印 12 页」是页数。AI 服务：概览「今日累计」11 次、成功率 90.9%（1 次 ServiceUnavailableException），分能力「近 24 小时」同为 11；工作台稍后读到 13 次 92.3%（时间差，非口径差）。告警中心 1 条待处理（AI 内容投诉），打印失败/打印机异常/离线 0，与流水一致（打印机故障演练未开始）。机构 A：政策公告 3（已发布 1、待初审 1、待审核 1）、本机构在架 1、终端 WALK-001 在线、本机构告警 0；平台大屏在架 2（多的是机构 B 那条）。口径说明已写在页面上的：浏览跳转归因为空（日志无机构快照）、「打开来源平台」只计点击；另 13 项指标待补机构归属（P-04 仍在）。


### 4.7a 打印扫描链续跑（Grok K1）结论

通：材料扫描投递→打印（2 页）；两张身份证样张合成 PDF 后**没有**被直接放行，材料检查先停在 6 处待确认、「全部保留」后才能打（修正 9/29 总指挥「转换产物整类豁免隐私检查」的担心：本地正式构建上转换产物走了隐私确认，豁免只在服务端建单闸门那一层，待后端复核）；断网（确认、报价、建单各注入 500）都有提示且重试可继续；打印机缺纸/离线下单前拦住（按钮「打印机不可用」），打印中缺纸/卡纸不出纸，结果未确认 20 秒回写，三种失败告警中心都有记录；到机码超时重输给「已经用过」。
问题见 W-76～W-78；W-17、W-21、W-23、W-44、W-46、W-51 复核仍在。

### 4.7b 跨端与退出残留（Grok K4）结论

打印进度回流通：手机下单 → 一体机核销 → 打印中 → 完成，小程序详情逐步变中文「待取件 / 打印中 / 已完成」（未核销时英文见 W-72）。退出残留通：「结束使用」和闲置 180 秒清场后，localStorage / sessionStorage / cookie 只剩隐私边界键与终端会话令牌，不含手机号、文件名、问题原文；无 IndexedDB、无 service worker；下一位登录不串号。缺口在「不点结束」的清场前窗口（W-42、W-75）与跨端删除后的一体机旧列表（W-73、W-74）。

### 4.16 第五次更新放行复走（10/4，#1224 = release/r5 = 3faa07816，正式构建）

10/4 查明 10/3 19:55–10/4 13:12 的走查栈前端是 React 开发版（构建命令与 source 后端 env 同一个 shell，NODE_ENV=development 带进 vite build），开发版 StrictMode 双挂载造出「成对建检查任务 / 上传会话」的假象，W-118 据此误报为 P0；13:13 起以 `env -u NODE_ENV` 重建三端（jsxDEV 0），起栈脚本加了开发版拒绝启动的自查。在正式构建上三路复走，**挡发布均无，放行条件满足**（已报总指挥）：简历一路 13 次导出全 201、经历不丢、至今识别、联系方式不进经历、上传会话各 1 个；两后台第 5 批工作台对库一致、人次 0/1–4/≥5 显示规则统一且正确；打印三条主线各 10 次带隐私命中 0/30 被拒、每文件 1 条检查任务，#1211 的 0 元口径与 W-117 五处已修。总指挥裁定 R-1+R-2 跟第六次。新登记见 W-124。

### 4.15 第五次更新发布前复走（10/3–10/4，bb49ea064，已停发）

rc 栈跑 bb49ea064，另起「托管打开」对照环境（库副本 walk_rc_on_1003）。结论：**两条挡发布级**——W-119 优化页导出 PDF 必 400（第五次更新因此停发，#1214 关闭，修复 #1220）；W-118 有隐私命中的文件约半数在「确认并打印」被拒（可能线上已有，待总指挥只读核线上库）。其余：AI 额度（#1190）通过；托管关闭七处（#1202）在有存量时七处全过（第一轮因库里无存量四处没验到，是任务包前提写错，已补验）；两后台第 2–4 批通过；人次压制无直接泄露但三处可反推（W-120）；小程序 #1189 不通过、#1201 只差断网一种（W-122，不挡一体机与后台）；W-107、W-108 通过；B 批 6 页结构照稿但多处留白超标。过程：10/3 晚停机打断两路，10/4 接着证据收尾；10/3 晚四路结论因想攒齐再发而没发出，已改为出一路报一路。

### 4.14 10/1–10/3 续记

- 第四次更新（7807f7ac8 那棵树，外加只动 Agent axios、锁文件与两条门禁的紧急修复）10/3 13:41 上线；线上尚无人用真实账号再走 W-116，走查结论只在 rc 栈。
- #1190（AI 额度三个漏洞）并入带 #1197 axios 修复的候选 79490e294 后 CI 三项全绿，10/3 已合进候选；闸门收尾包 #1186、W-116 修复 #1192 均已随第四次更新上线。
- 10/1 08:36 电脑重启打断本地栈；Codex 命令行 10/1 09:29–10/3 12:52 损坏，本窗口该期间未派 Codex，无受影响产出。
- 第五次更新复走重点（等 release/r5 的 SHA）：#1190 三处、#1195 简历优化不丢内容、#1202 托管关闭七处、#1189 小程序 9 页无钱字眼与 #1201 错误原话（一次性副本真跑）、#1184 B 批打印主线 6 页观感、#1185/#1194 两后台各抽三页。

### 4.13 第四次更新发布前复走（9/30 晚，发布目标 7807f7ac8）

rc 栈 22:59:00 起跑 7807f7ac8（自本窗口工作目录运行，不再在 walk-rc 里切版本）。四处全部通过、无阻塞，已报总指挥：W-116 三例导出 PDF 201 且不编造职位；闸门收尾（#1186）核销被拒码不作废、恢复后同码取件出纸、报价原话、告警全中文含处置指引；打印主线游客现打现取、会员登录打印、到机码代取三条到出纸且页数一致；A 批（#1179）首页与打印入口无回归。#1135/#1138 的三条 Redis 门禁本地全过。证据 `~/.cache/walk0929/evidence/k16/`。非阻塞老问题登记为 W-117。

### 4.12 第三次小步更新发布前复核（9/30，候选 353b680d0 → 677cffefd）

rc 栈 16:54 换到 353b680d0，分五组复走（Claude 子代理，本地 rc 栈 + 假大模型/假 OCR + 模拟 Agent）：打印（W-103 四处页数一致、出纸无空白页，先用上一轮带空白页的单做阳性对照）与主链三条**通过**；简历 W-95 **通过**，W-97 姓名补回通过、逐条建议**待真模型复核**；两后台第 0 批、告警标题白话、AI 配置说明白话、托管 a **通过**，「今日概览」#1172 未进候选，总指挥裁定排第四次；闸门组一体机入口、建单原话、后台、恢复、W-45 变体、W-96 正常代取**通过**，小程序新错误码在 353b680d0 不通过（#1156 修，已进 677cffefd），新登记 W-112、W-113。Agent 0.4.13 开机清理本身是 Windows 行为，本机只跑了 Agent 自带五条门禁（全部通过）。候选随后进了 #1152、#1176、#1156（677cffefd），17:31 换栈做差量复核。差量结论：#1152 重新提交（0.4.13 缺纸后重提出纸、0.4.12 被 409 挡、双击/连点/并发都只出一份）、#1156 小程序暂停接单原话与「换一个服务点」、#1176 小程序失败与过期说明**全部通过**，无阻塞，已报总指挥（发布目标 677cffefd）。W-112 与 W-113 等四项由总指挥定为「闸门收尾包」P1，排第四次更新，走查窗口写任务包派 Codex（分支 claude/gate-closeout-w112）。

### 4.11 第二次小步更新发布前复核（9/30，候选 9565ee6bc）

总指挥要求在 rc 栈复核五组后决定是否发布。结论：**五组全部通过，无阻塞**（已报总指挥）。清场 P0（#1149）：四种离场 + 完成页倒计时，下一位在任何入口都读不到上一位资产，W-42/43/75/64、B-12 全部已修，清场后存储回到基线；打印链第二轮（#1153）：W-88、W-91、W-93、W-94 格式说明通过；每单 100 面（#1146、#1147）：102 面置灰、100 面出纸、101 面服务端 400 `PRINT_JOB_TOO_LARGE` 原话显示；两个后台：可开、托管 a 正确、数字与库对上，剩余工程词裁定非阻塞（W-101）；主链三条通过。非阻塞遗留：W-94 乱码文件名二次乱码、W-102、W-103。
过程教训：派出的 Grok 挂 6 小时后 402 失败未被及时发现；复核中又发现 rc 栈 API 未换成候选、模拟 Agent 回写字段与候选不兼容，两处修正后全部重测，结论只取修正后证据。

### 4.10 数据集 v2 落库情况（9/30 04:20）

两周历史经时钟偏移实例（方案 A，正常接口）回放 + 今天真实时钟补 22 单，全部走正常渠道、未直接写库。订单共约 478 条，分布在 9/16–9/30、四个网点：工作日明显多于周末（服务大厅 102:23、零工之家 106:31、高校 65:19、社区 58:17），钟点上服务大厅 9 点 86 单、14 点 31 单，零工之家 7 点 84 单（早高峰成立），高校与社区下午多；含完成、失败（缺纸、卡纸、未确认）、放弃（报价不建单、上传不确认）、过期未取、隔夜取件、家人代取（被拒，W-96）。28 个人设都有真实操作；岗位与招聘会按托管 a 未造。截图 `~/.cache/walk0929/evidence/dataset-d4/`（数据大屏近 30 天、订单第 2/24 页、告警、AI 服务、四个机构的首页与数据统计）。人设清单与规格：走查分支 `scripts/walkthrough/dataset/PERSONAS.md`、`personas.json`。
注：D4b 报的「模拟 Agent 回写带 attempt 被 400」是走查环境版本错配（走查分支的模拟 Agent 已按 #1152 改为回写 attempt，而第一套走查栈仍是旧服务端），不是产品缺陷；模拟 Agent 已改为只在服务端下发 attempt 时才回写。

### 4.9 一体机浸泡测试（K10，9/30 凌晨，rc 栈 4deeaefec）

同一 Chromium、同一页（`performance.timeOrigin` 全程不变，未整页重载）、1080×1920，按人设连续 100 位（约 70% 匿名、30% 登录，打印/扫描/小青各一段后离开），另做 30 位不清场的纯页内切换。结果文件 `~/.cache/walk0929/soak/results.json`、`results.md`。

| 第 N 位 | JS 堆 MB | DOM 节点 | 事件监听 | 活定时器 | 30 秒内请求 | 本地存储条目/字节 |
|---|---:|---:|---:|---:|---:|---|
| 0 | 5.9 | 496 | 206 | 15 | 0 | 1 / 68 |
| 10 | 15.1 | 1334 | 256 | 15 | 0 | 2 / 2873 |
| 50 | 14.1 | 1531 | 285 | 15 | 0 | 3 / 343 |
| 100 | 12.8 | 887 | 239 | 15 | 0 | 3 / 345 |

结论：**未发现内存泄漏**。堆随波动但趋势平（峰值第 80 位 21.6 MB，第 90 位回到 12.5）；30 位纯页内切换 12.4 → 10.4 MB；活定时器始终 15 个、页内切换后 7 个，没有逐位累积；30 秒窗口请求 0–3 次，只有终端会话续期、屏保、打印机状态，没有 W-80 那样的请求风暴；IndexedDB 为空、无 Service Worker、Cache 只有 1 条屏保资源。清场后本地存储只剩终端会话令牌与两条隐私边界键；只「回首页」时 sessionStorage 会留下进行中的材料检查草稿 `ai-job-print:current-print-material-check`，到下一次清场才清（本单草稿，不是跨用户堆积）；「回首页不退出登录」使后几位看到上一位的登录态——即清场组 P0，待状态机。
**说明**：这次的负载偏向页面切换——脚本在打印里常没点到「确认使用这份文件」，完整出纸只有 3 单（失败 47），扫描完整 2 单，小青 21 次都有回复；因此「大量完整打印链」下的内存还没被充分压测，清场状态机合入后建议用修正后的脚本再跑一次。

### 4.8 修复对定位与功能的影响（9/29 晚起每项必标）

口径：删、藏、停放、改名、撤回、降级都要点名说清是「某版本不显示、源码保留停放」还是「真的去掉」；默认不许削弱，AI 是驱动层，AI 挂了退化成手动不许消失。

| 项 | 修了什么 | 影响哪个版本 | 有无削弱 |
|---|---|---|---|
| W-01（#1100） | 一体机「我的反馈」加「AI 内容投诉」类别，小青页与 AI 服务记录页各加一个投诉入口 | 一体机正式版；小程序本来就有 | 无削弱，只增加 |
| R4 + W-08（#1102） | 打印扫描首页「复印」卡从不可点变为可点，进「怎么在面板上复印」说明；读不到能力时的两句工程词改成用户口径 | 一体机正式版 | 无削弱：复印本来就在打印机面板上做，一体机只多了说明；没有删任何入口 |
| W-14/W-22/W-47（#1107） | 手机上传后卡死、AI 记录打不开、改写没写进稿、优化页底栏被盖、块数不一致 | 一体机正式版 | 无削弱：都是让已有 AI 简历链能走完 |
| W-20/W-83/W-80/W-81（#1137） | 公共屏上小青回显与导出核对弹窗统一打码（身份证、银行卡、手机、邮箱）；小青作业页不再请求风暴；扫码等待不锁 U 盘 | 一体机正式版 | 无削弱：只打码与修通，送模型与保存仍用原文 |
| W-09、W-10 | 顾问工作台入口、政策材料清单打印：按产品负责人裁定试点后再议 | 不涉及现有版本 | 未新增、也未删除；现有「小青对话 → 要点总结」「上传自备材料打印」照旧 |

## 五、闭环矩阵

10/4 晚按已有证据整理（只读，没有新走查）；之后每轮复走更新对应行。

外部依赖一列：AI = 假大模型（4340），OCR = 假百度 OCR（4341），短信 = `SMS_PROVIDER=log`，出纸 = 模拟 Agent（不调打印机），付款 = 价目 0 元、从没走过真实支付，微信 = 开发者工具/沙箱 + 替身扫码，TRTC = 文字助手构建、ASR 关。**整张表没有一条走过真实外部服务**（见 a.5）。

### 5.1 一体机（feature-scope §二）

| # | 用户流程 | 状态 | 最近走通（轮次·提交） | 证据 | 外部依赖 | 备注 |
|---|---|---|---|---|---|---|
| K-01 | 首页入口与布局（游客/会员） | 走通 | K16 7807f7ac8 | `E/k16/resume-look/034、038`（audit 无英文/工程词/被裁） | — | K3 9/29 首页顶部 400px 横幅、「问小青」y=444（W-54）已由 K8 修 |
| K-02 | 设备状态展示（就绪/缺纸/离线） | 走通 | K19 3faa07816 | `E/k19/w118/049、050`；`E/k16/resume-look/035–037`（状态由 page.route 伪造） | 出纸 | W-117 缺纸写成「离线」已在 K19 改对 |
| K-03 | 游客打印：手机扫码上传→材料检查→预览参数→报价→建单→出纸→完成 | 走通 | K19 3faa07816（g01–g10 带隐私命中，0/10 被拒） | `E/k19/w118/040、041`，`results.jsonl`；`W/k19/w118/REPORT.md` A-a | 出纸、付款 | 完成页 0 元口径通过；N4 隐私摘要与用户裁决不符仍在 |
| K-04 | 会员短信登录 | 走通 | K19 3faa07816（m01–m10） | `W/k19/w118/REPORT.md` A-b | 短信 | 验证码取 API 日志，真短信从没发过 |
| K-05 | 扫码登录（小程序扫一体机登录码） | 走通【9/29 后没复核】 | K8 90eb5a21c（W-15 先勾协议再切扫码）；两端联动 K5 9/29 22:01 | `E/k8/032-qr-after-agree.png`；`E/k5/live-login-result.md`；`E/miniapp/live-login-01/02.jpg` | 微信（扫码由替身返回原文） | |
| K-06 | 会员登录后打印 + 「我的打印订单」 | 走通（有遗留 W-124 N3） | K19 3faa07816 | `E/k19/w118/043、046–048` | 出纸 | 详单 0 元单仍有「支付/实付/抵扣」字样 |
| K-07 | 游客 U 盘导入→打印出纸 | 走通（有遗留 W-125）【9/29 后没复核出纸】 | 出纸：K7 9/29 3841b823a（周建军 U 盘单）；导入到「导好了」：K20 e2e530a29 | `E/k7/ledger.jsonl`（J5）；`E/k20/usb/02-未配置导入-kiosk-05-*.png` | 出纸、U 盘=模拟目录 | W-125：后台关掉 U 盘后深链接、二维码过期改用 U 盘、简历来源页三条路照样导入（`E/k20/usb/11-/12-/13-/14-`） |
| K-08 | 登录态 U 盘导入→打印 | 走不通（W-76） | — | `E/k1/215–224`（9/29，`POST /materials/tasks` 403） | — | 总表状态「待派」，之后没复走 |
| K-09 | 材料扫描（面板扫描→回传→打印） | 走通【9/29 后没复核出纸】 | K1 9/29 3841b823a（2 页×1 份） | `E/k1/135–144` | 扫描=`scan-drop` 模拟、出纸 | K18 只到选类型/面板指引/等待/取消【开发版】`E/k18/print/095–099`；真 SMB 扫描没走 |
| K-10 | 复印（面板复印说明页，R4） | 走通（只有说明页） | #1102 截图 9/29 | `E/panel-copy/01–03` | — | 真面板复印、身份证复印没走；面板复印不经系统 |
| K-11 | 证件照 | 说明页「未开放」 | K19 3faa07816 | `E/k19/w118/050`（证件照卡「说明页·未开放」） | — | 功能本身未开放，不计走通 |
| K-12 | 签名合成 | 没走（开通态） | 只验过未开通 403 | `E/k3/131`、`W/grok/k3-result.md`（`/print/sign/inspect` 403 CAPABILITY_NOT_CONFIGURED） | — | 第一次发布签名关 |
| K-13 | 图片转 PDF→打印 | 走通【9/29 后没复核】 | K1 9/29 3841b823a（两张身份证样张，6 处待确认后打） | `E/k1/151–160` | 出纸 | |
| K-14 | 到机码取件（小程序单件下单→一体机核销→出纸） | 走通 | K19 3faa07816（p01–p10，0/10 被拒） | `W/k19/w118/REPORT.md` A-c；`E/k19/w118/044` | 微信（小程序代码在 node 沙箱下单）、出纸 | |
| K-15 | 到机码错码/作废重发/已用码 | 走通 | 被拒页格子清空：K19（045）；作废重发：K5 9/29；现打现取重输：K12（W-45） | `E/k19/w118/045`；`E/k5/pickup-void-reissue.md`；`E/k12/002-b-done.txt` | 出纸 | |
| K-16 | 家人持码代取 | 走通 | K12（W-96 修复，e15875fe0 本地合并） | `W/grok/k12-result.md` A；`E/k12/` | 出纸 | 9/30 数据集里周桂芳代取被拒的原单仍是 pending_release |
| K-17 | 材料包（小程序组包→一体机到机核销） | 没走（一体机侧） | — | 小程序侧只有 `E/miniapp/74-package-create.jpg`（9/29）、`E/k18/miniapp/t1-free-package-*.json`（沙箱） | — | 本地缓存里没有材料包到机核销的证据 |
| K-18 | 缺纸失败→「重新提交打印」出纸 | 走通 | K12（attempt 0 PAPER_EMPTY / attempt 1 completed） | `E/k12/003-d-paper-empty.txt`、`004-d-after-retry.png`；`E/k11/007、008` | 出纸 | Agent 0.4.12 竞态被 409 时页面只给兜底句（W-114，K14 delta 677cffefd） |
| K-19 | 打印机故障：下单前缺纸/离线拦截、打印中卡纸、结果未确认、强杀 Agent | 走通（有遗留 W-124 N2） | 卡纸 K19 3faa07816；W-88/W-91 K13 9565ee6bc | `E/k19/w118/052–054`；`E/k13/print/w88-*`、`w91-*` | 出纸 | 卡纸页 0 元单仍写「已付金额都保留着」+ 约 650px 空白 |
| K-20 | 打印队列闸门（Agent 0.4.13 queue_*）+ 到机码核销查打印机 | 走通 | K16 7807f7ac8 | `E/k16/gate-print/a1-*–a4-*` | 出纸 | |
| K-21 | 每单 100 面上限、50 页×2 份 | 走通 | K13 9565ee6bc | `E/k13/print/*b1-50x2-*、*b2-101-*` | 出纸 | W-102 报价页矛盾文案遗留 |
| K-22 | 异常文件（加密、乱码名、超长名、HEIC/WPS/DOC、48 页扫描件） | 走通（有遗留 W-94） | K13 9565ee6bc（W-93/W-94 格式说明） | `E/k13/print/w93-*、w94-*`；`E/k7/054–081`（9/29） | — | 乱码文件名二次乱码仍在 |
| K-23 | 断网（确认/报价/建单各 500）后重试 | 走通【9/29 后没复核】 | K1 9/29 | `E/k1/175–184` | — | |
| K-24 | 到机码抖动（连点、核销后断网、出纸中刷新） | 走通【9/29 后没复核】 | K7 9/29（J2） | `E/k7/092–120` | 出纸 | |
| K-25 | 清场：结束使用/闲置/换人/完成页倒计时/直接输网址 | 走通 | K13 9565ee6bc（四种离场 + 完成页倒计时） | `E/k13/clear/`（handover-*、idle-*、deeplink-*、end_use-*、print_done-*） | — | 游客两次确认结束：只在 K18 `E/k18/print/092、093`【开发版】 |
| K-26 | 浸泡 100 位 | 走通（压测偏切页） | K10 4deeaefec | `W/soak/results.md` | — | 完整出纸只 3 单、失败 47（脚本没点到确认） |
| K-27 | 屏保（闲置进入、触摸唤醒） | 走通 | K13 9565ee6bc（handover-B-screensaver）；计时 K3 9/29（游客首页 151 秒） | `E/k13/clear/*handover-B-screensaver*`；`E/k3/101、139、075` | — | 素材只有 setup 上传的 1 份（`E/setup/53–56`） |
| K-28 | 使用时限页（倒计时、继续） | 走通（有遗留 W-65） | K13 9565ee6bc（idle-warning） | `E/k13/clear/*idle-warning*`；`E/k3/138、153` | — | 「继续后回到 /profile」原始路径（W-65 待派） |
| K-29 | AI 简历诊断：上传→解析→报告→导出→打印出纸 | 走通（有遗留 W-103/W-104） | 导出：K19 3faa07816（13 次 201）；出纸：K14 353b680d0 | `E/k19/resume/s*-report-*`；`E/k14/print/043–049`；`E/k13/clear/104–111` | AI、OCR、出纸 | 报告 2 页、出纸 4 页（W-103） |
| K-30 | 扫描/图片简历走 OCR 诊断 | 走通（有遗留 W-109/W-110） | K14 353b680d0 | `E/k14/resume/`、`W/k14/resume/results.jsonl` | AI、OCR | 48 页只读前 3 页且不告诉用户 |
| K-31 | AI 简历优化→逐条对照→导出 PDF/修改清单 | 走通（有遗留 R-1/R-2/R-6） | K19 3faa07816 | `E/k19/resume/s1–s8b`；`W/k19/resume/REPORT.md` | AI | s6 长句被当公司标题且 PDF 文字重叠（`E/k19/resume/089-s6-optimized-resume-p1.png`）；标题不能改、条目不能删；R-3/4/5「待真模型复核」 |
| K-32 | 优化稿打印出纸 | 走通【9/29 后没复核出纸】 | K2 9/29 3841b823a | `E/k2/052–057`（优化版 1×1 出纸） | AI、出纸 | K15/K16/K19 都只到导出、没再打印 |
| K-33 | 从零生成简历→导出→打印 | 走通【9/29 后没复核正常路径】 | K2b 9/29（20:02 出纸） | `E/k2/204–214` | AI、出纸 | AI 挂时导出未润色稿出纸 K7 J1 9/29（`E/k7/010、022`）；402 下 K20 r8 文案矛盾（W-130） |
| K-34 | 简历对照（自填岗位要求） | 部分（只在故障态进过） | K2 9/29 只在假模型 http500 下进过 | `E/k2/248-fault-fit-entry.png`、`249-fault-fit-result.png` | AI | 正常路径、打印对照、从「我的简历」进对照都没走（`W/grok/k2b-result.md` 剩余 1） |
| K-35 | 职业规划 | 部分 | K2b 9/29 生成方案，没打印 | `E/k2/250、251` | AI | K20 402 下入口要求先有解析（`E/k20/llm402/explore/职业规划.png`） |
| K-36 | 自我探索：同意→问卷→结果→打印→历史 | 走通 | 打印 K2b 9/29；同意门 K10 4deeaefec | `E/k2/177–183`；`E/k10/018–020`；`E/fix-sa-consent/` | AI | |
| K-37 | 求职材料（自荐信模板生成→打印） | 走通【9/29 后没复核】 | K2b 9/29（校招自荐信 1 页） | `E/k2/165–171` | AI、出纸 | 社招信只到报价 |
| K-38 | 模拟面试：设置→3 题→报告→打印→历史 | 走通【打印 9/29 后没复核】 | 报告：K20 e2e530a29（s4 ivok-report-ok）；打印：K2b 9/29 | `E/k20/llm402/*s4-ivok-report-ok*`；`E/k2/148–157` | AI、出纸 | W-107 设置页不预选方向只在 K18 验过【开发版】`E/k18/print/077、078` |
| K-39 | 模拟面试遇 AI 故障（402） | 走不通（W-129、W-131） | — | `E/k20/llm402/042、043、084、085、031、032` | AI | 作答草稿被清空；报告失败死循环 |
| K-40 | 模拟面试语音作答 | 没走 | — | — | TRTC/ASR | ASR 关 |
| K-41 | 小青文字对话 | 走通 | K20 e2e530a29（r11、s4） | `E/k20/llm402/*r11-d-final*`；`E/k10/005` | AI | F08 对话不进 AI 服务记录（仍在） |
| K-42 | 小青回显打码（身份证/手机/邮箱） | 走通 | K10 4deeaefec | `E/k10/005-w20-echo.png` | AI | |
| K-43 | 小青保存要点→作业页→打印要点 | 部分 | 作业页读出：K10 4deeaefec；打印要点没走 | `E/k10/016、017` | AI | `W/grok/k2b-result.md` 第 4 项「要点打印：未做」 |
| K-44 | 小青数字人（TRTC）/语音对话 | 没走 | — | 构建 `VITE_ALLOW_TEXT_ONLY_ASSISTANT=true`；W-123：无凭证时 `POST /trtc/session` 笼统 500 | TRTC | |
| K-45 | AI 内容投诉入口（小青、AI 记录→反馈→后台） | 走通【9/29 后没复核】 | ai-complaint 9/29（#1100） | `E/ai-complaint/00–12` | — | |
| K-46 | AI 使用声明 / 年满 14 周岁（开关打开） | 走通（有遗留 W-92） | K8 90eb5a21c | `E/k8/094–096`；`E/fix-declaration/W-16-*`（10/4 22:17，构建未注明） | AI | 一体机登录页与首次 AI 提示的 14 岁文案仍待改 |
| K-47 | AI 挂了退化手动（诊断/优化/小青/生成都有出路） | 走通 | K20 e2e530a29 | `W/k20/llm402/REPORT.md` a、b、d、e | AI | |
| K-48 | AI 额度用完 / 失败扣次 | 走不通（W-128、W-131） | — | `E/k20/llm402/073-r11-a-final.png`、`089-s3-diag-402.png` | AI | 失败也扣次数，恢复后 429 |
| K-49 | 政策：浏览/详情/发布日期/收藏/扫码来源 | 走通【9/30 后没复核】 | K8 90eb5a21c（W-49、W-52） | `E/k8/063、065、089` | — | |
| K-50 | 政策→上传自备材料打印 | 走通【9/29 后没复核】 | K3 9/29（2 页×1 份） | `E/k3/019、024`；`W/grok/k3-result.md` 流水 | 出纸 | |
| K-51 | 用户停在政策/渠道页时平台紧急下架 | 走不通（W-90） | — | `E/k7/105、106、113、114`（9/29） | — | `E/fix-policy-2/W-90-*` 有修复截图，但总表状态仍「待派」，没见复走 |
| K-52 | 本机构官方渠道（二维码可解） | 走通【9/29 后没复核】 | K3 9/29 | `E/k3/012-official-channels.png` | — | 下架后二维码仍在 → W-90 |
| K-53 | 我的·我的简历 | 走通【9/29 后没复核】 | K3 / K2 9/29 | `E/k3/035`；`E/k2/123` | — | |
| K-54 | 我的·我的文档（查看/删/保存期限/再打/加载更多到 62 条） | 走通（有遗留 W-117） | 列表：K19 3faa07816（4 份）；查看/删/期限/分页：K3 9/29 | `E/k19/resume/*s1-me-documents*`；`E/k3/123–132、186–189` | — | 4 份时底部空白 291px（W-117 待下一轮） |
| K-55 | 我的·打印订单（列表/详单/ORD 号） | 走通（W-124 N3） | K19 3faa07816 | `E/k19/w118/046–048` | — | |
| K-56 | 我的·AI 服务记录（打开诊断/优化） | 走通 | K8 90eb5a21c | `E/k8/087、088` | — | |
| K-57 | 我的·收藏 | 走通（跨端失效 W-74 待派） | K8 90eb5a21c | `E/k8/089`；`E/k4/011、012` | — | |
| K-58 | 我的·权益 | 没走（只看过空页） | — | `E/k3/039-me-benefits.png`（「还没有权益」） | — | 后台权益活动 0 条，无法走领取 |
| K-59 | 我的·浏览与跳转记录（56 条加载更多） | 走通【9/29 后没复核】 | K3 9/29 | `E/k3/046、047、186–189` | — | |
| K-60 | 我的·通知 | 走通【9/29 后没复核】 | K3 9/29（反馈回复 1 条） | `E/k3/041、055` | — | |
| K-61 | 我的·意见反馈（会员/匿名） | 走通【9/29 后没复核】 | K3 9/29 | `E/k3/044、048、049、056` | — | |
| K-62 | 我的·隐私与数据权利（导出、注销） | 走不通（W-48） | — | `E/k3/042、072` | — | 一体机只有「撤回岗位 AI 授权」且置灰 |
| K-63 | 我的·账号设置/换号/结束使用 | 走通 | K13 9565ee6bc（W-64 修） | `E/k13/clear/*switch*`、`*end_use*` | — | |
| K-64 | 我的·求职进度（只读） | 没走 | — | — | — | 托管打开对照只在接口层验过（`W/k18/hosting2/REPORT.md` 第 4 项）【开发版栈】 |
| K-65 | 帮助中心 | 走通【9/29 后没复核】 | K3 9/29 | `E/k3/043-me-help.png` | — | |
| K-66 | 待继续办理（07 session-resume） | 没走 | — | — | — | |
| K-67 | 收银台/付款状态（32、37） | 没走（正常态） | 只看过无订单空态 | `E/k18/print/050`【开发版】 | 付款 | 0 元单不经收银台 |
| K-68 | Word/WPS 文件打印、Word 简历诊断 | 没走 | — | 环境 `CONVERSION_ENGINE=disabled`（总表 §一）；W-111 | 转换引擎 | 数据集 18 份 Word/1 份 doc/2 份 wps 都用不上 |
| K-69 | 彩色、双面打印 | 没走 | — | 未登记（总表 §一） | 出纸 | |
| K-70 | 签约风险提示 | 没走 | — | 开关关，`/contract-review` 回首页（`W/grok/k3-result.md` 路由文案行） | — | |
| K-71 | 智慧校园 / 百宝箱（一体机） | 没走 | 只在 K3 110 条路由巡检里打开过 | `E/k3/route-copy.json` | — | 后台智慧校园「暂无终端」、百宝箱 0 事件 |
| K-72 | 全路由合规文案巡检（110 条） | 走通【9/29 后没复核】 | K3 9/29 | `E/k3/route-copy.json`（禁用投递文案 0 处） | — | |

### 5.2 小程序（feature-scope §1.1 首发：首页 / AI 工具 / 打印 / 我的）

全部真渲染证据都在 9/29（开发者工具，扫码用替身）；9/30 第四轮（W-98、W-100）只有总表文字，本地缓存里没有截图；10/3、10/4 两次只是页面代码在 node 沙箱里跑、没渲染。

| # | 用户流程 | 状态 | 最近走通 | 证据 | 外部依赖 | 备注 |
|---|---|---|---|---|---|---|
| M-01 | 手机号登录 | 走通 | 9/29 | `E/miniapp/login-13800000{201,202,301,501}-*.jpg` | 短信、微信 | 限流时原因看不到（W-63 已派） |
| M-02 | 四个 Tab 首页/AI/打印/我的 | 走通（只看） | 9/29 | `E/miniapp/01–04.jpg` | 微信 | |
| M-03 | 法务四份 + 关于 + 帮助 | 走通 | 9/29 | `E/miniapp/05-legal-*.jpg、06、07` | — | W-13 标题压胶囊：#1093 修，待回归 |
| M-04 | 简历上传→授权→解析→诊断 | 走通 | 9/29（W-36 修后） | `E/miniapp/r2-01、r2-02、30、31` | AI、微信 | |
| M-05 | 简历优化/导出 | 没走 | — | 本地缓存没有截图 | AI | |
| M-06 | 简历生成、语音说简历 | 部分（只看到页） | 9/29 | `E/miniapp/82-resume-build.jpg、83-resume-voice.jpg` | AI、ASR | 语音是否真跑未核实 |
| M-07 | 简历对照 | 部分（只看到页） | 9/29 | `E/miniapp/79-job-fit.jpg` | AI | |
| M-08 | 职业规划 | 部分（只看到页） | 9/29 | `E/miniapp/80-career-plan.jpg` | AI | |
| M-09 | 自我探索 | 部分（只看到页） | 9/29 | `E/miniapp/81-self-explore.jpg` | AI | |
| M-10 | 求职材料 | 部分（只看到页） | 9/29 | `E/miniapp/75-job-materials.jpg` | AI | |
| M-11 | 小青（正常、超时） | 走通（W-37 已派） | 9/29 | `E/miniapp/20、21、21b` | AI | |
| M-12 | 模拟面试作答→结果 | 走通 | 9/29（#1106 后） | `E/miniapp/40、41、pr2-01、pr2-02` | AI | 402 下断网英文原话（W-122，沙箱 10/3） |
| M-13 | 今日早报 | 走通（只看） | 9/29 | `E/miniapp/72-daily.jpg` | — | |
| M-14 | 单件打印下单→选终端→到机码→一体机核销→小程序回流「已完成」 | 走通 | 渲染 9/29；下单代码沙箱 K19 3faa07816 | `E/miniapp/12–15、50–53、62–66、r3-05`；`E/k4/001–007`；`W/k19/w118/REPORT.md` A-c | 微信、出纸 | 未核销时详情英文 `pending_release`（W-72 已派；K18 沙箱仍在） |
| M-15 | 到机码作废重发 | 走通 | 9/29 | `E/miniapp/66-pickup-reissued.jpg`；`E/k5/pickup-void-reissue.md` | 出纸 | |
| M-16 | 材料包 组包→到机码 | 部分 | 渲染 9/29（创建页）；建码只在 K18 沙箱 bb49ea064 | `E/miniapp/74-package-create.jpg`；`E/k18/miniapp/t1-free-package-*.json` | 微信 | 到一体机核销没走；免费期仍写「付款」（W-122） |
| M-17 | 扫一体机登录码 | 走通 | 9/29 22:01 | `E/miniapp/live-login-01/02.jpg、r3-01/02` | 微信（替身扫码） | |
| M-18 | 扫一体机上传码传文件 | 走通 | 9/29 22:02 | `E/miniapp/live-upload-01/02.jpg、r3-03/04` | 微信（替身扫码） | |
| M-19 | 我的·计数 | 走通 | 渲染 9/29；W-98 修复复验 9/30（无截图） | `E/miniapp/51-me-counts.jpg` | — | |
| M-20 | 我的·文档（上传、删、预览、重新打印） | 走通 | 9/29 | `E/miniapp/10、11、r2-03、r2-21` | — | 跨端删后「预览失败」笼统（W-74 小程序半边） |
| M-21 | 我的·简历 | 走通（只看） | 9/29 | `E/miniapp/78-resumes.jpg` | — | 只取首 50 条（W-32） |
| M-22 | 我的·打印订单 列表/详情 | 走通（W-100 已派） | 渲染 9/29；第四轮 9/30 对数（602/603/604，无截图） | `E/miniapp/52-orders.jpg、r2-20、pr2-03`；总表 §4.5 | — | 失败只写「打印失败」无原因 |
| M-23 | 我的·AI 服务记录（含问答要点） | 走通 | 9/29（W-62 修后） | `E/miniapp/w62-01–03` | — | |
| M-24 | 我的·通知、设置、隐私（撤回授权） | 走通（只看/撤回） | 9/29 | `E/miniapp/73、76、71、r2-02` | — | |
| M-25 | 我的·意见反馈（含 AI 内容投诉） | 走通 | 9/29 | `E/miniapp/70-feedback-ai.jpg` | — | |
| M-26 | 账号注销/数据导出 | 没走 | — | — | — | |
| M-27 | 无 AI 版（提审备选） | 走通（只看） | 9/29 | `E/miniapp/noai-*.jpg` | — | |
| M-28 | 免费期不出现钱字眼（#1189）、错误原话（#1201） | 走不通（W-122） | — | `E/k18/miniapp/结论.md`（沙箱，bb49ea064） | — | 小程序首发停放的 20 页（岗位、招聘会、政策等）按设计不走 |

### 5.3 管理员后台（feature-scope §三）

| # | 菜单/流程 | 状态 | 最近走通 | 证据 | 备注 |
|---|---|---|---|---|---|
| A-01 | 首个管理员首登改密 | 走通 | setup 9/29 | `E/setup/00–02` | |
| A-02 | 工作台（指标对库） | 走通 | K19 3faa07816 | `E/k19/consoles/001`；`W/k19/consoles/REPORT.md` §1 | |
| A-03 | 数据大屏四视图 | 走通（只看，W-101） | 默认页 K19；四视图 K14 353b680d0 | `E/k19/consoles/012`；`E/k14/consoles/002–005` | 「访问人次」「会员下单占比」「打印·上传」「AI 简历·上传」写「未接入」 |
| A-04 | 设备：预建终端→生成绑定码→兑换→改名 | 走通（W-05） | setup / D2 9/29 | `E/setup/20–25`；`E/dataset-d2/015–023、086–093` | 绑定时 Agent 名称覆盖后台名称 |
| A-05 | 设备能力逐台登记 | 走通（登记）/ 走不通（W-125、W-126） | K20 e2e530a29 | `E/k20/usb/00-、10-、恢复为可用-*` | 关掉后一体机三条路拦不住；登记后回不到「未配置」 |
| A-06 | 宣传屏：素材上传/播放方案/终端配置 | 走通【上传 9/29 后没复核】 | setup 9/29；上传提示 K19 | `E/setup/52–56`；`E/k19/consoles/010、011` | 选 .txt 不校验、不写限额（K19-C2） |
| A-07 | 百宝箱（微应用审核、白名单、投放） | 没走（只看页） | — | `E/k14/consoles/016–018` | 0 事件 |
| A-08 | 智慧校园开关 | 没走 | — | `E/k14/consoles/019`；`E/k18/consoles/019-admin-智慧校园.txt`「暂无终端」 | |
| A-09 | 告警中心 列表/分类筛选 | 走通 | K19 3faa07816 | `E/k19/consoles/002–009` | 明细英文码、内部任务号（K19-C1）；**确认/静默/关闭/重开从没点过**（K3、K19 都只看） |
| A-10 | 订单管理 列表/翻页 | 走通 | K14 353b680d0 | `E/k14/consoles/021、099` | 退款没走（全 0 元） |
| A-10b | 订单详情、失败单筛选 | 走通【开发版】 | K18 bb49ea064 | `E/k18/consoles/022、113、114` | W-105 页数「未记录」 |
| A-11 | 打印扫描运维 任务中心/商业化控制 | 走通（只看） | K14 353b680d0 | `E/k14/consoles/022–025` | 扫描任务筛选只在 K18【开发版】`116` |
| A-12 | 计费：新建黑白/彩色价目 | 走不通（W-02） | — | `E/setup/27、28`（按 SQL 补） | 本地对账只看过 ¥0（`E/k14/consoles/028`） |
| A-13 | 文件管理 列表 | 走通（只看） | K14 353b680d0 | `E/k14/consoles/029–031` | 详情、筛选身份证只在 K18【开发版】`032、117`；清理没走 |
| A-14 | 求职材料库 | 走通（只看） | K14 | `E/k14/consoles/032`；`E/setup/57` | |
| A-15 | AI 服务管理：统计/日志/四开关 | 走通（只看） | K14 353b680d0 | `E/k14/consoles/033–036` | 暂停 AI、全机维护没在界面切过；日志筛选只在 K18【开发版】`129` |
| A-16 | AI 大模型配置保存/测试 | 走不通（预期拒回环地址） | — | `E/setup/37–51` | #1077 后界面保存没再走 |
| A-17 | 招聘类信息源/招聘会/企业/Excel/数据接入（托管 a 只读+紧急下架） | 走通（只看） | K14 353b680d0 | `E/k14/consoles/038–048` | 托管打开对照只在 K18 hosting2【开发版栈】；岗位类紧急下架没点过 |
| A-18 | 政策信息源 + 紧急下架 | 走通【下架 9/29 后没复核】 | 下架 K3/D2/K7 9/29；列表 K14 | `E/k3/064、071`；`E/dataset-d2/070–073`；`E/k14/consoles/042` | 「查看申领条件」只在 K18【开发版】`126` |
| A-19 | 合作机构：新建/可信/域名/模块 | 走通【9/29 后没复核】 | setup / D2 9/29 | `E/setup/03–19`；`E/dataset-d2/001–014` | 详情抽屉只在 K18【开发版】`123、124`；「登记机构手机号」（W-03 方案 A）没走 |
| A-20 | 线下机构 | 没走 | — | 菜单在（`E/dataset-d4/admin-alerts.txt` 侧栏） | 托管 a |
| A-21 | 用户管理 列表 | 走通（只看） | K14 | `E/k14/consoles/051–053` | 详情只在 K18【开发版】`125`；封禁没走 |
| A-22 | 权益活动 新建/发布 | 没走 | — | `E/k18/consoles/057-admin-权益活动.txt`「0 条 / 暂无活动」 | |
| A-23 | 会员权益 发放/撤销 | 没走 | — | `E/k18/consoles/058-admin-会员权益.txt`「先搜索会员」 | |
| A-24 | 意见反馈 查看/回复 | 走通【回复 9/29 后没复核】 | K3 9/29 | `E/k3/051–053`；`E/ai-complaint/09、10` | AI 投诉详情只在 K18【开发版】`128` |
| A-25 | 消息通知 创建广播 | 没走 | — | `E/k18/consoles/060-admin-消息通知.txt`「0 条 / 暂无广播」 | |
| A-26 | 权限管理 | 走通（只看） | K14 | `E/k14/consoles/058、059` | 页面写明暂不做 RBAC |
| A-27 | 日志审计 列表 | 走通（只看） | K14 | `E/k14/consoles/060–062` | 详情只在 K18【开发版】`118–122`（W-121：31 种动作显示「其他操作」） |
| A-28 | 法务文档 新建/激活 | 走通【9/29 后没复核】 | setup 9/29 | `E/setup/29–36` | 正文查看只在 K18【开发版】`127` |
| A-29 | 数据权利工单 | 没走 | — | `E/k18/consoles/067-admin-数据权利工单.txt`「暂无数据权利工单」 | 一体机发不起（W-48） |
| A-30 | 每页条数/翻页 | 走通（W-106 修复待复核） | K14 | `E/k14/consoles/090–101` | |

### 5.4 机构后台（feature-scope §四）

| # | 菜单/流程 | 状态 | 最近走通 | 证据 | 备注 |
|---|---|---|---|---|---|
| P-01 | 登录 + 手机号本人验证 | 走不通（W-03） | — | `E/setup/61、62、89、90`；10/4 简报仍写「登录弹手机验证点『稍后验证』」（`W/k20/rc-brief.md`） | 只能「稍后验证」 |
| P-02 | 工作台（政策数、人次、处置通知） | 走通 | K19 3faa07816（四家） | `E/k19/consoles/030、037、044、051` | |
| P-03 | 机构资料 查看/编辑 | 走通（只看） | K14 353b680d0 | `E/k14/consoles/067`；`E/setup/64` | 保存无提示（W-07，9/29） |
| P-04 | 本机构官方渠道：登记域名→新增→启用 | 走通【9/29 后没复核】 | D2 9/29（10 条） | `E/setup/65–69`；`E/dataset-d2/025–027、036、046–048、059、060` | |
| P-05 | 政策：新建→自审→确认责任→发布 | 走通【9/29 后没复核】 | D2 9/29（16 条） | `E/setup/70–83、92–98`；`E/dataset-d2/028–069` | 附件上传未开放 |
| P-06 | 平台处置（紧急下架）通知 | 走通 | K19 3faa07816（工作台） | `E/k19/consoles/030`；`E/dataset-d2/078` | |
| P-07 | 数据大屏（机构总览/信息使用/终端孪生） | 走通（W-120） | K19 3faa07816 | `E/k19/consoles/031–034、060–077` | 1–4 可反推只在 K18 smallcount【开发版】`E/k18/smallcount/024–032、105` |
| P-08 | 数据统计 | 走通（只看，内容是空态说明） | K19 3faa07816 | `E/k19/consoles/036、043、050、057` | 浏览与跳转「不能按本机构统计」 |
| P-09 | 终端数据（近 7/30/90 天）+ 导出 CSV | 走通（只看） | 列表 K19；导出 CSV 只在 K18【开发版】 | `E/k19/consoles/035`；`E/k18/smallcount/008-、011-、014-*导出.csv` | |
| P-10 | 账号：改密 / 子账号管理 | 没走 / 无此功能 | — | `E/k18/consoles/079-partner-账号.txt`「机构子账号与细分权限由平台统一管理」 | feature-scope §四「子账号管理 P1」页面上没有 |
| P-11 | 智慧校园（机构） | 没走 | 只直开过 | `E/k13/consoles/partner/direct-_smart_campus.png` | |
| P-12 | 托管 b 页面（岗位/招聘会/企业/数据源/同步日志） | 关闭态如实说明 | K13 9565ee6bc | `E/k13/consoles/partner/direct-*` | 打开态只在 K18 hosting2【开发版栈】 |

### 5.5 只靠模拟外部服务、从没真打的

| 外部服务 | 走查里怎么替代 | 哪些结论因此不能当真 | 依据 |
|---|---|---|---|
| 真大模型（DeepSeek） | 4340 假服务按格式回包 | 所有 AI 内容质量：W-97 逐条建议、R-3/R-4/R-5 补回、W-116「优化版丢原件内容」都写「待真模型复核」；402 走查用的是标记触发 | 总表 W-97、W-116、W-119；`W/k20/llm402/REPORT.md` §0 |
| 真 OCR（百度） | 4341 假服务 | 低置信、真扫描件识别率、W-109 费用翻倍 | 总表 §一 |
| 真短信（腾讯云） | `SMS_PROVIDER=log`，码从 API 日志取 | 送达、限流在真通道上的表现 | 总表 §一、§4.4 |
| 真支付 | 价目 0 元，免费单直接记已付；`PAYMENT_PROVIDER=sandbox` 也没用上 | 收银台待付款、付款结果、退款、对账一次都没走（`E/k18/print/REPORT.md`「32 待付款 没验」） | 总表 §一 |
| 真出纸（奔图 CM2800） | 模拟 Agent 写 PDF 存档；缺纸只在模拟上成立 | 真机缺纸会变成「结果未确认」（W-11）；W-85/W-86/W-87 只在 KSK-001 只读核过 | 总表 W-11、W-85–W-87 |
| 真面板扫描 SMB、真 U 盘 | `scan-drop`、模拟目录 | TIFF/OFD 等面板格式（W-12 待验） | `W/kiosk-brief.md` |
| TRTC 数字人、语音、ASR | 文字助手构建、ASR 关 | 小青数字人、语音面试、语音说简历全部没走 | 总表 §一；W-123 |
| Word 转换（LibreOffice） | `CONVERSION_ENGINE=disabled` | Word/WPS 打印与诊断（B-15、W-111） | 总表 §一 |
| 真微信 | 开发者工具模拟器、替身扫码、node 沙箱 | 真机扫码、微信登录、真机渲染 | 总表 §4.5 末行 |
| 企业微信告警推送 | 走查没接 | — | — |

### 5.6 只在开发版前端（K18，10/3 19:55–10/4 13:12）走过、正式构建没复核的条目

| 条目 | 开发版证据 | 正式构建情况 |
|---|---|---|
| W-107 诊断/面试不预选方向（PR #1193） | `E/k18/print/066–072、077、078` | 没复走 |
| W-108 加密 PDF 诊断提示「去掉密码」 | `E/k18/print/075、079–081` | 没复走；同页约 1150px 空白也只在开发版量过 |
| B 批 12/13/18/32 留白测量、14 主按钮被底栏盖 | `E/k18/print/083–099、050`，`pairs/` | K19 只复测了 14（已在首屏）与 15 卡纸（仍约 650px） |
| 扫描工作台（选类型/面板指引/等待回传/取消） | `E/k18/print/095–099` | 没复走 |
| 游客两次确认结束使用 | `E/k18/print/091–093` | 没复走（K13 9565ee6bc 走过会员四种离场） |
| 收银台无订单空态 | `E/k18/print/050` | 没复走 |
| AI 额度 #1190（k18 quota 路） | `E/k18/quota/` | K20 只在 402 场景里顺带碰到额度文案（W-131） |
| W-123：AI 次数用完时标题「这一轮没连上」、无凭证时 `/trtc/session` 笼统 500 | `E/k18/quota/` | 没复走 |
| 托管关闭七处（#1202）+ 托管打开对照、H2-1/2/3 | `E/k18/hosting/`、`hosting2/`（接口与两后台） | 没复走 |
| 机构小样本可反推（W-120 三处）、终端数据导出 CSV | `E/k18/smallcount/` | K19 复核了 0/1–4/≥5 显示规则（通过），三处反推只记现状、导出 CSV 没再导 |
| 两后台第 2–4 批详情类页面（订单详情、失败单、文件详情/筛选身份证、审计详情、机构详情、用户详情、政策申领条件、法务正文、AI 投诉详情、AI 日志筛选）、W-121 | `E/k18/consoles/113–129` | K19 只抽查工作台、告警、宣传屏和 GET 通查 |
| 小程序 #1189、#1201（W-122） | `E/k18/miniapp/`（沙箱，不受前端构建影响） | 修复 #1219 后没见复走证据 |
| W-118 成对建检查任务 | `E/k18/print/100–112` | **已在 K19 正式构建证伪**（0/30 被拒），不再算问题 |

---

## 六、修复分派

（进行中）

### 4.7 Codex B 旅程核查的裁定

17 条，其中 3 条 P0 全部与已登记项重合并已在真实环境复现：W-36（小程序 resume_ai 授权，已修）、W-14（手机上传后卡死，修复中）、W-20（小青回显身份证号，待复现）。新增采纳 W-68、W-69，两条作线索 W-70、W-71；「价目行缺失」并入 W-02，「双面完成页面数翻倍」本机未开双面、暂记线索不单列；「隐私请求一体机不能导出注销」= W-48；「打印完成页称已清除但账户记录仍在」= W-43。

## 七、agy 反方评审的取舍（总表 v1，9/29 22:10）

原文：`~/.cache/walk0929/agy/review-v1.md`（gemini-3.8-flash-high，只看总表，不读仓库）。

**漏链 8 条：全部采纳，排进第二轮走查。**

| agy 漏链 | 采纳 | 怎么走 / 归谁 |
|---|---|---|
| 1 公共终端本地磁盘与缓存擦除（U 盘、扫描暂存、Windows 临时目录、断电） | 采纳 | Windows 窗口 9/29 22:52 真机只读：Agent 临时目录只剩 6/3、7/5 两件旧 task_*，print_*.pdf、扫描目录、打印队列、%TEMP% 与下载目录里的 PDF 都是 0；缺口是 W-85（图片转 PDF 临时件断电后不清）与 W-87（Edge 普通缓存）；发布当天 0.4.12 再补「用户走完后缓存变化」 |
| 2 AI 全局宕机时从零手动做一份简历并打出来 | 采纳 | **K7 通**：假模型 http500 时从零生成页写「AI 简历生成服务暂时不可用」并给「导出并打印我填的内容（未经 AI 润色）」，一路出纸；固定模板在故障下仍能生成；假 OCR error 时自备 PDF 的材料检查仍能做完——AI 挂了退化为手动成立 |
| 3 弱网与网络抖动下到机码核销、出纸的幂等与防重打 | 采纳 | **K7 通**：连点 3 次只核销 1 次、出纸 1 份；核销后断网 20 秒出纸 1 份、订单完成；打印中刷新后转「打印结果未确认」、仍只 1 份——无重复出纸、无吞单 |
| 4 用户正停在政策/渠道页时平台紧急下架 | 采纳 | **K7 断** → W-90 |
| 5 多租户越权（机构 A 令牌查 B、终端拉 B 的内容） | 采纳 | Codex C 只读审查完：机构 A 读改删 B 的政策、渠道、终端、统计、通知、账号，会员按 ID 访问他人文件订单简历 AI 记录，均**未发现**越权；确认 1 条 W-84（打印任务状态按 ID 可读，已实测）；`POLICY_SCOPE` 不设时 A 终端可见 B 的政策是配置（第一次发布口径），第二次发布设 `org` 时需复验；屏保、智慧校园、打印机状态、能力接口无终端认证但只回公开白名单内容 |
| 6 异常与超大文件（损坏、加密、几十页、超大）与免费期单次页数上限 | 采纳 | **K7 部分**：无白屏；48 页扫描件认出 48 页、手机路径写明只检查前 5 页后下一步灰；乱码名与超长名能报价（¥0.00）；加密 PDF 死胡同 → W-93；二次乱码与格式说明 → W-94 |
| 7 未成年人阻断 | 部分采纳（K7：两端年龄条款不一致 → W-92） | 第一次发布「AI 使用声明强制」关闭（W-16 发布约束）；第二轮只核年龄声明文案与小程序年龄条款一致，强制阻断随第二次发布一起测 |
| 8 断电重启后的「幽灵打印」 | 采纳 | 代码核实（Windows 窗口）：租约到期一律改 failed + PRINT_JOB_UNCONFIRMED、不自动重排，Agent 重启见本地 dispatching/spooled 也只报未确认不再调打印机（`task-runner.ts:331-346`）——**我们代码里没有「几十分钟后自动补打」的路径**；剩余风险在 Windows 打印队列本身（断电时驱动已收下的作业开机后可能续打，代码不清队列），发布当天真机拔电验；本地服务端一半由 K7 在测；附带发现 W-86 |

**定级：** 采纳上调 W-42/W-43/W-75（合为清场组 P0：清场前窗口内下一位能进上一位「我的文档」查看、打印，完成页还写「已清除」）、W-01（P0，法定投诉渠道，#1100 已修）、W-39（P1）、拆出 W-83（导出核对弹窗全号，P1）；采纳下调 W-27、W-28 为 P2。**不采纳**：W-02 升 P0——第一次发布沿用的生产库价目两行已在，缺口影响的是新客户部署，维持 P1，但私有化部署前必须修；W-07 升 P1——CLAUDE.md 定管理员对招聘类内容保留查看与紧急下架，#1082 已把写入入口停放为只读，残留的是导航与文案，维持 P2；W-45 维持 P1。

**合并：** 采纳清场组（W-42/43/64/75、B-12）、订单视图组（W-34/45/46/51/58/66/72，依托 #1086）、跨端失效组（W-49/73/74）、小程序分页组（W-26/32/71）、文案组（W-06/08/18/28/40/44/53/56/65/82）。时间组部分采纳：W-67、W-78 是时区；W-52 是字段名对不上（`publishedDate` vs `publishConfirmedAt`），不是时区问题，单列。

**修复批次：** 采纳 agy 的四批划分，按 P0 → 打印与 AI 通路 → 订单与对账 → 文案与体验的顺序排；「W-48 一体机不开放导出与注销，放在小程序个人隐私设置」采纳（公共屏开放注销有代点风险），但一体机「撤回岗位 AI 授权」这类托管 a 之前的旧说法仍要改（并入文案组）。

### 4.3 W-03 补充核对（9/29 晚，读代码）

- 死锁链：管理员新建机构账号 `passwordProofState=TEMPORARY` → 机构自己改密后仍是 TEMPORARY（`password-proof-state.ts:16`）→ 首次绑手机 `initial-phone-bind.service.ts:48/:90` 先要求 OWNER_MANAGED，否则 409 → 只有绑定成功才在 `:107` 升为 OWNER_MANAGED。系统里没有「线下核验恢复」的操作路径，管理员侧提示「本系统不提供管理员绕过」。
- 管理员账号：同一断言对 `role≠partner` 直接放行，管理员自改密后是 OWNER_MANAGED，读代码判断不受影响；已请后端窗口在 #1091 前实测一次（bootstrap 管理员首登改密后能否完成手机号绑定）。

- **拍板（总指挥 9/29 晚）**：采用方案 A，再加一道防线——管理员登记的机构手机号必须与盖章确认函一致，登记后给该号发知会短信。后端做接口，两后台窗口做「登记手机号」按钮；修好后走查窗口在同一环境复走。

### 4.4 已知限制（不是缺陷，记录在案）

- 走查环境多路共用 127.0.0.1，会员短信按 IP 每小时计数被打满（`member:sms:ip:*`，18 点那个小时已到 31 次，触发 `SMS_IP_LIMIT`）；上传会话接口也按 IP 每分钟 12 次。9/29 18:4x 清过一次测试环境的 IP 计数。生产上需要留意：同一网点多台一体机与现场用户手机若共用一个出口 IP，也会被同一只桶限住——交后端窗口评估是否按终端而不是按 IP 计。

- 面板复印的明暗度、纸张设置会留给下一位用户（奔图手册 p46），一体机清场管不到打印机面板；建议每日开门检查加一条「面板复印设置恢复默认」。
- 面板复印不经过一体机与 Agent，后台看不到复印张数、不计费、不留记录；R4 已定对用户免费开放。
