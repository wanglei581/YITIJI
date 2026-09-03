# 青序流光 · Kiosk 前台设计令牌文档（Phase 2 · 简历域 F01–F03）

> **交付对象**：原型构建师（筑原型）。本文件是 F01 AI简历诊断（3 屏）、F02 AI简历优化（3 屏）、F03 导出与打印（1 屏）的**唯一令牌施工依据**。
> **地位**：本文件所有调色板、字阶、圆角、间距、动效参数**直接继承** `kimi-full-coverage-v2/design-system/kiosk-tokens.css`（第 0 批冻结候选），不得另起一套。本文件只做两件事：① 把冻结令牌整理成「可写 CSS 的程度」并补对比度核验；② 增补简历域专属组件（步骤指示器 / 左右对照 / 逐条裁决 / 上传区）。
> **硬约束来源**：`DESIGN-PLAN.md`（密度红线、合规内建）、`DESIGN-SYSTEM.md`（结构铁律、状态规范、合规白名单）、`MOTION-SPEC.md`（动效真源）。

---

## 0. 风格参照与继承声明（一句话）

本方向（米纸底 + 深墨绿 + 朱砂、克制留白、公共服务感）气质最对齐 **Notion（克制·纸张感·温暖中性）× Apple（公共服务信任·清晰层级）**，并参照 GOV.UK 式信息克制；但项目已沉淀自定义「青序流光」体系（冻结令牌），本文档**直接继承该体系，不再选型**。

> **颜色角色映射（关键澄清，避免误用）**：
> - 「深墨绿 = 主色/正文/标题」→ 冻结令牌 `--ink #10302b`（用于正文、标题、主按钮底色）。
> - 「翡翠绿 = 交互/强调/选中态」→ 在**浅色前台屏**上即冻结令牌 `--teal #1f9e86`（可见的绿、选中/已验证/主动作）；明亮的 `--emerald #2ee6a8` **仅用于深色小青区高光**，放在米纸上对比度仅 1.4:1，**严禁**作浅屏按钮/文字。
> - 「朱砂 = 警示/关键动作点缀」→ 冻结令牌 `--cinnabar #b23a2e`，**仅用于不可逆确认（删除/清空/离场）与失败态**，克制使用。

---

## 1. Visual Theme（视觉主题）

```markdown
## 1. Visual Theme
**Philosophy**: 公共终端的克制与可信——像政务/银行柜台一样清楚每一步能拿走什么，而非炫技科技感。
**Direction**: warm-paper, restrained, public-service, high-legibility touch
**Personality**: 温暖、可信赖、安静、确定（calm & certain）
**Reference**: Notion（纸张感）× Apple（公共信任）× GOV.UK（信息克制）；落地为自定义「青序流光」
```

---

## 2. Color Palette（色彩令牌 · 含对比度核验）

### 2.1 调色板（冻结值，逐色 hex + OKLCh + 角色）

