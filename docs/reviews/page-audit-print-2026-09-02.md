# 打印扫描主链路逐页体检（2026-09-02）

> 本文只做**问题清单**，不是重做方案。配色 / 字体 / 圆角 / 阴影 / 间距与新稿的差异**不在本文范围**，
> 那是全局设计系统的事，另有方案。

## 0. 体检口径与环境

| 项 | 值 |
|---|---|
| 运行时 | `localhost:5279`（kiosk dev server，`VITE_API_MODE=http`） |
| 视口 | 1080×1920，`deviceScaleFactor=1`，实测 `kiosk-stage` transform scale = **1**（48px 断言无需换算） |
| 原型 | `docs/design/kiosk-redesign-2026-08/*.html?flat=1`（Firefox headless 1080×1920） |
| 截图目录 | `/tmp/audit-print/`（未入库） |
| 覆盖路由 | 12 条 |

**环境限制（必须先读）**：后端 API（`localhost:3010`）**未运行**，`/api/v1/*` 一律 500。因此：

1. 直接截图得到的都是**降级态**（顶栏「状态未知」、hub 七件事全部「暂不可用」）。
2. 为拿到正常态，本次用 Playwright（仓库内 `playwright@1.55.1`）做了两件事，**只影响本次取证，未改任何仓库文件**：
   - 桩 `GET /terminals/*/capabilities` 与 `GET /terminals/*/printer-status`，把能力与打印机置为 available/ready；
   - 通过 `sessionStorage`（`ai-job-print:current-print-material-check`）与 `history.state.usr` 注入打印/扫描流程上下文。
3. 凡是**必须真实后端才能判定**的（支付通道正常态、真实打印中多文件进度、图片排序控件、真实 PDF 预览），本文一律标注**「未测」**并写明原因，不猜。

**降级态本身表现是合格的**：`/print/preview`、`/print/progress`、`/print/cashier`、`/scan/settings`
在缺上下文 / 缺后端时都给出诚实守卫页，不伪造「已完成 / 已出纸 / 已支付」，符合 CLAUDE.md §9。
下文不把这些当问题记。

**合规文案扫描**：对 `pages/print`、`pages/print-scan`、`pages/scan` 全量 grep
「一键投递 / 立即投递 / 平台投递 / 企业收简历 / 候选人管理」——**零命中**。本批次无合规越界。

**死链扫描**：本批次页面里 21 个 `navigate('/...')` 目标全部在 `apps/kiosk/src/routes/index.tsx` 存在
（`/login` 以绝对路径形式定义在 line 104）。**无死链**。

**触控扫描**：12 条路由逐一量 `button / a / [role=button] / input / select` 的 `getBoundingClientRect`，
除 `input.sr-only`（1×1，视觉隐藏 + 可见 label，合规）外，**没有任何可点区域 < 48px**。本批次无触控问题。

---

## 1. 跨页问题（先修这个，一次修掉 11 页）

### X-1 [中] 旧顶栏主副标题零间距连排

**现象**：屏上读成「就业服务大厅 · KSK-001**AI求职打印服务终端**」，两段文字之间没有任何间隔。

**用户影响**：机号和产品名黏成一个词，运维一眼读不出终端编号；用户看到的是一串乱码般的标题。

**证据**（实测 DOM 几何，`/print/preview`）：

```
<b>就业服务大厅 · KSK-001</b>      right = 357.9609375
<span>AI求职打印服务终端</span>     left  = 357.9609375   ← 间距 0px
```

**波及范围**：`apps/kiosk/src/layouts/KioskRoot.tsx:69-79` 的 `V6_SHELL_ROUTES` 白名单只有 8 条路由
（`/`、`/print-scan`、`/resume-service`、`/jobs-service`、`/fairs-service`、`/interview-service`、
`/policy-service`、`/profile`）。本批次里**只有 `/print-scan` 在白名单内**，其余 11 条路由全部走旧深色顶栏，
全部有这个问题。

**建议**：`packages/ui/src/components/KioskTopbar.tsx:39-40` 的 `<b>` / `<span>` 之间补间距（或给 span 加 `ml`）。
一处改，11 页齐修。

---

### X-2 [高] 流程页 `min-h-full` 不生效，页面只占屏幕上半截

**现象**：`/print/upload`、`/print-scan/convert`、`/print-scan/sign` 的内容在半屏处戛然而止，
下方是整块空白画布。

**证据**（`/print/upload`，健康态与降级态复测结果一致）：

