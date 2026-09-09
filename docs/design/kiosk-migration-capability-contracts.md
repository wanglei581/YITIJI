# 待迁页面能力契约（青序流光 51 页迁移）

**这是迁移的验收清单，不是参考资料。** 每迁一页，对着这一页的四条逐条勾掉；勾不掉的
要么补上，要么在 PR 里写清为什么这一条不该有。

## 它为什么存在

2026-09-09 一天内在四个 PR 里连续发现同一类缺陷：**新页把旧页的能力弄丢了，而且每处都是
门禁红了才发现，一次只露一个**——首页身份入口登录前后都写「我的」、`/interview` 工作台的
会话告警落到通用文案、会话守卫的标题从 h2 退成 div 且按域定制的影响说明算出来却没渲染、
登录页数据披露少列一项、招聘会列表 N 张卡的按钮都叫「查看详情」。

共同点是**这些能力都不在设计稿里**。稿只画版式和主要状态；诚实性声明、可访问性语义、
按状态定制的告知、出口按钮，是代码在长期使用中自己长出来的。照稿重写就没了，
而且不报错、不红编译。

四家模型（Claude / codex / grok / agy / hermes）就「能不能自动抓住」给过判断，三家结论一致：
**做不到纯自动的新旧 diff**——迁移本来就在故意删旧东西，纯 diff 会把有意删除报成回归
（2026-09-09 #1002 删掉首页三颗死控件就是实例）。可行的是**一页一份契约 + 迁移时逐条对照**。

## 四类是怎么定的

不是拍脑袋列的，是上面八处丢失归类出来的：

1. **出口** —— `QxPageFrame` 的 `back` 是可选 prop，不传就没有返回键且不报错
2. **可访问性语义** —— 标题必须是真 heading；一屏多个同名按钮必须带条目名
3. **按状态定制的告知** —— 匿名 vs 已登录、按来源域定制的影响说明
4. **诚实性披露** —— 数据披露枚举、合规白名单文案、不伪造能力的状态说明

## 怎么用

- 迁移某页**之前**，先读该页这一段，并**对着源码复核一遍**——这份清单由 codex 从代码收割，
  本会话抽查过 `/help` 与 `/print/pickup-claim` 共十条，全部对上；但没有逐条全查。
  **写错一条会让人补一个本来不存在的东西**，所以复核不能省。
- 迁完逐条勾掉。勾不掉的写进 PR 说明。
- 这一页迁完后，把它这一段删掉（契约的归宿是变成页面本身和门禁，不是永久台账）。

---

> 迁移每一页前，先对着源码复核该页那一段。**

## /help（稿 06-help）

组件：`apps/kiosk/src/pages/help/HelpCenterPage.tsx`
- [ ] 出口：顶栏“返回我的” → `/profile`；FAQ“去登录” → `/login`，带 `state: { from: '/help' }`。
- [ ] a11y：`KioskPageHeader` 输出 h1“帮助中心”；“联系现场工作人员”为 h2；FAQ 按钮以题目文本为名称，带 `aria-expanded` 与对应的 `aria-controls="help-answer-${section.key}-${itemIndex}"`；FAQ 容器 `aria-label="常见问题"`。
- [ ] 状态告知：`activeFilter` 按分类过滤 FAQ；无匿名/登录条件分支。
- [ ] 诚实披露：“本终端是公共设备，登录态只保存在当前会话内存中。页面刷新、离开或闲置超时会自动退出登录并清除会话信息，这是公共终端的正常保护行为。”；“本终端不是网络招聘平台，不办理岗位申请。岗位与招聘会信息均来自第三方/官方来源，相关申请与报名请通过页面提供的来源平台入口自行办理。”；“本终端仅提供信息与打印辅助服务，办理结果以官方/来源平台为准。”
卡点：FAQ 的展开语义和各题目不同的真实说明最容易被统一卡片样式吞掉。

## /legal/:doc（稿 08-legal）

