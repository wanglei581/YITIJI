# Admin / Partner 暖色主题治理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保持 Kiosk 用户前台的青序 LightFlow 蓝白服务台，同时将 Admin 与 Partner 固定为暖色 Inkpaper 运营后台，并以静态门禁和正式文档防止再次串色。

**Architecture:** `service-desk.css` 继续由 Kiosk 导入并由 Kiosk 路由选择；Admin 与 Partner 只保留 `tokens.css → inkpaper.css → tailwindcss` 的主题链。两个后台 wrapper 显式传入 `legacy`，Partner 岗位页把仅由服务台定义的分类变量改为 Tailwind 既有低饱和分类工具类，并继续与状态语义 token 分离。现有 CI 脚本保留路径与调用名，仅把断言改为新的端侧边界。

**Tech Stack:** React、TypeScript、Tailwind CSS v4、Node 静态 verify、pnpm。

---

## 功能归位与边界

- 前端：`apps/admin`、`apps/partner`，只修改主题导入、主题选择和一处视觉 class；不修改任何 API 调用、路由、表单、状态机或权限判断。
- 共享 UI：`packages/ui/scripts/verify-service-desk-foundation.mjs`，只更新端侧主题边界断言；不改共享组件 API。
- 文档：现有 LightFlow 迁移规范、视觉设计规范与两份进度 SSOT；不新增产品入口或并列设计标准。
- 不涉及：Kiosk 运行时代码、后端、数据库、支付、打印、扫描、AI、终端、认证和外部依赖。

### Task 1: 先建立失败的端侧边界校验（RED）

**Files:**
- Modify: `packages/ui/scripts/verify-service-desk-foundation.mjs`
- Modify: `apps/admin/scripts/verify-service-desk-dashboard-ui.mjs`
- Modify: `apps/partner/scripts/verify-service-desk-jobs-ui.mjs`

- [ ] **Step 1: 将 foundation 校验改为 Kiosk 必须导入、双后台不得导入服务台 CSS。**

```js
const kioskCss = await read('apps/kiosk/src/index.css', repoRoot)
assert.ok(kioskCss.includes('@import "@ai-job-print/ui/styles/service-desk.css";'))

for (const app of ['admin', 'partner']) {
  const appCss = await read(`apps/${app}/src/index.css`, repoRoot)
  assert.ok(appCss.includes('@import "@ai-job-print/ui/styles/inkpaper.css";'))
  assert.equal(appCss.includes('@import "@ai-job-print/ui/styles/service-desk.css";'), false)
}
```

- [ ] **Step 2: 将 Admin verify 的主题与投影断言改为暖色目标。**

```js
check(
  /visualTheme=['"]legacy['"]/.test(layout) &&
    /density=['"]compact['"]/.test(layout) &&
    count(layout, 'visualTheme=') === 1,
  'AdminLayout keeps the warm legacy theme at compact density on every route',
)

check(
  alertCta?.[1]?.includes('shadow-[0_8px_18px_rgba(16,48,43,0.18)]') &&
    !dashboard.includes('rgba(23,105,232,0.18)'),
  'alert CTA uses the Inkpaper ink-green shadow rather than a LightFlow blue shadow',
)
```

- [ ] **Step 3: 将 Partner verify 的主题与分类 token 断言改为暖色目标。**

```js
check(
  partnerLayoutProps.includes('visualTheme="legacy"') &&
    matches(partnerLayoutProps, /density=['"]comfortable['"]/),
  'PartnerLayout keeps the warm legacy theme at comfortable density on every route',
)

const expectedCategories = [
  ['fulltime', '全职', 'bg-blue-50 text-blue-700'],
  ['intern', '实习', 'bg-violet-50 text-violet-700'],
  ['campus', '校招', 'bg-emerald-50 text-emerald-700'],
  ['parttime', '兼职', 'bg-orange-50 text-orange-700'],
]
```

- [ ] **Step 4: 运行 RED，确认失败由尚未删除的后台服务台导入与选择器引起。**

Run:

