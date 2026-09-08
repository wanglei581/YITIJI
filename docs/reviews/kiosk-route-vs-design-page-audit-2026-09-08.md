# 一体机路由数 vs 青序流光稿数：多出来的 28 屏在哪里

产品负责人 2026-09-08 提问：「为什么需要交替？这样每个页面都不是统一的，
而且还要那么多操作做什么？有些多余的页面或者是功能没有价值的可以优化或者是合并。」

本文只回答第二问和第三问（多余页面 / 合并）。第一问「为什么交替」是迁移节奏问题，
结论写在文末。

## 一、一句话结论

**稿本身就是要合页的，是代码没跟上。**

| | 数量 | 取数方式 |
|---|---|---|
| Kiosk 活路由 | **79** | `routes/index.tsx` 里 86 条 `{ path: }` 减去 7 条已下线的 `Navigate` 重定向 |
| 青序流光稿 | **51** | `docs/design/kiosk-redesign-2026-08/*.html` 去掉 `master-v2-dark-tech` 与 `shot-sheet` |

差 28 屏。这 28 屏**不是稿漏画了**，是稿刻意把「一个流程拆成 N 个路由」改成
「一张工作台 + N 个状态」。下面每一条都有稿内证据。

## 二、稿已经合掉、代码还没合的流程

判据统一：**同一个 `.html` 文件里同时存在覆盖多个现有路由的状态键**，
即稿把它们画成了一张纸的不同状态。

### 2.1 自我探索：4 个路由 → 1 张稿（证据最直接）

`34-self-assessment.html` 的状态键：`intro` / `questions` / `result` / `review`

现有路由：`/resume/self-assessment/intro`、`/questions`、`/result`、`/history`

状态键和路由段**逐字对应**。稿说这是一张纸。

### 2.2 打印材料检查 + 预览与参数：2 个路由 → 1 张稿

`13-print-desk.html` 的顶栏胶囊文案里同时有：

```
'check-loading'  : '第 2 步 / 共 4 步 · 正在检查'
'check-clean'    : '第 2 步 / 共 4 步 · 检查完成'
'check-flagged'  : '第 2 步 / 共 4 步 · 3 处待裁决'
'preview'        : '第 3 步 / 共 4 步 · 预览与参数'
```

一个文件里既是第 2 步又是第 3 步 —— 稿明确把「材料检查」和「预览与参数」
放在同一张纸上翻状态。代码却是 `/print/material-check`（572 行）
+ `/print/preview`（582 行）两个独立路由。

而且稿写的是**共 4 步**：选文件 → 检查 → 预览 → 确认。代码走到确认要 5 屏。

### 2.3 打印进度 + 完成：2 个路由 → 1 张稿

`15-print-fulfill.html` 的状态：`printing` / `completed` / `out-of-paper` /
`paper-jam` / `partial-output` / `paid-no-output` / `result-unconfirmed` /
`client-status-timeout` / `refund-info`

`printing`（进度）和 `completed`（完成）在同一张纸上。代码是
`/print/progress` + `/print/done` 两个路由。

> 注：这两屏之间用户**不需要操作**（自动推进），所以它不增加「操作步数」，
> 只增加维护面。优先级低于 2.2。

### 2.4 扫描：4 个路由 → 1 张稿

`18-scan-workbench.html` 的状态里同时有 `capture`（采集）、`create-loading` /
`create-ok` / `create-error`（建单）、`cancelling` / `cancelled`、`completed` /
`completed-no-file`（结果）—— 整个扫描生命周期在一张工作台上。

现有路由：`/scan/start`、`/scan/settings`、`/scan/progress`、`/scan/result`。

### 2.5 面试训练：5 个路由 → 1 张稿

`29-interview-training.html` 的状态里同时有 `interview-primary`（面试中）、
`report-loading` / `report-ready` / `report-pending` / `report-unavailable`（单份报告）、
`reports-loading` / `reports-ready` / `reports-empty` / `reports-guest`（报告列表）、
`report-print-*`（报告打印交接）。

现有路由：`/interview/setup`、`/session`、`/report`、`/tips`、`/reports`。

### 2.6 招聘会：~~7 个路由 → 1 张稿~~ —— **本条已撤销**

原判断：稿 `28-jobfair-enhanced.html` 的 7 个状态
（`index` / `loading` / `ready` / `preview` / `qr` / `requested` / `documents-ready`）
对应 `/job-fairs/:id` 的 6 个子路由，可以合成一页。

**2026-09-08 复核后撤销。** 这 7 个状态是**「活动资料申领」这一个子功能的事务状态机**
（浏览资料包 → 生成预览 → 扫码 → 提交申领 → 就绪可取），只对应
`/job-fairs/:id/materials` **一条**路由，不是 7 个子页。

