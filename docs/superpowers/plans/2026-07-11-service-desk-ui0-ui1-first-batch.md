# 青序 LightFlow UI-0/UI-1 第一批实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for inline execution. Do not use subagents unless the user explicitly authorizes delegation.

**Goal:** 在不改变业务逻辑、路由、API、权限、认证、支付、打印和数据契约的前提下，建立青序 LightFlow 共享视觉基础，并完成 Kiosk 首页、Admin 工作台、Partner 岗位管理三个正式代表页的第一批迁移。

**Architecture:** 青序 LightFlow 在工程中继续采用 `[data-visual-theme="service-desk"]` 作用域和 `touch / compact / comfortable` 三种密度。旧全局主题暂时保留给未迁移路由；只有本批三个代表页由路由壳层显式启用新主题。每个代表页单独提交、单独验证、可单独回滚，全部通过后才允许制定 UI-2 扩展计划。

**Tech Stack:** React 18、TypeScript、Vite 6、Tailwind CSS 4、`@ai-job-print/ui`、Node `.mjs` 静态 verify、真实 HTTP API 浏览器验收。

---

## 1. 本批硬边界

### 1.1 只做这些

- UI-0：共享语义 token、主题作用域、三种密度、三端壳层合同。
- UI-1 Kiosk：正式首页 `/`。
- UI-1 Admin：正式工作台 `/`。
- UI-1 Partner：正式岗位管理 `/jobs`。
- 新增与本批一一对应的静态 verify，并执行现有功能 verify、typecheck、lint、生产 build 和真实 API 浏览器回归。
- 最后只按实际结果同步两份进度 SSOT。

### 1.2 明确不做

- 不新增或删除路由、首页入口、底部 Tab、后台菜单和业务卡片。
- 不修改 `services/`、`packages/shared/`、Prisma、认证、支付、打印、扫描、AI、TRTC、Terminal Agent 或环境密钥。
- 不修改 API 调用、请求参数、DTO、权限、刷新策略、busy lock、会话清理和业务状态机。
- 不把 4188 的演示登录、假数据、弹窗或原型跳转带入正式代码。
- 不在本批全仓删除 `inkpaper.css`、`fusion-youth.css` 或旧视觉 verify；未迁移页面继续使用旧主题。
- 不顺手修复本批审查中发现的无关代码问题；另立任务。

### 1.3 完成等级

本批代码在本地真实 HTTP API、角色登录与浏览器回归通过后，最多标记为 **UX-2 本地集成闭环**。没有预生产证据时不得宣称 UX-3；没有 Windows 真机、奔图硬件或真实支付证据时不得宣称 UX-4。

## 2. 文件预算与回滚边界

### Batch A — UI-0 共享基础

**Create**

- `packages/ui/src/theme/visualTheme.ts`
- `packages/ui/src/styles/service-desk.css`
- `packages/ui/scripts/verify-service-desk-foundation.mjs`

**Modify**

- `packages/ui/package.json`
- `packages/ui/src/index.ts`
- `packages/ui/src/layouts/KioskLayout.tsx`
- `packages/ui/src/layouts/AdminLayout.tsx`
- `packages/ui/src/layouts/PartnerLayout.tsx`
- `apps/kiosk/src/index.css`
- `apps/admin/src/index.css`
- `apps/partner/src/index.css`

Batch A 只提供能力，不在任何路由启用 `service-desk`。因此即使后三批尚未完成，现有页面默认视觉不变。

### Batch B — Kiosk 首页代表页

**Create**

- `apps/kiosk/scripts/verify-home-service-desk.mjs`
- `apps/kiosk/src/pages/home/home-service-desk.css`
- `apps/kiosk/src/pages/home/styles/home-shell.css`
- `apps/kiosk/src/pages/home/styles/home-services.css`
- `apps/kiosk/src/pages/home/styles/home-continuation.css`
- `apps/kiosk/src/pages/home/styles/home-responsive.css`

**Modify**

- `apps/kiosk/package.json`
- `apps/kiosk/src/pages/home/HomePage.tsx`
- `apps/kiosk/src/layouts/KioskRoot.tsx`

**Delete**

- `apps/kiosk/src/pages/home/home-inkpaper.css`

Batch B 可通过单独回退其提交恢复旧首页；Batch A 保持休眠，不影响其他路由。

