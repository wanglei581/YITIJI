# 运动语言参考（Motion System）

> 适用范围：AI求职打印服务终端 —— 一体机前台（Kiosk）、管理员后台、合作机构后台。
> 本文档为历史动效参考，不再要求所有页面统一遵守。各页可根据当前设计任务自定义时长、缓动、动画库和动效语言。
> 不可覆盖的底线是：不伪造成功状态、不掩盖错误 / 离线 / 硬件失败、不降低触控可用性和可访问性。
> 配套可交互演示台：`docs/design/motion-playground.html`。

---

## 0. 核心原则

旧版统一运动语言的目标是"稳、清楚、有现场设备感"，而不是炫技。落地时可参考以下五条：

1. **优先使用 `opacity` 与 `transform`（translate / scale）。** 如需动画 `width / height / top / left / box-shadow / filter`，先评估性能与抖动风险。
2. **关键动效表达状态。** 纯装饰动效可以使用，但不得掩盖系统状态或误导用户认为任务已成功。
3. **时长与缓动可参考 token。** 见第 1、2 节；新设计任务可以定义自己的节奏。
4. **性能可控。** 一体机业务页和后台可以使用更强视觉动效，但不能造成输入延迟、滚动卡顿或长时间占用注意力。
5. **可访问 + 触控优先。** 主按钮触控区 ≥ 56px，可点击区 ≥ 48px；`prefers-reduced-motion` 必须提供降级体验。这是可用性硬约束，不属于可放宽的视觉风格限制。

动效层的合规红线单列在第 5 节，仍为硬约束。

---

## 1. 时长 token

| Token | 值 | 用途 |
|------|------|------|
| `--motion-enter` | **220ms** | 元素进入 / 出现（卡片、列表项、弹层入场） |
| `--motion-press` | **120ms** | 点击 / 按压反馈（按钮下压、卡片回弹） |
| `--motion-state` | **180–260ms（默认 220ms）** | 状态切换（在线↔离线、徽章变色、crossfade、筛选重排） |
| `--motion-flow` | **300–400ms（默认 360ms）** | 复杂流程 / 页面转场 / 共享元素转场 |
| `--motion-stagger` | **40–60ms** | 多元素依次出现的相邻间隔（默认 50ms） |
| `--motion-success-max` | **≤ 1000ms** | 成功反馈动画旧版建议总时长上限（如对勾扩散），优先在 1 秒内结束 |

建议：单个动画时长不宜过长；`stagger` 队列避免长尾等待。

---

## 2. 缓动 token

| Token | 曲线 | 用途 |
|------|------|------|
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | 进入 / 出现 / count-up（减速收尾） |
| `--ease-inout` | `cubic-bezier(.4,0,.2,1)` | 状态切换 / 转场 / 重排 |
| `--ease-press` | `cubic-bezier(.4,0,.6,1)` | 按压（快进快出，无明显回弹） |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | 离场 / 收起（加速离开，时长可比进入短 ~40ms） |

默认不使用夸张弹性（overshoot）曲线；如果当前设计任务需要更强表现，可以在不影响触控和阅读的前提下使用。

---

## 3. 通用动效模式

下列模式是各页可复用的基础积木，落地时优先参考；新设计任务可以自定义写法。

**卡片 / 区块进入：** `opacity 0→1` + `translateY(12px→0)`，时长 `--motion-enter`，缓动 `--ease-out`。

**列表 stagger：** 按模块或优先级排序，每项延迟 `index × --motion-stagger`；高优先级项先出现。

**点击按压：** 按下 `transform: scale(.98)` 或 `translateY(2–3px)`，时长 `--motion-press`，缓动 `--ease-press`；松开还原。

**状态切换：** 用 `opacity` crossfade 或徽章颜色过渡，时长 `--motion-state`。离线 / 错误是明确终态——切过去后保持稳定，**不持续闪烁**。

**count-up 数字：** 真实数据到位后从 0（或上次值）滚动到目标，时长 ≤ `--motion-flow` 上限，缓动 `--ease-out`。**数据加载失败显示"—"，不显示假 0、不滚动。**

**展开 / 收起：** `grid-template-rows: 0fr↔1fr` 配合 `opacity`，时长 `--motion-flow`。收起后不留空白占位。

**弹层 / 浮层：** 从触发按钮位置 `scale(.92→1)` + `opacity`，`transform-origin` 对准按钮，时长 `--motion-flow`，缓动 `--ease-out`。

**骨架屏 → 真实内容：** 加载时骨架 shimmer（微光扫过）；数据到位后 crossfade 切换为真实内容，不做"假 0 再跳变"。

---

## 4. 各页动效落地

### 4.1 首页 · 服务总控屏
方向：像就业服务大厅的一体机首页，稳、清楚、有现场设备感。

