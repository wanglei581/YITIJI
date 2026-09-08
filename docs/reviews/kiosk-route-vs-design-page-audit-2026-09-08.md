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

### 2.6 招聘会：7 个路由 → 1 张稿

`28-jobfair-enhanced.html` 的状态：`index` / `loading` / `ready` / `preview` /
`qr` / `requested` / `documents-ready`。

现有路由：`/job-fairs/:id`、`/companies`、`/companies/:companyId`、`/map`、
`/materials`、`/visit-plan`、`/stats`。

> 这条要谨慎：招聘会子页里「展位导览图」「参会企业名录」是 CLAUDE.md §9A
> 点名的能力，合并时不能丢；稿把它们做成同一页内的分区而不是独立路由。
> **需要逐个核对稿内是否真有对应分区**，不能照数字直接砍。

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
| 6 | 招聘会 7 → 1（稿 28） | 3 | **高**，须逐分区核对 §9A 能力不丢 |
| 7 | `/print/progress` + `/print/done` → 一张交付页（稿 15） | 0 | 低，但 PR #938 已在改这两页，需协调 |

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