```
main.ui-kiosk-content            top=76   bottom=1920  (可视 1844, scrollHeight 1844 —— 不滚动)
└ div.flex.min-h-full.flex-col   top=76   bottom=876   ← 只有 800px 高，min-h-full 没落地
像素扫描：uniform rows 842–1919，height = 1078px（占屏 56.1%）
```

各页实测空白高度：

| 路由 | 空白区间 | 高度 |
|---|---|---|
| `/print/upload` | rows 842–1919 | **1078px** |
| `/print-scan/convert` | rows 1047–1919 | **873px** |
| `/print-scan/sign` | rows 1522–1919 | **398px** |

**用户影响**：27 寸竖屏上，操作区被压在上半截，下半屏是空的；触控热区离手远，观感像页面没加载完。

---

### X-3 [高] 「返回修改」在两条真实入口上无处可去，且承诺不成立

**现象**：从「我的文档」和「扫描结果页」进入打印时，打印参数被写死（1 份 / 黑白 / 单面），
用户**没有任何界面可以改份数、彩色、双面**，但界面一直在说「可再修改」。

**链路**：

```
/me/documents  ── print() ──► /print/confirm
   params = makePrintParams({ copies:1, duplex:'single', color:'bw' })   ← 写死
   apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx:212-221

/scan/result   ── handlePrint() ──► /print/confirm
   卡片文案：「直接打印 · 按默认参数进入确认打印，可再修改」
   params = makePrintParams({ copies:1, duplex:'single', color:'bw' })   ← 同样写死
   apps/kiosk/src/pages/scan/ScanResultPage.tsx:66-74

/print/confirm 本身只有只读的「参数确认清单」（无任何参数控件），
「返回修改」= navigate(-1)
   apps/kiosk/src/pages/print/PrintConfirmPage.tsx:333, 464-465
   → 退回 /me/documents 或 /scan/result，两处都没有参数编辑器
```

**用户影响**：想打 3 份、想彩色、想双面的用户，走这两条路径永远只能拿到 1 份黑白单面；
按了写着「返回修改」的按钮之后发现什么都改不了。这是对能力的**过度承诺**（CLAUDE.md §9「不伪造能力」）。

**建议**：这两条入口改为跳 `/print/preview`（参数页）而不是 `/print/confirm`；
或在 `/print/confirm` 内提供参数编辑；或把按钮文案改成不承诺可改。

---

## 2. 逐页清单

### `/print-scan` ↔ `10-print-hub.html`

**结论**：有 3 个问题
**运行时截图**：`/tmp/audit-print/ok-print-scan.png`（正常态，能力已桩）、`/tmp/audit-print/rt2-print-scan.png`（降级态）
**原型截图**：`/tmp/audit-print/proto-10-print-hub.png`

1. **[中] 功能缺失：hub 没有「U 盘导入打印」入口** —— 原型 hub 第一屏把「U 盘导入打印」做成与「文档打印」
   并列的独立卡（「插右侧 USB 口，本机服务列出根目录里的文件，你在屏幕上选」）；运行时七张卡是
   文档打印 / 手机扫码上传 / 材料扫描 / 照片打印 / 证件照 / 格式转换 / 签名盖章，**无 U 盘**。
   —— 用户拿着 U 盘站在机器前，在打印扫描首页找不到入口。
   —— 证据：`apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx:115-220` 只定义 7 张卡，无 `usb` 项。
   能力本身仍在，藏在 `/print/upload` 的第三个 tab（`PrintUploadPage.tsx:205-211`，本机未配置时置灰）。
   —— 建议：hub 补一张 U 盘卡，直达 `/print/upload?source=document&tab=usb`；未配置时按现有降级样式置灰。

2. **[中] 降级态下合规/计价免责声明最后一行被底栏拦腰切断** —— 「服务状态无法确认」状态（真机 Agent 掉线时
   全天就是这个状态）下，底部免责声明第三行「…资质的电子签名服务办理。本页不核价、不结算，价格以打印工作台
   核价与现场公示价为准。」只露出上半截字。
   —— 用户影响：这一行正是「本机不核价不结算」的价格免责，最需要被看见的时候看不全。
   —— 证据（实测）：`main.ui-kiosk-content` clientHeight=1704 / scrollHeight=**1798**（94px 在折线下）；
   `footer.v6-ph-foot` bottom=**1826** > `nav.ui-kiosk-nav` top=**1804**。裁切放大图：`/tmp/audit-print/crop-hub-footer.png`。
   —— 正常态复测 scrollHeight=1767（仍溢出 63px），但免责声明本体（bottom=1781）完整可见，只裁到尾部留白。
   —— 建议：底部免责区改为不参与滚动的固定块，或压缩降级横幅高度。