| Token | HEX | OKLCh | 角色 / 用法 |
|-------|-----|-------|------------|
| `--paper` | #f5f2e9 | oklch(94% 0.017 95) | 米纸底·页面主背景（暖白纸张感） |
| `--surface` | #fffdf8 | oklch(99% 0.006 95) | 卡面·区块背景（比 paper 更纯的纸） |
| `--ink` | #10302b | oklch(29% 0.04 165) | 深墨绿·主文字/标题/主按钮底色 |
| `--muted` | #5d6b63 | oklch(50% 0.018 155) | 辅助文字·元信息 |
| `--line` | #e3ddcb | oklch(88% 0.022 95) | 分隔线·1px 描边（暖调，非黑） |
| `--ink-soft` | #eae7dc | oklch(91% 0.013 95) | 浅墨绿底·禁用态/状态块底/进度槽 |
| `--deep` | #0b241e | oklch(22% 0.035 165) | 深色小青区底色 |
| `--emerald` | #2ee6a8 | oklch(85% 0.16 165) | 深色区高光（仅深色区，禁上浅屏） |
| `--teal` | #1f9e86 | oklch(62% 0.10 165) | 翡翠绿（浅屏交互/强调/选中/已验证） |
| `--teal-deep` | #157a67 | oklch(53% 0.09 165) | teal 文字/描边（对比不足时用） |
| `--teal-soft` | #e0f1ea | oklch(92% 0.04 165) | teal 浅底（选中态淡底/图标容器） |
| `--slate` | #3f68b0 | oklch(52% 0.10 255) | 第三方与官方来源（去来源平台/扫码） |
| `--slate-deep` | #35608f | oklch(46% 0.09 255) | slate 文字/按钮底（白字可达 AAA） |
| `--slate-soft` | #e6edf5 | oklch(92% 0.03 255) | 来源条浅底 |
| `--clay` | #b8683c | oklch(55% 0.10 55) | 待核实/付费相关（打印费/支付） |
| `--clay-deep` | #9e5330 | oklch(47% 0.10 55) | clay 文字/按钮底 |
| `--clay-soft` | #f5e9de | oklch(91% 0.04 60) | clay 浅底 |
| `--plum` | #7a5a86 | oklch(52% 0.09 320) | 会员/权益（非 Phase 2 重点，备用） |
| `--wheat` | #a9781f | oklch(58% 0.10 80) | 提醒/注意（warning 语义） |
| `--wheat-deep` | #8a6219 | oklch(49% 0.10 80) | wheat 文字/禁用原因（AA 可达） |
| `--sage` | #4d7a6a | oklch(52% 0.04 160) | 次要辅助（保留态/中性） |
| `--sage-deep` | #3c6355 | oklch(45% 0.04 160) | sage 文字 |
| `--cinnabar` | #b23a2e | oklch(47% 0.16 30) | 朱砂·不可逆确认/失败态（克制） |
| `--cinnabar-deep` | #963227 | oklch(40% 0.15 30) | cinnabar 文字/按钮底（白字 AAA） |
| `--cinnabar-soft` | #f6e4e1 | oklch(91% 0.04 30) | cinnabar 浅底（失败态图标容器） |

### 2.2 语义色角色映射（简历域语义 → 冻结令牌）

| 语义 | 浅屏用令牌 | 说明 |
|------|-----------|------|
| 主文字 / 标题 | `--ink` | 所有正文、区块标题、小青问句 |
| 交互 / 强调 / 选中 | `--teal` / `--teal-soft` | 主动作、已选步骤、采纳态、进度填充 |
| 第三方/官方来源 | `--slate` / `--slate-soft` | 岗位/招聘会入口、去来源平台/扫码 |
| 付费 / 打印费 | `--clay` | F03 打印计费、支付态 |
| 提醒 / 注意 | `--wheat` | 禁用原因、温和提示 |
| 次要 / 保留态 | `--sage` | 逐条裁决「保留」中性态 |
| 不可逆 / 失败 | `--cinnabar` | F03 结束并清空、删除、失败态 |
| 成功 / 已验证 | `--teal`（同交互绿） | 导出成功、诊断已完成 |
| 深色区高光 | `--emerald` | 仅小青意图区（.k-xiaoqing） |

### 2.3 27 寸竖屏对比度与可读性核验（WCAG AA）

> 物理屏 27″ 竖屏 × CSS 坐标 1080×1920（`#stage` 整体 transform 缩放适配），站立视距约 0.6–1m。依据：正文 ≥19px、任意文字 ≥15px、主按钮字 ≥22px（冻结硬约束）；对比度按 AA（正文 4.5:1 / 大文字 3.0:1）核验。

| 前景 → 背景 | 比值 | 结论 | 用法限制 |
|------------|------|------|---------|
| `--ink` → `--paper` | ≈13:1 | ✅ AAA | 标题/正文任意字号 |
| `--muted` → `--paper` | ≈5.4:1 | ✅ AA | 辅助文字（≥15px） |
| `--teal` → `--paper` | ≈3.4:1 | ⚠ 仅大文字/UI | 不作小正文；作填充/选中态 |
| 白字 → `--teal` | ≈3.3:1 | ✅ 大文字 AA | 仅 22px/700 主按钮（满足「大文字」） |
| `--emerald` → `--paper` | ≈1.4:1 | ❌ 禁用 | 仅深色小青区 |
| `--slate` → `--paper` | ≈4.0:1 | ⚠ 临界 | 浅屏尽量用 `--slate-deep` 作文字 |
| 白字 → `--slate-deep` | ≈6.5:1 | ✅ AAA | 来源按钮底 |
| `--clay` → `--paper` | ≈3.6:1 | ⚠ 仅大文字 | 付费标签用 `--clay-deep` 文字 |
| 白字 → `--clay-deep` | ≈5.0:1 | ✅ AA | 支付/打印费按钮 |
| `--cinnabar` → `--paper` | ≈4.3:1 | ✅ AA（临界） | 失败态文字可用 `--cinnabar-deep` 更稳 |
| 白字 → `--cinnabar-deep` | ≈6.5:1 | ✅ AAA | 朱砂危险按钮 |
| `--wheat` → `--paper` | ≈3.0:1 | ⚠ 仅大文字 | 提示文字用 `--wheat-deep` |
| `--sage` → `--paper` | ≈4.2:1 | ✅ AA | 保留态文字 |