### Batch C — Admin 工作台代表页

**Create**

- `apps/admin/scripts/verify-service-desk-dashboard-ui.mjs`

**Modify**

- `apps/admin/package.json`
- `apps/admin/src/layouts/AdminLayoutWrapper.tsx`
- `apps/admin/src/routes/dashboard/index.tsx`

Batch C 只在 `activeKey === 'dashboard'` 时启用新主题；`/devices` 等其他路由不变。

### Batch D — Partner 岗位管理代表页

**Create**

- `apps/partner/scripts/verify-service-desk-jobs-ui.mjs`

**Modify**

- `apps/partner/package.json`
- `apps/partner/src/layouts/PartnerLayoutWrapper.tsx`
- `apps/partner/src/routes/jobs/index.tsx`

Batch D 只在 `activeKey === 'jobs'` 时启用新主题；`/profile` 等其他路由不变。

### Batch E — 事实文档

**Modify only after tests and browser evidence exist**

- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

## 3. 核心代码合同

### 3.1 主题与密度类型

`packages/ui/src/theme/visualTheme.ts` 必须使用以下完整合同：

```ts
export type VisualTheme = 'legacy' | 'service-desk'

export type UiDensity = 'touch' | 'compact' | 'comfortable'

export function getVisualThemeAttributes(
  visualTheme: VisualTheme,
  density: UiDensity,
) {
  return {
    'data-visual-theme': visualTheme,
    'data-ux-density': density,
  } as const
}
```

- `KioskLayout` 新增 `visualTheme?: VisualTheme`、`density?: UiDensity`，默认 `legacy / touch`。
- `AdminLayout` 新增同名 props，默认 `legacy / compact`。
- `PartnerLayout` 默认 `legacy / comfortable`，继续复用 `AdminLayout`，不复制第二套后台壳层。
- 三个布局根节点展开 `getVisualThemeAttributes()`；布局和关键区域增加稳定的 `ui-kiosk-*` / `ui-admin-*` class hook。
- `packages/ui/src/index.ts` 导出 `VisualTheme`、`UiDensity`，不导出页面业务类型。

### 3.2 主题作用域

`packages/ui/src/styles/service-desk.css` 必须只在新主题作用域内覆盖视觉 token：

```css
[data-visual-theme='service-desk'] {
  --sd-color-canvas-outer: #e9f1fb;
  --sd-color-canvas: #f7faff;
  --sd-color-surface: #ffffff;
  --sd-color-text-strong: #071a43;
  --sd-color-text: #17345d;
  --sd-color-copy: #566a84;
  --sd-color-copy-muted: #64748b;
  --sd-color-primary: #1769e8;
  --sd-color-primary-strong: #0758d7;
  --sd-color-line: #dce6f4;
  --sd-color-line-strong: #cbd9ed;
  --sd-shadow-touch: 0 18px 60px rgba(30, 71, 124, 0.09);
  --sd-shadow-console: 0 10px 34px rgba(30, 71, 124, 0.06);
  --sd-category-blue-bg: #edf6ff;
  --sd-category-blue-fg: #0f64c5;
  --sd-category-mint-bg: #eefaf6;
  --sd-category-mint-fg: #087f6a;
  --sd-category-orange-bg: #fff7ef;
  --sd-category-orange-fg: #a94c12;
  --sd-category-lavender-bg: #f5f3ff;
  --sd-category-lavender-fg: #594bc0;
  --sd-category-cyan-bg: #effbff;
  --sd-category-cyan-fg: #067b9d;
  --sd-category-sand-bg: #fffaf0;
  --sd-category-sand-fg: #93620e;

  --color-canvas: var(--sd-color-canvas);
  --color-surface: var(--sd-color-surface);
  --color-primary-50: #edf6ff;
  --color-primary-100: #d9ecff;
  --color-primary-200: #b9dcff;
  --color-primary-300: #88c2ff;
  --color-primary-400: #4f9dff;
  --color-primary-500: #2c7ff4;
  --color-primary-600: var(--sd-color-primary);
  --color-primary-700: var(--sd-color-primary-strong);
  --color-primary-800: #0b469e;
  --color-primary-900: #0c3d7f;
  --color-neutral-50: #f7faff;
  --color-neutral-100: #edf3fa;
  --color-neutral-200: var(--sd-color-line);
  --color-neutral-300: var(--sd-color-line-strong);
  --color-neutral-400: #8493a7;
  --color-neutral-500: var(--sd-color-copy-muted);
  --color-neutral-600: var(--sd-color-copy);
  --color-neutral-700: #334b68;
  --color-neutral-800: var(--sd-color-text);
  --color-neutral-900: var(--sd-color-text-strong);
  --font-heading: var(--font-sans);
}

[data-visual-theme='service-desk'][data-ux-density='touch'] {
  --sd-control-min: 48px;
  --sd-primary-control-min: 56px;
  --sd-card-radius: 26px;
  --sd-nav-height: 112px;
}

[data-visual-theme='service-desk'][data-ux-density='compact'] {
  --sd-control-min: 32px;
  --sd-primary-control-min: 36px;
  --sd-card-radius: 14px;
  --sd-table-row-height: 44px;
}

[data-visual-theme='service-desk'][data-ux-density='comfortable'] {
  --sd-control-min: 36px;
  --sd-primary-control-min: 40px;
  --sd-card-radius: 14px;
  --sd-table-row-height: 48px;
}

[data-visual-theme='service-desk'] :is(button, a, input, select, textarea, [tabindex]):focus-visible {
  outline: 3px solid rgba(23, 105, 232, 0.42);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  [data-visual-theme='service-desk'] *,
  [data-visual-theme='service-desk'] *::before,
  [data-visual-theme='service-desk'] *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

同一文件继续定义 `.ui-kiosk-shell`、`.ui-kiosk-nav`、`.ui-admin-sidebar`、`.ui-admin-topbar`、`.ui-admin-content` 的 legacy 默认变量和 service-desk 覆盖。禁止在此文件使用无作用域的 `body`、`html` 或 `:root` 覆盖，避免未迁移页面被连带修改。

### 3.3 路由启用合同

只有完成对应代表页后，才加入下列启用条件：

```tsx
// apps/kiosk/src/layouts/KioskRoot.tsx
visualTheme={pathname === '/' ? 'service-desk' : 'legacy'}
density="touch"