3. **[低] 「复印」引导整站缺失** —— 原型在「已下过单 · 我的文件」区给了一张复印说明卡：
   「请直接在奔图机器面板上操作。本机网页没有复印流程，也不代收费。」运行时该位置换成了「反馈问题」。
   硬件是支持复印的（CLAUDE.md §3），但页面上没有任何地方告诉用户去哪复印。
   —— 建议：在 hub 或「这个台面能做的七件事」旁补一条静态说明，成本极低。

**无问题项（已验证）**：7 张卡 + 3 个记录入口的 `to` 路由全部存在；无违禁文案；无触控问题。

---

### `/print/upload` ↔ `12-file-source.html`

**结论**：有 3 个问题（其中 2 个见跨页 X-1 / X-2）
**运行时截图**：`/tmp/audit-print/ok-print-upload.png`
**原型截图**：`/tmp/audit-print/proto-12-file-source.png`

1. **[高] 底部 1078px 空白** —— 见 X-2。像素扫描 rows 842–1919，占屏 56.1%；
   `div.flex.min-h-full.flex-col` bottom=876，`main` 可视高 1844。健康态（能力/打印机已桩）复测数值一致，
   **不是数据缺失导致的**。

2. **[中] 「最近文件（最近 3 份）」列出来了却选不了** —— 登录用户能看到自己最近 3 份打印文件的文件名和状态，
   但每一项是纯 `<div>`，没有 `onClick`、没有按钮、没有链接。
   —— 用户影响：看到自己的文件摆在眼前却点不动，只能退出流程去「我的文档」再从那边发起打印
   （而那条路又落进 X-3 的参数写死问题）。
   —— 证据：`apps/kiosk/src/pages/print/PrintUploadPage.tsx:505-533`，item 外层为 `div`，内含 icon + 文件名 span
   + 状态 span，无任何交互元素。
   —— 对照：原型 `12-file-source.html` §02 把「我的文档 / 最近打印」做成与手机扫码、本机选文件、U 盘并列的
   真实来源（「登录后查看已保存材料和最近打印文件。进入打印前会重新取得有效访问链接」）。
   —— 建议：把 item 改成按钮，点击后走与 U 盘导入相同的「取签名 URL → 进材料检查」链路。

3. **[中] 顶栏标题连排** —— 见 X-1。

**已验证无问题**：4 个来源按钮（选择文件 / 扫码上传 / U 盘导入 / 扫描原件）全部 ≥72px 高；
「扫描原件」跳 `/scan/start` 有效；U 盘 tab 在未配置时显示「本机未配置」并置灰，属诚实降级。

---

### `/print/preview` ↔ `13-print-desk.html`

**结论**：有 2 个问题
**运行时截图**：`/tmp/audit-print/ok-print-preview.png`（正常态）、`/tmp/audit-print/ok-print-preview-full.png`（整页）
**原型截图**：`/tmp/audit-print/proto-13-print-desk.png`

1. **[高] 主 CTA 在首屏外 1001px，且底部操作条不吸底** —— 用户在这一页设完份数/彩色/双面/方向/缩放/页范围，
   屏幕上看不到任何「下一步」，必须把整页往下滚一整屏才能找到「确认参数」。
   —— 证据（正常态实测）：
   ```
   main.ui-kiosk-content   clientHeight = 1844,  scrollHeight = 2935   → 折线下 1091px
   footer.ui-kiosk-action-bar   position: static（不吸底）
   button「确认参数」        top = 2921   （视口底 1920，即在屏外 1001px）
   ```
   降级态同样（CTA 文案变「打印机不可用」，top=2981）。
   —— 用户影响：一体机用户天然不会去滚一个"看起来已经填完"的页面；这是流程被卡死的直接原因。
   —— 建议：`ui-kiosk-action-bar` 在本页改 `position: sticky; bottom: 0`（该操作条在 `/print/upload`、
   `/print/confirm` 上因为内容短刚好可见，问题只在本页暴露）。