判据是状态名的时序语义：`preview → qr → requested → documents-ready` 是一条
单向事务链，不是并列的信息板块。而 `/map`（展位导览）、`/companies`（参会企业名录）、
`/stats` 是 CLAUDE.md §9A 点名的**独立能力**，是重浏览的信息模块，
在 27 寸竖屏上塞不进同一张工作台，也不该塞。

**教训：用「稿的状态数」推「该合几个路由」，只在状态名与路由段能一一对应时成立**
（第 2.1 条 self-assessment 那种）。状态名是一条事务链时，它描述的是**一个功能的生命周期**，
不是多个功能的合集。这两种情况从状态数上看不出区别，必须读状态名的语义。

## 三、代码自身的重复（与稿无关，纯属堆叠）

### 3.1 报价确认与收银台把「钱」说了两遍

- `/print/confirm` 渲染「打印须知」+ 金额
- `/print/cashier` 渲染「价目明细」+「打印费用」+ 支付方式

两屏连着出现，金额信息重复。稿里 `14-print-confirm` 的流程条写的是
`创建订单 → 完成付款 → 开始打印`，确认屏的职责应当只是**建单**，
价目明细应当只在收银台出现一次。

> 但**不建议合并这两个路由**：`32-cashier` 的返回键写着「返回我的打印订单」，
> 说明稿里收银台是可以从「我的打印订单」单独进入去付一笔旧单的。
> 合并会杀掉这个入口。正确做法是**去重内容**，不是去重路由。

### 3.2 已有先例

`/print/params` 已于 2026-08-18 下线并重定向到 `/print/preview`，
下线理由写在 `routes/index.tsx:225-229`：
「每一个可编辑控件（份数/色彩/双面/方向/缩放/纸张）都和 `/print/preview` 完全重复」。

所以「合并重复页」在本项目是既定做法，不是新提议。

## 四、这违反了项目自己定的验收标准

`CLAUDE.md` §13 第 3 阶段（一体机前台）验收，原文：

> 操作路径不超过 3 步

打印一份文件现在要经过 7 屏才到付款：

```
/  →  /print-scan  →  /print/upload  →  /print/material-check
   →  /print/preview  →  /print/confirm  →  /print/cashier
```

按 2.2 合并后是 6 屏，仍然超。要真正压到 3 步还需要产品裁决
（例如首页直接给「打印文件」而不是先进 `/print-scan` 服务墙）。

## 五、建议执行顺序

按「省下的用户操作次数」排，不按工作量排：

| 序 | 动作 | 省几次点击 | 风险 |
|---|---|---|---|
| 1 | `/print/material-check` + `/print/preview` → 一张打印台（稿 13） | 1 | 低，稿已画好 |
| 2 | `/print/confirm` 去掉重复的价目明细，只留建单 | 0（省认知） | 低 |
| 3 | 自我探索 4 → 1（稿 34） | 2~3 | 低，状态键逐字对应 |
| 4 | 扫描 4 → 1（稿 18） | 2 | 中，涉硬件轮询 |
| 5 | 面试训练 5 → 1（稿 29） | 2 | 中 |
| 6 | `/print/progress` + `/print/done` → 一张交付页（稿 15） | 0 | 低，但 PR #938 已在改这两页，需协调 |

## 六、关于「为什么会交替」

不是设计要交替。青序流光是**一次性整体改版**，51 张稿是一套。
交替是我的迁移方式造成的中间态：我按「一页一个 PR」推进，
所以任何时刻线上都是旧壳 `KioskPageFrame` 和新壳 `QxPageFrame` 混着。

已确认的实际链路（生产 `97a06a8cc`，20 个已迁移路由）：

```
/ 旧 → /print-scan 新 → /print/upload 新 → /print/material-check 新
     → /print/preview 新 → /print/confirm 新
     → /print/cashier 旧 → /print/progress 旧 → /print/done 旧
```

改法：**迁移单位从「一页」改成「一条完整旅程」**，先把打印这条链一次收完，
让用户至少有一条从头到尾统一的路，再开下一条。

---

## 附：无入口死路由盘点（2026-09-08 补，结论是「基本没有」）

产品负责人问「有没有没价值的页面」。除了上面「该合没合」的，另一类是
**根本走不到的路由**。写脚本对全部 78 条活路由扫了一遍
（在 `apps/kiosk/src` 里找 `navigate('/x')` / `to="/x"` / `href="/x"` / `data-route="/x"`）。

初筛报出 9 条无入口。**逐条复核后，8 条是我脚本的误判**，只有 1 条是真的：