// apps/admin/src/layouts/AdminLayoutWrapper.tsx
visualTheme={activeKey === 'dashboard' ? 'service-desk' : 'legacy'}
density="compact"

// apps/partner/src/layouts/PartnerLayoutWrapper.tsx
visualTheme={activeKey === 'jobs' ? 'service-desk' : 'legacy'}
density="comfortable"
```

## 4. 逐步实施任务

### Task 0: 开工前基线与冲突门禁

**Files:** None.

- [ ] 确认在独立 worktree 和本计划指定分支执行：

```bash
git branch --show-current
git rev-parse --short HEAD
git status --short --branch
git worktree list --porcelain
```

Expected: 当前分支为本任务专属分支，工作区干净；若目标文件被其他任务占用，立即停止，不吸收他人改动。

- [ ] 记录本批目标文件的基线行数：

```bash
wc -l packages/ui/src/layouts/{KioskLayout,AdminLayout,PartnerLayout}.tsx \
  apps/kiosk/src/pages/home/{HomePage.tsx,home-inkpaper.css} \
  apps/admin/src/routes/dashboard/index.tsx \
  apps/partner/src/routes/jobs/index.tsx
```

Expected: `HomePage.tsx` 和旧首页 CSS 超过 800 行，只允许拆分/收口，不继续堆功能；后台代表页只改视觉 class，不扩大业务职责。

- [ ] 运行现有基线验证：

```bash
pnpm --filter @ai-job-print/ui typecheck
pnpm --filter @ai-job-print/kiosk verify:kiosk-shell-active-nav
pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui
pnpm --filter @ai-job-print/admin verify:refresh-safe
pnpm --filter @ai-job-print/partner verify:partner-refresh-safe
pnpm --filter @ai-job-print/partner verify:job-quality-dashboard-ui
```

Expected: 全部退出码 0；任何基线失败先另行诊断，不带病开始视觉迁移。

### Task 1: UI-0 共享主题与壳层合同（RED → GREEN）

**Files:** Batch A 全部文件。

- [ ] 先创建 `verify-service-desk-foundation.mjs` 并在 `packages/ui/package.json` 增加：

```json
"verify:service-desk-foundation": "node scripts/verify-service-desk-foundation.mjs"
```

verify 必须断言：

- `visualTheme.ts` 只含 `legacy | service-desk` 和三种密度；
- `service-desk.css` 含上述 11 个核心语义色、三种密度、focus-visible 和 reduced motion；
- CSS 不含无作用域的 `:root` / `body` / `html` 主题覆盖；
- 三个布局根节点输出 `data-visual-theme` 与 `data-ux-density`；
- Partner 仍复用 AdminLayout；
- 三端 `index.css` 均在旧主题之后导入 `service-desk.css`；
- 三个布局的默认值均为 `legacy`，避免调用方未传 props 时误启用新主题。

- [ ] 运行 RED：

```bash
pnpm --filter @ai-job-print/ui verify:service-desk-foundation
```

Expected: 因 `visualTheme.ts` / `service-desk.css` 尚不存在而失败。

- [ ] 按第 3 节合同实现主题类型、样式、布局 props、稳定 class hook 与三端样式导入。

- [ ] 运行 GREEN：

```bash
pnpm --filter @ai-job-print/ui verify:service-desk-foundation
pnpm --filter @ai-job-print/ui typecheck
pnpm --filter @ai-job-print/ui lint
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/partner typecheck
```

Expected: 全部退出码 0；现有页面默认仍是 legacy。

- [ ] 在提交 Batch A 前做一次临时启用检查：

```bash
rg -n "service-desk" \
  apps/kiosk/src/layouts/KioskRoot.tsx \
  apps/admin/src/layouts/AdminLayoutWrapper.tsx \
  apps/partner/src/layouts/PartnerLayoutWrapper.tsx