**要点**：浅屏上所有「绿/来源/付费」按钮一律用其 `--*-deep` 作底 + 白字（稳过 AA）；`--teal` 作浅屏交互绿时，凡涉及小字号文字一律改用 `--teal-deep` 或配 `--teal-soft` 浅底 + `--ink` 文字。

---

## 3. Typography（排版令牌）

### 3.1 字体族（中文系统无衬线优先；标题用衬线宋体）

```css
--serif: 'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',serif;   /* 小青问句/标题 */
--sans:  'PingFang SC','Microsoft YaHei',system-ui,sans-serif;               /* 正文/UI */
```

- 零外部资源：不引 CDN 字体（与 `DESIGN-SYSTEM.md §7` 一致），全部依赖系统字体栈。
- 拉丁数字/价格用等宽对齐：`font-variant-numeric: tabular-nums`（倒计时、金额不跳动）。

### 3.2 字阶（px 为冻结真值；rem 以 `:root{font-size:16px}` 为根换算，仅供需要时引用）

| 等级 | Token | px | rem@16 | 字重 | 行高 | 用法 |
|------|-------|----|--------|------|------|------|
| 小青问句（主标题/唯一问句） | `--fs-display` | 42 | 2.625 | 700/900 | 1.25 | 每屏 **唯一** 主问句（.k-xiaoqing .q） |
| 区块标题 | `--fs-title` | 29 | 1.8125 | 700 | 1.3 | ≤3 区块的 h2 |
| 关键数字/价格/结果 | `--fs-key` | 26 | 1.625 | 900 | 1.2 | 诊断分档、费用、页数 |
| 主按钮/强调正文 | `--fs-primary` | 22 | 1.375 | 700 | 1.4 | 主按钮字、卡片主名 |
| 正文 | `--fs-body` | 19 | 1.1875 | 400 | 1.6 | 段落、说明（硬下限 19px） |
| 辅助说明 | `--fs-meta` | 17 | 1.0625 | 400 | 1.5 | 元信息、hint、禁用原因 |
| 最小合法文字 | `--fs-micro` | 15 | 0.9375 | 500 | 1.4 | 来源信息、标签（硬下限 15px） |

> 标题字距：`letter-spacing: 1–2px`（中文标题用宋体，留白更透气）；正文 `letter-spacing: 0`（中文不拉字距）。

### 3.3 字重

```css
--fw-regular:400; --fw-medium:500; --fw-bold:700; --fw-black:900;
```

---

## 4. Component Styles（组件规范）

> 下列组件类均已在 `kiosk-components.css` 定义（.k-topbar / .k-xiaoqing / .k-sec / .k-card / .k-entry / .k-btn / .k-cta-bar / .k-navbar / .k-tag / .k-source-meta / .k-state / .k-progress / .k-steps / .k-overlay / .k-sheet）。**简历域新增类见 §10 附录 CSS**，本节约定用法与红线。

### 4.1 按钮（主/次/危险/幽灵 · 触控 ≥48–56px · 含朱砂主 CTA 示例）

| 种类 | 类 | 底 | 字 | 圆角 | 最小高 | 用法 |
|------|----|----|----|------|--------|------|
| 主 CTA | `.k-btn[data-kind="primary"]` | `linear-gradient(145deg,#2fbf97,var(--teal))` | #fff 22px/700 | pill(999) | 56px | 每屏唯一主动作（上传/去优化/导出PDF） |
| 次按钮 | `.k-btn[data-kind="secondary"]` | `--surface` + 1.5px `--line` | `--ink` | pill | 56px | 次级肯定（预览/返回上一步） |
| 幽灵 | `.k-btn[data-kind="ghost"]` | transparent | `--teal-deep` | pill | 48px | 稍后/跳过/查看示例 |
| **朱砂主 CTA** | `.k-btn[data-kind="danger"]` | `var(--cinnabar)` | #fff 22px/700 | pill | 56px | **仅不可逆确认**（F03 结束并清空） |