```bash
pnpm --filter @ai-job-print/ui verify:service-desk-foundation
pnpm --filter @ai-job-print/admin verify:service-desk-dashboard-ui
pnpm --filter @ai-job-print/partner verify:service-desk-jobs-ui
```

Expected: 三个命令以新的“后台不得使用 service-desk / 必须是 legacy / 不得保留蓝色投影或 `--sd-category-*`”断言失败，而不是脚本语法错误。

### Task 2: 最小运行时主题修正（GREEN）

**Files:**
- Modify: `apps/admin/src/index.css`
- Modify: `apps/partner/src/index.css`
- Modify: `apps/admin/src/layouts/AdminLayoutWrapper.tsx`
- Modify: `apps/partner/src/layouts/PartnerLayoutWrapper.tsx`
- Modify: `apps/admin/src/routes/dashboard/index.tsx`
- Modify: `apps/partner/src/routes/jobs/index.tsx`

- [ ] **Step 1: 仅从两个后台 index.css 删除服务台导入。**

```css
@import "@ai-job-print/ui/styles/tokens.css";
@import "@ai-job-print/ui/styles/inkpaper.css";
@import "tailwindcss";
```

- [ ] **Step 2: 将两个后台 wrapper 的视觉主题固定为 legacy，保留既有密度。**

```tsx
// AdminLayoutWrapper.tsx
visualTheme="legacy"
density="compact"

// PartnerLayoutWrapper.tsx
visualTheme="legacy"
density="comfortable"
```

- [ ] **Step 3: 把 Admin 工作台的唯一蓝色投影还原为墨绿投影。**

```tsx
shadow-[0_8px_18px_rgba(16,48,43,0.18)]
```

- [ ] **Step 4: 将 Partner 岗位类别色从 `--sd-category-*` 替换为现有低饱和分类工具类，并保持分类与状态语义分离。**

```ts
const CATEGORY_MAP = {
  fulltime: { label: '全职', style: 'bg-blue-50 text-blue-700' },
  intern: { label: '实习', style: 'bg-violet-50 text-violet-700' },
  campus: { label: '校招', style: 'bg-emerald-50 text-emerald-700' },
  parttime: { label: '兼职', style: 'bg-orange-50 text-orange-700' },
}
```

- [ ] **Step 5: 运行 GREEN 与构建验证。**

Run:

```bash
pnpm --filter @ai-job-print/ui verify:service-desk-foundation
pnpm --filter @ai-job-print/admin verify:service-desk-dashboard-ui
pnpm --filter @ai-job-print/partner verify:service-desk-jobs-ui
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/partner typecheck
pnpm --filter @ai-job-print/admin build
pnpm --filter @ai-job-print/partner build
```

Expected: 全部退出码为 0；Kiosk 未修改，仍是唯一导入 `service-desk.css` 的应用。

### Task 3: 让正式文档与运行时边界一致

**Files:**
- Modify: `docs/superpowers/specs/2026-07-11-service-desk-commercial-ux-migration-design.md`
- Modify: `docs/design/visual-design-spec.md`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: 在 LightFlow 迁移规范顶部加入 2026-07-15 的明确 supersession。**

```md
> **2026-07-15 视觉边界修正：** 青序 LightFlow 蓝白服务台只适用于 Kiosk 用户前台。Admin 与 Partner 不参与蓝白迁移，继续使用暖色 Inkpaper（米纸画布、墨绿侧栏、青玉主操作、陶土预警和紧凑运营密度）。本段优先于本文此前“三端统一”措辞。
```

- [ ] **Step 2: 在视觉设计规范顶部建立两套现行系统及禁止串用规则。**

```md
| 端 | 现行体系 | 禁止串用 |
| --- | --- | --- |
| Kiosk 用户前台 | 青序 LightFlow 蓝白服务台 | 不使用后台纸纹、墨绿侧栏、衬线标题作为全局壳层 |
| Admin / Partner | 暖色 Inkpaper 运营后台 | 不导入 `service-desk.css`，不启用 `data-visual-theme="service-desk"` |
```

- [ ] **Step 3: 更新两份进度 SSOT，记录本次只改变视觉主题与静态门禁。**

