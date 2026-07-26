# 首页招聘会与打印扫描专区视觉平衡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 390×844 与 390×700 窄屏下压缩首页“打印扫描”的视觉体量并弱化“招聘会”重复色块，同时保持 1080×1920 一体机、全部真实入口和动态专区不退化。

**Architecture:** `ServiceCard` 只增加稳定的 `data-group-id` 结构作用域，避免招聘会与政策服务共享 `wheat` token 时串组。所有视觉调整只追加到 `@media (max-width: 760px)`，原型派生基础规则保持不动；窄屏规格使用独立静态 verifier，和现有 1080 原型真值合同并列。

**Tech Stack:** React 18、TypeScript、CSS Media Queries、Node.js 静态 verifier、Vite、真实浏览器视口验收

---

## 0. 范围、文件预算与已决策事项

**真实功能闭环：** 首页现有招聘会和打印扫描入口在手机窄屏下保持可发现、可点击、状态诚实，且不挤压动态专区和底栏。

**允许修改的生产/验证文件（5 个）：**

- Create: `apps/kiosk/scripts/verify-home-narrow-visual-balance.mjs` — 原型外窄屏视觉合同。
- Modify: `apps/kiosk/package.json` — 注册新 verifier 脚本。
- Modify: `apps/kiosk/src/pages/home/HomePage.tsx` — 为服务组增加稳定作用域属性。
- Modify: `apps/kiosk/src/styles/prototype-v1.css` — 添加严格限定的窄屏覆写。
- Modify: `docs/progress/current-progress.md` — 记录本地验证事实和未完成边界。

**治理文件（不计入产品文件预算）：**

- `.ccg/tasks/home-sections-visual-balance-20260726/*` — active task、review 和归档。

**禁止修改：** `serviceGroups.ts`、`ProfilePage`、`/me/*`、API、DTO、Prisma、认证、权限、支付、打印/扫描任务状态机、Terminal Agent、AI、TRTC、岗位投递或招聘会合规文案。

**双模型分析已确定：**

- 使用 `data-group-id={group.id}`，不使用 `.a-wheat`、标题文本或 `:nth-child()` 定位业务组。
- 末项通栏使用 `.tile:last-child`；这是网格位置规则，入口顺序继续由现有路由合同锁定。
- 不修改现有 `.tile.col { min-height: 90px }` 与 `.tiles.c5 { repeat(5, 1fr) }` 基础规则，只在窄屏作用域内覆写。
- “招聘会”当前已基本符合浅麦金层级，只做更轻的 primary 背景，不改变行高、间距或入口顺序。

### Task 1: 建立原型外窄屏静态合同并取得 RED

**Files:**

- Create: `apps/kiosk/scripts/verify-home-narrow-visual-balance.mjs`
- Modify: `apps/kiosk/package.json:49-55`

- [ ] **Step 1: 创建独立静态 verifier**

新增以下完整文件。它从批准规格派生窄屏期望，不改变 `verify-home-prototype-v1.mjs` 的“1080 原型真值”职责：

