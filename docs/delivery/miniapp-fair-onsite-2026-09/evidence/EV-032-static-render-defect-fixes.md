# 8 处渲染/可达性缺陷的静态推导与修复（EV-032）

**修订 `0c04cec15` · 2026-09-02 · 源码走查 + `git show` 逐 diff 复核 · local**

## 这条证据成立的范围

这 8 处**全部是纯静态可判定**的：结论只依赖 WXSS 层叠、WXML 条件渲染、
flex 盒模型和「全站引用搜索」，不依赖任何运行时观测。所以本条可以是 PASS。

**但这 8 处修复本身一处都没在渲染环境里看过。** 静态能证明「原来那样写必然错」，
不能证明「现在这样写看起来对」。修完之后未验证的面积**变大了**，没有变小 ——
新增的 CSS 规则、新增的入口磁贴、改过的画布尺寸算式，全部只在源码里成立。

## 发现方式：全部不是门禁报的

**8 处一处都不是自动门禁发现的**，都是人（或子代理）读代码顺着选择器链、
条件链和引用链推出来的。这本身是本轮最有价值的结论：

> `verify-miniapp-static.mjs` 在本修订上跑出 **110 条断言全 PASS**，
> 而这 8 处缺陷当时全部存在。**110 条断言对「渲染类缺陷」是零覆盖。**

它覆盖的是「文件在不在、路由注册没注册、有没有假数据、有没有密钥残留、
报价参数一不一致」这类**可以从字符串匹配判定的事实**；
「这个类有没有被定义过」「这个 flex 子项会不会缩到 max-content」
「这个画布会不会比它的内容盒宽」不在其中。视觉刻度门禁也不管
—— 它只管字号与圆角落不落在令牌刻度上（EV-028 自己写明了这一点）。

## 逐条

| # | 缺陷 | 判定依据（静态） | 修复提交 |
|---|---|---|---|
| 1 | `policy-check` / `job-materials` 卡片内容贴住 1px 边框 | 全局 `.card`（`app.wxss:257`）有 background / radius / border / margin / overflow，**无 padding**；内距在 `.card-inner:270`。这两页所有卡片都用裸 `.card`，内层类也不带 padding | `453f92799` |
| 2 | `policy-check` 加载失败态整块拿不到任何样式 | `.empty-wrap` / `.state-icon` / `.state-title` / `.state-desc` / `.retry-btn` 在 `app.wxss` 与 `policy-check.wxss` **各 grep 0 命中**（已在父修订 `eff92ac9c063` 上复核）。其它页各自在自己的 wxss 里定义同名一套，而页面 wxss 不跨页生效 | `0c04cec15` |
| 3 | `policy-check` 结果页主按钮无配色变体 | `policy-check.wxml:110` 是 `class="btn lg block tap"`。`app.wxss` 的 `.btn` 基类只给 display / height / padding / radius / font / `border:none`，**background 与 color 全在 `.primary` / `.ghost` / `.dark` / `.clay` / `.plum` / `.ghost-ink` / `.wx` 变体里**，这一处一个都没带 | `0c04cec15` |
| 4 | `policy-check` 结果卡 `.r-foot` 断头分隔线 | `.r-foot` 无条件渲染，内部两个 `text` 分别由 `sourceName`（默认 `''`）与 `manualReviewRequired`（默认 `false`）控制，可同时为假；此时 `.r-foot` 的 `border-top + padding-top` 仍占位 | `0c04cec15` |
| 5 | `pages/resume-build` 全站无 UI 入口 | 在父修订上做全仓引用搜索：除自身四件套与 `app.json:26` 注册外，唯一引用是 `ai-records.js:9` 的记录回看路由，而那个列表在成功生成过一次之前是空的 —— 「要先有记录才能进页面，要进页面才能产生记录」 | `f14cd5093` |
| 6 | `self-explore` 雷达画布超出卡片内容盒 | 原式 `windowWidth - 48`，而容器链实际占用 66（`.card` margin 16×2 + border 1×2 + `.card-inner` padding 16×2，三层都是 border-box）。375 / 390 / 393pt 上画布比内容盒宽 13~18px；`.card overflow:hidden` 的裁切线在 `windowWidth-34`，所以不会被裁、不报错、不留痕 | `f14cd5093` |
| 7 | `job-materials` 底栏按钮挤在左侧 | `.jm-bar` 是 `.actionbar`（`display:flex`）的子项却没有 `flex:1`，`flex-basis:auto` 使其按 max-content 定宽；子元素的 `flex:1/2` 只能在这个已经缩过的父容器里分配 | `f14cd5093` |
| 8 | 简历诊断置信度提示重复渲染两个警告框 | `normalize.js` 在 low/medium 时渲染一条完整「识别置信度…」横幅，而提取层（`services/api` `resume-extraction.service.ts` 的 `finalizeText`）对**同一条件**还会再推一条「文字识别置信度有限…」warning，两条讲同一件事 | `9193a6efd` |

第 8 条不在派工书列出的清单里 —— 它是随 `9193a6efd` 一起入库的，
本轮核实 `git diff eff92ac9c063..HEAD -- apps/miniapp/utils/normalize.js` 时查出来的。
补记在此，避免包内出现「改了但没登记」的第二类问题。

## 有意不修的一条：`.ficon` 的 16 个图标没有 mask

同批查证：`app.wxss` 的 `.ficon` 用「`background-color: currentColor` + mask 裁形」
画图标。实测 50 个 `.i-*` 类里 **34 个有 mask、16 个没有**
（`i-briefcase` / `i-check-circle` / `i-clock` / `i-corner-up-left` / `i-credit-card` /
`i-dollar-sign` / `i-heart` / `i-lightbulb` / `i-map` / `i-map-pin` / `i-message-circle` /
`i-navigation` / `i-phone` / `i-share` / `i-tag` / `i-wallet`）。没有 mask 就没有裁剪，
整个 1em×1em 盒子被 `currentColor` 填满 —— 应该是实心方块。

**没有修，因为修法有岔路，静态判不了**：微信 `<text>` 对伪元素的支持与 H5 不同。
若 emoji 兜底（`.ficon.i-*::before { content: "…" }`）能渲染，修法是取消底色让 emoji 露出来；
若不渲染，取消底色会让图标**彻底消失**，修法必须是补 16 个真 mask。两个方向完全相反，
而 `app.json` 注册了 **61 个页面**，改错会让 61 页图标一起消失。
已写成一个只需回答 (a)/(b)/(c) 的问题挂在
`docs/acceptance/miniapp-fair-onsite-visual-spotcheck-2026-09-02.md` §4A-1，
并登记为 RISK-007。

## 本条不能证明什么

1. 不能证明修完之后好看、对齐、间距合理 —— 一处都没渲染过；
2. 不能证明这 8 处是全部 —— 发现手段是人读代码，没有穷尽性；
   同一批还查出 `.navbar .nav-back` 返回键热区 32×32px（低于 `CLAUDE.md §9` 的 48px 下限、
   被 59 页共用）与 `fair-visit-plan` 在 320pt 下按钮切字（RISK-008），
   都因为影响面或需真机定夺而未修；
3. 不能推进 G3 的任何一条。G3 要的是真机、真后端业务闭环、可访问性与性能，
   本条一条都不碰。