- 禁区：每屏 `.k-cta-bar` 内**至多 1 个** `primary` 或 `danger`；其余动作降级为 `secondary`/`ghost` 或收进区块内次级。
- 禁用态：`aria-disabled="true"` + `.k-disabled-reason` 原因文字常驻（不只改灰）。
- 触控反馈：`:active{transform:scale(.98)}`，120ms（见 §9 动效）。

### 4.2 卡片 / 入口卡

- `.k-card`：`--surface` 底 + 1px `--line` 描边 + `--r-card`(22px) + padding 28px；**默认无投影**（公共服务感偏扁平描边）。
- `.k-entry`（可选中/可点入口，如上传通道、优化项）：高 ≥120px，左侧 72px 圆角图标容器（tone 可选 teal/slate/clay/plum/wheat/sage），右侧 名称(--fs-primary/700) + 描述(--fs-body/muted)。

### 4.3 步骤指示器（简历三幕式 stepper · 新增 `.k-stepper`）

- 横排 3 步（F01：引导→报告→建议；F02：待优化→改写→对比；F03 单屏无需）。
- 当前步：`--teal` 实心圆 + `--ink` 标签；已完成：`--teal` ✓；未达：`--ink-soft` 圆 + `--muted` 标签；连接线 已完成段 `--teal`、未达段 `--line`。
- 每步触控 ≥48px（可点击跳转至已完成步）。详见 §10 CSS。

### 4.4 上传区 / 拖拽区（新增 `.k-dropzone`）

- 虚线 2px `--line`（激活态改 `--teal`）+ `--r-card`(22px) + 内距 32px；含 `file-user` 图标(48) + 主提示(--fs-primary) + 副提示(--fs-meta)。
- 激活/拖入：底 `--teal-soft`、边框 `--teal`；放下后变 `.k-entry` 卡片。

### 4.5 左右对照（before/after compare · 新增 `.k-compare`）

- 两栏等宽：左「原文」=`--ink-soft` 底 + `--muted` 文字 + 左标「原文」；右「改版」=`--surface` 底 + 左缘 4px `--teal` 实线强调 + 左标「AI 改版」。
- 变更行底色 `--teal-soft`；两栏同步滚动。F02c 预览对比用。

### 4.6 逐条裁决三态（采纳/保留/自己写 · 新增 `.k-verdict`）

| 动作 | 态 | 样式 |
|------|----|------|
| 采纳 | positive | `var(--teal)` 底 + #fff 字（22px/700） |
| 保留 | neutral | `--surface` + 1.5px `--line` + `--ink` 字 |
| 自己写 | ghost | transparent + `--teal-deep` 字（跳转编辑输入） |

- 三按钮同栏、等宽、最小高 56px；选中态加 `--teal` 1px 描边 + `--teal-soft` 底。F02b/c 用。

### 4.7 证据图例（E1/E2/E3 · 常驻图例）

| 证据级 | 含义 | 色点 | 文字色 |
|--------|------|------|--------|
| E1 | 原文依据 | `--ink` 圆点 | `--ink` |
| E2 | 本机数据 | `--teal` 圆点 | `--teal-deep` |
| E3 | AI 推断 | `--slate` 圆点 | `--slate-deep` |

- 常驻于 F02 改写/对比屏底部一行（`.k-evidence-legend`），不随滚动消失（进 `.k-cta-bar` 上方常驻条或吸底）。

### 4.8 标签 / 来源条（合规三要素）

- `.k-tag`：高 40px、radius 12px、`--fs-meta`；tone 复用 teal/slate/clay/wheat。
- `.k-source-meta`（岗位/招聘会卡必渲染）：`来源名称 · 同步时间 · 外部链接/说明`，`--slate-soft` 底 + `--slate-deep` 字 + `--fs-micro`。**缺三要素即违规**。

### 4.9 输入 / 编辑区

- 高度 56px（触控）、1px `--line` 描边、`--r-sm`(16px)、padding 0 20px、`--surface` 底、`--fs-body` 字、`--ink` 文本；placeholder `--muted`。
- 聚焦：描边 `--teal` + `box-shadow:0 0 0 3px var(--teal-soft)`（翡翠绿聚焦环）。
- 错误：描边 `--cinnabar` + 下方 `--cinnabar-deep` 原因文字（`.k-disabled-reason` 同款样式）。

### 4.10 状态块（空 / 加载 / 失败 / 成功 · 复用 `.k-state`）