2. **[低 · 需真机复验] 文件预览 iframe 不校验响应内容类型** —— 预览区直接把 `file.fileUrl` 塞进 iframe，
   如果该地址返回的不是 PDF（签名 URL 过期、后端返回错误页），iframe 会把返回的 HTML 整页渲染进预览框。
   本次注入的 `/files/demo.pdf` 被 dev server 的 SPA fallback 回落成 `index.html`，结果预览区里
   **递归渲染了整个 kiosk 应用**（带迷你顶栏 + 「页面暂时无法显示 / 返回首页」）。
   截图：`/tmp/audit-print/rt2-print-preview.png`。
   —— 说明：触发条件由本次注入的假 fileUrl 制造，生产上等价条件是签名 URL 过期/报错。页面已有文案
   「若只看到文件图标，请确认文件链接未过期」说明作者预期过这类情况，但没有拦住"渲染任意页面"。
   —— **需用真实过期签名 URL 复验后再定级**。

**已验证无问题**：所有参数按钮 48×(≥48)；无元素溢出视口；步骤条 6 步标签全部可见
（x1020–1080 区域深色像素 47，与 `/print/confirm` 形成对照）；`3 页 / 3 面 / 3 张` 用量预估与文件页数一致，
页数未识别时显示「待识别」而非编数。

---

### `/print/confirm` ↔ `14-print-confirm.html`

**结论**：有 3 个问题
**运行时截图**：`/tmp/audit-print/ok-print-confirm.png`
**原型截图**：`/tmp/audit-print/proto-14-print-confirm.png`

1. **[中] 布局塌陷：第 6 步「打印」标签被裁掉，用户只看到一个光秃秃的「6」** ——
   —— 证据（正常态与降级态一致）：
   ```
   nav.ui-kiosk-steps   clientWidth = 984,  scrollWidth = 1072   （溢出 88px）
                        可视框 x = 48 … 1032
   标签「打印」          x = 1032 … 1072    ← 完全落在可视框右侧之外
   document.elementFromPoint(标签中心) → DIV.print-confirm-body   （标签不可命中）
   像素复核：x1020–1080, y230–275 区域深色像素数 = 0
             同一区域 /print/preview = 47（该页步骤条不溢出，标签正常显示）
   ```
   —— 用户影响：六步流程条最后一步没有名字，用户不知道第 6 步是什么。`overflow-x: auto` 理论上可横向滚，
   但触控屏上没人会去横滑一个步骤指示器。
   —— 建议：本页 `nav.ui-kiosk-steps` 的左右 inset（left=48/right=1032）比 `/print/preview`（0…1080）窄 96px，
   步骤条按原宽度排就撑破了。收紧步骤间距或让 nav 与 `/print/preview` 一样撑满宽度。

2. **[中] 左栏「参数确认清单」卡内 796px 空白** ——
   —— 证据：卡片 top=418 / bottom=1749；卡内最后一行内容 bottom=**953**。空白 = 1749 − 953 = **796px**。
   右栏在同一高度里塞了隐私摘要 + 用量 + 权益 + 提交后流程 + 打印须知五张卡，左栏只有一张 9 行的清单被拉长。
   —— 用户影响：核对参数这一屏，视觉重心整个偏右，左边一大块空白让人以为内容还没加载完。

3. **[中] 「返回修改」承诺不成立** —— 见 X-3。

**已验证无问题**：无滚动条（内容恰好放进 1920）；CTA「按以上设置打印原文件」/「返回修改」在首屏内可见
（top=1798/1806）；无触控问题；取不到价目时显示「本机没能取到现行价目」并且不显示金额、不试算抵扣
（`¥—`），符合 §9。

---

### `/print/progress` ↔ `15-print-fulfill.html`

**结论**：有 2 个问题
**运行时截图**：`/tmp/audit-print/rt3-print-progress.png`（打印中，轮询挂起构造）、
`/tmp/audit-print/rt2-print-progress.png`（轮询失败终态，实际落在 `/print/done`）
**原型截图**：`/tmp/audit-print/proto-15-print-fulfill.png`

1. **[中] 底部 604px 空白** —— 像素扫描 rows 1242–1845（1845 以下是 `import.meta.env.DEV` 才渲染的
   `taskId:` 调试行，生产不出现，故生产上空白约 **678px**，一直到 1920）。
   —— 打印中这一屏用户会盯着看几十秒，下三分之一是空的。

2. **[中] 打印过程中没有任何求助按钮** —— 原型 15 在「卡纸、缺纸、没出全？别硬拉纸，找现场工作人员处理。」
   旁边放了一个实心「联系工作人员」按钮；运行时只有正文里一句「如遇卡纸或缺纸，请联系现场工作人员」，
   页面上**没有可点的动作**（底部操作条只有一个状态徽标「状态确认中」）。
   —— 用户影响：真卡纸的时候，用户在打印进度页上无路可走——既不能反馈也不能求助，只能退回首页。
   —— 对照：终态页 `/print/done` 上倒是有「反馈问题 / 使用帮助」按钮；进行中这一屏没有。
   —— 建议：把「反馈问题」按钮提到 `/print/progress` 的操作条上。

