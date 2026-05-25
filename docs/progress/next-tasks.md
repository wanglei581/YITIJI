# 下一步任务

> 最后更新：2026-05-25（新增 Phase 9 UI Polish 规划）  
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

### Phase 2 - 页面框架与导航接线（已完成 2026-05-24）

| 交付项 | 状态 |
|--------|------|
| 三端路由骨架（React Router v7） | ✅ |
| KioskLayout 底部导航联动 | ✅ |
| AdminLayout 14 路由侧栏联动 | ✅ |
| PartnerLayout 10 路由菜单联动 | ✅ |
| Fast Refresh warning 修复 | ✅ |
| Playwright 截图验收 | ✅ |

### Phase 3 - 一体机前台 MVP（已封板 2026-05-25）

| 模块 | 页面 | 状态 |
|------|------|------|
| 打印流程 | 5页（upload→preview→confirm→progress→done） | ✅ |
| 扫描流程 | 4页（start→settings→progress→result） | ✅ |
| AI简历服务 | 5页（source→parse→report→optimize→export） | ✅ |
| 我的记录 | 1页（profile，整合三流程承接） | ✅ |
| P1 白屏修复 | ResumeReportPage ErrorState | ✅ |

**数据状态**：全部 mock + location.state，不接后端  
**合规**：禁用文案审查通过，DEV 失败按钮隔离 ✅  
**构建**：lint/typecheck/build 全通过 ✅

### Phase 4 - 岗位和招聘会信息（已完成 2026-05-25）

| 模块 | 页面 | 状态 |
|------|------|------|
| 岗位列表 | JobsPage（5条mock岗位，标签筛选） | ✅ |
| 岗位详情 | JobDetailPage（完整信息+来源+合规说明） | ✅ |
| 招聘会列表 | JobFairsPage（3条mock招聘会，状态筛选） | ✅ |
| 招聘会详情 | JobFairDetailPage（详情+来源+合规+打印资料） | ✅ |

**类型**：`ExternalJob`、`ExternalJobFair`、`JobFairStatus` 已加入 packages/shared  
**合规**：去来源平台投递/扫码投递/扫码预约，无一键投递/候选人等禁用文案 ✅  
**构建**：lint/typecheck/build 全通过 ✅

---

## 🚧 Phase 5 - 管理员后台（待填充内容）

当前状态：路由骨架已完成（14路由），各页面为 EmptyState 占位。

### 优先填充页面（建议顺序）

| 优先级 | 页面 | 说明 |
|--------|------|------|
| P0 | 工作台（Dashboard） | 关键指标卡：在线终端数、今日打印量、待处理告警 |
| P0 | 终端管理 | 终端列表、在线状态、最后心跳时间 |
| P0 | 订单管理 | 打印订单列表、状态筛选、详情 |
| P1 | 告警中心 | 告警列表、级别标签、处理状态 |
| P1 | 文件管理 | 文件列表、有效期、删除日志 |
| P2 | AI服务管理 | 调用量、成功率、错误日志 |
| P2 | 日志审计 | 操作日志列表、筛选 |
| P3 | 权限管理 | 角色/用户管理 |

---

## 🚧 Phase 6 - 合作机构后台（待填充内容）

当前状态：路由骨架已完成（10路由），各页面为 EmptyState 占位。

### 优先填充页面（建议顺序）

| 优先级 | 页面 | 说明 |
|--------|------|------|
| P0 | 岗位信息管理 | 岗位列表、审核状态、上架/下架 |
| P0 | 招聘会信息管理 | 招聘会列表、状态管理 |
| P1 | 数据源管理 | 同步配置、上次同步时间 |
| P1 | 同步日志 | 同步历史、成功/失败记录 |
| P2 | 数据统计 | 展示量、跳转量 |

---

## 决策待定项（Phase 7 前确定）

| 待定事项 | 说明 |
|---------|------|
| 后端语言 | NestJS 还是 FastAPI |
| 部署方案 | 云服务器还是本地 |
| 文件存储 | MinIO / 阿里云 OSS / 腾讯 COS |

---

---

## 📋 Phase 9 - UI Polish / Kiosk 视觉升级（Phase 8 完成后启动）

> **触发条件**：Phase 5 Admin、Phase 6 Partner、Phase 7 API、Phase 8 设备联调全部完成后，统一升级 Kiosk 前台视觉质感。  
> **不提前做**：当前页面功能完整、合规边界清晰，视觉打磨属于锦上添花，不阻塞核心流程交付。

### 升级目标

参考秒哒成熟页面质感，不照抄，在现有设计系统基础上提升层级感和专业度。

### 升级范围

| 模块 | 当前状态 | 升级方向 |
|------|---------|---------|
| **首页** | 功能卡片平铺，层级单一 | 强化业务入口视觉层级；图标质感升级；主入口卡片与次入口卡片区分更明确 |
| **打印/扫描/AI简历流程页** | 基础布局，空白区域多 | 增强步骤进度感（步骤条或分段指示器）；状态反馈更丰富；减少空旷感 |
| **岗位/招聘会列表与详情** | 信息卡片层级偏平 | 岗位卡片主次信息层级更清晰；薪资/标签/来源信息排版升级；状态徽章更专业 |
| **我的记录（ProfilePage）** | 四个 section 平铺 | 文件/订单/AI记录分区视觉更像真实产品；空状态高度压缩；卡片信息密度提升 |
| **二维码弹层** | 基础占位框 | 统一弹层美化；QR 区域视觉优化；操作说明排版升级 |
| **失败态 / 空状态** | 基础 ErrorState/EmptyState | 插画/图标升级；文案更具引导性；操作按钮更突出 |

### 执行约束

- 保持所有合规边界，**不新增**招聘闭环、一键投递、候选人管理等功能
- 不破坏现有 location.state 数据流，只改样式不改逻辑
- 升级后必须通过 lint/typecheck/build 全量验证
- 视觉升级参考秒哒风格，但所有代码重新编写，不复制旧代码

---

## 近期不做

- 后端 API（第 7 阶段）
- Windows Terminal Agent（第 8 阶段）
- 奔图打印机接口对接（第 8 阶段）
- **Kiosk 视觉打磨（第 9 阶段）** ← Phase 8 完成前不启动
- 企业招聘端（已确认删除，不开发）
