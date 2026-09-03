# MOTION / INTERACTION 规范 · 青序流光 Kiosk v2（Batch 0.5 真值校正版）

> 地位：全站唯一动效真源。关键参数**禁止散落在各 HTML 中**；后续沉淀为 `kiosk-motion.css` + React 动效组件。
> 质量基线：继承 `15-print-fulfill.html` 的交互表现；动效 = 状态的语言，不是装饰。
> 反伪造红线：任何动效不得用 `setTimeout`/`setInterval` 伪造业务成功（支付/打印/扫描/AI/上传/退款/清除）。
> 硬件动效禁止：不得用动画假装扫码器在线、纸张已经出来、扫描页码递增、离人检测；不得用固定计时器自动成功；硬件状态必须来自 USB HID 输入 / Agent 轮询 / 浏览器 MediaDevices / 终端事件。
> 两种扫码方向分治（v3.3）：**A 用户手机扫一体机屏幕二维码**（信号=二维码渲染+服务端轮询/expiresAt，不使用扫码器）与 **B 一体机嵌入式扫码器读取用户手机码**（信号=HID keydown/input+服务端校验）是两种不同交互，**不得合成同一动画**。
> 到机码真值（2026-08-24 当前 Git）：**8 位纯数字新码 + 10 位字母数字历史码兼容**。不得用动效、位数点或键盘布局继续表达“6 位新码”；历史码输入不得被纯数字键盘或 `maxlength=8` 阻断。10 位历史码读满可立即提交；8 位数字码只能在输入静默 250ms 后或用户确认/Enter 时提交，禁止在第 8 位同步提交并截断“前 8 位恰为数字”的历史码。
> 原型手动切态器（`?state=…`）必须标注「原型演示控制」，不属于产品逻辑。

**全站通用参数**：`--dur-instant:120ms` `--dur-quick:240ms` `--dur-page:480ms` `--ease-out:cubic-bezier(.22,1,.36,1)`；只用 transform/opacity（GPU 友好）；`prefers-reduced-motion` 与 `?flat=1` 下一律静态降级（见每行末列）。

**登记表列**：动效｜宿主页｜data-state｜触发（用户/系统）｜开始→结束｜时长·缓动｜循环｜可中断（中断后界面）｜真实信号源｜React 实现建议｜静态降级 / reduced-motion

## M1 状态呼吸（持续环境信号）

| 动效 | 宿主 | data-state | 触发 | 开始→结束 | 时长·缓动 | 循环 | 可中断（中断后） | 真实信号源 | React 建议 | 降级 |
|---|---|---|---|---|---|---|---|---|---|---|
| 设备在线呼吸点 | 全域顶栏 `.k-status-pill` | normal | 系统：状态轮询成功 | 光晕 scale(.82)→scale(1.3) 透明 | 2600ms·ease-in-out | 是 | 是（状态变化即换色/停） | 当前 `useTerminalDeviceStatus` 原生 effect / `setInterval` 每 60s 轮询 `terminals/:id/printer-status` | 当前 hook 状态驱动 class；未来若改轮询实现须另验 | 静态圆点，无色环 |
| 等待用户操作 | 表单/槽位卡 | filling | 系统：进入待输入 | 卡缘透明度 .6→1 呼吸 | 2400ms·ease-in-out | 是 | 是（输入开始即停） | 无（纯 UI） | CSS animation on class | 静态描边 |
| 等待扫码 A · 手机扫屏 QR（12 上传码 / 32 扫码支付 / 登录 / 外跳来源码） | 12/32/03/浮层 | pending / relay-waiting | 系统：二维码真实渲染完成 | 取景框角标 opacity .5→1 | 1600ms·ease-in-out | 是 | 是（按各宿主可观测信号结束） | **用户手机扫屏，不使用嵌入式扫码器**；上传/登录仅按各自服务端 session/auth 确认切态，支付仅按 `pay-status` / `pay/reconcile` 业务终态切态；外跳来源码没有扫码回调，只能由用户关闭/返回或二维码自身过期结束，不得宣称或动画表达“已扫码成功”；`expiresAt` 倒计时只用于接口真实返回有效期的二维码 | 各宿主独立轮询/确认；外跳来源码不设扫码成功态 | 静态二维码；仅在有真实 `expiresAt` 时显示剩余时间 |
| 等待扫码 B · 扫码器读用户手机码（32 付款码模式 / 11 到机码·取件认领） | 32/11 | pending-scan | 系统：页面进入扫码受理态 | 输入域聚焦光标脉冲 | 1600ms·ease-in-out | 是 | 是（HID 输入到达即切 verifying） | **嵌入式扫码器 USB HID 键盘输入（keydown/input）+ 服务端校验结果**；扫码器无在线状态遥测，不得表现「扫码器在线」 | HID 输入监听 + 长度/结束符识别；到机码 10 位历史码读满可提交，8 位数字码须等待 250ms 输入静默或确认/Enter，禁止第 8 位同步提交；扫码器前缀/后缀/Enter 仍待真机验证；非目标页拦截 | 静态输入域+「请出示二维码」文字 |
| 任务处理中（整体指示） | 21/24/15/18 | processing | 21/24：真实单次请求进入 pending；15/18：任务创建成功后进入状态查询 | 「处理中」指示微脉冲（**无真实阶段字段时只显示整体处理中，不画阶段点**） | 1600ms·ease-in-out | 是 | 是（完成/失败即切态） | 21/24 只认请求 Promise pending→最终响应；15/18 只认任务接口返回的整体状态字段 | 按宿主真实请求模型驱动 class；禁止把单次 POST 伪装成轮询任务或虚构阶段 | 静态「正在处理」文字+已用时间 |

