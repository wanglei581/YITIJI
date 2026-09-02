# 微信小程序 Gate 0 决策确认单

> 状态：2026-08-07 用户已确认四项路线决策。本单是正式工程收敛的可执行结论；权威背景为
> `miniprogram-os-architecture-plan-2026-08.md`、`recovered-miniapp-gate0-api-contract-audit-2026-08-06.md`
> 与 `recovered-miniapp-vs-v8-2026-08-06.md`。

## 1. 已确认决策

| # | 决策项 | 结论 |
| --- | --- | --- |
| D1 | 产品定位与名称 | “职易达 · AI 求职与职业生活服务”；若微信后台已注册其他名称，以实际注册名为准，仅同步文档与文案 |
| D2 | Tab 结构 | “首页 / AI百宝箱 / 求职 / 我的”四 Tab（此前已冻结，继续有效） |
| D3 | 技术路线 | 原生微信小程序渐进演进，不迁移 Taro 4；找回源码 `/Users/wanglei/zhiyida-miniapp` 为候选基线，按迁移计划选择性迁入 `apps/miniapp/` 唯一真源 |
| D4 | 首发范围 | M0 可登录壳 + M1 AI 百宝箱核心能力首发；M2 手机下单到一体机打印、JSAPI 支付、订阅消息与跨端权益延后 |
| D5 | 终端履约 | v1 不下单打印，不做“下单时指定终端 / 到机履约 / 支付”；打印与材料包在 M2 重新设计 |
| D6 | 合规边界 | 不提供平台内投递、不向企业收取简历、不做企业筛选/面试邀约/Offer；岗位与招聘会仅作第三方/官方来源信息入口，文案使用“去来源平台投递 / 扫码投递” |

## 2. M0 首发范围

- 微信一键登录 + 短信降级、协议与隐私、会话与公共终端清场。
- 公开岗位 / 招聘会 / 政策来源浏览（线上后端已清理为真实空态，接入真实来源后展示）。
- 订单 / 权益 / 消息 / 反馈本人真实只读闭环（复用既有 `/me` 底座）。

## 3. M1 首发范围

- 规则优先的“今天”下一步引擎；全局小青按端意图路由。
- 简历上传 / OCR / 诊断 / 优化、成果资产与材料页。
- 岗位匹配真实结果页：JD 逐项拆解 + 连续动作（继续优化 / 按岗位模拟面试）；生产 `389f37ff`
  已带 `requirementBreakdown`，真实验收可开始。
- 自我探索 v1 小程序前端适配（复用主仓 25 题五维共享数据、submit/get/withdraw/print API 与本人隔离）。
- 所有 AI 成果必须进入本人简历、文档、报告或后续材料包；不自由生成路由、按钮、外链、支付或打印动作。

## 4. 延后（M2+）

材料包模型与锁定、远程订单 / release / 到机码、JSAPI 支付与退款、订阅消息、位置导航、
微应用与商业运营。M2 启动前单独做 schema / API / 支付文件预算与验证计划。

## 5. 待用户提供 / 确认清单（不阻塞 M0/M1 开发启动）

- [ ] 微信 AppID / 主体 / 类目与隐私声明材料（M0 登录与发布前必须）。
- [ ] 产品名最终确认（若与微信后台注册名不同）。
- [ ] 真实岗位与政策来源及授权（求职 Tab 展示内容；空态保持诚实）。
- [ ] 一份真实简历，用于岗位匹配真实结果页验收。

---

## 6. 变更记录

> 本节由 2026-09-02 的一次逐条代码核对追加。
>
> **上面第 1–5 节是 2026-08-07 的决策原文，一个字都没有改，也不应该改。**决策记录的价值在于「当时定了什么」，
> 改原文等于用今天的实现去洗当时的范围，会让后来的人无法判断某个能力究竟是被批准的还是自己跑出来的。
> 因此已经和实现对不上的条目，一律在这里登记差异，并说明该以什么为准；需要重新授权的，另立决策条目追认，
> 不在原表上改字。
>
> 本节只记录「文档说什么 / 代码是什么」的比对结果，**不代表任何功能已验收、已发布或可上生产**。

### 6.1 D2 —— 第二个 Tab 已更名，四 Tab 结构本身仍然有效

- **原文说什么**：D2 写「首页 / **AI百宝箱** / 求职 / 我的」四 Tab（此前已冻结，继续有效）。
- **现状是什么**：第二个 Tab 的名称是「**职业生活圈**」。四 Tab 的数量、顺序和各自承担的职责没有变，
  变的只是这一个标签文案；更名发生在 2026-08-18 的职业生活圈改版（`a1a771252` / PR #694）。
