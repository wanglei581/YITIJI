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

**当前阶段：第 0 阶段 - 项目初始化（未开始）**

文档体系已建立（2026-05-23 完成）：
- [x] CLAUDE.md
- [x] AGENTS.md（Codex 项目说明）
- [x] README.md
- [x] docs/product/feature-scope.md
- [x] docs/compliance/compliance-boundary.md
- [x] docs/device/pantum-cm2820adn.md
- [x] docs/decisions/ai-collaboration-rules.md
- [x] docs/progress/current-progress.md
- [x] docs/progress/next-tasks.md

项目初始化任务（待开始）：
- [ ] 创建 monorepo 项目结构（ai-job-print-terminal/）
- [ ] 初始化 apps/kiosk（React + Vite + TypeScript）
- [ ] 初始化 apps/admin
- [ ] 初始化 apps/partner
- [ ] 初始化 Tailwind CSS
- [ ] 初始化 shadcn/ui
- [ ] 初始化 ESLint / Prettier
- [ ] 创建 .env.example
- [ ] 验证项目可以启动

---

## 三、优先级任务列表

### P0（MVP 核心，立即开发）

- [ ] 新建正式项目（monorepo 结构）
- [ ] 建立设计系统（颜色/字体/按钮/卡片/状态标签规范）
- [ ] 完成一体机首页
- [ ] 完成打印扫描核心流程
- [ ] 完成管理员后台基础框架
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
| 第 0 阶段 | 项目初始化 | 未开始 |
| 第 1 阶段 | 设计系统 | 未开始 |
| 第 2 阶段 | 公共组件 | 未开始 |
| 第 3 阶段 | 一体机前台 | 未开始 |
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

---

> 每次完成开发任务后，请更新本文档的任务清单和更新记录。