- 空态：诚实说明 + 一个去向动作；**不画假数据/假图位**。
- 加载：**禁循环 spinner**；用 `.k-progress` 确定性进度条或 `.k-steps` 步骤点；无真实进度给阶段文字。
- 失败：`[data-kind="error"]` 用 `--cinnabar-soft` 图标容器；说清原因 + 重试/求助出口（带 `data-testid="<screen>-fallback"`）。
- 成功：✓ 图标(--teal) scale(.6)→1，240ms。

### 4.11 结构铁律（每屏固定骨架，见 `DESIGN-SYSTEM.md §1–2`）

```
#viewport > #stage(1080×1920, 永不溢出)
  ├ .k-topbar        (返回 / 品牌 / 状态胶囊 / 时钟)   高 92px 常驻
  ├ .k-xiaoqing      (≤1 问句, 深色渐变+呼吸光环)      常驻
  ├ .k-scroll        (唯一中部滚动区; 短内容可省)       弹性 1
  │    ├ .k-sec ×≤3  (编号+标题+右hint)
  │    └ ...卡片/列表/对照/裁决
  ├ .k-cta-bar       (≤1 主操作, 常驻不进滚动区)       高 96px
  └ .k-navbar        (首页/问小青/我的, 三 Tab 固定)    高 132px
```
- 主操作**无需滚动即可触达**；底部三 Tab 固定，不加第四个。
- 每屏可点元素 ≤20（不含底栏）；任意可点 ≥48px。

---

## 5. Layout（间距与栅格 · 8pt 基准）

### 5.1 间距刻度（8pt 体系，冻结已有 `--gap-card:24px` / `--pad-x:48px`，补全全刻度）

```css
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
--space-6: 24px;  --space-8: 32px;  --space-12: 48px; --space-16: 64px;
```
- 区块间距：`.k-sec` 上距 28px（≈`--space-8` 微调）；卡片间距 `--gap-card:24px`。
- 卡片内边距 28px；控件间距 `--space-4`(16)；紧邻元素 `--space-2`(8)。

### 5.2 竖屏安全边距与容器

```css
--stage-w:1080px; --stage-h:1920px;   /* CSS 坐标, 整体缩放适配物理屏 */
--pad-x:48px;        /* 左右安全边距(已冻结) */
--topbar-h:92px; --navbar-h:132px; --cta-h:96px;
```
- 内容列宽：文字密集屏（F01 报告、F02 对比）正文 `max-width:640px` 居中阅读；动作屏可放宽至 ≤960px。
- 顶部/底部常驻栏之外，内容区 `padding:0 var(--pad-x)`。

### 5.3 单列信息密度

- F01/F02/F03 全部**单列为主**；区块内如需并列（如 F02c 左右对照、F02b 三态按钮）才用 2–3 栏，栏间隙 `--space-4`。
- 下半屏不留白：内容不足时用 `.k-scroll` 弹性或 `margin-top:auto` 把 CTA 条顶到底（结构铁律）。

---

## 6. Depth & Elevation（圆角 / 阴影 / 层级）

### 6.1 圆角尺度

```css
--r-xs:10px;   /* 区块编号徽标、小标签 */
--r-sm:16px;   /* 输入框、返回键、来源条 */
--r-md:20px;   /* 入口卡图标容器、二维码 */
--r-card:22px; /* 标准卡片(冻结) */
--r-paper:30px;/* 大卡片/页面块/小青区/浮层(冻结) */
--r-pill:999px;/* 胶囊/主按钮/状态胶囊(冻结) */
```
- 按钮统一 pill（冻结 `.k-btn` border-radius:var(--r-pill)）。无零圆角。

### 6.2 阴影与描边（克制 · 公共服务感偏扁平）

```css
--shadow-none:   none;                       /* 默认卡面: 1px --line 描边即可 */
--shadow-sm:     0 2px 10px rgba(11,36,30,.06);   /* 卡片悬浮/选中 */
--shadow-md:     0 4px 16px rgba(11,36,30,.08);   /* 浮层 .k-sheet */
--shadow-overlay:0 8px 30px rgba(11,36,30,.12);   /* 全屏覆盖 .k-overlay */
```
- 默认表面**无投影 + 1px 暖描边**（`--line`）；仅悬浮/选中/浮层用低透明度墨绿调阴影（非黑、非重）。
- 阶段背景用 `#stage` 双 radial-gradient 微弱晕染（teal 7% / clay 5%），不放装饰插画。

### 6.3 Z-index 层叠