组件：`apps/kiosk/src/pages/legal/LegalDocPage.tsx`
- [ ] 出口：顶栏“返回” → `navigate(-1)`；文档切换使用 replace 到 `/legal/terms` 或 `/legal/privacy`。
- [ ] a11y：顶栏由 `KioskPageHeader` 输出 h1；正文标题为 h2，各章为 h3；文档切换容器 `role="group" aria-label="法律文档"`，按钮有 `aria-pressed`；目录 `aria-label="章节目录"`；字号按钮分别为 `aria-label="缩小字号"`、`aria-label="放大字号"`。
- [ ] 状态告知：服务端成功取到当前文档时显示“以上为运营方当前发布的有效版本；如有疑问可咨询现场工作人员。”；取不到时显示本机留存分支。
- [ ] 诚实披露：“当前无法读取正式版本，以下为本机留存的说明文本，不作为正式版本。请稍后重试，或向现场工作人员索取正式文本。”；“本文本为本机留存的试运营文本，正式运营前以运营方法务审定发布的版本为准；如有疑问可咨询现场工作人员。”
卡点：不能把本机留存文本伪装成当前正式版本。

## /error-offline（稿 09-system-state）

组件：`apps/kiosk/src/pages/placeholders/ErrorOfflinePage.tsx`
- [ ] 出口：“联系工作人员” → `/help`，replace；连通性恢复后 → 安全的 `location.state.from`，否则 `/`，replace。
- [ ] a11y：h1“网络连接中断”；h2“当前功能状态”；无额外 `aria-label`；重试按钮是原生 disabled。
- [ ] 状态告知：每 10 秒和浏览器 `online` 事件重试；重试中按钮为“正在重试”；显示“最近检测 {timeLabel} · 每 10 秒自动重试，已重试 {attempts} 次”；恢复后才返回原页。
- [ ] 诚实披露：“打印机本机功能不受影响，恢复后将返回原页面继续。”；“U盘打印、扫描到 U盘为打印机自带功能，以现场设备实际提示为准。”
卡点：五项功能影响状态不能被简化成笼统的“网络异常”。

## /member/qr-login（稿 51-phone-relay）

组件：`apps/kiosk/src/pages/auth/MobileQrLoginPage.tsx`
- [ ] 出口：无路由返回按钮；确认后仅告知回一体机继续。
- [ ] a11y：h1 为设备名或“就业服务大厅 · 当前一体机”；失败 h2“暂时无法确认登录”；检查、通知使用 `role="status" aria-live="polite"`，错误使用 `role="alert" aria-live="polite"`；手机号、验证码均有显式 label。
- [ ] 状态告知：缺少票据时“二维码缺少登录票据，请回到一体机刷新二维码后重新扫码。”；有效时“二维码 3 分钟内有效 · 到期请在一体机上刷新”；已确认时“该二维码已确认，请回到一体机继续”或“登录已确认，请回到一体机继续使用”。
- [ ] 诚实披露：“该一体机正在请求登录你的账号。请确认是你本人在现场操作，再完成手机号验证。”；“确认后请回到一体机继续使用；离开时请记得在一体机上退出登录。手机号在系统中加密存储，页面展示时脱敏。”
卡点：票据失效、已确认、检查中、验证码发送后的不同提示不能丢。

## /toolbox（稿 50-capability-zone）

组件：`apps/kiosk/src/pages/toolbox/ToolboxZonePage.tsx`
- [ ] 出口：顶栏“返回” → `/`。
- [ ] a11y：`KioskPageHeader` 输出 h1“百宝箱”；每个能力项是原生 button，名称来自 `item.title`，并含 `item.description`；无逐项 `aria-label`。
- [ ] 状态告知：仅在 `config.enabled` 时展示按 `sortOrder` 排序的 `config.items`；无项目时显示“待配置”“后续功能上线后将在这里展示。”；不可启动项原生 disabled。
- [ ] 诚实披露：“扩展服务由运营方审核后上架；进入第三方服务前会有明确提示，本终端不记录你在第三方页面的办理结果。”
卡点：配置为空与单项不可启动不是同一状态，不能一律展示可进入的能力卡。

## /assistant（稿 05-ai-cockpit）