- **依据**：
  - `apps/miniapp/app.json` 的 `tabBar.list` —— 四项依次为
    `pages/home/home`（首页）、`pages/ai/ai`（**职业生活圈**）、`pages/jobs/jobs`（求职）、`pages/me/me`（我的）；
  - `CLAUDE.md §15` —— 「微信小程序底部导航：首页、职业生活圈、求职、我的（四 Tab）」；
  - `docs/progress/current-progress.md`（材料包守卫一节）记载了该改版的提交与 PR 号。
- **该以什么为准**：以 `apps/miniapp/app.json` 与 `apps/miniapp/scripts/verify-miniapp-static.mjs` 的静态门禁为准。
  D2 冻结的是**四 Tab 结构**，这一点未被推翻；「AI百宝箱」只作为该 Tab 的历史名称阅读。

### 6.2 D5 —— 打印链已越过原范围，材料包链仍守原决策（范围变更，不是笔误）

这一条**只对了一半**，必须分开读。

**（a）打印链：D5 的「不下单打印 / 不指定终端 / 不到机履约」已被实现推翻。**

- **原文说什么**：D5 写「v1 不下单打印，不做『下单时指定终端 / 到机履约 / 支付』；打印与材料包在 M2 重新设计」。
- **现状是什么**：小程序打印链五页已接真实后端，用户可以在小程序内选文件、选终端、建单并拿到真实到机码：
  `print-upload`（服务端页数与报价 + PII 隐私确认闸门）→ `print-preview`（只读复核，不作流程节点）→
  `print-store`（拉真实在线终端列表并选定）→ `print-pay`（建单）→ `print-pickup`（到机码）。
  走的是 **Order-only 路径**：`print-pay.js` 调 `api.createCloudPrintOrder()`，即
  `POST /me/print-orders`，请求体带 `fileId` / `terminalId` / `copies`，响应里取 `pickupCode` 与
  `pickupCodeExpiresAt` 后跳到机码页；服务端未返回到机码即抛错，不本地伪造。
  也就是说：**「下单打印」「下单时指定终端」「到机履约」三项都已经发生**。
- **依据**：
  - `apps/miniapp/pages/print-pay/print-pay.js` —— `createCloudPrintOrder({ fileId, terminalId, copies, colorMode, duplex })`，
    `if (!order || !order.pickupCode) throw new Error('服务端未返回到机码')`；
  - `apps/miniapp/utils/api.js` —— `createCloudPrintOrder()` 打到 `POST /me/print-orders`；
  - `apps/miniapp/pages/print-store/print-store.js` —— 取 `GET /api/v1/terminals/public` 的真实在线终端；
  - `services/api/src/print-jobs/print-jobs.controller.ts` —— `@Post('claim-pickup')` 到机核销端点存在；
  - `apps/miniapp/scripts/verify-miniapp-static.mjs` —— 已有门禁断言「Order-only 建单、不由小程序提交金额/页数」
    「报价与下单的 `colorMode`/`duplex` 必须逐字一致」「到机码不得叫取件码」。
- **仍与 D5 一致的部分**：**支付没有做**。小程序内没有 `wx.requestPayment`，没有 JSAPI 支付；
  当前口径是到机后现场支付，`print-pay` 页只建单不收款。
- **该以什么为准**：以代码与上述静态门禁为准。**建议后续另立一条决策条目，正式追认「小程序云打印 M2 第一片」
  的范围**（下单 + 指定终端 + 到机码，不含手机支付），并在那条新决策里写清授权边界与验收要求。
  **不要回头修改 D5 原文** —— D5 记录的是 2026-08-07 当时批准的范围，打印链是在其后越出该范围的，
  这个先后关系本身是要留档的信息。

**（b）材料包链：D5 的这一半仍然有效，且被代码主动守着。**

- **现状是什么**：材料包四页 `package-create` / `store-select` / `package-confirm` / `package-code`
  虽然在仓库里、也在 `app.json` 注册，但每页 `onLoad` 首行都调 `guardPackageChain()` 直接 fail-closed：
  弹「材料包 · 尚未开放」后 `wx.reLaunch` 回首页，后续 `setData` 一律不执行。
  原因是服务端 `POST /orders/package` 至今不存在，而 `package-code` 会把到机码、订单号、金额全部从 URL query
  读出来渲染 —— 不挡死的话，一条构造出来的深链或一张转发的分享卡片就能显示一张带到机码的「成功页」。
- **依据**：
  - `apps/miniapp/utils/package-feature.js` —— `guardPackageChain()` 及其设计说明；
  - `apps/miniapp/pages/{package-create,store-select,package-confirm,package-code}/*.js` —— 四处 `onLoad` 首行调用；
  - `apps/miniapp/scripts/verify-miniapp-static.mjs`（约 730 行）—— 用正则强制该守卫必须在 `onLoad` 首行，
    并另有三条门禁禁止这四页出现分享入口、默认展开的成功横幅和假数据；
  - `services/api/src/` 排除 `generated/` 后无 `POST /orders/package` 的 controller。