```css
--z-base:0; --z-sticky:200; --z-sheet:50; --z-overlay:300; --z-toast:400;
```
- 顶栏/底栏/CTA 条在滚动区外常驻（不依赖 z-index）；浮层 `.k-overlay`(50) 覆盖内容，`.k-sheet`(同层) 居中。

---

## 7. Cautions（反模式 + 合规禁区）

### Never Do（设计反模式）
- ❌ 每屏超过 1 个问句 / 超过 3 个区块 / 超过 1 个主操作。
- ❌ 文字墙：区块说明 >2 行不拆、区块内 >6 行不拆屏。
- ❌ 用 `--emerald` 作浅屏按钮/文字（对比 1.4:1，不可读）。
- ❌ 循环 spinner 伪造进度；用 setTimeout 伪造「已打印/已支付/已清除」。
- ❌ 灰块假图位、假数据、假「已完成」；无真实数据/接口时画诚实空态。
- ❌ 重投影 / 2–3px 粗黑描边（破坏公共服务扁平感）。
- ❌ 页内硬编码 px 颜色/字号（必须引令牌变量）。

### 合规禁区（每屏自检，来自 `DESIGN-SYSTEM.md §6`）
- ❌ 岗位/招聘会 CTA 出现：**一键投递 / 立即投递 / 平台投递**。
- ✅ 白名单仅：`查看岗位` `去来源平台投递` `扫码投递` `查看招聘会` `去来源平台预约` `扫码预约`。
- ❌ 招聘闭环（本机不代收简历、不代办、不收费）；岗位/招聘会仅第三方/官方来源入口。
- ✅ 来源卡必渲染 `.k-source-meta`（来源·同步时间·链接）。
- ✅ 匹配只给三档（较高/中等/偏低），**禁百分比**；条件核对写「确定性比对」不写「AI 判定」。
- ✅ 朱砂 `--cinnabar` 只给不可逆确认（删除/清空/离场）。
- ✅ 诚实声明（「本机不代收简历」等）不得为压字数删除。

---

## 8. Responsive Behavior（响应式：27″竖屏 + 手机/桌面）

| 视口 | 行为 |
|------|------|
| Kiosk 27″竖屏（基准） | `#stage` 1080×1920 居中，`transform:scale()` 适配物理屏；触控交互，禁用 hover 依赖 |
| 手机 (<640px) | 同套令牌；`--pad-x` 降到 20px，`--fs-display` 降到 32px，按钮全宽，三态/对照改纵向堆叠 |
| 桌面 (>1024px) | 同套令牌；`#stage` 等比缩放居中，留侧边深墨绿底（`body{background:#181b19}` 已定） |

- **一套令牌通吃**：不另起配色；仅断点微调 `--pad-x` / `--fs-display` / 栅格列数。
- 触控优先：所有可点 ≥48px、主按钮 ≥56px 在所有断点不变。
- `prefers-reduced-motion` 与 `?flat=1` 全局静态降级（见 §9）。

---

## 9. Agent Prompt Guide（图标 + 动效 + 密度红线落地）

### 9.1 图标规范（lucide-react 线性 SVG）
- 体系：lucide 线性 SVG，**stroke 1.9–2.4px**（项目统一，取 2px 名义值），`fill:none`，`stroke:currentColor`（随令牌）。
- 档位：`--icon-sm:24px` / `--icon-md:32px` / `--icon-lg:48px`（glyph 尺寸；容器见 `.k-entry` 72px / `.k-state` 96px）。
- 颜色：默认 `--ink`；激活/选中 `--teal-deep`；警示 `--cinnabar-deep`；来源 `--slate-deep`。
- **Phase 2 批准图标集**（禁止单字图标/随机插画）：
  `file-user`（简历）· `printer-check`（打印/导出）· `briefcase-business`（岗位）· `calendar-check`（招聘会/预约）· `messages-square`（小青/建议）· `scroll-document`（材料/报告）· `graduation-cap`（求职/学习）。

### 9.2 动效原则（克制 · 仅状态语言，非装饰）
- 全站参数（冻结）：`--dur-instant:120ms` `--dur-quick:240ms` `--dur-page:480ms` `--ease-out:cubic-bezier(.22,1,.36,1)`。
- 只用 `transform`/`opacity`（GPU 友好）；触控反馈 100–200ms（`:active` scale .98，120ms）。
- 简历域相关：上传进度(确定性条) / 解析阶段点 / AI 生成槽位逐项淡入(300ms/项) / 裁决✓ scale(.6→1,240ms)；**全部真值驱动，禁伪造**。
- 不做：粒子、3D 翻转、花哨转场；`prefers-reduced-motion` 与 `?flat=1` 下一律静态。