**已验证无问题（诚实性合格，记录备查）**：
- 直达无上下文 → 「未找到打印任务」守卫，不跑动画不伪造成功；
- http 模式下有 file 无 taskId → 另一道守卫，不回退 SIM 动画；
- taskId 无法核验 → 跳 `/print/done` 显示「无法确认打印结果 / 当前未取得可信的任务终态，请勿据此判断已经出纸」；
- 文案「超过 10 分钟未响应将提示处理超时」与 `REAL_POLL_TIMEOUT_MS = 10 * 60 * 1000`（`PrintProgressPage.tsx:151`）一致；
- `taskId: xxx` 调试行受 `import.meta.env.DEV` 保护，生产不渲染（`PrintProgressPage.tsx:758-760`）。

**未测**：真实 `printing` 状态下的逐文件进度列表（原型 15 有「简历_2026.pdf 打印中 / 身份证 排队中」两行）。
运行时只渲染单文件任务信息；是否支持多文件需真实后端任务复验。

---

### `/print/cashier` ↔ `32-cashier.html`

**结论**：有 2 个问题
**运行时截图**：`/tmp/audit-print/rt2-print-cashier.png`（注入订单上下文）、`/tmp/audit-print/rt-print-cashier.png`（直达守卫）
**原型截图**：`/tmp/audit-print/proto-32-cashier.png`

1. **[高] 开发者错误串直接展示给用户** —— 支付通道拉取失败时，收银台在支付方式卡里原样显示：
   ```
   fetchPaymentChannels failed: 500 请求失败（500）
   ```
   —— 用户影响：公共一体机的收银台上，用户看到的是一行英文函数名 + HTTP 状态码。既看不懂也不知道该怎么办。
   —— 证据：`apps/kiosk/src/services/print/paymentApi.ts:29`
   `throw new Error(\`fetchPaymentChannels failed: ${res.status} ${await readError(res)}\`)`；
   `apps/kiosk/src/pages/print/PrintCashierPage.tsx:168`
   `setIssueError(err instanceof Error ? err.message : '获取支付通道失败')`
   —— `err.message` 永远存在，友好兜底文案「获取支付通道失败」**永远走不到**。
   —— 同样写法还在 `PrintCashierPage.tsx:117 / 143 / 367`（创建任务失败、出码失败、模拟支付失败），
   对应 `paymentApi.ts:63 / 76 / 89 / 98 / 125 / 143` 六处同款英文 message。
   —— 建议：页面侧不要直接吐 `err.message`；或在 `paymentApi.ts` 里改抛带 code 的结构化错误，由页面映射中文。

2. **[中] 底部 670px 空白** —— 像素扫描 rows 1250–1919。

**已验证无问题**：直达无订单 → 「未找到待支付订单」守卫；金额展示与「本单实付金额 · 已按下单时公示价锁定」
文案一致；支付与退款规则四条完整可见；步骤条 6 步标签全部可见；无触控问题。

**未测**：支付通道选择行（微信支付 / 支付宝）与「屏上收款码 / 扫付款码」的正常态——本次通道接口 500，
通道行为空。原型 32 的两步选择（先通道后扫码方式）在运行时代码里存在（副标题「先选通道，再选扫码方式」），
但**需真实支付后端复验**。

---

### `/print-scan/convert` ↔ `19-img2pdf.html`

**结论**：有 3 个问题
**运行时截图**：`/tmp/audit-print/rt-convert.png`
**原型截图**：`/tmp/audit-print/proto-19-img2pdf.png`

1. **[高] 同一屏自相矛盾，并对未登录用户伪造「已保存」** ——
   ```
   顶部横幅（未登录时）：未登录状态下转换的 PDF 不会进入「我的文档」，请在本次操作内直接完成打印…
   右侧「转换规则」第 4 条（无条件）：生成后自动进入确认打印；PDF 已保存到「我的文档」。
   ```
   —— 用户影响：一体机绝大多数用户未登录。他们同屏读到两句互相打脸的话，其中一句还直接断言
   「已保存到我的文档」——文件其实不会保存。用户按这句话走开，文件就没了。这是 CLAUDE.md §9
   「没有真实保存结果时不得展示已保存」的直接违反。
   —— 证据：`apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx:179-181`（横幅按登录态分支）
   vs `:270-277`（规则列表写死）。
   —— 建议：规则第 4 条按 `getToken()` 分支，与横幅口径一致。