| 元素 | 动效 | Token |
|------|------|------|
| 顶部打印机 / 网络状态点 | 在线时轻微呼吸（`scale`+`opacity`）；**离线切换为明确警示终态，停止呼吸，不花哨闪烁** | `--motion-state` |
| 服务卡片 | 进入按模块轻微 stagger 出现；点击下压 2–3px | `--motion-enter` / `--motion-press` |
| 登录后数量（简历 / 文档 / AI记录 / 收藏） | 真实数据 count-up 或 crossfade | `--motion-flow` |
| 智慧校园区块 | 仅终端开启时淡入展开；关闭时整块收起，**不留空白** | `--motion-flow` |

### 4.2 AI 简历页 · 材料生成工作台
方向：让用户感觉"系统正在处理我的材料"，**但不承诺录用或投递结果**。

| 元素 | 动效 | Token |
|------|------|------|
| 上传文件 | 文件卡片从上传区滑入流程条（`translate`+`opacity`） | `--motion-enter` |
| 解析 / 诊断 / 优化 / 导出 PDF | 横向步骤条，当前步骤有轻微进度光带（`transform` 位移光条，非闪烁） | `--motion-state` |
| 诊断报告 | 分数 count-up；问题项 / 建议分批出现，**高优先级先出现** | `--motion-enter` + stagger |
| 新旧简历对比 | 柔和高亮扫过修改区域，避免强烈闪烁 | `--motion-flow` |

### 4.3 打印扫描页 · 硬件流程可视化（重点）
方向：用户在等机器，这是最该重点做动效的页面。把等待变成"看得见的进度"。

| 元素 | 动效 | Token |
|------|------|------|
| 流程时间线 | 上传 → 预览 → 参数 → 确认 → 队列 → 打印中 → 完成，做成明确时间线，逐节点点亮 | `--motion-state` |
| 打印中状态流 | 「任务已提交 / 终端已领取 / 打印机执行 / 出纸完成」逐条真实状态出现 | `--motion-enter` |
| 错误态 | 离线 / 缺纸 / 卡纸时**直接切错误态，绝不播放模拟成功动画**，给出明确处理提示 | `--motion-state` |
| 成功反馈 | 对勾扩散 + 纸张轻微滑出，旧版建议 **≤ 1 秒内结束** | `--motion-success-max` |

### 4.4 岗位 / 招聘会 / 企业展示页 · 来源导览感
方向：像信息入口和现场导览，**不要像招聘平台**。

| 元素 | 动效 | Token |
|------|------|------|
| 筛选条件切换 | 列表卡片轻微淡入重排（`opacity`+`translateY`） | `--motion-state` |
| 来源机构 / 同步时间 / 外部入口按钮 | **保持固定可见**，强化"第三方 / 官方来源"（不做隐藏动效） | — |
| 招聘会详情 | 时间 / 地点 / 参展企业 / 导览图按信息层级展开（stagger） | `--motion-enter` |
| 二维码 / 来源平台弹层 | 从按钮位置弹出；按钮文案固定为「去来源平台投递 / 扫码投递 / 去来源平台预约 / 扫码预约」 | `--motion-flow` |

### 4.5 AI 助手页 · 顾问对话感
方向：真人照片顾问"小青"已是核心视觉，不再做复杂 3D，重点做**对话节奏**。

| 元素 | 动效 | Token |
|------|------|------|
| AI 回复 | 流式逐字出现；输入中用小型思考点或语音波纹 | `--motion-enter` |
| 推荐操作卡片 | 用户说"我要打印简历"后，「去简历服务」「去打印扫描」等卡片从底部浮出 | `--motion-enter` |
| 业务页跳转 | 共享转场：推荐卡片轻微放大后进入目标页面 | `--motion-flow` |
| 会话未落库 | **不展示"历史问答已保存"之类动效或提示** | — |

### 4.6 我的页 · 个人服务回执台
方向：不是资产中心堆叠，而是"我刚做过什么、还能去哪继续"。

| 元素 | 动效 | Token |
|------|------|------|
| 顶部真实统计 | 加载用骨架屏，到位后 crossfade；**失败显示横杠"—"，不用假 0** | `--motion-state` |
| 本次服务记录 | 卡片轻微上浮出现 | `--motion-enter` |
| 文档 / 打印订单 / 收藏 / 浏览记录入口 | 点击明确按压反馈 | `--motion-press` |
| 明细 | **不重新聚合到"我的"页**，明细仍归位到对应业务页面 | — |

---

## 5. 动效层合规红线（必读）

这些是 `CLAUDE.md` 合规边界在动效层的具体落地，违反即不合规：