### 9.3 密度红线在令牌层的落地规则（硬约束）
1. **唯一问句**：每屏恰 1 个 `--fs-display` 主问句，落在 `.k-xiaoqing .q`（唯一 h1 语义）。
2. **≤3 区块**：每屏 `.k-sec` 容器数 ≤3；区块间距 `--space-8`，不堆叠文字。
3. **唯一主操作**：每屏 `.k-cta-bar` 内恰 1 个 `data-kind="primary"` 或 `danger`；其余 `secondary`/`ghost`。
4. **正文下限**：任意文字 ≥`--fs-micro`(15px)，正文 ≥`--fs-body`(19px)，主按钮 ≥`--fs-primary`(22px)。
5. **拆屏阈值**：区块说明 >2 行 → 拆编号步骤或收次级；区块内 >6 行 → 考虑拆屏。
6. **可点上限**：每屏可点元素 ≤20（不含底栏）；用 `--tap-min:48px`/`--tap-primary:56px` 保触控。
7. **不空白**：下半屏用 `.k-scroll` 弹性 / `margin-top:auto` 拉开，杜绝大留白。
8. **字符预算**：屏内可见字符 ≤450（列表 550）；文字覆盖面积 ≤12%。

**每屏骨架模板（直接套用）**：
```html
<main id="stage" data-screen="f01-upload" data-state="idle">
  <header class="k-topbar">…返回/品牌/状态/时钟…</header>
  <section class="k-xiaoqing"><div class="core">青</div>
    <div><p class="q">想先看简历哪里能更强？</p>
         <p class="hint">上传简历，本机帮你做诊断</p></div>
  </section>
  <div class="k-scroll">
    <section class="k-sec"><div class="k-sec-head"><span class="no">1</span><h2>上传简历</h2></div>
      <div class="k-dropzone">…file-user…</div></section>
    <!-- 最多再有 2 个 .k-sec -->
  </div>
  <div class="k-cta-bar"><div class="grow"></div>
    <button class="k-btn" data-kind="primary">开始诊断</button></div>
  <nav class="k-navbar">…三 Tab…</nav>
</main>
```

---

## 10. 给原型构建师的使用说明

**① 哪些令牌先落地（顺序）**
1. 先 `<link>` 引入**已冻结** `kiosk-tokens.css` + `kiosk-components.css`（不要另写一套配色/字阶）。
2. 本文 §2–§6 即冻结令牌的中文可读版 + 对比度核验，写 CSS 时以 `kiosk-tokens.css` 变量名为准。
3. Phase 2 简历域**新增 4 个组件类**（步骤指示器/上传区/左右对照/逐条裁决）不在冻结文件内，把下方附录 CSS 追加进 `kiosk-components.css`（或本屏 `<style>` 仅限独有布局，禁止复制组件样式、禁止硬编码令牌值）。

**② 哪些屏优先**
- 第一批：**F01 引导/上传（f01-upload）→ F01 诊断报告（f01-report）→ F03 导出与打印（f03-export）**，因 F03 复用打印链已有模式、F01 承接上传通道，风险最低。
- 第二批：**F02 三屏**（逐条裁决/对照/证据图例是全新交互，先在 f02-optimize 单屏打磨三态+对照，再铺 f02-triage / f02-preview）。
- 每屏交付前跑 `DESIGN-SYSTEM.md §6` 九项自检（纵/横溢出 0、触控 ≥48、违禁文案 0、来源三字段、空态诚实、1080×1920 截图目检）。

**③ 合规注意点（Phase 2 高频雷区）**
- F01/F02 若出现岗位/招聘会推荐入口，CTA 必须是白名单文案（去来源平台投递/扫码投递/去来源平台预约/扫码预约），且卡上必有 `.k-source-meta` 三要素；**绝不可**出现「一键投递/立即投递/平台投递」，绝不可做投递闭环。
- 简历诊断/优化**不承诺入职、不评分排名、不写百分比**；匹配给三档，条件写「确定性比对」。
- F03「结束并清空」是**唯一**可用 `--cinnabar` 危险按钮（`.k-btn[data-kind="danger"]`）处；导出/打印主 CTA 用 `--teal` 主按钮。
- 所有 PII 默认脱敏（手机号 138****5678 式）；无真实接口时不显示「已保存/已打印」。

