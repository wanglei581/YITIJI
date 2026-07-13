# 青序 LightFlow 核心三 Tab 4188 紧凑服务台布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变首页 Hero/登录卡和任何真实业务合同的前提下，把首页服务区、AI 助手和 `/profile` 主入口改为 4188 的紧凑服务台布局。

**Architecture:** 首页把现有 `SERVICE_GROUPS` 数据转换为 4188 的服务目录，而不是复制入口或变更路由；AI 助手和 Profile 保留各自的运行时组件与数据 hooks，仅替换局部根样式和布局 class。所有 CSS 继续按页面 namespace 限定，禁止回写全局、API、认证或 `/me/*` 明细页。

**Tech Stack:** React、TypeScript、React Router、现有 Kiosk icon sprite、CSS Grid、既有 LightFlow `service-desk` tokens、Node 静态 verify。

---

### Task 1: 锁定首页服务目录的布局合同（RED）

**Files:**
- Modify: `apps/kiosk/scripts/verify-home-service-desk.mjs`
- Test: `apps/kiosk/scripts/verify-home-service-desk.mjs`

- [ ] **Step 1: 写入首页服务区的新失败断言**

  断言 `HomePage` 渲染 `service-quick-nav`、`home-service-catalog`、AI 简历的 `featured` 变体以及岗位/招聘会的并列变体；断言旧 `sec-head` 与大卡片的 1080 专用尺寸不再作为服务区布局合同。断言 6 个既有组、24 条入口、禁用项与路由仍存在。

- [ ] **Step 2: 运行 RED**

  Run: `pnpm --filter @ai-job-print/kiosk verify:home-service-desk`

  Expected: FAIL，原因是新 class、导航和紧凑目录 CSS 尚不存在。

- [ ] **Step 3: 不修改运行时代码前记录失败输出**

  Expected: 失败点只包含新布局守卫，不应是 API、登录、合规或既有入口守卫。

### Task 2: 首页服务区改为 4188 紧凑目录（GREEN）

**Files:**
- Modify: `apps/kiosk/src/pages/home/HomePage.tsx`
- Modify: `apps/kiosk/src/pages/home/styles/home-services.css`
- Modify: `apps/kiosk/src/pages/home/styles/home-responsive.css`
- Test: `apps/kiosk/scripts/verify-home-service-desk.mjs`

- [ ] **Step 1: 保留原 `SERVICE_GROUPS` 数据和按钮跳转，仅加入展示元数据**

  为组生成稳定的 `id` 和布局 variant；为现有 tile 加入来源于当前功能含义的简短说明。禁止改动 `to`、`state`、disabled、`titleTo` 或分组顺序。

- [ ] **Step 2: 将首页服务 JSX 改为目录结构**

  在 `IdentityPanel` 后渲染六项 `service-quick-nav` 锚点；以 `home-service-catalog` 替换 `sec-head + home-grid`。AI 简历用两张亮蓝主卡加四条紧凑次入口；岗位信息与招聘会并列，其他组沿用相同组件但按内容自适应。保留 `ToolboxSection`、`SmartCampusHorizontalSection` 和合规脚注。

- [ ] **Step 3: 局部 CSS 只实现 4188 层级**

  使用冰蓝画布、无阴影或极轻边界、平直横向分隔线、48/56px 触控尺寸；桌面用 2 栏工作面板，390px 回退为两列可触达卡片。禁止修改 `.service-value`、`.identity`、顶栏或底部导航样式。

- [ ] **Step 4: 运行 GREEN**

  Run: `pnpm --filter @ai-job-print/kiosk verify:home-service-desk && pnpm --filter @ai-job-print/kiosk typecheck`

  Expected: PASS。

### Task 3: AI 助手进入紧凑服务台布局

**Files:**
- Modify: `apps/kiosk/src/pages/assistant/AssistantPage.tsx`
- Modify: `apps/kiosk/src/pages/assistant/assistant-inkpaper.css`
- Modify: `apps/kiosk/scripts/verify-lightflow-k2a-ai-career.mjs`
- Test: `apps/kiosk/scripts/verify-lightflow-k2a-ai-career.mjs`