```

Expected: 退出码 1 且无输出，证明 Batch A 尚未在正式路由启用；此临时检查不写入长期 foundation verify，因为后续 Batch B–D 会合法加入 route opt-in。

- [ ] 明确暂存并提交：

```bash
git add packages/ui/package.json \
  packages/ui/scripts/verify-service-desk-foundation.mjs \
  packages/ui/src/index.ts \
  packages/ui/src/theme/visualTheme.ts \
  packages/ui/src/styles/service-desk.css \
  packages/ui/src/layouts/KioskLayout.tsx \
  packages/ui/src/layouts/AdminLayout.tsx \
  packages/ui/src/layouts/PartnerLayout.tsx \
  apps/kiosk/src/index.css apps/admin/src/index.css apps/partner/src/index.css
git commit -m "feat(ui): add scoped service-desk theme foundation"
```

### Task 2: Kiosk 首页代表页（RED → CSS 拆分 → GREEN）

**Files:** Batch B 全部文件。

- [ ] 先创建 `verify-home-service-desk.mjs` 并新增脚本：

```json
"verify:home-service-desk": "node scripts/verify-home-service-desk.mjs"
```

verify 必须断言：

- `HomePage.tsx` 导入 `home-service-desk.css`，不再导入 `home-inkpaper.css`；
- CSS 聚合文件只导入四个拆分样式文件；每个普通 CSS 文件少于 300 行；
- 新 CSS 含 48px 最小触控、56px 主按钮、112px 底栏、390×844 响应式和 reduced motion；
- 新 CSS 不含 `#fdfbf4`、`#0e302b`、宋体或纸纹背景；
- `KioskRoot` 只在 `/` 启用 `service-desk`；
- `SERVICE_GROUPS` 仍为当前六组，禁用项仍是“岗位大师、证件复印、云打印、格式转换、证件照打印”；
- 首页仍保留三项底部导航、登录/游客状态、继续上次、百宝箱受控空态和合规脚注；
- 不出现“一键投递、立即投递、平台投递”。

- [ ] 运行 RED：

```bash
pnpm --filter @ai-job-print/kiosk verify:home-service-desk
```

Expected: 因新样式文件和 route opt-in 尚不存在而失败。

- [ ] 先做无行为变化拆分：

`home-service-desk.css` 必须只包含：

```css
@import './styles/home-shell.css';
@import './styles/home-services.css';
@import './styles/home-continuation.css';
@import './styles/home-responsive.css';
```

拆分职责固定为：

- `home-shell.css`：`.khome`、顶栏、Hero、身份条、按钮、涟漪、进入动画；
- `home-services.css`：区块标题、`.home-grid`、分类卡、子入口、禁用态与 focus；
- `home-continuation.css`：百宝箱受控空态、继续上次、合规脚注；
- `home-responsive.css`：≤900px、390×844、1080×1920 和 reduced motion。