2. **[中] 底部 873px 空白** —— 见 X-2，像素扫描 rows 1047–1919。

3. **[低] 原型有而运行时没有的两处** ——
   - 添加通道：原型给三条（本机上传一张 / 手机扫码上传一张 / **U 盘导入图片**，第三条附
     「还不能直接进这个列表，点开看还能怎么办」的诚实说明）；运行时只有前两条。
   - 限额披露：原型「这里的规矩」列了 只收 JPG/PNG、单张 ≤10MB、**单张 ≤2500 万像素**、一次最多 20 张、
     **合计 ≤40MB**、**生成的 PDF ≤15MB** 六条；运行时「转换规则」只写了前两条 + 20 张。
     用户传到一半被退回时不知道踩了哪条线。

**未测**：已添加图片后的上移 / 下移 / 移除排序控件（页面文案称「可用右侧按钮调整或移除」），
需真实上传后复验。

---

### `/print-scan/sign` ↔ `20-sign-stamp.html`

**结论**：有 2 个问题
**运行时截图**：`/tmp/audit-print/rt-sign.png`
**原型截图**：`/tmp/audit-print/proto-20-sign-stamp.png`

1. **[中 · 需产品定夺] 原型把这一页设计成登录门禁页，运行时匿名可直接上传合成** ——
   —— 原型 20 整页只做一件事：拦住未登录用户。
   ```
   还没确认你是谁
   签名和印章是高敏材料，在确认身份之前，这一页不提供上传、不显示任何文件，也不合成。
   [这一页不显示任何文件] [不生成、不保存、不上传] [签名图不跨会话保留]
   底部动作：返回打印扫描 / 去登录
   ```
   —— 运行时匿名进入即是完整工作台：选 PDF → 上传签名/印章图片 → 选叠加位置 → 勾授权 → 生成合成 PDF，
   **没有任何身份门禁分支**（`SignStampPage.tsx` 只把 `getToken()` 当参数传给上传调用，
   见 :168 / :192 / :236，无 `if (!token) return <gate/>` 之类逻辑）。
   —— 用户影响：公共一体机上，任何路人都能上传他人签名/印章图片并合成 PDF。页面自己的免责文案也说了
   「伪造、变造印章或冒用他人签名属违法行为」——但没有任何身份关联手段。
   —— **服务端是否拒绝匿名 `signature_image` 未测**（API 未运行）。静态检查
   `services/api/src/upload-sessions/upload-sessions.service.ts:95-100` 的
   `SUPPORTED_UPLOAD_SESSION_PURPOSES` 里没看到登录约束；`services/api/src/files/file.types.ts:35`
   把该 purpose 标为「高敏,锁定系统短期,不进"我的文档"」，是留存策略而非访问门禁。
   —— 建议：请产品明确口径。若维持原型口径，加登录门禁；若维持现状，至少把差异记入
   `docs/compliance/`，别让原型和实现各说各话。

2. **[低] 底部 398px 空白** —— 见 X-2，像素扫描 rows 1522–1919。

**已验证无问题**：触控全部合格——位置九宫格 92×58、大小按钮 58×52、页码 77×54、
授权勾选 label 378×56、生成按钮 460×56，均 ≥48px；
「签名画布预留区」诚实标注「本批次请上传签名 / 印章图片；触屏手写将在校准后开放」，未伪造手写能力；
顶部法律免责（非 CA 电子签、不具备法律认证效力）完整可见。

---

### `/scan/start` ↔ `18-scan-workbench.html`

**结论**：有 2 个问题
**运行时截图**：`/tmp/audit-print/ok-scan-start.png`（能力已桩）、`/tmp/audit-print/rt-scan-start.png`（能力未知降级态）
**原型截图**：`/tmp/audit-print/proto-18-scan-workbench.png`