组件：`apps/kiosk/src/pages/assistant/AssistantPage.tsx`、`apps/kiosk/src/pages/assistant/AdvisorConversation.tsx`
- [ ] 出口：无顶栏返回出口；AI 不可用时手动入口存在于 `AdvisorManualEntries`。
- [ ] a11y：隐藏 h1“AI顾问”；页面标题 h2“你好，我是小青”；对话区 `role="log" aria-live="polite" aria-busy={loading}`；操作区 `aria-label="回答后的操作"`，快捷问题区 `aria-label="快捷问题"`；输入框 `aria-label="输入咨询问题"`。
- [ ] 状态告知：首次是 unknown，显示“AI 顾问的服务状态会在你问出第一句时确认；在此之前本页不声称它可用。”；非真实模型时显示“这一轮没有 AI 回答”，并锁住输入框；请求失败显示“AI 服务暂不可用，请稍后再试”。
- [ ] 诚实披露：“头像是虚拟形象，不是真人在跟你说话 · 回答可能出错 · 对话不保存，离场即清”；“页面不会用预置话术冒充 AI 回答。”；“这一轮回答由真实模型生成（服务标识：{describeProviderLabel(providerLabel)}），仅供参考，不构成录用、薪资或办理结果的承诺。”
卡点：只有 `llm:` 真实回答才能呈现为 AI 正文；回落文案不能作为 AI 回答显示。

## /jobs/:id（稿 27-browse-detail）

组件：`apps/kiosk/src/pages/jobs/JobDetailPage.tsx`、`apps/kiosk/src/pages/jobs/components/JobDetailSections.tsx`
- [ ] 出口：加载、找不到、正常态均可回 `/jobs`；未登录使用 AI 岗位能力时 → `/login`，带 `state: { from: \`/jobs/${currentJob.id}\` }`。
- [ ] a11y：`QxPageFrame` 输出 h1“岗位详情”；内容区有 h2/h3；二维码弹层 `role="dialog" aria-modal="true" aria-label="扫码投递"`；收藏按钮按状态使用“收藏岗位”或“取消收藏”；来源不完整时，投递按钮使用 `aria-disabled` 和 `aria-describedby` 指向原因。
- [ ] 状态告知：加载态“真实字段返回前不显示示例内容，也不预估剩余时间。”；找不到态“本机不会用相似岗位替你补上。”；来源四要素缺失时停用扫码与外跳，并列出缺失项。
- [ ] 诚实披露：“投递在来源平台完成，本终端不接收简历、不参与招聘流程”；“来源要素不完整，前往来源平台与扫码已停用”；“这不表示该岗位无效 —— 岗位是否仍在招聘由来源平台决定，可到来源平台自行查询该职位。”；“来源核验只说明该机构是否被允许在本系统发布信息，不构成本平台对该岗位真实性的背书。”
卡点：来源四要素门禁及其邻接原因必须保留；不能仅保留一个置灰按钮或二维码。

## /renshi（稿 48-policy-workspace）

组件：`apps/kiosk/src/pages/renshi/RenshiPage.tsx`、`apps/kiosk/src/pages/renshi/components.tsx`
- [ ] 出口：顶栏“返回首页” → `/`；横幅“问 AI 助手” → `/assistant`。
- [ ] a11y：`KioskPageHeader` 输出 h1“政策服务”；标签按钮以可见文字为名称，使用 `aria-pressed`；来源二维码关闭按钮 `aria-label="关闭"`。
- [ ] 状态告知：政策、公告分别有 loading/error/retry 分支；政策为空时来源行是“政策库暂无已发布政策；下方「通用办事指引」为本机整理参考，以官方发布为准{truncated}”；条件核对可显示“无法判定”。
- [ ] 诚实披露：“仅信息指引 · 不代办”；“只做政策说明、材料清单、来源链接与打印辅助；不代申请、不承诺补贴到账，不保存身份证 / 银行卡 / 社保等材料。”；“政策与公告内容仅作展示说明，具体要求请向发布主体或主管部门核对；如需办理，请前往对应窗口或核对目标域名后扫码访问。”
卡点：来源链接不能改称“官方入口”；页面明确要求用户核对来源机构与目标域名。

