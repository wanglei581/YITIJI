# 当前开发进度

> 最后更新：2026-05-23  
> 关联文档：[CLAUDE.md](../../CLAUDE.md) | [feature-scope.md](../product/feature-scope.md)

---

## 一、已确认的项目决策

| 决策项 | 结论 | 确认时间 |
|--------|------|---------|
| 项目定位 | AI求职打印服务终端（非招聘平台） | 2026-05 |
| 底部导航 | 仅保留：首页、AI助手、我的 | 2026-05 |
| AI工具箱入口 | 不作为一级导航 | 2026-05 |
| 企业招聘端 | 删除，不开发 | 2026-05 |
| 合作机构后台 | 保留，只做数据与运营后台 | 2026-05 |
| 管理员后台 | 保留，管理整个终端运营体系 | 2026-05 |
| 打印机型号 | 奔图 Pantum CM2820ADN | 2026-05 |
| 岗位/招聘会数据 | 只做第三方/官方来源信息入口 | 2026-05 |
| 旧秒哒项目 | 仅作参考库，不作为正式工程 | 2026-05 |
| 技术栈 | React + Vite + TypeScript + Tailwind + shadcn/ui | 2026-05 |

---

## 二、当前开发阶段

**当前阶段：第 0 阶段 - 项目初始化（✅ 完成）**

文档体系（2026-05-23 完成）：
- [x] CLAUDE.md
- [x] AGENTS.md（Codex 项目说明）
- [x] README.md
- [x] docs/product/feature-scope.md
- [x] docs/compliance/compliance-boundary.md
- [x] docs/device/pantum-cm2820adn.md
- [x] docs/decisions/ai-collaboration-rules.md
- [x] docs/progress/current-progress.md
- [x] docs/progress/next-tasks.md

代码工程（2026-05-23 完成）：
- [x] pnpm monorepo 结构（pnpm-workspace.yaml）
- [x] 根目录配置：package.json、tsconfig.base.json、eslint.config.mjs、.prettierrc.json、.editorconfig、.gitignore
- [x] apps/kiosk 初始化（React + Vite + TypeScript + Tailwind v4），Port 5173
- [x] apps/admin 初始化，Port 5174
- [x] apps/partner 初始化，Port 5175
- [x] packages/ui：Button、Card、StatusBadge、PageHeader 组件
- [x] packages/shared：UserRole、DeviceStatus、JobSourceStatus、PrintTaskStatus 类型
- [x] services/api、services/worker 占位
- [x] pnpm install 成功（216 个包）
- [x] pnpm lint 通过（零报错）
- [x] pnpm typecheck 通过（零错误）
- [x] pnpm dev 三端均成功启动