## M2 进度反馈（只表达真实进度粒度；禁循环 spinner、禁假百分比、禁假阶段）

| 动效 | 宿主 | data-state | 触发 | 开始→结束 | 时长·缓动 | 循环 | 可中断（中断后） | 真实信号源 | React 建议 | 降级 |
|---|---|---|---|---|---|---|---|---|---|---|
| 文件上传 | 12/21 | uploading | 用户：选定文件 | 「正在上传」指示（**当前为单次 fetch multipart，无真实百分比，不画进度条**） | 1600ms·ease-in-out 脉冲 | 是 | 是（失败→failed 态+保留重试） | `files/kiosk-upload` 单次请求的成功/失败 | fetch promise 二态（pending→done/fail）；无 progress 事件可用时不造百分比 | 静态「正在上传」文字+已用时间 |
| 简历解析 | 21 | parsing | 用户：提交解析（POST 发出） | **整体「正在等待解析结果」指示**（无百分比、无读页/提字段/比对实时阶段，不画阶段点） | 1600ms·ease-in-out 脉冲 | 是 | 是（失败→parse-failed，保留原文件） | **`POST /resume/parse`（Promise pending → completed / 失败）**；`resume/records/:taskId` 仅用于后续结果读回或恢复，**不是当前解析进度来源** | 单次 POST 等待最终结果（pending→done/fail 二态）；禁止虚构阶段枚举 | 静态「正在等待解析结果」文字+已用时间 |
| AI 简历生成 | 24 | generating | 用户：确认生成 | 整体「正在生成」指示；完成后一次性渲染结构化结果并跳预览，不做逐字段流式动画 | 1600ms·ease-in-out 脉冲 | 是 | 是（失败保留已填槽） | 当前页面单次 `POST /resume/generate`：Promise pending → completed / failed；GET 端点存在但本页未轮询 | 单次请求二态；禁止把字段逐项出现画成服务端流式返回 | 静态「正在生成」文字+已用时间 |
| AI 优化/材料生成 | 23/25 | generating | 用户：确认处理 | 只在真实响应返回后渲染完整结果；无增量信号时不做逐项生成表演 | 1600ms·ease-in-out 脉冲 | 是 | 是（失败保留输入/原文件） | 各页面当前提交请求的 pending → completed / failed | 按真实页面请求状态驱动 | 静态「正在处理」文字+已用时间 |
| 付款码渠道确认 | 32 | awaiting-code-confirmation | 用户付款码已由 HID 读入并提交，且 `POST /orders/:id/code-pay` 返回 `paying`/待确认 | 「正在等待支付渠道确认」三点脉冲 | 1200ms·ease-in-out | 是（至服务端终态或查单结果） | 是（失败/超时→按服务端结果切态或继续查单） | HID 输入只证明付款码已提交；后续只认 `code-pay`、`pay-status` / `pay/reconcile` 的服务端或渠道结果 | 提交后按真实响应进入等待确认；屏上二维码模式**不进入本状态**，保持 `pending`/`paying`，直到服务端返回 paid/failed/expired/closed；不得用动画或计时推断成功 | 「正在等待支付结果，请稍候」文字 |
| 打印进度 | 15 | progress | 系统：任务 release | **页数仅真实 `file.pages`/`billablePages` 存在时显示「正在打印，共 N 页」，否则只显示「正在打印」**+整体脉冲（无逐页 n/N 回流，不模拟页码递增） | 1600ms·ease-in-out 脉冲 | 是 | 是（异常→对应履约态；超时→client-status-timeout / result-unconfirmed 分治） | `print/jobs/:taskId` **轮询 3 秒**（Agent 回流） | 轮询 3s；①前端连续查询 10 分钟无终态→**client-status-timeout**（只提示联系工作人员，不改服务端状态）；②服务端返回 `failed`+`errorCode=PRINT_JOB_UNCONFIRMED`→**result-unconfirmed** | 「正在打印（，共 N 页）」文字 |
| 等待扫描文件回传（SMB 面板扫描链路） | 18 | scanning | 用户：在奔图操作面板手动扫描（**React/Agent 无一键启动**） | **「请在奔图面板完成扫描，正在等待文件回传」指示**（链路：面板扫描→SMB→Agent `scanWatchFolder`→deliver→服务端；无逐页进度，不制作 2400ms/页假进度） | 1600ms·ease-in-out 脉冲 | 是 | 是（completed/failed/expired/cancelled 即切态；**不画盖板未合/无纸/卡纸/多页进纸细分态**） | `scan/sessions/:id`（会话最终状态：completed / failed / expired / cancelled） | 状态机四态映射；无页级事件时不画页数计数 | 静态「请在奔图面板完成扫描，正在等待文件回传」文字 |