```md
Admin / Partner 已从蓝白 service-desk opt-in 恢复为 Inkpaper；不改路由、真实数据、权限、打印、支付、API 或数据库。Kiosk 继续保留蓝白 LightFlow。
```

- [ ] **Step 4: 对文档和代码做范围检查。**

Run:

```bash
rg -n "service-desk\.css|data-visual-theme=['\"]service-desk['\"]|--sd-category-" apps/admin/src apps/partner/src
git diff --check
git diff --name-only
git ls-files --others --exclude-standard
```

Expected: Admin/Partner 中无 `service-desk.css`、service-desk 主题属性或 `--sd-category-*`；tracked 与 untracked 候选均仅在本计划声明的文件内。

### Task 4: 终审与归档

**Files:**
- Modify: `.ccg/tasks/admin-partner-warm-theme-governance-20260715/task.json`
- Create: `.ccg/tasks/admin-partner-warm-theme-governance-20260715/review.md`

- [ ] **Step 1: 并行运行 Antigravity 与 Claude 对完整 diff 的审查。**

Run:

```bash
~/.claude/bin/codeagent-wrapper --progress --backend antigravity - "$(pwd)"
~/.claude/bin/codeagent-wrapper --progress --backend claude - "$(pwd)"
```

Expected: 两份可读取的完整审查报告；若任一报告不可用，`review.md` 必须如实记录不可用原因，不能写为批准。

- [ ] **Step 2: 复跑 Task 2 的全部命令，检查 git diff，并将 task 状态标记为 completed 后归档。**

Run:

```bash
git status --short --branch
git diff --check
git diff --name-only
git ls-files --others --exclude-standard
```

Expected: 无空白错误；没有本任务范围外文件；不提交、不 push，除非用户另行授权。

### Task 5: 已授权的主线集成与受控发布（2026-07-16）

**授权目标：** 将本计划产生的候选变更迁移到当前 `origin/main` 的 `e62a9789` 基线，形成可追溯提交、并入正式发布来源后再执行受控生产发布。不得继续依赖会被全量发布覆盖的静态产物热补丁。

**Additional files only when resolving true upstream document overlap:**

- Modify: 本计划已声明的候选文件；`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`
- Do not modify: Kiosk 运行时代码、后端、数据库、环境变量、支付、终端、打印、扫描、账号状态或生产 `CLOSED_MODE`

- [ ] **Step 1: 保护候选变更并快进到 `origin/main`。**

  以具名 stash 暂存包括本计划文件在内的全部候选，`git merge --ff-only origin/main` 后恢复该具名 stash。仅在两份进度 SSOT 有真实文本冲突时手动合并；其他冲突即停止并记录。

- [ ] **Step 2: 核对迁移结果。**

  确认运行时变更仍仅覆盖 Admin / Partner 主题链、wrapper 主题选择、一个 Admin 阴影与 Partner 类别 class；确认 Kiosk 未变，且没有上游的认证、账单、终端或支付变更被改写。

- [ ] **Step 3: 在新基线复跑完整验证和浏览器验收。**

  运行三个静态 verify、Admin / Partner 的 typecheck、lint、显式 HTTP API 模式 build，并用本地受控 mock 验收 Admin 工作台与 Partner 岗位页；不使用生产账号或生产数据。

- [ ] **Step 4: 对集成后的完整 diff 并行执行 Antigravity 与 Claude 审查。**

  两份报告必须有非空、可读取结论；Critical 必须修复并重新审查。

- [ ] **Step 5: 精确提交、推送、合并并受控发布。**

  只暂存本计划列出的文件，以 `fix: restore warm inkpaper admin partner themes` 提交并推送候选分支；将已审查提交合入 `main` 作为受控发布源，构建并发布该提交的 Admin / Partner 产物。发布后仅检查公开静态资产与页面视觉边界，不读写生产数据，也不变更运行配置。

- [ ] **Step 6: 发布后验收与归档。**

  用缓存规避请求确认两个公开页面返回新提交对应资产：Admin / Partner 不加载 `service-desk.css`、运行时均为 `legacy`，Kiosk 不发生改变。更新两份进度 SSOT 的提交与发布事实，将任务归档。
