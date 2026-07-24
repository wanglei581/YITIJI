# Wave P2 · Kiosk 12 业务线流程闭环编排

> **🔒 P5 冻结（2026-07-23）**：双模型审查 Critical/High 全部清零；本文件与 FREEZE.md 同步冻结。  
> 唯一勘误：`/me/ai-records` proto 编号已从 (22) 更正为 **(19)**（全文已修正，4 处）。

> 目标：把 75 屏原型按 **12 条真实业务线**重排为「入口 → 前置条件 → 输入 → 处理中 → 结果 → 保存/下载/打印/合规外跳」的闭环，并逐条标注真实需要的状态变体（loading/empty/error/permission/config/hardware/external）。
> 分类依据来自 [`WAVE-P-CLOSURE.md`](./WAVE-P-CLOSURE.md) 第一节，route·proto 链路与该表严格一致；本文件只做流程编排，不重复分类，不新增步骤，不编造能力。
> 缺图（P3 补）：`/toolbox`(76)、`/print/upload`(77)、`/me/feedback`(22B)；下文用 `【缺图】` 标注。
> 覆盖承诺：86 条 route 各归属唯一业务线（含受控专区/系统页），第四节给出归属校验表，杜绝孤儿页。

## 一、核心功能业务线（1–8：单用户主闭环）

### Flow 1 · 文档打印

- **入口**：首页「打印扫描」→ `/print-scan`(02，七能力卡)｜`CONFIG_BLOCKED`(七能力开关)
- **主链路**：`/print/upload`【缺图】→ `/print/material-check`(31) → `/print/preview`(64) → `/print/params`(03) → `/print/confirm`(65) → `/print/cashier`(32) → `/print/progress`(04) → `/print/done`(33)
- **输入**：本机/扫码/U盘三源上传（`/print/upload`，`HARDWARE_BLOCKED` U盘/Agent）
- **处理中**：体检规范化(31) → 参数与费用预估(03) → 收银(32，`EXTERNAL_BLOCKED` 支付) → 出件轮询(04，`HARDWARE_BLOCKED` 打印机)
- **结果/终点**：`/print/done`(33) 取件码 + 满意度；订单入 `/me/print-orders`(18)
- **辅助工具**（同属打印线，产出文件回主链路）：图片转 PDF `/print-scan/convert`(66)、签章 `/print-scan/sign`(67)、功能说明 `/print-scan/feature/:key`(68，证件照「即将上线」诚实标注)
- **重定向卡**：45→43、46→44、47→42
- **状态变体**：各步 loading/error；支付失败 **32A**(不建打印任务，proto 号命名)；打印机离线**不另建**(缺纸/卡纸/失败/重试已在 04 内绘制，见 WAVE-P-CLOSURE §二)；preview 文件不可用兜底(64)
- **合规**：非 CA 签章声明(67)；无「一键打印」越界文案

### Flow 2 · 纸质扫描

- **入口**：`/print-scan`(02)「扫描原件」→ `/scan/start`(34)
- **主链路**：`/scan/start`(34) → `/scan/settings`(35) → `/scan/progress`(36) → `/scan/result`(37)｜全程 `HARDWARE_BLOCKED`(扫描仪)
- **输入**：简历/证件/普通三选一(34) + 四步面板设置(35)
- **处理中**：诚实等待态 + 阶段时间线(36)，不伪造进度
- **结果/终点**：`/scan/result`(37) → ①AI简历识别去诊断(Flow 3) ②打印(Flow 1) ③保存 `/me/documents`(17)
- **状态变体**：loading/error/轮询；扫描仪离线 **34A**(proto 号命名，34–37 复用)
- **合规**：设备离线时诚实降级，不显示「扫描完成」

### Flow 3 · AI 简历诊断

- **入口**：首页「AI简历服务」→ `/resume/source`(05，重定向 56/57 归此)
- **主链路（数字源）**：`/resume/source`(05) → `/resume/parse`(27) → `/resume/report`(06) → 去 `/resume/optimize`(07，转 Flow 4)
- **主链路（纸质源）**：`/resume/source`(05) → 分流 `/scan`(Flow 2) → `/scan/result`(37) 回诊断 → `/resume/report`(06)
- **输入**：上传/扫码传/纸质扫描 OCR(05)
- **处理中**：加载态 + 三步清单(27)；**OCR 失败不调 LLM**(诚实中止)
- **结果/终点**：`/resume/report`(06) 评分维度；结果入 `/me/resumes`(16) + `/me/ai-records`(19)
- **状态变体**：loading/error/登录态；05/06 视觉待双栏对齐(p25，冻结后)
- **合规**：低置信度 OCR 提示复核，不伪造识别结果