## M3 页面状态过渡（九态一套参数，全站复用）

| 过渡 | 宿主 | data-state | 触发 | 开始→结束 | 时长·缓动 | 循环 | 可中断（中断后） | 真实信号源 | React 建议 | 降级 |
|---|---|---|---|---|---|---|---|---|---|---|
| idle→loading | 全域 | loading | 用户动作/路由进入 | 内容 opacity 1→0.4 骨架淡入 | 240ms·ease-out | 否 | 是 | — | `<StateView state>` 统一容器 | 直接切换 |
| loading→success | 全域 | success | 接口返回该业务契约的明确成功终态（如 completed / paid / success） | 骨架淡出+内容 opacity 0→1、y+8→0 | 240ms·ease-out | 否 | 是 | 响应中的业务状态字段或服务端终态；HTTP 2xx 单独不等于业务成功 | 同上 | 直接切换 |
| →empty | 全域 | empty | 接口成功但空 | `.k-state` 淡入 | 240ms·ease-out | 否 | — | 空数组/空对象 | 同上 | 直接切换 |
| →failed | 全域 | failed | 接口错误码/超时 | `.k-state[data-kind=error]` 淡入（不抖动） | 240ms·ease-out | 否 | — | 错误码映射表 | 同上 | 直接切换 |
| →offline | 全域 | offline | 健康检查失败 | 状态胶囊先变 down，再切态 | 120ms→240ms·ease-out | 否 | — | `health` 轮询失败 | navigator.onLine + 轮询 | 直接切换 |
| →expired / display-expired-reconciling / closed | 11/32/浮层 | expired / display-expired-reconciling / closed | 上传/登录/到机码等按各自契约确认过期；屏上支付二维码仅本地显示 `expiresAt` 到点时先进入核验中 | 二维码 opacity 1→.25+遮罩淡入 | 240ms·ease-out | 否 | 是（核验结果 paid 则立即切已付） | 非支付二维码按服务端 session/status 或真实有效期；屏上支付二维码本地到点只说明显示期结束，**不等于渠道已关单**；`attempt.status=expired` 与 `order.payStatus=closed` 是两个不同服务端终态 | 本地到点：显示「收款码到期核验中，未确认前请勿重复支付」；服务端 `attempt.status=expired`：显示「收款码已过期」并允许重新出码；服务端 `order.payStatus=closed`：显示「订单已超时关闭」，禁止重新出码，引导返回重新发起打印 | 核验中显示静态警示；按服务端终态分别显示收款码过期或订单关闭 |
| →locked | 全域 | locked | 能力开关/权限判定 | `.k-state[data-kind=lock]` 淡入 | 240ms·ease-out | 否 | — | 终端 capabilities / feature flag | 配置驱动 | 直接切换 |
| →client-status-timeout | 15 | client-status-timeout | 前端连续查询 10 分钟仍无终态 | 「状态暂未确认，请联系工作人员」淡入，**不改服务端任务状态、不猜成败** | 240ms·ease-out | 否 | — | 前端轮询计时（查询超时是**前端表现层判定**） | 前端 10 分钟计时分支；文案+联系工作人员出口 | 直接切换 |
| →result-unconfirmed | 15 | result-unconfirmed | API/Agent 返回 `failed` + `errorCode=PRINT_JOB_UNCONFIRMED` | 「结果未确认」淡入，**不猜成败** | 240ms·ease-out | 否 | — | 服务端明确登记的 `PRINT_JOB_UNCONFIRMED` 错误码 | 服务端错误码映射的状态机分支 | 直接切换 |