1. **[中] 两栏都是大片死空间，合计约 1600px** ——
   —— 左栏三张扫描类型卡，每张 **429px 高但内容只有 155px**，上下各 **137px** 空白：
   ```
   简历扫描  card 461–891   content 598–753   padTop 137  padBottom 137
   证件扫描  card 907–1336  content 1044–1199 padTop 137  padBottom 137
   普通文档  card 1352–1781 content 1489–1644 padTop 137  padBottom 137
   像素扫描（x60–600）：141 / 134 / 141 / 133 / 141 / 133 —— 合计 823px
   ```
   —— 右栏「扫描流程（共 4 步）」卡内 **802px** 空白（像素扫描 x660–1010，rows 872–1673）。
   —— 用户影响：三张几乎空的大卡 + 一张空了一大半的说明卡，第一眼像是内容没加载出来。
   —— 成因：左栏三卡被拉伸去对齐右栏高度（各自 `flex-1`），而右栏又被撑到底。

2. **[低] 原型的次要出口「改用面板扫描到 U 盘」运行时没有** —— 原型 18 底部操作条给了
   「改用面板扫描到 U 盘」作为扫描链路走不通时的兜底；运行时正常态只有「返回 / 下一步 · 创建扫描会话」。
   —— 运行时在**降级态**（能力读不到）另给了「改用上传文件打印」，方向不同但确实有兜底，故只记低。

**已验证无问题**：降级态诚实（「能力状态暂不可用 / 本机未能读取扫描能力配置」+ 重新确认能力 + 联系工作人员，
不创建任务）；文案明确说明「扫描仍需在打印机面板操作」，未伪造一键扫描；无触控问题。

---

### `/scan/settings` ↔ `18-scan-workbench.html`

**结论**：有 1 个问题
**运行时截图**：`/tmp/audit-print/ok-scan-settings.png`（会话已桩）、`/tmp/audit-print/rt-scan-settings.png`（直达守卫）

1. **[高] 一屏 1920 里超过一半是空的** ——
   ```
   左栏「当前会话的服务端指引」卡：像素扫描 x60–600，blank rows 755–1777  → 1023px
   右栏（任务信息 + 提示）：       像素扫描 x640–1030，blank rows 716–1829 → 1114px
   ```
   —— 用户影响：这一屏是"去打印机面板怎么操作"的核心指引页，用户要照着做。四条指引挤在顶部 1/3，
   下面两块大白板，观感像页面出错了。
   —— 说明：指引条数由服务端 `instructions[]` 决定（本次桩了 4 条，与实际业务量级相当）。
   条数再多也填不满 1000px。

**已验证无问题**：直达无 `scanType` → 「未创建扫描任务 / 当前页面没有来自扫描首页的合法类型信息，
本次不会发起创建请求」守卫，不空发创建请求；剩余时间倒计时真实；「仅当前会话有效。点击返回会取消
这个未确认的任务」提示到位；无触控问题。

---

### `/scan/progress` ↔ `18-scan-workbench.html`

**结论**：有 1 个问题
**运行时截图**：`/tmp/audit-print/ok-scan-progress.png`

1. **[低] 右栏「流程说明」卡内 701px 空白** —— 像素扫描 x640–1030，blank rows 970–1670。
   —— 左栏等待卡的上 584px / 下 606px 属于等待态图标的垂直居中，**不计为问题**（等待屏留白是合理设计）；
   右栏是一张有边框的说明卡，卡内下半部空着，是能看出来的空白框。

**已验证无问题**：直达无 `scanTaskId`/`controlToken` → 正确回退 `/scan/start`（且 `controlToken` 刻意只在
内存传递、不落 storage，刷新即失效，见 `ScanProgressPage.tsx:64-66` 注释）；
「实际进度以打印机端为准」「没有页数进度」口径与原型一致，未伪造逐张扫描进度；
底部「取消扫描」按钮可见（top≈1830）；无触控问题。

---

### `/scan/result` ↔ `18-scan-workbench.html`

**结论**：有 2 个问题
**运行时截图**：`/tmp/audit-print/ok-scan-result2.png`

1. **[中] 「选择下一步操作」四张卡各有 354px 死空间** ——
   ```
   AI 简历识别 / 直接打印 / 登录后管理文件 / 返回首页
   每张：height = 410px，内容高度 = 57px，padTop = 177px，padBottom = 177px
   ```
   —— 用户影响：四个动作按钮被撑成四块巨大的空板，文字缩在正中一小条，扫视成本反而变高。

2. **[中] 「直接打印 · 按默认参数进入确认打印，可再修改」承诺不成立** —— 见 X-3。
   文案在 `ScanResultPage.tsx` 的卡片描述里，实际跳 `/print/confirm` 且 params 写死
   （`ScanResultPage.tsx:66-74`），到了确认页没有任何参数控件，「返回修改」退回本页也改不了。