- [ ] 将视觉值替换为第 3 节语义 token：浅冰蓝画布、白表面、深海军蓝层级、亮蓝主操作、克制分类色。不得修改 `SERVICE_GROUPS`、跳转、登录、suggestion、toolbox 或 ripple 行为；`useInkRipple` 的命名清理留到旧主题退出批次，避免本批扩大行为 diff。

- [ ] 只在 Kiosk `/` 启用 `service-desk / touch`，其余 Kiosk 路由继续 legacy。

- [ ] 运行 GREEN 与功能回归：

```bash
pnpm --filter @ai-job-print/kiosk verify:home-service-desk
pnpm --filter @ai-job-print/kiosk verify:kiosk-shell-active-nav
pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
```

Expected: 全部退出码 0；静态门禁证明入口、禁用态和合规文案未变化。

- [ ] 明确暂存并提交：

```bash
git add apps/kiosk/package.json \
  apps/kiosk/scripts/verify-home-service-desk.mjs \
  apps/kiosk/src/layouts/KioskRoot.tsx \
  apps/kiosk/src/pages/home/HomePage.tsx \
  apps/kiosk/src/pages/home/home-service-desk.css \
  apps/kiosk/src/pages/home/styles/home-shell.css \
  apps/kiosk/src/pages/home/styles/home-services.css \
  apps/kiosk/src/pages/home/styles/home-continuation.css \
  apps/kiosk/src/pages/home/styles/home-responsive.css \
  apps/kiosk/src/pages/home/home-inkpaper.css
git commit -m "feat(kiosk): migrate home to service-desk visual system"
```

### Task 3: Admin 工作台代表页（RED → GREEN）

**Files:** Batch C 全部文件。

- [ ] 先创建 `verify-service-desk-dashboard-ui.mjs` 并新增脚本：

```json
"verify:service-desk-dashboard-ui": "node scripts/verify-service-desk-dashboard-ui.mjs"
```

verify 必须断言：

- 只有 `activeKey === 'dashboard'` 启用 `service-desk / compact`；
- 工作台仍调用终端、打印机、岗位源、招聘会源、文件、AI 用量、审计、打印任务和告警真实服务；
- 首屏仍使用 `LoadingState`、`ErrorState` 与重试；
- 无真实金额/收入 KPI，不把未知或加载失败当成 0；
- 打印状态仍区分排队、领取、打印中、完成、失败；
- 告警主 CTA 从旧深色硬编码改为 `bg-primary-600`，但 `load` 和 `/alerts` 行为不变。

- [ ] 运行 RED：

```bash
pnpm --filter @ai-job-print/admin verify:service-desk-dashboard-ui
```

Expected: route opt-in 和新语义 CTA 尚不存在，验证失败。

- [ ] 在 `AdminLayoutWrapper.tsx` 加入第 3.3 节 route opt-in；在 Dashboard 只替换视觉 class：

```tsx
className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-primary-600 px-4 text-[13px] font-bold text-white shadow-[0_8px_18px_rgba(23,105,232,0.18)] transition-transform hover:-translate-y-px hover:bg-primary-700 active:scale-[0.97]"
```

- [ ] 运行 GREEN：

```bash
pnpm --filter @ai-job-print/admin verify:service-desk-dashboard-ui
pnpm --filter @ai-job-print/admin verify:refresh-safe
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
```

Expected: 全部退出码 0；真实数据加载和错误恢复逻辑无 diff。

- [ ] 明确暂存并提交：

```bash
git add apps/admin/package.json \
  apps/admin/scripts/verify-service-desk-dashboard-ui.mjs \
  apps/admin/src/layouts/AdminLayoutWrapper.tsx \
  apps/admin/src/routes/dashboard/index.tsx
git commit -m "feat(admin): validate service-desk dashboard density"
```

### Task 4: Partner 岗位管理代表页（RED → GREEN）

**Files:** Batch D 全部文件。

- [ ] 先创建 `verify-service-desk-jobs-ui.mjs` 并新增脚本：

```json
"verify:service-desk-jobs-ui": "node scripts/verify-service-desk-jobs-ui.mjs"
```

verify 必须断言：