## M4 触控反馈（按钮级统一组件）

| 动效 | 宿主 | data-state | 触发 | 开始→结束 | 时长·缓动 | 循环 | 可中断 | 真实信号源 | React 建议 | 降级 |
|---|---|---|---|---|---|---|---|---|---|---|
| pressed | 全部可点 | — | 用户按下 | scale(1)→(.98) | 120ms·ease-out | 否 | — | — | `:active` CSS | 同（CSS 即可） |
| disabled | 全部按钮 | — | 前置条件未满 | 无动画；`.k-disabled-reason` 常驻 | — | — | — | — | `aria-disabled` + 原因 prop | 同 |
| 按钮 loading | 提交类按钮 | — | 用户提交 | 文案→整体「处理中…」或接口真实阶段文字+禁用 | 120ms·ease-out | 否 | 否（防重复点击期） | 对应提交端点的 pending 或真实阶段字段 | `isPending` 禁用 + label 切换；无真实阶段时只用整体处理中 | 文字变化即可 |
| 防重复点击 | 支付/打印/删除 | — | 一次点击后 | 禁用 1500ms 或至响应返回 | — | — | — | — | 点击锁 ref | 同 |
| 操作完成反馈 | 裁决/收藏/确认 | — | 端点返回明确成功结果或持久化确认 | ✓ 图标 scale(.6)→1 | 240ms·ease-out | 否 | — | 响应业务状态/已持久化结果；accepted/pending/processing 不打勾 | 成功终态后受控渲染 | 静态 ✓ |

## M5 操作引导（Hardware Grounding，复用 15 机身组件并点亮当前部位）

> 硬件边界：一体机整机含奔图打印/扫描/复印；扫码器是 USB HID 键盘模拟，与奔图扫描不同；**奔图扫描走 SMB 面板扫描链路（面板手动扫描→Agent `scanWatchFolder`→deliver→服务端），React/Agent 无一键启动平板/ADF**；盖板/离人传感器不存在；摄像头软件未接通；麦克风软件链路存在、物理真机待验（仅浏览器探测 available 时启用，无固定「在线」状态）。引导动画只能表现真实部件位置，不能伪造在线状态或传感器事件。