| 路由 | 初筛 | 复核结论 |
|---|---|---|
| `/job-fairs/:id/map` | 无入口 | **误判**。模板字面量 `` `/job-fairs/${id}/map` `` 我的正则匹配不到。实有 2 处导航来源 |
| `/job-fairs/:id/materials` | 无入口 | **误判**，实有 2 处 |
| `/job-fairs/:id/visit-plan` | 无入口 | **误判**，实有 4 处 |
| `/job-fairs/:id/stats` | 无入口 | **误判**，实有 2 处 |
| `/job-fairs/:id/companies` | 无入口 | **误判**，实有 3 处 |
| `/job-fairs/:id/companies/:companyId` | 无入口 | **误判**，同上 |
| `/member/qr-login` | 无入口 | **误判**。这是**手机端**深链接，稿 `phone-relay.js:3` 原文：「承接 `/member/qr-login` 与 `/upload/phone` 两条真实 route」。一体机不导航到它是对的 |
| `/upload/phone` | 无入口 | **误判**，同上 |
| `/smart-campus/freshman-insights` | 无入口 | **确认无入口**。全仓只有 `apps/kiosk/tests/visual/fusion-w4.spec.ts` 和 `route-manifest.ts` 用 `page.goto()` 直接进，没有任何页面上的按钮指向它 |

所以：**「多出来的 28 屏」不是死路由造成的，是流程被拆开造成的。**
死路由只有 1 条，且它有测试覆盖（说明是有意保留还是遗漏需要产品确认，不要直接删）。

> 记一笔方法教训：用正则找导航来源，遇到参数路由（`/a/:id/b`）必然大面积误判，
> 因为真实调用是模板字面量。**初筛出来的每一条都必须手工复核**，
> 否则会得出「招聘会 6 个子页全是死路由」这种完全相反的结论。

---

## 附二：合并路由在「公共终端」这个形态下的三条约束（2026-09-08 复核后补）

一体机不是普通网页。把 N 个路由合成「一页 + N 个状态」，在这个形态下有三处
普通 Web 不会遇到的坑。三条都已核对过当前代码，结论写在每条末尾。

### 约束一：重定向必须带状态，裸 `replace` 有害

原计划要求「旧路由一律保留为 `Navigate replace`」。**这条是错的。**

裸的 `<Navigate to="/print/desk" replace />` 会把从 `/print/preview` 深链进来的用户
**静默重置到第 1 步**——用户以为回到了预览，实际参数全丢，比直接报错更难排查。

改为带状态透传：

```tsx
{ path: 'print/material-check', element: <Navigate to="/print/desk?step=check" replace /> },
{ path: 'print/preview',        element: <Navigate to="/print/desk?step=preview" replace /> },
```

并且：**能否进入某阶段仍由真实前置条件决定**。检查没过就不许落到 preview，
带了 `?step=preview` 也不行。URL 是意图，不是授权。

> 一体机没有收藏夹，但有二维码深链接（手机扫码上传 `/upload/phone`、
> 到机码取件 `/member/qr-login`），所以旧地址仍然会被外部持有，不能直接删。

### 约束二：状态必须能从 `sessionStorage` 复水

一体机有看门狗会自动 reload，夜间也有定时刷新。两个路由时靠 URL 记住走到哪；
合成一页后若状态只在 React state 里，**一次刷新就跌回第 1 步**——
用户若已扫码付款，这是死局。

**当前代码这条已经是对的，合并时别改坏：**
`apps/kiosk/src/pages/print/printMaterialSession.ts`（**冻结文件**）已把流程状态写进
`sessionStorage`（`readPrintMaterialSession` / `savePrintMaterialSession` /
`patchPrintMaterialSession`）。合并后的页必须首屏就复水，
并有 E2E 钉死「走到 preview → reload → 仍在 preview」。

### 约束三：换人清场不许改成挂 unmount

多路由天然靠组件销毁做清理；单页多状态若改成手工 `resetState()`，
一旦某个异常分支漏了清理，**下一个排队的人会看到上一个人的文件名 / 姓名 / 手机号**。

**当前代码这条也已经是对的：** 清理是集中式的，走
`apps/kiosk/src/auth/kioskSensitiveSession.ts:33` 的 `clearPrintMaterialSession()`，
不依赖路由 unmount。所以合并路由**不会**引入隐私残留——前提是不许把清理搬到 unmount 上。

### 一条没解决的：排障埋点会失焦

多路由时，远程看板能直接看出用户卡在 `/print/material-check` 还是 `/print/preview`；
合成一个 URL 后就看不出来了。一体机现场没有前端控制台，全靠上报。

**未解决。** 合并时应把阶段名带进上报事件（而不是只报 URL），
否则线上排障成本会上升。这条不阻塞合并，但要在实现时一并处理。
