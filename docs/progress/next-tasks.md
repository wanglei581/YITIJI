# 下一步任务

> 最后更新：2026-05-23  
> 关联文档：[current-progress.md](./current-progress.md)

---

## ✅ Phase 0 封板确认

Phase 0 已完成全部验收项：

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

**结论：Phase 0 正式封板。可以进入 Phase 1：设计系统。**

---

## 当前待执行：第 1 阶段 - 设计系统

### 前置步骤（进入 Phase 1 前做一次）

- [ ] 执行首次 git commit（staged 内容已干净，可直接提交）
- [ ] 初始化 shadcn/ui（`pnpm dlx shadcn@latest init`）到 packages/ui

### 设计 Token 定义

- [ ] 颜色 token（主色科技蓝 #2563EB、成功绿、警告橙、错误红、背景浅灰 #F9FAFB）
- [ ] 字体规范（字号阶梯 xs/sm/base/lg/xl/2xl/3xl，行高，字重）
- [ ] 间距系统（基于 4px 基准，Tailwind spacing 复用）
- [ ] 圆角系统（卡片 8~12px，按钮 8px，标签 4px/full）
- [ ] 阴影系统（轻阴影 shadow-sm，卡片 shadow）

### 组件规范文档

- [ ] 按钮规范（已有 Button 组件，补充使用指南）
- [ ] 卡片规范（白底 + 1px border-gray-200 + shadow-sm）
- [ ] 状态标签规范（5 种状态配色已定义，补充使用场景）
- [ ] 表格规范（列对齐、行高、操作列位置）
- [ ] 表单规范（标签位置、错误提示样式）

### 状态组件

- [ ] EmptyState 组件（图标 + 标题 + 描述 + 可选操作按钮）
- [ ] LoadingState 组件（Spinner + 提示文字）
- [ ] ErrorState 组件（错误图标 + 错误信息 + 重试按钮）

### 布局组件

- [ ] KioskLayout（一体机全屏布局，底部导航：首页/AI助手/我的）
- [ ] AdminLayout（左侧菜单 + 顶部 header + 内容区）
- [ ] PartnerLayout（与 Admin 相近，权限范围不同）

### 暗黑模式

- [ ] Tailwind dark: 变体基础配置
- [ ] 颜色 token 区分 light/dark 值

---

## 决策待定项

| 待定事项 | 说明 |
|---------|------|
| 后端语言 | NestJS 还是 FastAPI？当前阶段只做前端，Phase 7 前决定 |
| 部署方案 | 云服务器还是本地？Phase 7 前决定 |

---

## 近期不需要做的事

- 后端 API（第 7 阶段）
- Windows Terminal Agent（第 8 阶段）
- 奔图打印机接口对接（第 8 阶段）
- 数据统计报表（P2）
- 企业招聘端（已确认删除，不开发）