**已验证无问题**：文件卡在拿到真实 file 时正确显示文件名 / 大小 / PDF / 页数 / 「临时文件 · 设有效期」；
预览失败时明确说明「预览失败不代表文件本身有问题，文件状态以页面上的文件卡为准」；
底部「未选择去向的临时文件会按服务端策略清理；本页不会伪造"已保存"」——口径正确；
未拿到 file 时显示「扫描未完成 / 本次没有生成可用的扫描文件」，不伪造成功；无触控问题。

---

## 3. 汇总

**共查 12 条路由，全部可打开**（无白屏、无报错路由、无非预期重定向）。

按严重度：

| 级别 | 数量 | 条目 |
|---|---|---|
| 高 | 6 | X-2 布局塌陷（3 页）、X-3 参数写死+假承诺、`/print/preview` CTA 屏外 1001px、`/print/cashier` 英文错误串直出、`/print-scan/convert` 伪造「已保存」、`/scan/settings` 过半空白 |
| 中 | 12 | X-1 顶栏连排（波及 11 页）、hub 缺 U 盘入口、hub 免责被裁、upload 最近文件不可点、confirm 步骤 6 标签被裁、confirm 左栏 796px 空白、progress 无求助按钮、progress/cashier 底部空白、scan-start 两栏 1600px 死空间、scan-result 四卡 354px 死空间、sign 无身份门禁 |
| 低 | 5 | hub 缺复印引导、preview iframe 不校验类型（待复验）、convert 缺 U 盘通道与限额披露、scan-start 缺 U 盘兜底、scan-progress 右栏空白 |

**零问题页面：0 页。** 但 `/scan/progress` 只有 1 条低级问题，`/print-scan/sign` 的 2 条里 1 条是待产品定夺的
口径差异——这两页实质上是健康的。

### 我认为最严重的三个

1. **X-3 「返回修改」承诺不成立 + 参数被写死**（`/print/confirm`、`/scan/result`、`/me/documents`）——
   唯一一个**让用户拿不到想要的东西**的问题。想打 3 份/彩色/双面的用户走这两条入口永远只能得到
   1 份黑白单面，而界面全程在说「可再修改」。功能损失 + 假承诺，双重命中。

2. **`/print/preview` 主 CTA 在屏外 1001px** —— 打印主链路的**流程断点**。用户设完参数，屏幕上没有下一步，
   操作条又不吸底。一体机用户不会去滚一个看起来已填完的页面，这一步直接把人堵在那里。

3. **`/print-scan/convert` 对未登录用户伪造「已保存到我的文档」** —— 同屏自相矛盾，且断言的那一句是错的。
   用户信了就走人，文件真的没了。这是 CLAUDE.md §9 红线里最实在的一条：**没有真实保存结果时不得展示已保存**。

紧随其后的是 `/print/cashier` 把 `fetchPaymentChannels failed: 500` 直接印在收银台上——
影响面小于上面三条（只在支付后端异常时出现），但性质最"露怯"，且同一写法在该文件里有 4 处、
在 `paymentApi.ts` 里有 6 处待修。

### 异常与未完成项

**环境异常**：后端 API（`localhost:3010`）全程未运行。本文所有"正常态"结论均建立在
桩掉 `capabilities` / `printer-status` 两个只读接口的基础上；未桩其余接口。

**因后端缺失而未测的项（不猜，留待复验）**：

| 页面 | 未测内容 | 原因 |
|---|---|---|
| `/print/cashier` | 支付通道（微信/支付宝）选择行、屏上收款码 / 扫付款码正常态 | 通道接口 500 |
| `/print/progress` | 真实 `printing` 态、多文件逐条进度（原型 15 有） | 需真实打印任务 |
| `/print/preview` | 真实 PDF 内嵌预览、签名 URL 过期时的 iframe 行为 | 需真实签名 URL |
| `/print-scan/convert` | 已添加图片后的上移/下移/移除排序控件 | 需真实上传 |
| `/print-scan/sign` | 服务端是否拒绝匿名 `signature_image` 上传 | 需真实后端 |
| `/print/upload` | U 盘导入正常态（本机 `usbConfigured=false`，一直是「本机未配置」） | 需 Terminal Agent |

**原型缺失**：无。本批次 9 份原型文件全部存在且可截图。

**顺带记录（非本批次问题，但值得知道）**：原型 `12-file-source.html` 自身在 1080×1920 下有文字重叠——
「当前文件」卡的第 3 条与底部橙色提示「这一步还没有文件…」压在一起（约 y≈1555）。属原型问题，未计入运行时清单。
