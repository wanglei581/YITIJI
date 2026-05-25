# 当前开发进度

> 最后更新：2026-05-25  
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

**当前阶段：Phase 4 — 岗位和招聘会信息（✅ 完成）**

---

## 三、优先级任务列表

### P0（MVP 核心）

- [x] 新建正式项目（monorepo 结构）
- [x] 建立设计系统（颜色/字体/按钮/卡片/状态标签规范）
- [x] 完成一体机首页
- [x] 完成打印扫描核心流程（打印 5 页 + 扫描 4 页，含失败路径和重试）
- [x] 完成管理员后台基础框架
- [x] 完成岗位/招聘会外部来源展示逻辑（合规展示）

### P1（重要功能，第二批）

- [x] AI简历服务（上传、解析、诊断、优化、打印）
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
| 第 0 阶段 | 项目初始化 | ✅ 完成封板 |
| 第 1 阶段 | 设计系统 | ✅ 完成 |
| 第 2 阶段 | 公共组件 | ✅ 完成 |
| 第 3 阶段 | 一体机前台 | ✅ 完成封板 |
| 第 4 阶段 | 岗位和招聘会信息 | ✅ 完成 |
| 第 5 阶段 | 管理员后台 | 骨架完成，内容待填充 |
| 第 6 阶段 | 合作机构后台 | 骨架完成，内容待填充 |
| 第 7 阶段 | 后端 API | 未开始 |
| 第 8 阶段 | Windows Terminal Agent | 未开始 |

---

## 五、Phase 3 封板记录（2026-05-25）

### 完成内容

| 模块 | 页面数 | 路由 |
|------|--------|------|
| 打印流程 | 5 | /print/upload → preview → confirm → progress → done |
| 扫描流程 | 4 | /scan/start → settings → progress → result |
| AI简历服务 | 5 | /resume/source → parse → report → optimize → export |
| 我的记录 | 1 | /profile |

### 数据状态

- 全部为 mock 数据 + `location.state` 传递，本阶段不接后端
- DEV 模拟失败按钮均通过 `import.meta.env.DEV` 隔离，生产 build 不包含

### 验收结果

- pnpm lint：✅ 0 warnings
- pnpm typecheck：✅ 0 errors
- pnpm build：✅ 三端均通过
- P1 白屏修复：`ResumeReportPage if (!report) return null` 改为错误引导页 ✅
- 合规词全文审查：一键投递/立即投递/HR查看/候选人/录用率等均未出现 ✅

---

## 六、Phase 4 完成记录（2026-05-25）

### 完成内容

| 模块 | 页面 | 路由 |
|------|------|------|
| 岗位列表 | JobsPage | /jobs |
| 岗位详情 | JobDetailPage | /jobs/:id |
| 招聘会列表 | JobFairsPage | /job-fairs |
| 招聘会详情 | JobFairDetailPage | /job-fairs/:id |

### 类型扩展

- `packages/shared/src/types/job.ts` 新增 `ExternalJob`、`ExternalJobFair`、`JobFairStatus`
- 所有外部数据类型继承 `ExternalJobSource`，强制包含：`sourceOrgId`、`externalId`、`sourceName`、`sourceUrl`、`syncTime`、`reviewStatus`、`publishStatus`

### 合规边界执行情况

| 检查项 | 结果 |
|--------|------|
| 按钮文案：查看详情 / 去来源平台投递 / 扫码投递 | ✅ |
| 按钮文案：去来源平台预约 / 扫码预约 | ✅ |
| 无"一键投递"/"立即投递"/"投递简历" | ✅ |
| 无"候选人"/"HR 查看"/"推荐给企业" | ✅ |
| 每个岗位/招聘会展示来源机构、同步时间、外部ID | ✅ |
| 页面内合规说明文案（不参与招聘流程） | ✅ |
| "去来源平台投递"以扫码形式模拟（Kiosk 不支持直接跳转外链） | ✅ |

### 验收结果

- pnpm lint：✅ 0 warnings
- pnpm typecheck：✅ 0 errors
- pnpm build：✅ 三端均通过

---

## 七、正确开发节奏

```
干净架构 → 设计系统 → 核心页面 → 后端 API → 打印机对接 → 上线测试
```

不要跳过设计系统直接写页面。  
不要在旧秒哒项目里继续堆功能。  
不要一次性想完成所有功能。

---

## 八、更新记录

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
| 2026-05-24 | Phase 3 打印流程完成：PrintUploadPage→PreviewPage→ConfirmPage→ProgressPage→DonePage，含成功/失败/重试路径；DEV 模拟失败按钮；CONTROL_FIELDS 黑名单重试；Mavis 视觉修复；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-24 | Phase 3 扫描流程完成：ScanStartPage→SettingsPage→ProgressPage→ResultPage，4 页扫描流程，含类型选择/参数配置/进度/结果；DEV 模拟失败；黑名单重试；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-24 | Phase 3 AI简历服务完成：ResumeSourcePage→ParsePage→ReportPage→OptimizePage→ExportPage，5 页流程；合规说明；DEV 模拟失败；ProfilePage 整合承接；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 3 封板：P1白屏修复（ResumeReportPage return null → ErrorState），lint/typecheck/build 全通过，合规词审查通过，推送 GitHub main | Claude Code |
| 2026-05-25 | Phase 4 完成：JobsPage+JobDetailPage+JobFairsPage+JobFairDetailPage，ExternalJob/ExternalJobFair 类型扩展，合规边界执行，lint/typecheck/build 全通过 | Claude Code |

---

> 每次完成开发任务后，请更新本文档的任务清单和更新记录。