- [ ] **Step 1: 写入失败断言**

  断言助手保持无可见页面重复标题、真实对话/会话/TRTC 合同，并有 `kassist-lightflow` 的服务台目录区、当前会话主工作面板和紧凑快捷任务/常见问题区；禁止 InkPaper 色值和纸纹选择器。

- [ ] **Step 2: 运行 RED**

  Run: `pnpm --filter @ai-job-print/kiosk verify:lightflow-k2a-ai-career`

  Expected: FAIL，仅因新的布局和根样式断言未满足。

- [ ] **Step 3: 重组展示 class，不移动请求与状态代码**

  聊天面板保持主工作区，快捷任务与常见问题使用 4188 风格紧凑入口；保留小青只在对话内容中出现、可访问标题、键盘、失败和合规提示。

- [ ] **Step 4: 用局部 LightFlow CSS 替换旧视觉入口**

  所有 selector 限定在 `.kassist-lightflow`；复用既有分片，禁用米色、墨青、纸纹和 serif；保留 reduced-motion、48px 控件和小屏回退。

- [ ] **Step 5: 运行 GREEN**

  Run: `pnpm --filter @ai-job-print/kiosk verify:lightflow-k2a-ai-career && pnpm --filter @ai-job-print/kiosk typecheck`

  Expected: PASS。

### Task 4: `/profile` 主入口进入紧凑服务台布局

**Files:**
- Modify: `apps/kiosk/src/pages/profile/ProfilePage.tsx`
- Modify: `apps/kiosk/src/pages/profile/profile-inkpaper.css`
- Create: `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`
- Modify: `apps/kiosk/package.json`
- Test: `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`

- [ ] **Step 1: 写入 Profile 静态守卫（RED）**

  守卫要求 `.kprofile-lightflow` 根、真实登录/统计/既有入口的保留、紧凑服务目录 class、无 InkPaper 色值/纸纹/serif；明确 `/me/*` 文件不在改动集合。

- [ ] **Step 2: 运行 RED**

  Run: `pnpm --filter @ai-job-print/kiosk verify:lightflow-profile-entry`

  Expected: FAIL，因新脚本、package 注册和根 class 尚不存在。

- [ ] **Step 3: 重组 `/profile` 主入口布局**

  将会员身份/登录引导压缩为 4188 的状态行与主操作；本人记录、常用服务、招聘会活动和账户服务改为分区目录，保留每一条既有 `ProfileEntry` 的路由和登录门槛，不在 Profile 重建资产明细。

- [ ] **Step 4: 替换局部 CSS**

  保持 `.kprofile` namespace，以 `.kprofile-lightflow` 为根；使用冰蓝白、亮蓝、深海军蓝、紧凑分隔线与两列卡片。只影响 `/profile`，不导入或覆盖 `me-detail-inkpaper.css`。

- [ ] **Step 5: 运行 GREEN**

  Run: `pnpm --filter @ai-job-print/kiosk verify:lightflow-profile-entry && pnpm --filter @ai-job-print/kiosk typecheck`

  Expected: PASS。

### Task 5: 集成、浏览器与审查

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.ccg/tasks/qingxu-lightflow-core-tabs-layout/task.json`

- [ ] **Step 1: 回归命令**

  Run:

  ```bash
  pnpm --filter @ai-job-print/kiosk verify:home-service-desk
  pnpm --filter @ai-job-print/kiosk verify:lightflow-k2a-ai-career
  pnpm --filter @ai-job-print/kiosk verify:lightflow-profile-entry
  pnpm --filter @ai-job-print/kiosk typecheck
  pnpm --filter @ai-job-print/kiosk lint
  VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 pnpm build:kiosk:production
  git diff --check
  ```

- [ ] **Step 2: 浏览器矩阵**

  在 1080×1920、390×844、390×700 检查首页、`/assistant` 和 `/profile`：Hero/登录卡锁定、服务区紧凑化、所有可见入口可达、无横向溢出、无可见重复标题、未登录空态诚实。

- [ ] **Step 3: 双外部审查与记录**

  Antigravity 前端审查和 Claude 审查必须并行调用；若 Claude 无有效输出，必须如实记录为无效，不计为批准。内部独立 reviewer 复核合同、合规和文件范围。

- [ ] **Step 4: 文档和提交**

  只在所有本地证据通过后更新进度与 task 状态，精确暂存本批文件，使用 conventional commit；不 push、不合并、不部署。