## /campus（稿 49-campus-workspace）

组件：`apps/kiosk/src/pages/campus/CampusPage.tsx`、`apps/kiosk/src/pages/campus/components/CampusTabs.tsx`
- [ ] 出口：顶栏“返回首页” → `/`；打印资料 → `/job-fairs/${fair.id}/materials`；各 Tab 内还有到岗位、简历和企业详情的真实路由。
- [ ] a11y：页框 h1“校园招聘专区”，招聘会名称另为 h1；Tab 使用 `aria-pressed`；弹层关闭按钮 `aria-label="关闭"`；活动信息、现场服务快捷入口、热门企业为 h2。
- [ ] 状态告知：加载时为 `LoadingState`；无校园招聘会或请求失败时显示“暂无校园招聘会数据，请稍后再试”，重试 → `/`；预约入口仅在 `fair.status !== 'ended'` 时显示。
- [ ] 诚实披露：“请使用手机扫码前往来源平台办理预约，预约由对方平台管理，本系统不参与活动报名流程、不接收简历。”；“信息由主办方提供，以来源平台为准”；“本专区为第三方 / 官方校招信息入口，预约与投递一律前往来源平台办理，本系统不接收简历。”
卡点：预约二维码只记录打开来源入口，不能被迁成平台内报名或投递能力。

## /contract-review（稿 47-contract-review）

组件：`apps/kiosk/src/pages/contract-review/ContractReviewHomePage.tsx`
- [ ] 出口：顶栏“返回简历服务” → `/resume-service`；路由仅在 `VITE_ENABLE_CONTRACT_REVIEW === 'true'` 时挂载，否则 replace 到 `/`。
- [ ] a11y：`KioskPageHeader` 输出 h1“AI 签约风险提示”；本机文件区 `role="button"`，其 `aria-label` 含已选文件名；合同类型为 `role="radiogroup" aria-label="合同类型"`，每个类型为 `role="radio"` 与 `aria-checked`。
- [ ] 状态告知：一体机只显示“手机扫码上传”；非终端环境才显示“本机文件（桌面验证）”；知情同意加载失败显示“无法加载知情同意信息，请稍后重试”；匿名扫码文件缺确认凭证时显示“这份合同还缺少确认凭证，请重新扫码上传”。
- [ ] 诚实披露：“风险提示 · 仅供参考 · 非法律意见”；“本服务仅作风险提示，不构成正式法律意见。重大争议请咨询律师或官方机构。”；“您上传的合同原件仅在本项目受控存储中短期用于 OCR 与风险分析，发送模型前脱敏，结束时优先删除，不向招聘企业或合作机构回传。”；“数据类别：{describeDataCategories(consentScope.disclosures.dataCategories).join('、')}。最长保存 {consentScope.disclosures.retention.maximumHours} 小时。”
卡点：同意范围中的数据类别和最长保存时长来自服务端枚举，不能写死或漏显示。

## /print/pickup-claim（稿 33-pickup-code）

组件：`apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx`
- [ ] 出口：输入和扫码指引态顶栏“返回打印扫描” → `/print-scan`；帮助 → `/help`；成功后已放行 → `/print/progress`，未放行 → `/print/cashier`；“再取一件”重置本页。
- [ ] a11y：`QxPageFrame` 输出 h1“输入你的到机码”或“认领成功”；输入框 `aria-label="到机码输入框"`、`aria-invalid`、动态 `aria-describedby`；提交按钮 `aria-busy`；错误为 `role="alert"`；扫码回显容器 `aria-live="polite"`。
- [ ] 状态告知：受理 8 位新码和 10 位历史码；成功按 `result.released` 分叉为“打印任务已进入队列，请稍候出纸”或“订单核验成功，请先完成现场支付”；输入中显示“已接收 {code.length} 位”。
- [ ] 诚实披露：“输错可以改，不作废”；“这一步不收钱。”；“付款成功后系统才会创建打印任务，不会提前出纸。”
卡点：8 位新码必须静默 250ms 后自动校验，避免把 10 位历史码前八位误认领。

