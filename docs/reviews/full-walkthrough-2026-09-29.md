# 四端全功能模拟走查（2026-09-29 起）

> 产品负责人 9/29：用模拟数据按正常使用方式把所有功能走一遍，找出断点、走不通、数据显示有问题的地方，
> 汇总、评审、设计、修复。开发完不算完成，要站在用户角度实际操作一遍。
>
> 「做完」标准：从真实入口一路操作到拿到结果（纸、文件、报告、二维码、记录）；数据正确（存了还在、两端同一份、
> 两后台数字对得上）；出错、空态、断网、AI 挂了都有下一步；证据用真后端走一遍。
>
> **证据层级：本地全栈 + 模拟外部服务。** 不代表生产验收、真实 AI、真实支付、真实短信或真实出纸。
> 上一轮（一体机与两后台）见 [kiosk-full-walkthrough-2026-09-27.md](kiosk-full-walkthrough-2026-09-27.md)，
> 本文沿用它的编号与格式，并逐条复核那一轮的问题。场景清单见 [附录](full-walkthrough-2026-09-29-scenarios.md)。

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

（进行中）

### 4.2 本轮新增

| 编号 | 级别 | 端 | 问题 | 证据与根因 | 归属窗口 | 状态 |
|---|---|---|---|---|---|---|
| W-01 | P1 | 一体机 | 一体机没有可点的「AI 内容投诉」入口：词表有 `ai_content_complaint`，但打印完成页、打印扫描首页两个反馈子集都不含；「我的反馈」类别只有 4 类（`apps/kiosk/src/pages/profile/me/feedback/types.ts:4-9`，`services/api/memberFeedback.ts:11` 类型也没有）。小程序已有 | 代码核对 | Claude（一体机页面） | 新增 |
| W-02 | P1 | 管理员后台 | 新生产库上后台建不出黑白/彩色打印价目：计费页只渲染已有行，服务端只自动补 `resume_export`（`admin-billing.service.ts:40`），不存在的行返回 `PRICE_CONFIG_NOT_FOUND`（:121）→ 报价失败。本地按 `docs/operations/price-config-production.md` 的 SQL 补齐 | UI 实操截图 setup/ 第 3 项 | 后台窗口 / 后端窗口 | 新增 |
| W-03 | P1 | 机构后台 | 管理员新建的机构账号永远验证不了手机号：每次登录弹「手机号本人验证」，获取验证码 409 `ACCOUNT_PASSWORD_PROOF_NOT_READY`，只能「稍后验证」（`password-proof-state.ts:16`、`auth.service.ts:648-656`）；也不强制首登改密 | UI 实操截图 61–62、89–90 | 后端窗口 + 后台窗口 | 新增 |
| W-04 | P2 | 管理员后台 | 从没连过的终端显示「最近心跳 刚刚」：心跳空时回落 `lastSeenAt`（`@updatedAt`，任何编辑都刷新）（`terminals/index.tsx:767`） | 截图 22、25 | 后台窗口 | 新增 |
| W-05 | P2 | 管理员后台 | 绑定码兑换时 Agent 上报的名称覆盖管理员设的终端名（`terminal-credential-security.service.ts:248`） | 截图 60 | 后端窗口 | 新增 |
| W-06 | P1 | 两后台 | 工程词与原始 ID 给运营看：工作台「最近操作」`policy.publish`、`terminal.bind_code.exchange`、账号 ID；「contentTrustStatus=active」；设备总览「F1/F2 CLOSED_MODE」；「fail-closed 口径」；机构端每页「不直接对应前端页面」；「info-only」；星号原样显示（`partners/index.tsx:725`）；AI 调用 0 次显示成功率 0% | 截图 58、107 等 | 后台窗口 | 新增 |
| W-07 | P2 | 两后台 | 托管 a 下管理员导航仍有岗位/招聘会/企业/Excel 导入/数据接入；机构类型默认模块含岗位招聘会；法务类型名「AI 免责声明」与「AI 服务免责声明」两叫法；设备能力页仍叫「签名盖章」；保存成功无提示（机构档案、屏保终端配置） | UI 实操 | 后台窗口（A-10 已排期） | 新增 |
| W-08 | P2 | 一体机 | 读不到能力配置时的开发者口吻长文案（`printHubContent.ts:205-206`）；「签名盖章」用户可见约 22 行，2.0 定稿要求改「签名」 | 代码核对 | 主执行窗口定时间 | 已派 |
| W-09 | 待拍板 | 一体机 | 小青「按办事入口开顾问作业」：2.0 定稿里没有这个入口（05 稿 :979 把顾问工作台标「还没开放」，52 稿无上游链接）；只有驾驶舱「入口方向」标签未实现（P2） | 设计稿核对 | 产品负责人 | 待拍板 |
| W-10 | 待拍板 | 一体机 | F12 政策材料清单打印：2.0 冻结稿 48 没有此按钮；`PolicyPost` 没有结构化材料字段，只能印原文；要做需改冻结稿 + 新端点（参照 `fair-company-print.service.ts`）+ 打印交接新来源 | 设计稿与代码核对 | 产品负责人 | 待拍板 |
| W-11 | 已知限制 | 真机 | 缺纸只在模拟 Agent 与会写状态的驱动上成立：奔图驱动 `DetectedErrorState` 恒 0，真机缺纸最终是 `PRINT_JOB_UNCONFIRMED`，一体机显示「打印结果未确认」；`wmi.ts:127-128` 把 4 映射成 error | Windows 窗口 | Windows 窗口 | 已派 |
| W-12 | P1 | 服务端 | 扫描指引用词与面板不一致（`scan-tasks.service.ts:177-193`「按『开始』」「扫描到网络 / SMB」，面板实际「扫描」按钮、「扫描到 SMB」）；面板复印设置会留给下一位（已知限制）；面板可出 TIFF/OFD 而 Agent 只认 pdf/jpg/png（待验） | 总指挥转奔图手册 | 后端窗口 | 已派 |

## 五、闭环矩阵

（进行中）

## 六、修复分派

（进行中）

## 七、agy 反方评审的取舍

（总表 v1 出来后）