- 只有 `activeKey === 'jobs'` 启用 `service-desk / comfortable`；
- `useRefreshable`、`useInteractionLock`、真实 API、筛选、编辑、下架和重新提审逻辑保留；
- 加载、错误、空筛选、保存错误、保存中、下架处理中和成功通知仍存在；
- 审核状态和发布状态仍是两套独立语义；分类色不复用 success/warning/error；
- 外部来源链接、重新审核提示和“不在本系统内接收简历”的合规文案保留；
- Drawer 的取消、禁用保存、键盘焦点与输入保留策略不回归。

- [ ] 运行 RED：

```bash
pnpm --filter @ai-job-print/partner verify:service-desk-jobs-ui
```

Expected: route opt-in、分类 token 和蓝色选中态尚不存在，验证失败。

- [ ] 加入第 3.3 节 route opt-in；只替换以下视觉映射：

```ts
const CATEGORY_MAP: Record<JobCategory, { label: string; style: string }> = {
  fulltime: { label: '全职', style: 'bg-[var(--sd-category-blue-bg)] text-[var(--sd-category-blue-fg)]' },
  intern: { label: '实习', style: 'bg-[var(--sd-category-lavender-bg)] text-[var(--sd-category-lavender-fg)]' },
  campus: { label: '校招', style: 'bg-[var(--sd-category-mint-bg)] text-[var(--sd-category-mint-fg)]' },
  parttime: { label: '兼职', style: 'bg-[var(--sd-category-orange-bg)] text-[var(--sd-category-orange-fg)]' },
}
```

两个筛选组选中态统一为 `border-primary-600 bg-primary-600 text-white`，未选中态使用 `border-neutral-200 bg-surface text-neutral-700`。不得修改筛选值、计数、API 或状态映射。

- [ ] 运行 GREEN：

```bash
pnpm --filter @ai-job-print/partner verify:service-desk-jobs-ui
pnpm --filter @ai-job-print/partner verify:partner-refresh-safe
pnpm --filter @ai-job-print/partner verify:job-quality-dashboard-ui
pnpm --filter @ai-job-print/partner typecheck
pnpm --filter @ai-job-print/partner lint
```

Expected: 全部退出码 0；机构隔离和真实 API 行为没有代码 diff。

- [ ] 明确暂存并提交：

```bash
git add apps/partner/package.json \
  apps/partner/scripts/verify-service-desk-jobs-ui.mjs \
  apps/partner/src/layouts/PartnerLayoutWrapper.tsx \
  apps/partner/src/routes/jobs/index.tsx
git commit -m "feat(partner): validate service-desk jobs workflow"
```

### Task 5: 真实浏览器验收与 UX-2 边界

**Files:** 不把截图、HAR、token 或真实个人数据写入 Git。

- [ ] 使用当前已验证的本地 API 地址启动三端，必须显式使用 HTTP 模式。若 API 地址不是 `http://127.0.0.1:3010/api/v1`，只替换命令中的地址，不修改仓库配置：

```bash
VITE_API_MODE=http VITE_API_BASE_URL=http://127.0.0.1:3010/api/v1 VITE_USE_TRTC_CALL=true \
  pnpm --filter @ai-job-print/kiosk exec vite --host 127.0.0.1 --port 5273

VITE_API_MODE=http VITE_API_BASE_URL=http://127.0.0.1:3010/api/v1 \
  pnpm --filter @ai-job-print/admin exec vite --host 127.0.0.1 --port 5274

VITE_API_MODE=http VITE_API_BASE_URL=http://127.0.0.1:3010/api/v1 \
  pnpm --filter @ai-job-print/partner exec vite --host 127.0.0.1 --port 5275
```

Expected: 三端启动且控制台无应用错误；Admin/Partner 使用用户提供的本地测试账号人工登录，账号凭据不写入脚本、文档或截图。

- [ ] Kiosk 验收：

- 1080×1920：六组入口、身份条、继续上次、百宝箱状态、112px 底栏无遮挡；全部触控目标 ≥48px，主 CTA ≥56px。
- 390×844：无横向滚动，长标题不盖住状态或按钮；固定底栏稳定。
- `/assistant` 与 `/profile` 仍是 legacy，证明作用域未外溢。
- 登录、游客继续、禁用入口、继续上次、底部三 Tab 逐项实点；不以截图代替跳转结果。

- [ ] Admin 验收：

