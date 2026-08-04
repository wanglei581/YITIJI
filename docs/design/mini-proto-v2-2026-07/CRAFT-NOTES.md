# 小程序 premium 改版 · Craft 决策记录

> **状态：设计打磨记录（2026-07）。** 记录小程序 v2「premium 改版」三轮「去模板化」的视觉 craft 决策与**约束边界**，供后续接手者理解「为什么这样、什么不能动」。
> 适用范围：微信小程序（`~/WeChatProjects/zhiyida`，warm inkpaper 暖纸调 + teal 品牌 + plum AI 分类）。不覆盖 Kiosk/Admin/Partner 三端。
> 合规硬约束仍以 `docs/compliance/` 为准；本文只谈视觉 craft，不谈合规与业务逻辑。
> 上位设计语言见 [inkpaper-design-language.md](../inkpaper-design-language.md) 的色彩令牌与「零 AI 味」原则。

## 0. 源码与预览的关系（先读这条）

- **真源码 = `~/WeChatProjects/zhiyida`**（微信开发者工具默认位置，**不在本 git 仓库**）。三轮改动都落在这里的 `app.wxss` + 各页 `pages/*/*.wxss` / `*.wxml`。
- **预览 = `mini-preview-premium.html` + `.css`**：由 `build-mini-preview.js` 从真源码**动态拼装** CSS（`app.wxss` + 各页 wxss 顺序拼接），HTML 手写。改样式后必须 `node build-mini-preview.js` 重新构建预览才同步。
- 因此仓库内的 `.css` 是**快照**，不是源。要改视觉，改 `~/WeChatProjects/zhiyida` 源码，再重建。

## 1. 三轮做了什么（What）

**第一轮 · 去彩虹 + 结构**
- 首页磁贴、打印路径、我的入口 6 图标：多色 → **墨色单色**。
- AI 工具 6 块：杂色 → 统一 **plum 紫调**，与「小青」助手卡同色相，整个 AI 区共用一个身份色。
- Hero 刊头化：品牌行下压发丝分割线（masthead 感）；问候语 27→29px。
- 精选卡加 kicker 短横 rule（报刊栏目标签手感）。
- 卡片扁平化：厚投影 → 发丝描边 + 极淡墨影；唯 hero 上的精选卡保留提升阴影。8 栅格对齐 16/24 节拍。

**第二轮 · 字形可控化**
- 匹配标签 `◈` 字符 → CSS `::before` 圆点（5px，`background: currentColor` 自动跟随 high/mid/low 文字色）。见 `.job-card .jc-match::before`。
- 导航箭头 `›` 统一 **16px + ghost 色**（原 print 20px / row 16px 不齐）。
- `page` 基础 `line-height: 1.6`（原本无设定，多行中文继承 ~1.2 偏挤）。

**第三轮 · 标题字距系统化**
- 页面级 serif 标题补字距：`ph-title` 22px → `+.5px`；`ch-title`/`jc-title`/`fc-title` 15–16px → `+.3px`（对齐首页 feat-title .5px / section-title .8px 的既有节拍）。

## 2. 约束边界（What NOT to do —— 最重要）

以下是「看起来该改、实际不能动」的判断，改了就是退步：

| 约束 | 为什么 |
|---|---|
| **数字类 serif 不加字距** | 价格 `.price` / 评分 `.score-ring .sr-val` / 薪资 `.jc-salary` / 取件码 `.pickup-code` 保持紧凑。字距会伤数字组的可读性与对齐。取件码的 8px 大间距是刻意特例，非通用规则。 |
| **导航入口图标一律单色** | 色相只留给**有意义**处：AI 分区身份色（plum）、匹配度 high/mid/low 语义色、青色操作 affordance。导航入口用彩色 = 廉价「模板 App」感的最大来源。 |
| **AI 区用 plum 不违反「零 AI 味」** | 设计语言里 plum 本就指派为「AI/权益」**功能分类色**；「零 AI 味」禁的是**紫蓝渐变 / 霓虹光晕 / 玻璃拟态堆叠**，不是实色分类。plum 实色平铺是合规的。 |
| **图标不需要「统一描边」** | 全部图标是**同一套 Ant Design Outlined**，CSS mask 渲染（见 app.wxss `.ficon`），共享同一设计网格，描边天生一致。不存在粗细不齐问题。 |
| **`.chip` 内边距不动** | 24px 高 / 11.5px 字 / 10px 横向 padding，CJK 节拍已稳。 |

## 3. 尚未验证（真机才有意义）

浏览器预览验证到此为止，以下必须上真机 / 模拟器：
- Songti（宋体）在真机 iOS / Android 的**字重差异**与 fallback（`--font-serif: 'Songti SC', STSong, serif`）。
- `-webkit-font-smoothing: antialiased` 的实际效果。
- 点按 / 入场动效在真机的流畅度。

## 4. 关键选择器速查

| 关注点 | 选择器 · 文件 |
|---|---|
| 匹配度圆点 | `.job-card .jc-match::before` · app.wxss |
| 正文行高基线 | `page { line-height: 1.6 }` · app.wxss |
| 导航箭头 | `.pc-arrow`(print.wxss) / `.r-arrow`(app.wxss)，均 16px |
| serif 标题字距 | `.ph-title` / `.ch-title` / `.jc-title` / `.fc-title` · app.wxss |
| 色彩令牌 | app.wxss `page{}` 顶部（plum/teal/clay/wheat/slate） |
| 图标系统 | `.ficon` + `.i-*`（Ant Design Outlined via mask）· app.wxss |