| 动效 | 宿主 | data-state | 触发 | 开始→结束 | 时长·缓动 | 循环 | 可中断（中断后） | 真实信号源 | React 建议 | 降级 |
|---|---|---|---|---|---|---|---|---|---|---|
| 出纸过程指引 | 15 | progress / done-all | 系统：开始出纸 | 机身图出纸口脉冲点亮 | 1600ms·ease-in-out | 是（至完成） | 是（完成/异常即切） | `print/jobs/:taskId`（Agent 回流终态/进度） | 机身 SVG 部件 id 驱动 | 静态高亮出纸口 |
| 扫描操作面板指引 | 18 | normal | 进入页 | 面板示意图+「请在奔图操作面板手动扫描」指引脉冲 | 1800ms·ease-in-out | 是（≤3 轮后静止） | 是（收到回传文件即停） | 无（纯引导；**SMB 面板扫描链路，不画 Agent 直接选择或控制平板/ADF；盖板传感器不存在，不虚构开盖检测**） | 循环次数计数器 | 静态面板示意图 |
| 身份证摆放 | 18/13 | checking 前置 | 识别到证件类 | 证件框对齐角标脉冲 | 1600ms·ease-in-out | 是（≤3 轮） | 是 | `materials/tasks` 分类 | 同上 | 静态示意 |
| 扫码引导 A · 手机扫屏 QR | 12/32/03 | pending 等 | 二维码出现 | 手机线框+取景框对位动画 | 2000ms·ease-out | 是（≤2 轮后静止） | 是 | 无（纯引导；用户手机扫屏，不涉及嵌入式扫码器） | CSS 循环计数器 | 静态图示 |
| 扫码引导 B · 扫码器读手机码 | 32/11 | pending-scan | 页面进入扫码受理态 | 「请出示二维码」+输入域聚焦指示 | 1600ms·ease-in-out | 是（≤2 轮后静止） | 是（HID 输入即切 verifying） | **嵌入式扫码器 USB HID 键盘输入**（到机码/付款码），不是扫码器「在线」状态 | 监听 `keydown`/`input` + 长度/结束符识别；到机码 10 位读满可提交，8 位须等待 250ms 输入静默或确认/Enter，禁止第 8 位同步提交；非目标页拦截 | 静态图示 |
| 文件选择/导入 | 12/21 | normal | 通道选中 | 目标卡 y+6→0 淡入 | 240ms·ease-out | 否 | 是 | 无（纯 UI） | CSS | 直接呈现 |

## M6 隐私交互（会话真值=本地空闲计时；清除=本地先清；禁用动画伪造「已清除」，不虚构离人传感器）

| 动效 | 宿主 | data-state | 触发 | 开始→结束 | 时长·缓动 | 循环 | 可中断（中断后） | 真实信号源 | React 建议 | 降级 |
|---|---|---|---|---|---|---|---|---|---|---|
| 会话剩余时间 | 顶栏胶囊 | normal | 登录/会话开始 | 数字每秒递减（tabular-nums，无跳动动画） | — | 每秒 | — | **本地空闲计时器**（`kiosk/session/heartbeat`·`extend` 当前仅返回 ok，不作为剩余时间来源） | 本地 idle timer hook（用户操作即重置） | 同（数字即静态） |
| 即将超时提醒 | 04 | timeout | 系统：本地空闲剩余 ≤60s | 页面淡入+倒计时环 dashoffset 递减 | 480ms·ease-out | 否 | 是（「继续用」→重置本地计时） | 本地空闲计时器阈值 | reduced-motion 下每 10s 跳格 | 静态剩余秒数 |
| 自动清除倒计时 | 15 | leaving-clear | **系统：本地空闲超时**（打印中一律不启动；**无离人传感器/红外，不虚构该事件**） | 朱砂数字递减 | — | 每秒 | 是（用户操作即取消并重置） | 本地空闲计时器 | 本地计时驱动 | 静态秒数 |
| 手动结束并清除 | 15/30 | leaving-clear | 用户：朱砂按钮+二次确认 | 确认层淡入 | 240ms·ease-out | 否 | 是（取消即回） | — | 两步确认组件 | 直接呈现 |
| 清除完成覆盖层 | 全域 | cleared | **系统：本地敏感数据清除完成后**（本地先清，不依赖网络确认） | 覆盖层 opacity 0→1+「已清空」 | 480ms·ease-out | 否 | 否 | 本地清除例程真实执行完毕才展示；**未完成则显示「清除未确认」** | 清除 Promise resolve 后渲染 | 静态文字页 |

---

**实施顺序**：先按 `REUSE-MAP.md` §六执行 Batch 1R（11 到机码事实返修）→ Batch 2B-H（先修五个真实 Hub）→ Batch 2A-R（再接首页/服务页入口）→ Batch 2B-E（其余已有 V3 页面）→ Batch 2C（受控能力与“我的”）→ Batch 3（打印/扫描/支付/AI 恢复态）→ 仅对双底座均无宿主的真实缺口新建页面。每批均须通过本文件动效边界与 `REUSE-MAP.md` §七门禁；五个 Hub 未验收前不得接首页，Batch 2A-R 未验收前不得进入 2B-E，更不得据此直接推广全站或宣称 React 组件已落地。