## /resume-service（稿 16-service-hubs）

组件：`apps/kiosk/src/pages/resume/ResumeServiceHubPage.tsx`
- [ ] 出口：顶栏“返回” → `/`。
- [ ] a11y：`KioskPageHeader` 输出 h1“AI简历服务”；能力、快捷入口均为带可见标题的原生 button；“签约与权益”由 `aria-labelledby="contract-risk-title"` 关联标题。
- [ ] 状态告知：在线状态条：检查中“正在确认在线服务”、可用“在线服务已连接”、不可用“在线服务暂不可用”；不可用时显示“重新检测”，在线依赖入口变为“等待服务”。
- [ ] 诚实披露：“AI生成内容仅供参考，不构成正式求职建议；简历最终投递由本人负责确认。”
卡点：在线可达只表示 API 可达，不能迁成所有 AI、设备、权益均可用的承诺。

## /jobs-service（稿 16-service-hubs）

组件：`apps/kiosk/src/pages/jobs/JobsServiceHubPage.tsx`
- [ ] 出口：顶栏“返回” → `/`。
- [ ] a11y：`KioskPageHeader` 输出 h1“岗位信息”；能力和历史入口为带可见标题的原生 button。
- [ ] 状态告知：复用在线状态条；依赖 API 的能力不可用时禁用并显示“等待服务”；历史区说明“登录后可查看历史”。
- [ ] 诚实披露：“岗位信息均来自第三方 / 官方来源，本终端仅提供信息展示；投递、预约请前往来源平台完成，本系统不参与招聘闭环，不收取求职者简历给企业。”
卡点：服务中心的“投递请前往来源平台”与“不收取求职者简历给企业”必须同时保留。

## /fairs-service（稿 16-service-hubs）

组件：`apps/kiosk/src/pages/job-fairs/FairsServiceHubPage.tsx`
- [ ] 出口：顶栏“返回” → `/`。
- [ ] a11y：`KioskPageHeader` 输出 h1“招聘会信息”；能力和快捷入口为带可见标题的原生 button。
- [ ] 状态告知：复用在线状态条；不可用时能力和快捷入口禁用，显示“等待服务”；快捷区说明“登录后可查看历史记录”。
- [ ] 诚实披露：“招聘会信息来自第三方或官方来源；预约、报名请前往来源平台完成，本终端只提供信息展示与跳转入口。”
卡点：预约、报名属于来源平台，不可被改写成终端内办理。

## /interview-service（稿 16-service-hubs）

组件：`apps/kiosk/src/pages/interview/InterviewServiceHubPage.tsx`
- [ ] 出口：顶栏“返回” → `/`。
- [ ] a11y：`KioskPageHeader` 输出 h1“AI面试训练”；能力和快捷入口为带可见标题的原生 button。
- [ ] 状态告知：复用在线状态条；只有 `requiresApi !== false` 的能力会被在线状态禁用；快捷区说明“登录后可查看历史记录”。
- [ ] 诚实披露：“AI模拟面试内容仅供练习参考，不代表真实面试流程；评测结果不构成招聘意见，不对外共享。”
卡点：训练结果不能被迁成企业筛选、真实面试或招聘意见。

## /policy-service（稿 16-service-hubs）

组件：`apps/kiosk/src/pages/policy/PolicyServiceHubPage.tsx`
- [ ] 出口：顶栏“返回” → `/`。
- [ ] a11y：`KioskPageHeader` 输出 h1“政策服务”；能力和快捷入口为带可见标题的原生 button。
- [ ] 状态告知：复用在线状态条；依赖 API 的入口不可用时禁用并显示“等待服务”；快捷区说明“登录后可查看历史记录”。
- [ ] 诚实披露：“政策内容由来源机构提交并经平台审核后展示，仅供参考；补贴类只做政策说明和材料指引（info-only），不承诺到账，不代办申请。办理前请核对来源机构与目标域名，正式办理请前往相关政府部门或官方渠道。”
卡点：不能把“来源机构提交并经平台审核后展示”表述成已核验的官方政策或代办能力。

未修改任何文件。