**④ 附录：需追加到 kiosk-components.css 的简历域组件 CSS（直接粘贴）**
```css
/* ── 步骤指示器（F01/F02 三幕式） ── */
.k-stepper{display:flex;align-items:center;gap:0;padding:20px var(--pad-x)}
.k-stepper .step{display:flex;align-items:center;gap:12px;min-height:var(--tap-min);cursor:default}
.k-stepper .dot{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;
  font-size:var(--fs-meta);font-weight:var(--fw-bold);background:var(--ink-soft);color:var(--muted)}
.k-stepper .step.done .dot{background:var(--teal);color:#fff}
.k-stepper .step.now .dot{background:var(--teal);color:#fff;box-shadow:0 0 0 4px var(--teal-soft)}
.k-stepper .step.now{cursor:pointer}
.k-stepper .bar{flex:1;height:3px;margin:0 14px;background:var(--line);border-radius:2px}
.k-stepper .bar.done{background:var(--teal)}
.k-stepper .lab{font-size:var(--fs-meta);color:var(--muted)}
.k-stepper .step.now .lab,.k-stepper .step.done .lab{color:var(--ink)}

/* ── 上传区 ── */
.k-dropzone{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  min-height:200px;padding:32px;border:2px dashed var(--line);border-radius:var(--r-card);
  background:var(--surface);text-align:center;cursor:pointer;transition:border-color var(--dur-quick) var(--ease-out)}
.k-dropzone:active{border-color:var(--teal)}
.k-dropzone.active{border-color:var(--teal);background:var(--teal-soft)}
.k-dropzone .t{font-size:var(--fs-primary);font-weight:var(--fw-bold);color:var(--ink)}
.k-dropzone .d{font-size:var(--fs-meta);color:var(--muted)}

/* ── 左右对照 ── */
.k-compare{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4)}
.k-compare .pane{border-radius:var(--r-card);padding:24px;overflow:auto}
.k-compare .before{background:var(--ink-soft)}
.k-compare .before .cap{color:var(--muted);font-size:var(--fs-meta);font-weight:var(--fw-bold);margin-bottom:12px}
.k-compare .after{background:var(--surface);border-left:4px solid var(--teal)}
.k-compare .after .cap{color:var(--teal-deep);font-size:var(--fs-meta);font-weight:var(--fw-bold);margin-bottom:12px}
.k-compare .diff{background:var(--teal-soft);border-radius:8px;padding:4px 8px}
@media (max-width:640px){.k-compare{grid-template-columns:1fr}}

/* ── 逐条裁决三态 ── */
.k-verdict{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-4);margin-top:var(--space-6)}
.k-verdict .v{min-height:var(--tap-primary);display:inline-flex;align-items:center;justify-content:center;gap:8px;
  border-radius:var(--r-pill);font-size:var(--fs-primary);font-weight:var(--fw-bold);cursor:pointer}
.k-verdict .v[data-act="adopt"]{background:var(--teal);color:#fff}
.k-verdict .v[data-act="keep"]{background:var(--surface);border:1.5px solid var(--line);color:var(--ink)}
.k-verdict .v[data-act="write"]{background:transparent;color:var(--teal-deep)}
.k-verdict .v[aria-pressed="true"]{box-shadow:0 0 0 2px var(--teal) inset;background:var(--teal-soft);color:var(--teal-deep)}
@media (max-width:640px){.k-verdict{grid-template-columns:1fr}}

/* ── 证据图例（E1/E2/E3 常驻） ── */
.k-evidence-legend{display:flex;gap:20px;flex-wrap:wrap;padding:14px var(--pad-x);
  background:var(--surface);border-top:1px solid var(--line);font-size:var(--fs-micro)}
.k-evidence-legend .e{display:inline-flex;align-items:center;gap:8px;color:var(--muted)}
.k-evidence-legend .e i{width:12px;height:12px;border-radius:50%}
.k-evidence-legend .e[data-ev="E1"] i{background:var(--ink)}
.k-evidence-legend .e[data-ev="E2"] i{background:var(--teal)}
.k-evidence-legend .e[data-ev="E3"] i{background:var(--slate)}
```

---
*本文档与 `kiosk-tokens.css` / `kiosk-components.css` / `DESIGN-SYSTEM.md` / `MOTION-SPEC.md` / `DESIGN-PLAN.md` 口径一体生效；任何令牌值以冻结 CSS 为准，本文仅为可读化与简历域扩展。*