### Flow 4 · AI 简历优化

- **入口**：`/resume/report`(06)「去优化」｜`/me/resumes`(16)
- **主链路**：`/resume/optimize`(07) → `/resume/export`(28)
- **辅助工具**：模板库 `/resume/templates`(29)、求职材料 `/resume/materials`(30)（求职信/自我介绍/清单，产出回导出）
- **输入/处理**：原文 vs 建议对比、排版调整(07)
- **结果/终点**：`/resume/export`(28) → PDF/Word/纯文本下载 ｜ 打印(Flow 1) ｜ 入 `/me/documents`(17) + `/me/resumes`(16)
- **状态变体**：loading/error/登录态；导出依赖上游 state
- **合规**：非 PDF 暂不可打印如实标注（依 resume-optimize 现状）

### Flow 5 · AI 简历生成

- **入口**：首页「AI简历服务」→ 生成分支
- **主链路**：`/resume/generate`(25) → `/resume/generate/preview`(26) → `/resume/export`(28)
- **辅助**：模板库 `/resume/templates`(29) 选版式回生成
- **输入/处理**：信息表单提交(25) → A4 预览 + 分段重生成(26)
- **结果/终点**：导出(28) ｜ 入 `/me/resumes`(16)
- **状态变体**：loading/error
- **合规**：生成内容基于用户填写，不虚构履历

### Flow 6 · 岗位匹配参考

- **入口**：`/resume/report`(06) 或 `/jobs/:id`(09) → 全屏 `/resume/job-fit`(55)
- **主链路（单页闭环）**：`/resume/job-fit`(55) 三档匹配参考 + 改写建议
- **前置**：登录 or 匿名同意（页内已含）
- **结果/终点**：结果入 `/me/ai-records`(19)；可去优化(Flow 4)/打印(Flow 1)
- **状态变体**：登录/匿名同意态
- **合规**：**匹配为参考**，非投递、非推荐给企业

### Flow 7 · 职业规划

- **入口**：首页「AI简历服务/职业规划」→ 全屏 `/resume/career-plan`(56)
- **主链路（单页闭环）**：`/resume/career-plan`(56) 生成规划 → 打印
- **结果/终点**：结果入 `/me/ai-records`(19) + `/me/documents`(17)；打印带走(Flow 1)
- **状态变体**：loading/error/未登录

### Flow 8 · AI 模拟面试

- **入口**：首页「AI简历服务/模拟面试」→ 全屏 `/interview/setup`(38)
- **主链路**：`/interview/setup`(38) → `/interview/session`(39) → `/interview/report`(40)
- **辅助**：STAR 手册 `/interview/tips`(41，静态)、历史 `/interview/reports`(42) → 单份报告(40)
- **输入/处理**：设置岗位/难度 + 上传简历(38) → 作答/计时/语音(39，`EXTERNAL_BLOCKED` 语音可选)
- **结果/终点**：`/interview/report`(40) 四维度评分；入 `/me/ai-records`(19)；打印(`HARDWARE_BLOCKED` 可选)
- **状态变体**：语音能力态(39)；loading/empty/error/未登录(42)
- **合规**：语音失败回文字，不伪造评分

## 二、信息入口与辅助业务线（9–12）

### Flow 9 · 岗位 · 企业 · 招聘会（第三方/官方来源入口）

> 合规红线：只做**来源信息导览 + 合规外跳**，全程无平台内投递/收简历/筛选/邀约/Offer。

