# 下一步任务

> 最后更新：2026-05-24  
> 关联文档：[current-progress.md](./current-progress.md)

---

## ✅ 已完成阶段

### Phase 0 - 项目初始化（已封板）

| 验收项 | 状态 |
|--------|------|
| pnpm lint | ✅ 通过（零报错） |
| pnpm typecheck | ✅ 通过（零错误） |
| pnpm build | ✅ 三端均通过（Vite 6.4.2） |
| pnpm audit | ✅ No known vulnerabilities found |
| .gitattributes（LF 统一） | ✅ 已补全 |
| .DS_Store / zip 已移出 git 索引 | ✅ 已清理 |
| 合规边界干净（无禁用文案/密钥泄漏） | ✅ 审查通过 |
| 三端 app 引用 ui/shared 公共包 | ✅ 已验证 |

### Phase 1 - 设计系统基建（已完成）

| 交付项 | 状态 |
|--------|------|
| tokens.css（@theme 变量） | ✅ |
| cn 工具（clsx + twMerge） | ✅ |
| Button/Card/StatusBadge/PageHeader cva 重构 | ✅ |
| Spinner/EmptyState/LoadingState/ErrorState | ✅ |
| KioskLayout/AdminLayout/PartnerLayout | ✅ |
| 三端 `@source` 样式扫描修复 | ✅ |
| pnpm lint/typecheck/build/audit 复核通过 | ✅ |

---

## ✅ Phase 2 - 页面框架与导航接线（已完成 2026-05-24）

### P0（已完成）

- [x] 接入 React Router：`kiosk/admin/partner` 三端路由骨架
- [x] `KioskLayout` 底部导航与路由联动（首页/AI助手/我的）
- [x] `AdminLayout` 侧栏菜单与路由联动（14 个模块）
- [x] `PartnerLayout` 菜单与路由联动（10 个模块）
- [x] 新建 `apps/*/src/routes` 与页面占位（全部 EmptyState 占位）
- [x] Kiosk `/policy` 路由接通首页"查看政策"按钮
- [x] Admin/Partner 路由结构统一：router 抽至 `routes/index.tsx`，布局组件抽至 `layouts/`，App.tsx 为薄包装
- [x] Fast Refresh warning 修复：布局组件与 router 拆分到独立文件
- [x] 废弃 `apps/admin/src/routes/settings/` 目录已删除

### P1（已完成）

- [x] 统一状态容器（EmptyState/LoadingState/ErrorState）在三端复用
- [x] 完成 Phase 2 验收：三端路由全部 200，截图确认，lint/typecheck 通过

---

## 决策待定项（Phase 7 前确定）

| 待定事项 | 说明 |
|---------|------|
| 后端语言 | NestJS 还是 FastAPI |
| 部署方案 | 云服务器还是本地 |

---

## 近期不做

- 后端 API（第 7 阶段）
- Windows Terminal Agent（第 8 阶段）
- 奔图打印机接口对接（第 8 阶段）
- 企业招聘端（已确认删除，不开发）