Phase 0 修复（2026-05-23 完成）：
- [x] Button 组件：sm/md h-12(48px)，lg h-14(56px)，满足触控要求；forwardRef；type="button" 默认值
- [x] .env.example 创建（含 PANTUM_APP_KEY/SECRET 仅服务端注释）
- [x] 三端 app 添加 @ai-job-print/ui 和 @ai-job-print/shared workspace 依赖
- [x] 三端 App.tsx 实际引用 Button/Card/StatusBadge/PageHeader 及对应 shared 类型
- [x] tsconfig.node.json 修复：移除 allowImportingTsExtensions（TS5096），添加 outDir 重定向构建产物
- [x] 清理失败构建产物（apps/*/vite.config.js、*.d.ts、*.tsbuildinfo）
- [x] @types/node ^22 加入根 devDependencies
- [x] Agency 审查结果另存为 docs/reviews/claude-agency-phase0-review.md
- [x] pnpm lint / typecheck / build 全部通过（零报错）
- [x] Codex 复审收尾：新增 .gitattributes、三端 @ 路径别名、StatusBadge 无障碍语义、同步 Phase 1 任务文档
- [x] Vite 升级到 6.4.2，Esbuild 升级到 0.25.12，pnpm audit 无已知漏洞

提交前清理（2026-05-23 完成）：
- [x] .DS_Store 从 git 索引移除（本地文件保留）
- [x] 项目源码及需求文档.zip 从 git 索引移除（本地文件保留）
- [x] .gitignore 补充 *.zip 规则，防止后续再次入库
- [x] pnpm lint / typecheck / build / audit 全部通过（audit: No known vulnerabilities found）

---

## 三、优先级任务列表

### P0（MVP 核心，立即开发）

- [x] 新建正式项目（monorepo 结构）
- [x] 建立设计系统（颜色/字体/按钮/卡片/状态标签规范）
- [x] 完成一体机首页
- [x] 完成打印扫描核心流程（打印 5 页 + 扫描 4 页，含失败路径和重试）
- [x] 完成管理员后台基础框架
- [ ] 完成岗位/招聘会外部来源展示逻辑（合规展示）

### P1（重要功能，第二批）

- [ ] AI简历服务（上传、解析、诊断、优化、打印）
- [ ] 文件自动清理机制
- [ ] 打印任务状态实时追踪
- [ ] 合作机构后台（岗位/招聘会数据管理）
- [ ] 数据源同步功能

### P2（扩展功能，有时间再做）

- [ ] Windows Terminal Agent 开发
- [ ] 奔图打印机接口对接
- [ ] 扫描目录监听
- [ ] 告警中心
- [ ] 数据统计报表

---

## 四、各阶段完成情况

| 阶段 | 名称 | 状态 |
|------|------|------|
| 第 0 阶段 | 项目初始化 | ✅ 完成 |
| 第 1 阶段 | 设计系统 | ✅ 基建完成（可进入 Phase 2） |
| 第 2 阶段 | 公共组件 | ✅ 完成 |
| 第 3 阶段 | 一体机前台 | 进行中（打印流程 ✅，扫描流程 ✅） |
| 第 4 阶段 | 岗位和招聘会信息 | 未开始 |
| 第 5 阶段 | 管理员后台 | 未开始 |
| 第 6 阶段 | 合作机构后台 | 未开始 |
| 第 7 阶段 | 后端 API | 未开始 |
| 第 8 阶段 | Windows Terminal Agent | 未开始 |

---

## 五、正确开发节奏

```
干净架构 → 设计系统 → 核心页面 → 后端 API → 打印机对接 → 上线测试
```

不要跳过设计系统直接写页面。  
不要在旧秒哒项目里继续堆功能。  
不要一次性想完成所有功能。

---

## 六、更新记录

| 日期 | 更新内容 | 操作人 |
|------|---------|--------|
| 2026-05-23 | 建立项目文档体系（CLAUDE.md + 4 个文档） | Claude Code |
| 2026-05-23 | 整理目录结构，新增 AGENTS.md、README.md、ai-collaboration-rules.md、next-tasks.md，compliance 文档移至独立目录 | Claude Code |
| 2026-05-23 | 补充跨平台运行要求：CLAUDE.md 新增第 17 节、README.md 新增平台说明、新建 terminal-agent-windows.md | Claude Code |
| 2026-05-23 | 第 0 阶段完成：pnpm monorepo 初始化，三端 app 可运行，packages/ui 和 packages/shared 已创建，lint/typecheck/dev 全部通过 | Claude Code |
| 2026-05-23 | Phase 0 修复：Button 触控尺寸修正、forwardRef、.env.example、三端引用 ui/shared、tsconfig.node.json 修复、构建产物清理、pnpm build 通过 | Claude Code |
| 2026-05-23 | Codex Phase 0 复审收尾：补 .gitattributes、路径别名、StatusBadge 无障碍语义、Vite/Esbuild 安全升级，lint/typecheck/build/audit 均通过 | Codex |
| 2026-05-23 | 提交前清理：移除 .DS_Store 和 zip 出 git 索引，补 *.zip gitignore 规则，全部检查通过，Phase 0 正式封板 | Claude Code |
| 2026-05-23 | Phase 1 设计系统基建：tokens.css(@theme)、cn()工具、cva重构Button/Card/StatusBadge、Spinner/EmptyState/LoadingState/ErrorState、KioskLayout/AdminLayout/PartnerLayout，lint/typecheck/build全通过 | Claude Code |
| 2026-05-24 | Phase 1 视觉验证修复：三端 index.css 补 `@source "../../../packages/ui/src"` 指令，修复 Tailwind v4 不扫描 workspace 包导致样式全部缺失的问题，截图确认三端布局/颜色/组件均正常 | Claude Code |
| 2026-05-24 | Phase 2 完成：Admin 14路由、Partner 10路由、Kiosk /policy 路由及首页按钮接线；路由结构统一（router→routes/index.tsx，布局→layouts/），App.tsx 薄包装；Fast Refresh warning 修复；废弃 settings 路由删除；Playwright 截图验收全部通过 | Claude Code |
| 2026-05-24 | Phase 3 打印流程完成：PrintUploadPage→PreviewPage→ConfirmPage→ProgressPage→DonePage，含成功/失败/重试路径；DEV 模拟失败按钮；CONTROL_FIELDS 黑名单重试；Mavis 视觉修复（费用 text-2xl，PageHeader text-xl）；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-24 | Phase 3 扫描流程完成：ScanStartPage→SettingsPage→ProgressPage→ResultPage，4 页扫描流程，含类型选择/参数配置/进度/结果；DEV 模拟失败；黑名单重试；首页扫描按钮修正至 /scan/start；lint/typecheck/build 全通过 | Claude Code |

---

> 每次完成开发任务后，请更新本文档的任务清单和更新记录。