- **9a 岗位（线上）**：`/jobs`(08) → `/jobs/:id`(09) → **去来源平台投递/扫码投递**(`EXTERNAL_BLOCKED`)；埋点浏览/跳转（白名单）→ 记录入 `/me/activity`(71)
- **9b 岗位（线下机构）**：`/jobs`(08) → `/jobs/:id/offline`(74) ｜ `/offline-agencies`(75) → `/jobs/:id/offline`(74)；到店指引 + 资料打印，**不代收简历/费用**
- **9c 企业导览**：`/companies`(53) → `/companies/:id`(54)｜`EXTERNAL_BLOCKED`+`CONFIG_BLOCKED`(指标开关)；在招岗位 + 来源说明 → 外跳来源
- **9d 招聘会**：`/job-fairs`(10) → `/job-fairs/:id`(11) → 现场服务子页；**去来源平台预约**(`EXTERNAL_BLOCKED`)
  - 现场服务：`/companies`(44) → `/companies/:companyId`(45，外跳) ｜ `/map`(46) ｜ `/materials`(47，`HARDWARE_BLOCKED` 打印) ｜ `/visit-plan`(48，`HARDWARE_BLOCKED`，基于本人简历+公开信息) ｜ `/stats`(49，只读) ｜ 签到 `/job-fairs/checkin`(43，主办方管理)
- **入口收藏**：三类收藏统一进 `/me/favorites`(20)
- **状态变体**：各列表 loading/empty/error；详情 loading/error
- **合规**：主按钮文案严格白名单（查看岗位/去来源平台投递/扫码投递/查看招聘会/去来源平台预约/扫码预约）

### Flow 10 · AI 助手

- **入口**：底栏「AI助手」→ `/assistant`(13)
- **主链路**：`/assistant`(13) 咨询主题 → 对话 → 白名单动作引导跳功能页；语音通话子态 **73**(`AssistantCallPanel`，`EXTERNAL_BLOCKED` TRTC 可选)
- **结果/终点**：引导用户跳向对应功能业务线（打印/简历/岗位/政策）
- **状态变体**：loading/error；语音失败回文字
- **合规**：只做咨询与引导，不代替业务页产生「已完成」结论

### Flow 11 · 会员中心（我的）

- **入口**：底栏「我的」→ `/profile`(14，五分区 + 本次记录) ｜ 未登录引导登录
- **登录相关**：`/login`(15，`EXTERNAL_BLOCKED` 短信) ｜ PC 扫码 `/member/qr-login`(63) ｜ 手机上传 `/upload/phone`(62)
- **明细分区**（均含 loading/empty/error/未登录）：
  - `/me/resumes`(16) → 去报告/优化/匹配
  - `/me/documents`(17) → 签章/打印/到期清理
  - `/me/print-orders`(18) → 订单详情/取件码
  - `/me/ai-records`(19) → 各 AI 结果/删除
  - `/me/favorites`(20) → 各详情
  - `/me/benefits`(21) → 权益活动(→ `/activities`24 → `/activities/:id`72 领取 → BenefitGrant)
  - `/me/activity`(71) 浏览/外跳两 Tab → 明细 `/me/activity/:id`(25，`FALLBACK_PLACEHOLDER`)
  - `/me/notifications`(26) 站内消息 ｜ 顶层别名 `/notifications`(`FALLBACK_PLACEHOLDER`)
  - `/me/feedback`(27)【缺图 22B】提交反馈工单
  - `/me/settings`(23) 会话说明/AI授权撤销/退出
- **合规**：只记录本人浏览/外跳/打印/AI调用，不记录投递/预约结果；撤权即时生效

### Flow 12 · 系统状态页（全局兜底）

- **待机**：`/screensaver`(57)｜`CONFIG_BLOCKED`(终端素材集)；无素材兜底、触摸回首页
- **超时**：`/session-timeout`(60)｜页面组件已在 main 真实实现（commit ff09a692，30s 倒计时登出+清理本机会话）；⚠️当前无自动触发接线（idle 走屏保/静默登出），生产需补接触发路由
- **离线**：`/error-offline`(61)｜页面组件已在 main 真实实现（`/api/v1/health` 轮询重连+断网降级）；⚠️当前无自动触发接线（断网仅置首页设备标志），生产需补接触发路由
- **帮助**：`/help`(58，静态 FAQ + 现场协助)
- **法务**：`/legal/:doc`(59)｜`EXTERNAL_BLOCKED`(正文)，无正文走硬编码兜底
- **合规**：placeholder 页如实标注「新增功能」，不冒充已实现

## 三、受控内容专区（config 门控，非独立主流程，归口说明）

