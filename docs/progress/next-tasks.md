# 下一步任务

> 最后更新：2026-05-23  
> 关联文档：[current-progress.md](./current-progress.md)

---

## 当前待执行：第 0 阶段 - 项目初始化

### 任务清单

- [ ] **搭建 monorepo 基础结构**
  - 创建 `apps/kiosk/`、`apps/admin/`、`apps/partner/` 三个前端应用
  - 考虑使用 pnpm workspace 或 Turborepo 管理 monorepo
  - 创建 `packages/ui/` 和 `packages/shared/`

- [ ] **初始化 kiosk 前端应用**（优先）
  - React + Vite + TypeScript
  - Tailwind CSS
  - shadcn/ui 组件库
  - lucide-react 图标
  - ESLint + Prettier

- [ ] **初始化 admin 前端应用**
  - 同上技术栈
  - 可复用 kiosk 的配置

- [ ] **初始化 partner 前端应用**
  - 同上技术栈

- [ ] **创建 .env.example**
  - 列出所有需要配置的环境变量（不含真实值）

- [ ] **验证项目可以启动**
  - `npm run dev`（或 pnpm）能启动 kiosk、admin、partner
  - 基础页面可以访问

---

## 第 0 阶段完成后，进入第 1 阶段 - 设计系统

- [ ] 定义颜色 token（主色科技蓝、成功绿、警告橙、错误红、背景浅灰）
- [ ] 定义字体规范
- [ ] 定义按钮规范（触控区域 ≥ 56px）
- [ ] 定义卡片规范（白底 + 1px 边框 + 轻阴影 + 8~12px 圆角）
- [ ] 定义状态标签规范
- [ ] 定义空状态/加载/错误状态组件
- [ ] 建立暗黑模式基础

---

## 决策待定项

| 待定事项 | 说明 |
|---------|------|
| monorepo 工具 | pnpm workspace 还是 Turborepo？建议优先简单方案 |
| 后端语言 | NestJS 还是 FastAPI？当前阶段可先只做前端 |
| 部署方案 | 云服务器还是本地？当前阶段暂不需要决定 |

---

## 近期不需要做的事

- 后端 API（第 7 阶段）
- Windows Terminal Agent（第 8 阶段）
- 奔图打印机接口对接（第 8 阶段）
- 数据统计报表（P2）