- 1440×1024 与 1280×800：浅色侧栏、工作台 KPI、双列区块、告警 CTA、Loading/Error/Retry 不破版。
- 实点刷新、告警入口、打印任务入口、设备入口；网络失败时显示真实 ErrorState。
- `/devices` 保持 legacy，证明只迁移工作台。

- [ ] Partner 验收：

- 1440×1024 与 1280×800：岗位筛选、表格、横向溢出、抽屉、长来源链接和状态列可读。
- 实点筛选、新增/编辑打开与取消、保存禁用、失败保留输入、下架处理中、重新提审提示。
- 验证 Partner 账号只见本机构数据；`/profile` 保持 legacy。

- [ ] 记录证据边界：本地截图和脱敏网络摘要放仓库外；文档只写“通过/失败、时间、视口、真实 HTTP/角色结果和未完成边界”。

### Task 6: 全量工程门禁、审查与文档收口

**Files:** Batch E 两份进度文档；审查记录写入当前 CCG 任务目录，归档时一并提交。

- [ ] 运行本批全部新旧 verify：

```bash
pnpm --filter @ai-job-print/ui verify:service-desk-foundation
pnpm --filter @ai-job-print/kiosk verify:home-service-desk
pnpm --filter @ai-job-print/kiosk verify:kiosk-shell-active-nav
pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui
pnpm --filter @ai-job-print/admin verify:service-desk-dashboard-ui
pnpm --filter @ai-job-print/admin verify:refresh-safe
pnpm --filter @ai-job-print/partner verify:service-desk-jobs-ui
pnpm --filter @ai-job-print/partner verify:partner-refresh-safe
pnpm --filter @ai-job-print/partner verify:job-quality-dashboard-ui
```

- [ ] 运行三端静态门禁与生产构建：

```bash
pnpm --filter @ai-job-print/ui typecheck
pnpm --filter @ai-job-print/ui lint
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
pnpm --filter @ai-job-print/partner typecheck
pnpm --filter @ai-job-print/partner lint

VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 \
  pnpm build:kiosk:production
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/partner build
```

Expected: 全部退出码 0；生产构建没有 DEV 演示入口或 mock 数据警告。

- [ ] 审查范围和禁区：

```bash
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- packages/ui apps/kiosk apps/admin apps/partner docs/progress
git diff origin/main...HEAD -- services packages/shared apps/terminal-agent
```

Expected: 第三个命令无输出；diff 不含 API、认证、支付、打印、数据库或业务状态机修改。

- [ ] 按项目规则执行双模型审查；若 Antigravity 或 Claude 不可用，`review.md` 必须如实记录具体失败边界，不得写成通过。Critical 修复后重新跑全部门禁。

- [ ] 浏览器验收和所有门禁通过后，更新：

- `current-progress.md`：记录 UI-0 完成、三个代表页的实际 UX 等级、真实验证证据和旧主题仍保留范围。
- `next-tasks.md`：把 UI-2 拆成新的业务域计划；在用户再次批准前不得继续铺开。

- [ ] 明确暂存进度文档并提交：

```bash
git add docs/progress/current-progress.md docs/progress/next-tasks.md
git commit -m "docs: record service-desk first-batch acceptance"
```

## 5. 第一批完成判定

只有同时满足以下条件，才可报告“第一批完成”：

- 共享主题默认休眠，只有三个代表路由显式启用；未迁移页面无视觉外溢。
- Kiosk 首页不再引用页面级 InkPaper CSS，首页入口、禁用态、登录、恢复、百宝箱和合规行为保持真实。
- Admin 工作台真实数据、加载、错误、告警和打印状态不回归。
- Partner 岗位管理的机构数据、刷新锁、筛选、抽屉、重新审核和外部来源合规不回归。
- 目标视口、焦点、键盘、触控、reduced motion、长内容和错误恢复通过。
- 所有相关 verify、typecheck、lint、生产 build 和真实 HTTP API 浏览器回归通过。
- 证据只支持 UX-2 时，只报告 UX-2；预生产、支付、硬件和物理出纸继续明确未完成。
- 用户审阅三个代表页后明确同意，才进入 UI-2 扩展计划。

## 6. 执行停点

本计划提交后停止。下一步必须由用户明确选择“按计划开始第一批实施”，才进入 Task 0；不因计划完成自动修改页面代码。