> 这些 route 是**内容/运营专区**，受后台开关门控，不构成用户核心任务闭环，但必须有归属，避免孤儿页。

- **政策服务**：`/renshi`(12) 政策/社保/登记/公告浏览 + 材料打印（材料清单接 Flow 1）
- **百宝箱**：`/toolbox`(76)【缺图】｜`CONFIG_BLOCKED`；关则不渲染，开则微应用卡跳转 + config-off 兜底态
- **校园招聘**：`/campus`(50)｜`CONFIG_BLOCKED`(校招开关) → 招聘会/企业详情(接 Flow 9)；直达别名 `/campus/welcome`、`/campus/freshman-insights`(均 `FALLBACK_PLACEHOLDER`)
- **智慧校园**：`/smart-campus`(51) → welcome(69 静态) / service/:key(52 静态) / freshman-insights(70)｜均 `CONFIG_BLOCKED`；(70) **未开放锁定态，绝不展示假数据**

## 四、86 route × 业务线归属校验（无孤儿）

> 下表**编号均为 P1 总表「#」列的 route 序号（1..86）**，非 proto 编号。每个 route# 恰好归属一条，加总严格 = 86，杜绝孤儿。

| 归属 | route 数 | 覆盖 route#（P1 总表 # 列） |
|---|---|---|
| 全局入口（首页） | 1 | 15 |
| Flow 1 文档打印 | 12 | 41,42,43,44,48,49,50,51,52,53,54,55 |
| Flow 2 纸质扫描 | 4 | 67,68,69,70 |
| Flow 3 简历诊断 | 3 | 58,61,62 |
| Flow 4 简历优化 | 4 | 63,64,65,66 |
| Flow 5 简历生成 | 2 | 59,60 |
| Flow 6 岗位匹配 | 1 | 5 |
| Flow 7 职业规划 | 1 | 6 |
| Flow 8 模拟面试 | 5 | 7,8,9,10,11 |
| Flow 9 岗位/企业/招聘会 | 15 | 71,72,73,74,76,77,78,79,80,81,82,83,84,85,86 |
| Flow 10 AI助手 | 1 | 16 |
| Flow 11 会员中心 | 18 | 1,2,3,17,18,19,20,21,22,23,24,25,26,27,28,30,31,75 |
| Flow 12 系统状态页 | 5 | 4,12,13,14,29 |
| 受控专区 | 9 | 32,33,34,35,36,37,38,39,40 |
| 重定向卡 | 5 | 45,46,47,56,57 |
| **合计** | **86** | 1..86 各一次，无重、无漏、无跳号 |

> 说明：
> - 辅助工具/收藏跨线复用（如模板库 65、求职材料 66 亦服务生成线；收藏 21 汇聚 Flow 9 三类）只计**主归属**一次，不重复计数。
> - route# 75（`/notifications` 顶层别名，`FALLBACK_PLACEHOLDER`）语义归会员中心通知，故计入 Flow 11。
> - 子状态 proto 73（`AssistantCallPanel`）不占 route，不入本表（见 P1 子状态节）。
> - 逐条 route 在 P1 总表已 1..86 连续无跳号；本表为业务线聚合视图，供 P4 index 导航分组直接引用。

## 五、P2 结论

- 12 条业务线全部形成「入口→前置→输入→处理中→结果→保存/下载/打印/合规外跳」闭环，每条主功能均有合法终点。
- 状态变体候选（原 5 组，route 号命名）经 P3 逐个读原型验证后收敛为 **4 组真实缺失项**：**15A**(登录短信失败)、**32A**(支付失败)、**34A**(扫描仪离线)、**76A**(百宝箱未开放)，均按 proto 号命名；原 54A(打印机离线) 因 proto 04 已绘制缺纸/卡纸/失败/重试而**不新建**，不为覆盖率强凑。
- 受控专区、系统兜底页、重定向卡、placeholder 别名均有明确归属，**无孤儿路由**。
- **P3 已完成**：3 缺图页（76-toolbox-zone / 77-print-upload / 22B-me-feedback）+ 4 状态变体（15A/32A/34A/76A）已落地并通竖屏验证。
- **P4 进行中**：按本文件 12 分组重写 index.html 为流程闭环导航（见目录内 index.html）。