- **该以什么为准**：材料包部分继续按 D5 执行（延后）。服务端下单接口上线时才谈开放，届时删掉
  `utils/package-feature.js` 与四处调用即可，页面业务逻辑不用动。

### 6.3 D4 —— 受 6.1、6.2 两项连带影响

- **原文说什么**：D4 写「M0 可登录壳 + M1 **AI 百宝箱**核心能力首发；M2 手机下单到一体机打印、JSAPI 支付、
  订阅消息与跨端权益延后」。
- **现状是什么**：两处需要折算——
  1. 「AI 百宝箱」是第二个 Tab 的历史名称，现为「职业生活圈」，同 6.1；
  2. 「M2 手机下单到一体机打印……延后」这一句里的**「手机下单到一体机打印」已经先行落地**，同 6.2（a）；
     同句中的 **JSAPI 支付、订阅消息**未见实现（`apps/miniapp/` 内无 `wx.requestPayment`、无订阅消息接线），
     这部分与 D4 一致。
- **依据**：同 6.1、6.2 各条。
- **该以什么为准**：M0/M1/M2 的**阶段划分**仍按 D4 阅读；具体某项能力在不在，以代码和门禁为准，不以 D4 的
  阶段归属推断。追认打印链的新决策条目落地后，D4 的 M2 清单应在那条新决策里同步重述，同样不改 D4 原文。

### 6.4 逐条核对后认为仍然有效、无需变更的条目

以下条目本次逐条看过，未发现与实现冲突，仅附核对依据：

| # | 条目 | 核对结论与依据 |
|---|---|---|
| D1 | 产品定位与名称 | **仍有效。**「职易达 · AI 求职与职业生活服务」在用：`apps/miniapp/package.json` 的 `description` 即此名。D1 本身已写明「若微信后台已注册其他名称，以实际注册名为准」，故不构成冲突。**一处待你确认的观察**：`app.json` 的全局 `window.navigationBarTitleText` 是「AI 求职打印服务」，与产品名不一致；它是壳层默认标题、可被各页覆盖，本次不当作决策冲突登记，但若微信后台注册名已定，建议一并对齐 |
| D3 | 技术路线 | **仍有效，且已被实现证实。**`apps/miniapp/` 为原生微信小程序：`package.json` 无 `dependencies`、`main` 为 `app.js`、无构建 script；`scripts/verify-miniapp-static.mjs` 断言运行时依赖必须为空。找回源码 `/Users/wanglei/zhiyida-miniapp` 目录仍在，可继续作为选择性迁移资产。**注意反向问题**：`docs/product/miniprogram-os-architecture-plan-2026-08.md` 的 §11.1 与 §2.3 工程归位表仍写 Taro 4，那是被 D3 否决的方案候选，已于 2026-09-02 在该文加失效声明与就地失效注 |
| D6 | 合规边界 | **仍有效。**`apps/miniapp/pages` 与 `utils` 全量扫描未出现「一键投递 / 立即投递 / 平台投递」；`pages/job-detail/job-detail.wxml` 明写「岗位信息来自第三方来源……本终端不提供平台内投递服务」。**一处措辞说明（非违规）**：D6 举例的按钮文案「去来源平台投递 / 扫码投递」在当前页面里并非逐字出现，实际用的是更保守的表述（如招聘会参会企业页用「复制来源链接」）—— 依 `pages/fair-company-detail/fair-company-detail.js` 的代码注释，该页并无可投递的来源链接，写「去来源平台投递」会承诺一个并不存在的动作。这是收紧不是放宽，按 D6 边界读仍然成立 |

### 6.5 「待用户提供 / 确认清单」核对

**四项复选框本次不勾选**——它们要的是你的确认或外部材料，不是仓库里能证明的东西。仅登记仓库侧观察：

| 清单项 | 仓库侧观察与依据 | 说明 |
|---|---|---|
| 微信 AppID / 主体 / 类目与隐私声明材料 | `apps/miniapp/project.config.json` 中 `appid` 为 `wxe9ba99a3a311c7df`，即工程已配置一个正式 AppID | 仅证明工程里配了 AppID；**主体、类目、隐私声明材料在仓库内无从查证**，该项整体仍待你提供 |
| 产品名最终确认 | 同 6.4 的 D1 行：`package.json` 用「职易达 · AI 求职与职业生活服务」，`app.json` 壳层标题为「AI 求职打印服务」 | 两者不一致，最终以微信后台注册名为准，仍待确认 |
| 真实岗位与政策来源及授权 | `docs/progress/current-progress.md` 记载 2026-08-07 生产内容下架后，公网 `/api/v1/jobs`、`/api/v1/job-fairs`、`/api/v1/policies` 均为空 | 空态是当前的诚实状态，不是缺陷；来源与授权仍待提供 |
| 一份真实简历（岗位匹配结果页验收用） | 仓库内无相关证据 | 仍待提供 |