- **打印 / 扫描：** 硬件未真实成功，不得播放任何成功动画；离线 / 缺纸 / 卡纸一律切错误态。
- **简历 / 岗位：** 不承诺录用、不模拟"投递成功 / 已投递"结果动画；按钮文案只用「查看岗位 / 扫码投递 / 去来源平台投递 / 查看招聘会 / 去来源平台预约 / 扫码预约」。**禁用**「一键投递 / 立即投递 / 平台投递」等词。
- **我的：** 统计加载失败显示"—"；会话 / 记录未落库时不显示"已保存"。
- **AI 助手：** 回复流式呈现；不伪造历史保存状态。
- 不用人脸识别建档动效；扫描动效仅用于简历 / 证件等业务范围内的原件扫描。

---

## 6. 技术落地（纯 CSS + Tailwind v4）

本项目用 **Tailwind v4**（`@tailwindcss/vite`，**无 `tailwind.config.js`**），主题在 `packages/ui/src/styles/tokens.css` 的 `@theme` 块声明，三端 `index.css` 已 `@import` 它。默认优先用 CSS + Tailwind 实现轻量动效；如当前设计任务确需运行时动画库，可以在评估包体、性能、可维护性和一体机表现后引入，并必须补充浏览器或真机性能验收，覆盖触控响应、滚动流畅度和主要转场卡顿风险。

### 6.1 第一步：把第 1、2 节 token 写入 `tokens.css` 的 `@theme`（与 `--color-*` / `--radius-*` 同级）

```css
@theme {
  /* ── Motion: 时长（输出为 :root CSS 变量） ─────────────── */
  --motion-press:   120ms;  /* 点击/按压；hover 可用 150ms */
  --motion-state:   220ms;  /* 状态切换 180–260 取中 */
  --motion-enter:   220ms;  /* 元素进入 */
  --motion-flow:    360ms;  /* 复杂流程/转场 300–400 取中 */
  --motion-stagger:  50ms;  /* 相邻错峰间隔 40–60 */

  /* ── Motion: 缓动（Tailwind v4 namespace → 生成 ease-* 工具类） */
  --ease-out:   cubic-bezier(.22, 1, .36, 1);   /* 进入/出现/count-up */
  --ease-inout: cubic-bezier(.4, 0, .2, 1);     /* 状态切换/转场/重排 */
  --ease-press: cubic-bezier(.4, 0, .6, 1);     /* 按压快进快出 */
  --ease-in:    cubic-bezier(.4, 0, 1, 1);      /* 离场/收起 */

  /* ── Motion: 复用进入动画（生成 animate-* 工具类） ──────── */
  /* 字面值与上方 token 保持一致；改 token 时同步改这里 */
  --animate-fade-in: fade-in 220ms cubic-bezier(.22,1,.36,1) both;
  --animate-fade-up: fade-up 220ms cubic-bezier(.22,1,.36,1) both;
  --animate-pop-in:  pop-in  220ms cubic-bezier(.22,1,.36,1) both;
}

/* keyframes 放样式表顶层（与 @theme 同文件即可） */
@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes fade-up { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
@keyframes pop-in  { from { opacity: 0; transform: scale(.92) } to { opacity: 1; transform: scale(1) } }
```

> 注：`--ease-out` / `--ease-in` 会覆盖 Tailwind 内置同名缓动，属有意统一；若要保留内置值，改用自定义名（如 `--ease-emphasized`）。`--motion-*` 不是 Tailwind 命名空间，只作为 CSS 变量输出，通过 `duration-[var(--motion-*)]` 引用。

### 6.2 第二步：用法（Tailwind 优先，原生 CSS 兜底）

| 场景 | 写法 |
|------|------|
| 进入动画 | `class="animate-fade-up"` |
| 错峰进入 | 父级设 `--i`，子项 `style="animation-delay:calc(var(--i)*var(--motion-stagger))"` |
| 按压反馈 | `class="transition-transform duration-[var(--motion-press)] ease-press active:scale-[.98]"` |
| 状态切换 | `class="transition-colors duration-[var(--motion-state)] ease-inout"`（建议配 `data-state="online\|offline\|error"`） |
| 原生 CSS | `transition: opacity var(--motion-state) var(--ease-inout);` |

> 需要沿用旧 motion token 时，可用 `duration-[var(--motion-*)]` 引用变量；新设计任务也可以定义新的时长和缓动。

### 6.3 第三步：复用、降级与性能

- 在 `packages/ui` 暴露极小 hook（`useCountUp`、`useStagger`、`useReducedMotion`），各页不重复实现；优先 `data-state` + CSS transition 表达硬件/会话状态，轻量且与状态天然对应。
- **统一降级**：除全局媒体查询外，命中 `useReducedMotion()` 时所有动画退化为"瞬时切换 + ≤200ms 淡入"。全局兜底（放 `tokens.css` 顶层）：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
```

- **性能**：只动 `opacity` / `transform`；`will-change: transform, opacity` 仅动画期间加、结束移除；长列表不对每项常驻动画，错峰队列封顶 ~6 项（见第 1 节）。

---

_维护：本参考与 `motion-playground.html` 为配套资产。修改 token 时建议同步更新两者，并在 `docs/progress/current-progress.md` 记录。_