```js
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

let failures = 0
const expect = (condition, message) => {
  if (condition) {
    console.log(`  PASS ${message}`)
    return
  }
  failures += 1
  console.error(`  FAIL ${message}`)
}

function balancedBlock(source, marker) {
  const start = source.indexOf(marker)
  if (start < 0) return ''
  const open = source.indexOf('{', start)
  if (open < 0) return ''
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1)
  }
  return ''
}

function cssRule(source, selector) {
  return balancedBlock(source, `${selector} {`) || balancedBlock(source, `${selector}{`)
}

const home = read('src/pages/home/HomePage.tsx')
const css = read('src/styles/prototype-v1.css')
const groups = read('src/pages/home/serviceGroups.ts')
const mobile = balancedBlock(css, '@media (max-width: 760px)')
const printGrid = cssRule(mobile, ".kpv1 .card[data-group-id='print-scan'] .tiles.c5")
const printTile = cssRule(mobile, ".kpv1 .card[data-group-id='print-scan'] .tile.col")
const printText = cssRule(mobile, ".kpv1 .card[data-group-id='print-scan'] .tile.col .t-text")
const printLast = cssRule(mobile, ".kpv1 .card[data-group-id='print-scan'] .tile:last-child")
const fairPrimary = cssRule(mobile, ".kpv1 .card[data-group-id='job-fairs'] .tile.primary")

console.log('\n=== 首页窄屏专区视觉平衡合同 ===')

expect(/data-group-id=\{group\.id\}/.test(home), 'ServiceCard 使用稳定 data-group-id 作用域')
expect(mobile.length > 0, '存在 max-width: 760px 窄屏作用域')
expect(/grid-template-columns:\s*repeat\(2,\s*1fr\)/.test(printGrid), '打印扫描窄屏保持两列')
expect(/gap:\s*8px/.test(printGrid), '打印扫描窄屏网格间距为 8px')
expect(/flex-direction:\s*row/.test(printTile), '打印扫描磁贴改为横向排列')
expect(/min-height:\s*68px/.test(printTile), '打印扫描磁贴触控高度为 68px（不低于 56px）')
expect(/text-align:\s*left/.test(printText), '打印扫描文字恢复左对齐')
expect(/grid-column:\s*1\s*\/\s*-1/.test(printLast), '打印扫描尾项在窄屏通栏')
expect(/color-mix\([^)]*var\(--pv-wheat-soft\)/.test(fairPrimary), '招聘会 primary 使用更轻的浅麦金背景')
expect(!/:nth-child\(/.test(mobile), '窄屏业务样式不使用脆弱的 :nth-child 定位')
expect(!/\.a-wheat[^,{]*\{/.test(mobile), '招聘会窄屏规则不使用会误伤政策服务的裸 .a-wheat')
expect(!/title:\s*'云打印'/.test(groups), '不恢复已正式删除的云打印入口')
expect((groups.match(/disabled:\s*Boolean\(true\)/g) ?? []).length === 2, '两个设备能力入口继续保持禁用')
expect(home.includes('<span className="tag-soon">即将上线</span>'), '禁用入口继续展示即将上线')
expect(/\.kpv1 \.tiles\.c5\s*\{[^}]*repeat\(5,\s*1fr\)/.test(css), '1080 基础布局继续保持五列')
expect(/\.kpv1 \.tile\.col\s*\{[^}]*min-height:\s*90px/.test(css), '1080 基础磁贴继续保持 90px')

if (failures > 0) {
  console.error(`\nFAIL ${failures} 项 — 首页窄屏专区视觉平衡合同未满足\n`)
  process.exit(1)
}

console.log('\nALL PASS — 首页窄屏专区视觉平衡合同满足\n')
```

- [ ] **Step 2: 精确注册 verifier**

在 `apps/kiosk/package.json` 的 `verify:home-prototype-v1` 后增加：

```json
"verify:home-narrow-visual-balance": "node scripts/verify-home-narrow-visual-balance.mjs",
```

- [ ] **Step 3: 运行新门禁并确认 RED**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:home-narrow-visual-balance
```

Expected: FAIL，至少报告 `data-group-id`、打印扫描横向 68px、尾项通栏和招聘会浅麦金规则尚不存在。若此时通过，说明 verifier 误命中，必须先修 verifier，不能进入实现。

### Task 2: 增加稳定组作用域并实现最小窄屏样式

**Files:**

- Modify: `apps/kiosk/src/pages/home/HomePage.tsx:136-137`
- Modify: `apps/kiosk/src/styles/prototype-v1.css:369-377`

- [ ] **Step 1: 为 ServiceCard 增加稳定作用域属性**

将服务卡根节点改为：

```tsx
<section
  data-group-id={group.id}
  className={`card ${wide ? 'wide' : ''} ${ACCENT_CLASS[group.accent]}`.trim().replace(/\s+/g, ' ')}
>
```

不得修改 `SERVICE_GROUPS`、入口顺序或路由。

- [ ] **Step 2: 在现有 760px 媒体查询内追加招聘会与打印扫描规则**

保留现有通用窄屏规则，在 `@media (max-width: 760px)` 内把原来的裸 `.kpv1 .tiles.c5` 两列规则替换为以下完整作用域规则：

```css
.kpv1 .card[data-group-id='job-fairs'] .tile.primary {
  background: color-mix(in srgb, var(--pv-wheat-soft) 72%, var(--pv-paper));
  border-color: color-mix(in srgb, var(--pv-wheat) 24%, transparent);
}
.kpv1 .card[data-group-id='print-scan'] .tiles.c5 {
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.kpv1 .card[data-group-id='print-scan'] .tile.col {
  flex-direction: row;
  justify-content: flex-start;
  gap: 8px;
  min-height: 68px;
  padding: 6px 8px;
  text-align: left;
}
.kpv1 .card[data-group-id='print-scan'] .tile.col .t-text {
  min-width: 0;
  text-align: left;
}
.kpv1 .card[data-group-id='print-scan'] .tile.col .t-icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
}
.kpv1 .card[data-group-id='print-scan'] .tile.col .t-icon svg {
  width: 22px;
  height: 22px;
}
.kpv1 .card[data-group-id='print-scan'] .tile.col .t-text b {
  font-size: 17px;
}
.kpv1 .card[data-group-id='print-scan'] .tile.col .t-text span {
  font-size: 12px;
  line-height: 1.25;
}
.kpv1 .card[data-group-id='print-scan'] .tile.col.disabled {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  grid-template-areas:
    'icon text'
    'icon status';
  column-gap: 8px;
  row-gap: 2px;
}
.kpv1 .card[data-group-id='print-scan'] .tile.col.disabled .t-icon { grid-area: icon; }
.kpv1 .card[data-group-id='print-scan'] .tile.col.disabled .t-text { grid-area: text; }
.kpv1 .card[data-group-id='print-scan'] .tile.col .tag-soon {
  grid-area: status;
  justify-self: start;
  margin: 0;
  padding: 2px 7px;
  font-size: 11px;
}
.kpv1 .card[data-group-id='print-scan'] .tile:last-child {
  grid-column: 1 / -1;
}
```

注意：`tile:last-child` 只是网格位置规则；禁止替换为 `:nth-child(5)`，也禁止新增按中文标题匹配的 CSS。

- [ ] **Step 3: 运行专项 GREEN**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:home-narrow-visual-balance
pnpm --filter @ai-job-print/kiosk verify:home-prototype-v1
```

Expected: 两个 verifier 均 `ALL PASS`；前者证明窄屏增强，后者证明 1080 原型基础合同未受影响。

- [ ] **Step 4: 运行最小静态质量检查**

Run:

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk exec eslint src/pages/home/HomePage.tsx
git diff --check
```

Expected: typecheck 和 targeted lint 0 error，`git diff --check` 无输出。

- [ ] **Step 5: 精确提交 RED→GREEN 批次**

```bash
git add apps/kiosk/scripts/verify-home-narrow-visual-balance.mjs apps/kiosk/package.json apps/kiosk/src/pages/home/HomePage.tsx apps/kiosk/src/styles/prototype-v1.css
git commit -m "fix: balance home service sections on narrow screens"
```

### Task 3: 真实浏览器三视口验收

**Files:**

- No tracked files; use the running local preview and save evidence outside tracked product sources.

- [ ] **Step 1: 检查并启动本地预览**

优先复用 `http://127.0.0.1:58245/`；若不可达，运行：

```bash
pnpm --filter @ai-job-print/kiosk build
pnpm --filter @ai-job-print/kiosk exec vite preview --host 127.0.0.1 --port 58245 --strictPort
```

Expected: `curl --noproxy '*' -I http://127.0.0.1:58245/` 返回 200。

- [ ] **Step 2: 验收 390×844**

使用真实浏览器设置 390×844 并打开首页，逐项确认：

- 招聘会三项保持单列、顺序不变；前两项只使用浅麦金背景，扫码签到为中性背景。
- 打印扫描为两列横向紧凑磁贴，最后一项通栏；标题、说明、“即将上线”均可读且不重叠。
- 文档打印、纸质扫描、格式转换可点击并进入原路由；证件复印、证件照打印保持 disabled。
- 页面无横向溢出；百宝箱/智慧校园按真实配置显示；合规提示存在。

- [ ] **Step 3: 验收 390×700**

使用真实浏览器设置 390×700，重复布局检查，并确认专区不重叠、不被底栏遮挡，页面仍可按既有舞台策略滚动/缩放。

- [ ] **Step 4: 验收 1080×1920**

使用真实浏览器设置 1080×1920，确认打印扫描仍为五列、磁贴仍是 90px 竖排；动态专区、合规提示和底栏锚点无可见位移。

- [ ] **Step 5: 检查动效与无障碍状态**

启用 `prefers-reduced-motion: reduce`，确认磁贴按压不产生位移；检查可用文字对比度目标 ≥4.5:1、非文本边界/图标目标 ≥3:1。

### Task 4: 全量验证、双模型审查与进度收口

**Files:**

- Modify: `docs/progress/current-progress.md`
- Modify/Archive: `.ccg/tasks/home-sections-visual-balance-20260726/*`

- [ ] **Step 1: 运行完整相关验证**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:home-narrow-visual-balance
pnpm --filter @ai-job-print/kiosk verify:home-prototype-v1
pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui
pnpm --filter @ai-job-print/kiosk verify:smart-campus-ui
pnpm --filter @ai-job-print/kiosk verify:fusion-home
pnpm --filter @ai-job-print/kiosk verify:kiosk-visual-unity
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/kiosk build
git diff --check
```

Expected: 全部 PASS；lint 只允许明确记录的既有 warning，不得新增 error/warning。

- [ ] **Step 2: 并行调用 Antigravity 与 Claude 审查完整任务 diff**

两者均使用 reviewer 角色，只读检查正确性、CSS 外溢、1080 回归、触控/文本溢出、合规和范围。结果按 Critical/Warning/Info 合并写入：

```text
.ccg/tasks/home-sections-visual-balance-20260726/review.md
```

Expected: Critical=0；如有 Critical，修复后重新运行 Task 3、Task 4 Step 1，并重新双模型审查。

- [ ] **Step 3: 更新进度事实**

在 `docs/progress/current-progress.md` 追加一条 2026-07-26 记录，必须精确区分：

```markdown
- 本地完成首页招聘会/打印扫描窄屏视觉平衡：390×844、390×700 使用已批准方案 A，1080×1920 原型基础布局保持不变；保留全部路由、禁用态、动态专区和合规提示。记录静态门禁、typecheck、lint、build、浏览器实点和双模型审查结果。本项仅证明本地浏览器候选，不代表预生产、Windows 真机、打印机或扫描仪验收完成。
```

- [ ] **Step 4: 提交进度文档**

```bash
git add docs/progress/current-progress.md
git commit -m "docs: record home narrow-screen verification"
```

- [ ] **Step 5: 完成并归档 CCG task**

把 task 状态更新为 `completed`，确认 review 已写入后移动到当月归档目录：

```bash
mkdir -p .ccg/tasks/archive/2026-07
mv .ccg/tasks/home-sections-visual-balance-20260726 .ccg/tasks/archive/2026-07/
git add -f .ccg/tasks/archive/2026-07/home-sections-visual-balance-20260726
git commit -m "chore: archive ccg task home-sections-visual-balance-20260726"
```

禁止使用 `git add .`。不 push、不合并、不部署。

## 最终交付声明

最终报告只可声称：方案 A 已形成本地可审查候选，并通过记录中的静态、构建、浏览器和双模型验证。不得声称 82 个视觉目标全部完成、预生产已验收或打印扫描真机链路已验证。
